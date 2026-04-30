/**
 * @see https://playwright.dev/docs/test-configuration
 *
 * Windows: if you see "Windows cannot access the specified device, path, or file"
 * when the browser starts (not from the site under test):
 * - Reinstall browsers: npx playwright install chromium --force
 * - Allow %LOCALAPPDATA%\ms-playwright in Windows Security → Virus & threat protection
 *   (Defender "Controlled folder access" / corporate AV often blocks Playwright’s Chromium)
 * - Run the terminal as a normal user with write access to the above folder
 * - Avoid running from a network drive or a path the account cannot execute
 */
// @ts-check
const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./e2e",
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    launchOptions: {
      /** Helps some GPU/driver combos on Windows headed runs */
      args: ["--disable-dev-shm-usage"],
    },
  },
});
