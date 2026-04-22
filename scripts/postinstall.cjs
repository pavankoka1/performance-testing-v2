#!/usr/bin/env node
/**
 * Root postinstall: install client deps; install Playwright browser only locally (not on Vercel CI).
 */
const { execSync } = require("child_process");
const path = require("path");

const root = path.join(__dirname, "..");

execSync("npm install --prefix client", { stdio: "inherit", cwd: root });

if (process.env.VERCEL) {
  console.log("[postinstall] skipping playwright install chromium on Vercel");
  process.exit(0);
}

execSync("npx playwright install chromium", { stdio: "inherit", cwd: root });
