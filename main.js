/**
 * Electron main process for PerfTrace desktop app.
 * Starts Express server, then opens the app in a native window.
 */
const { app, BrowserWindow, session } = require("electron");

/**
 * Must run before the GPU process starts. Avoids ANGLE/Metal pipeline XPC failures on macOS.
 * Only force OpenGL if explicitly requested.
 */
if (process.platform === "darwin" && process.env.PERFTRACE_FORCE_ANGLE_GL === "1") {
  app.commandLine.appendSwitch("use-angle", "gl");
}

const fs = require("fs");
const path = require("path");
const { CONTENT_SECURITY_POLICY } = require("./csp.js");

// Must set before any Playwright code loads — bundled Chromium lives in Resources
if (app.isPackaged && process.resourcesPath) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.normalize(
    path.join(process.resourcesPath, "playwright-browsers")
  );
}

/**
 * Fail fast with a clear message if the packaged browser folder is missing or incomplete.
 * End users do not run `npx playwright install`; a broken zip or AV-quarantined chrome.exe
 * otherwise surfaces as the opaque Windows error "cannot access the specified device, path, or file."
 */
if (app.isPackaged && process.env.PLAYWRIGHT_BROWSERS_PATH) {
  try {
    const { chromium } = require("playwright");
    const exe = chromium.executablePath();
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

const { startServer } = require("./server/index.js");

const PORT = process.env.PORT || 3000;
const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;

let mainWindow = null;

/**
 * Dock / title-bar icon: use packaged raster or ICNS — never the tiny SVG favicon on macOS
 * (SVG scales poorly and looked horizontally squeezed next to the real app bundle icon).
 */
function resolveWindowIconPath() {
  const assetsDir = path.join(__dirname, "assets");
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
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    fullscreenable: true,
    title: "PerfTrace — Performance Testing",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
    ...(iconPath ? { icon: iconPath } : {}),
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
