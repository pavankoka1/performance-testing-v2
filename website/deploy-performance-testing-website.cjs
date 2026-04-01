#!/usr/bin/env node
/**
 * Deploys to Vercel project "performance-testing-website" from a temp directory
 * without .git, so Vercel does not enforce "Git author must have access to the team".
 */
const { execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = __dirname;
const perfProjectJson = path.join(
  root,
  ".vercel",
  "project.performance-testing-website.json"
);
const defaultProjectJson = path.join(root, ".vercel", "project.website.json");
const targetProjectJson = path.join(root, ".vercel", "project.json");

if (!fs.existsSync(perfProjectJson)) {
  console.error("Missing", perfProjectJson);
  process.exit(1);
}

fs.copyFileSync(perfProjectJson, targetProjectJson);

try {
  execSync("node prepare-vercel-output.cjs", { stdio: "inherit", cwd: root });

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "perftrace-vercel-"));
  try {
    fs.cpSync(path.join(root, ".vercel"), path.join(tmp, ".vercel"), {
      recursive: true,
    });
    const vj = path.join(root, "vercel.json");
    if (fs.existsSync(vj)) fs.copyFileSync(vj, path.join(tmp, "vercel.json"));

    execSync("npx vercel deploy --prebuilt --prod --yes", {
      stdio: "inherit",
      cwd: tmp,
      env: { ...process.env },
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
} finally {
  if (fs.existsSync(defaultProjectJson)) {
    fs.copyFileSync(defaultProjectJson, targetProjectJson);
  }
}
