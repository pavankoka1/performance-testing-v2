/**
 * Builds the Vite/React site and copies dist/ → .vercel/output/static for prebuilt deploy.
 * .cjs so it runs under website/package.json "type": "module".
 */
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const outputDir = path.join(root, ".vercel", "output");
const staticDir = path.join(outputDir, "static");
const distDir = path.join(root, "dist");

fs.rmSync(staticDir, { recursive: true, force: true });
fs.mkdirSync(staticDir, { recursive: true });

if (!fs.existsSync(path.join(root, "node_modules"))) {
  console.log("[prepare] npm install…");
  execSync("npm install", { cwd: root, stdio: "inherit" });
}

console.log("[prepare] npm run build (Vite)…");
execSync("npm run build", { cwd: root, stdio: "inherit" });

if (!fs.existsSync(distDir)) {
  throw new Error(`Expected ${distDir} after vite build`);
}

fs.cpSync(distDir, staticDir, { recursive: true });
console.log("[prepare] Copied dist/ → .vercel/output/static");

fs.writeFileSync(
  path.join(outputDir, "config.json"),
  JSON.stringify({ version: 3 }, null, 2)
);
console.log("[prepare] Created Build Output API config.json");
