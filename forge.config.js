/**
 * Electron Forge config. Excludes build output and large files from packaging.
 * The "out" directory from previous builds can exceed 4.2GB (asar limit) if included.
 */
module.exports = {
  packagerConfig: {
    name: "PerfTrace",
    executableName: "PerfTrace",
    asar: true,
    ignore: (path) => {
      if (!path) return false;
      // Exclude build output (contains large .dmg files from previous builds)
      if (path === "/out" || path.startsWith("/out/")) return true;
      if (path.endsWith(".dmg")) return true;
      // Standard exclusions
      if (path.includes("/.git/") || path === "/.git") return true;
      if (path === "/.env" || path.startsWith("/.env.")) return true;
      if (path.match(/\.log$/)) return true;
      if (path.startsWith("/client/node_modules")) return true;
      if (path.includes("/node_modules/.cache")) return true;
      return false;
    },
  },
  makers: [
    {
      name: "@electron-forge/maker-zip",
      platforms: ["darwin", "win32", "linux"],
    },
    { name: "@electron-forge/maker-dmg", config: {} },
  ],
};
