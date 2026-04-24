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

const path = require("path");
const { CONTENT_SECURITY_POLICY } = require("./csp.js");

// Must set before any Playwright code loads — bundled Chromium lives in Resources
if (app.isPackaged && process.resourcesPath) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(
    process.resourcesPath,
    "playwright-browsers"
  );
}

const { startServer } = require("./server/index.js");

const PORT = process.env.PORT || 3000;
const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "PerfTrace — Performance Testing",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
    icon: path.join(__dirname, "client/public/favicon.svg"),
  });

  const url = `http://localhost:${PORT}`;
  mainWindow.loadURL(url);

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
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
