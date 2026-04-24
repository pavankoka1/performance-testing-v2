/**
 * Preload script for PerfTrace Electron app.
 * Exposes safe APIs to the renderer if needed (e.g. platform info).
 */
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("perftrace", {
  platform: process.platform,
  version: process.env.npm_package_version || "0.1.0",
  isElectron: true,
});
