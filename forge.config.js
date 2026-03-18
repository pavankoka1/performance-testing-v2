/**
 * Electron Forge config. Excludes build output and large files from packaging.
 * Bundles Playwright Chromium so the app works on other machines without install.
 */
const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");

module.exports = {
  packagerConfig: {
    name: "PerfTrace",
    executableName: "PerfTrace",
    asar: true,
    // electron-packager uses extraResource (singular) — path(s) copied to Resources/
    extraResource: path.join(__dirname, "playwright-browsers"),
    // Universal build: Chromium binaries are arch-specific but identical in both packages (we bundle both).
    // Tell @electron/universal to skip lipo for these.
    osxUniversal: {
      x64ArchFiles: "**/playwright-browsers/**",
    },
    ignore: (filePath) => {
      if (!filePath) return false;
      if (filePath === "/out" || filePath.startsWith("/out/")) return true;
      if (filePath.endsWith(".dmg")) return true;
      if (filePath.includes("/.git/") || filePath === "/.git") return true;
      if (filePath === "/.env" || filePath.startsWith("/.env.")) return true;
      if (filePath.match(/\.log$/)) return true;
      if (filePath.startsWith("/client/node_modules")) return true;
      if (filePath.includes("/node_modules/.cache")) return true;
      if (filePath.startsWith("/playwright-browsers")) return true;
      return false;
    },
  },
  hooks: {
    prePackage: async (forgeConfig, platform, arch) => {
      const browsersPath = path.join(__dirname, "playwright-browsers");
      const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsersPath };
      const browsersJson = require("./node_modules/playwright-core/browsers.json");
      const chromium = browsersJson.browsers.find((b) => b.name === "chromium");
      const ffmpeg = browsersJson.browsers.find((b) => b.name === "ffmpeg");
      const version = chromium.browserVersion;
      const chromiumDir = path.join(
        browsersPath,
        `chromium-${chromium.revision}`
      );
      const ffmpegDir = path.join(browsersPath, `ffmpeg-${ffmpeg.revision}`);

      const downloadAndExtract = async (
        url,
        zipPath,
        extractDir,
        destFolder,
        destDir
      ) => {
        const targetDir = destDir || chromiumDir;
        fs.mkdirSync(extractDir, { recursive: true });
        execSync(`curl -fsSL "${url}" -o "${zipPath}"`, {
          stdio: "inherit",
          cwd: __dirname,
        });
        execSync(`unzip -o -q "${zipPath}" -d "${extractDir}"`, {
          stdio: "inherit",
          cwd: __dirname,
        });
        const src = path.join(extractDir, destFolder);
        const dest = path.join(targetDir, destFolder);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true });
        if (fs.existsSync(src)) fs.renameSync(src, dest);
      };

      const downloadAndExtractToDir = async (
        url,
        zipPath,
        extractDir,
        targetDir
      ) => {
        fs.mkdirSync(extractDir, { recursive: true });
        fs.mkdirSync(targetDir, { recursive: true });
        execSync(`curl -fsSL "${url}" -o "${zipPath}"`, {
          stdio: "inherit",
          cwd: __dirname,
        });
        execSync(`unzip -o -q "${zipPath}" -d "${extractDir}"`, {
          stdio: "inherit",
          cwd: __dirname,
        });
        const entries = fs.readdirSync(extractDir, { withFileTypes: true });
        for (const e of entries) {
          const src = path.join(extractDir, e.name);
          const dest = path.join(targetDir, e.name);
          if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true });
          fs.renameSync(src, dest);
        }
      };

      const cleanup = (zipPath, extractDir) => {
        try {
          if (zipPath) fs.rmSync(zipPath, { force: true });
          if (extractDir)
            fs.rmSync(extractDir, { recursive: true, force: true });
        } catch (_) {}
      };

      if (platform === "win32") {
        // Cross-build: host is likely Mac/Linux, so download Windows Chromium + ffmpeg directly
        const zipPath = path.join(__dirname, ".tmp-chrome-win64.zip");
        const extractDir = path.join(__dirname, ".tmp-chrome-extract");
        const ffmpegZip = path.join(__dirname, ".tmp-ffmpeg-win64.zip");
        const ffmpegExtract = path.join(__dirname, ".tmp-ffmpeg-extract");
        try {
          console.log(
            "[PerfTrace] Downloading Windows Chromium for bundling..."
          );
          if (fs.existsSync(chromiumDir))
            fs.rmSync(chromiumDir, { recursive: true });
          fs.mkdirSync(chromiumDir, { recursive: true });
          await downloadAndExtract(
            `https://cdn.playwright.dev/builds/cft/${version}/win64/chrome-win64.zip`,
            zipPath,
            extractDir,
            "chrome-win64"
          );
          console.log("[PerfTrace] Windows Chromium ready at", chromiumDir);

          console.log("[PerfTrace] Downloading Windows ffmpeg for bundling...");
          if (fs.existsSync(ffmpegDir))
            fs.rmSync(ffmpegDir, { recursive: true });
          await downloadAndExtractToDir(
            `https://cdn.playwright.dev/builds/ffmpeg/${ffmpeg.revision}/ffmpeg-win64.zip`,
            ffmpegZip,
            ffmpegExtract,
            ffmpegDir
          );
          console.log("[PerfTrace] Windows ffmpeg ready at", ffmpegDir);
        } catch (e) {
          throw new Error(`Failed to download Windows binaries: ${e.message}`);
        } finally {
          cleanup(zipPath, extractDir);
          cleanup(ffmpegZip, ffmpegExtract);
        }
      } else if (platform === "linux") {
        // Cross-build: host is likely Mac/Linux, so download Linux Chromium + ffmpeg directly
        const zipPath = path.join(__dirname, ".tmp-chrome-linux64.zip");
        const extractDir = path.join(__dirname, ".tmp-chrome-extract");
        const ffmpegZip = path.join(__dirname, ".tmp-ffmpeg-linux.zip");
        const ffmpegExtract = path.join(__dirname, ".tmp-ffmpeg-extract");
        try {
          console.log("[PerfTrace] Downloading Linux Chromium for bundling...");
          if (fs.existsSync(chromiumDir))
            fs.rmSync(chromiumDir, { recursive: true });
          fs.mkdirSync(chromiumDir, { recursive: true });
          await downloadAndExtract(
            `https://cdn.playwright.dev/builds/cft/${version}/linux64/chrome-linux64.zip`,
            zipPath,
            extractDir,
            "chrome-linux64"
          );
          console.log("[PerfTrace] Linux Chromium ready at", chromiumDir);

          console.log("[PerfTrace] Downloading Linux ffmpeg for bundling...");
          if (fs.existsSync(ffmpegDir))
            fs.rmSync(ffmpegDir, { recursive: true });
          await downloadAndExtractToDir(
            `https://cdn.playwright.dev/builds/ffmpeg/${ffmpeg.revision}/ffmpeg-linux.zip`,
            ffmpegZip,
            ffmpegExtract,
            ffmpegDir
          );
          console.log("[PerfTrace] Linux ffmpeg ready at", ffmpegDir);
        } catch (e) {
          throw new Error(`Failed to download Linux binaries: ${e.message}`);
        } finally {
          cleanup(zipPath, extractDir);
          cleanup(ffmpegZip, ffmpegExtract);
        }
      } else {
        // darwin: install Chromium + ffmpeg for current arch, then add other arch for universal
        console.log(
          "[PerfTrace] Installing Chromium and ffmpeg for bundling..."
        );
        execSync("npx playwright install chromium ffmpeg", {
          stdio: "inherit",
          env,
        });
      }

      // For universal macOS: add the OTHER architecture so both Intel and Apple Silicon work.
      // arch -x86_64 fails when node is arm64-only; Playwright removes existing browsers if we
      // remove markers. So we manually download the other-arch zip and extract into the same dir.
      const isUniversalMac = platform === "darwin" && arch === "universal";
      if (isUniversalMac) {
        if (process.arch === "arm64") {
          // Add x64 for Intel Macs
          const url = `https://cdn.playwright.dev/builds/cft/${version}/mac-x64/chrome-mac-x64.zip`;
          const zipPath = path.join(__dirname, ".tmp-chrome-mac-x64.zip");
          const extractDir = path.join(__dirname, ".tmp-chrome-extract");
          try {
            console.log(
              "[PerfTrace] Downloading x64 Chromium for Intel Mac compatibility..."
            );
            fs.mkdirSync(extractDir, { recursive: true });
            execSync(`curl -fsSL "${url}" -o "${zipPath}"`, {
              stdio: "inherit",
              cwd: __dirname,
            });
            execSync(`unzip -o -q "${zipPath}" -d "${extractDir}"`, {
              stdio: "inherit",
              cwd: __dirname,
            });
            const src = path.join(extractDir, "chrome-mac-x64");
            const dest = path.join(chromiumDir, "chrome-mac-x64");
            if (fs.existsSync(src)) fs.renameSync(src, dest);
            console.log("[PerfTrace] x64 Chromium added to", chromiumDir);
          } catch (e) {
            console.warn(
              "[PerfTrace] x64 Chromium skipped:",
              e.message,
              "- Universal build will work on Apple Silicon only."
            );
          } finally {
            try {
              fs.rmSync(zipPath, { force: true });
              fs.rmSync(extractDir, { recursive: true, force: true });
            } catch (_) {}
          }
        } else if (process.arch === "x64") {
          // Add arm64 for Apple Silicon Macs
          const url = `https://cdn.playwright.dev/builds/cft/${version}/mac-arm64/chrome-mac-arm64.zip`;
          const zipPath = path.join(__dirname, ".tmp-chrome-mac-arm64.zip");
          const extractDir = path.join(__dirname, ".tmp-chrome-extract");
          try {
            console.log(
              "[PerfTrace] Downloading arm64 Chromium for Apple Silicon compatibility..."
            );
            fs.mkdirSync(extractDir, { recursive: true });
            execSync(`curl -fsSL "${url}" -o "${zipPath}"`, {
              stdio: "inherit",
              cwd: __dirname,
            });
            execSync(`unzip -o -q "${zipPath}" -d "${extractDir}"`, {
              stdio: "inherit",
              cwd: __dirname,
            });
            const src = path.join(extractDir, "chrome-mac-arm64");
            const dest = path.join(chromiumDir, "chrome-mac-arm64");
            if (fs.existsSync(src)) fs.renameSync(src, dest);
            console.log("[PerfTrace] arm64 Chromium added to", chromiumDir);
          } catch (e) {
            console.warn(
              "[PerfTrace] arm64 Chromium skipped:",
              e.message,
              "- Universal build will work on Intel Macs only."
            );
          } finally {
            try {
              fs.rmSync(zipPath, { force: true });
              fs.rmSync(extractDir, { recursive: true, force: true });
            } catch (_) {}
          }
        }
      }

      console.log("[PerfTrace] Chromium ready at", browsersPath);
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
