/**
 * Electron main process for PerfTrace desktop app.
 * Starts Express server, then opens the app in a native window.
 */
const { app, BrowserWindow, session, nativeImage } = require("electron");

/**
 * Must run before the GPU process starts. Avoids ANGLE/Metal pipeline XPC failures on macOS.
 * Only force OpenGL if explicitly requested.
 */
if (process.platform === "darwin" && process.env.PERFTRACE_FORCE_ANGLE_GL === "1") {
  app.commandLine.appendSwitch("use-angle", "gl");
}

const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");
const { CONTENT_SECURITY_POLICY } = require("./csp.js");

/**
 * playwright-core resolves some paths with INIT_CWD || process.cwd(). Must point at the app
 * root (where package.json + node_modules live), and must be set BEFORE require("playwright").
 */
if (app.isPackaged) {
  process.env.INIT_CWD = __dirname;
}

/**
 * Packaged app with a real on-disk app folder (Windows asar:false): set cwd to that folder so
 * paths can be built as path.join(process.cwd(), relative…) instead of path.resolve / long absolutes.
 * IMPORTANT: call only AFTER require("playwright") — changing cwd earlier breaks module resolution.
 */
function ensurePackagedCwdForRelativePaths() {
  if (!app.isPackaged) return;
  try {
    const ap = app.getAppPath();
    if (ap && !ap.endsWith(".asar")) {
      process.chdir(ap);
      return;
    }
  } catch (_) {
    /* ignore */
  }
  if (process.platform === "win32") {
    try {
      process.chdir(path.dirname(process.execPath));
    } catch (_) {
      /* ignore */
    }
  }
}

/**
 * Prefer paths relative to the app content root (cwd after ensurePackagedCwdForRelativePaths).
 * Falls back to app.asar.unpacked or __dirname when needed.
 */
function resolvePackagedDiskPathWin32(...relativeParts) {
  if (process.platform === "win32" && app.isPackaged && process.resourcesPath) {
    const unpacked = path.join(
      process.resourcesPath,
      "app.asar.unpacked",
      ...relativeParts
    );
    if (fs.existsSync(unpacked)) return unpacked;
    try {
      const ap = app.getAppPath();
      if (
        ap &&
        !ap.endsWith(".asar") &&
        !ap.toLowerCase().includes(`${path.sep}app.asar${path.sep}`)
      ) {
        const flat = path.join(ap, ...relativeParts);
        if (fs.existsSync(flat)) return path.join(process.cwd(), ...relativeParts);
      }
    } catch (_) {
      /* ignore */
    }
  }
  return path.join(__dirname, ...relativeParts);
}

/**
 * Run Chromium from %APPDATA%/…/userData/playwright-browsers (writable). Install dirs under
 * Program Files and some AV policies block executing bundled helpers from read-only trees.
 */
function ensureWindowsPlaywrightBrowsersInUserData() {
  const srcRoot = path.join(process.resourcesPath, "playwright-browsers");
  const destRoot = path.join(app.getPath("userData"), "playwright-browsers");
  let revision = "unknown";
  try {
    const browsersJson = require("./node_modules/playwright-core/browsers.json");
    const ch = browsersJson.browsers.find((b) => b.name === "chromium");
    if (ch?.revision != null) revision = String(ch.revision);
  } catch (_) {
    /* keep revision marker coarse */
  }

  function hasWinChromiumBundle(root) {
    try {
      if (!fs.existsSync(root)) return false;
      const names = fs.readdirSync(root);
      for (const name of names) {
        if (!name.startsWith("chromium")) continue;
        const exe = path.join(root, name, "chrome-win64", "chrome.exe");
        if (fs.existsSync(exe)) return true;
      }
    } catch (_) {
      /* ignore */
    }
    return false;
  }

  const marker = path.join(destRoot, `.perftrace-chromium-rev-${revision}.ok`);
  if (fs.existsSync(marker) && hasWinChromiumBundle(destRoot)) {
    return destRoot;
  }

  if (!hasWinChromiumBundle(srcRoot)) {
    return srcRoot;
  }

  try {
    if (fs.existsSync(destRoot)) {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
    fs.mkdirSync(path.dirname(destRoot), { recursive: true });
    fs.cpSync(srcRoot, destRoot, { recursive: true });
  } catch (e) {
    console.error(
      "[PerfTrace] Could not mirror Chromium to userData (using install dir):",
      e?.message || e
    );
    return srcRoot;
  }

  if (!hasWinChromiumBundle(destRoot)) {
    return srcRoot;
  }
  try {
    fs.writeFileSync(marker, revision, "utf8");
  } catch (_) {
    /* still use destRoot */
  }
  return destRoot;
}

// Must set before any Playwright code loads — bundled Chromium lives in Resources (mirrored on Win)
if (app.isPackaged && process.resourcesPath) {
  if (process.platform === "win32") {
    process.env.PLAYWRIGHT_BROWSERS_PATH = ensureWindowsPlaywrightBrowsersInUserData();
  } else {
    process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(
      process.resourcesPath,
      "playwright-browsers"
    );
  }
}

/**
 * Fail fast with a clear message if the packaged browser folder is missing or incomplete.
 * End users do not run `npx playwright install`; a broken zip or AV-quarantined chrome.exe
 * otherwise surfaces as the opaque Windows error "cannot access the specified device, path, or file."
 */
if (app.isPackaged && process.env.PLAYWRIGHT_BROWSERS_PATH) {
  try {
    const pkgJson = path.join(__dirname, "package.json");
    const rootRequire = fs.existsSync(pkgJson)
      ? createRequire(pkgJson)
      : require;
    const { chromium } = rootRequire("playwright");
    let exe = chromium.executablePath();
    if (exe && process.platform === "win32") {
      exe = path.normalize(exe);
    }
    if (!exe || !fs.existsSync(exe)) {
      const { dialog } = require("electron");
      dialog.showErrorBox(
        "PerfTrace — bundled Chromium not found",
        [
          "The packaged browser is missing or incomplete.",
          "",
          `Expected near:\n${process.env.PLAYWRIGHT_BROWSERS_PATH}`,
          "",
          "Try: reinstall from a fresh build; fully extract the .zip; right‑click the zip → Properties → Unblock before extracting; check antivirus did not quarantine files under playwright-browsers.",
        ].join("\n")
      );
      app.quit();
      process.exit(1);
    }
  } catch (e) {
    const { dialog } = require("electron");
    dialog.showErrorBox(
      "PerfTrace — browser check failed",
      e?.message || String(e)
    );
    app.quit();
    process.exit(1);
  }
}

ensurePackagedCwdForRelativePaths();

const { startServer } = require("./server/index.js");

const PORT = process.env.PORT || 3000;
const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;

let mainWindow = null;

/**
 * Dock / title-bar icon: use packaged raster or ICNS — never the tiny SVG favicon on macOS
 * (SVG scales poorly and looked horizontally squeezed next to the real app bundle icon).
 */
function resolveWindowIconPath() {
  const assetsDir = resolvePackagedDiskPathWin32("assets");
  const icns = path.join(assetsDir, "app-icon.icns");
  const png = path.join(assetsDir, "app-icon.png");
  const ico = path.join(assetsDir, "app-icon.ico");

  if (process.platform === "darwin") {
    if (fs.existsSync(icns)) return icns;
    if (fs.existsSync(png)) return png;
  }
  if (process.platform === "win32" && fs.existsSync(ico)) return ico;
  if (fs.existsSync(png)) return png;
  if (fs.existsSync(ico)) return ico;
  const svg = path.join(__dirname, "client", "public", "favicon.svg");
  if (fs.existsSync(svg)) return svg;
  return undefined;
}

function createWindow() {
  const iconPath = resolveWindowIconPath();
  let iconOption = {};
  if (iconPath && fs.existsSync(iconPath)) {
    try {
      const img = nativeImage.createFromPath(iconPath);
      if (!img.isEmpty()) iconOption = { icon: img };
    } catch (_) {
      /* fall through: no icon */
    }
  }

  const preloadPath = resolvePackagedDiskPathWin32("preload.js");
  if (process.platform === "win32" && app.isPackaged && !fs.existsSync(preloadPath)) {
    const { dialog } = require("electron");
    dialog.showErrorBox(
      "PerfTrace — preload not on disk",
      `Expected preload at:\n${preloadPath}\n\nRebuild the Windows app (win32 packages use asar:false in forge.config.js).`
    );
    app.quit();
    process.exit(1);
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    fullscreenable: true,
    title: "PerfTrace — Performance Testing",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
    ...iconOption,
  });

  const url = `http://localhost:${PORT}`;
  mainWindow.loadURL(url);

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    mainWindow.maximize();
    if (isDev) {
      mainWindow.webContents.openDevTools();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  try {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      const isLocalApp =
        /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(details.url) ||
        details.url.startsWith("file://");
      if (!isLocalApp) {
        callback({ responseHeaders: details.responseHeaders });
        return;
      }
      callback({
        responseHeaders: Object.assign({}, details.responseHeaders, {
          "Content-Security-Policy": [CONTENT_SECURITY_POLICY],
        }),
      });
    });

    await startServer(PORT);
    createWindow();
  } catch (err) {
    console.error("Failed to start PerfTrace:", err);
    try {
      const { dialog } = require("electron");
      dialog.showErrorBox(
        "PerfTrace — startup failed",
        err?.stack || err?.message || String(err)
      );
    } catch (_) {}
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (mainWindow === null) {
    createWindow();
  }
});
