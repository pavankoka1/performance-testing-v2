/**
 * Remove outer white/light margins from assets/app-icon.png and composite the artwork
 * onto a full 1024×1024 canvas so macOS Dock / Finder show no white “frame” (matches
 * typical full-bleed app icons). Then rebuild app-icon.icns and sync web favicons.
 */
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const assetsDir = path.join(root, "assets");
const masterPng = path.join(assetsDir, "app-icon.png");
const clientPublic = path.join(root, "client", "public");

const CANVAS = 1024;
/** Visual inset inside the icon grid — keeps the squircle clear of the OS mask. */
const CONTENT_FRAC = 0.6;

function run(cmd, cwd = root) {
  execSync(cmd, { stdio: "inherit", cwd });
}

/**
 * Pick the matte dark fill of the squircle — **not** the anti‑aliased rim (which averages to a
 * lighter gray and reads as a “white” frame against the card interior).
 */
async function sampleDarkestBackground(buf) {
  const { data, info } = await sharp(buf)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const ch = info.channels;
  let R = 0,
    G = 0,
    B = 0,
    n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * ch;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const sum = r + g + b;
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      const sat = mx - mn;
      /** Near-neutral dark pixels (card body), excluding neon purple logo strokes. */
      if (sum < 200 && mx < 85 && sat < 38) {
        R += r;
        G += g;
        B += b;
        n++;
      }
    }
  }
  if (n < 80) return { r: 14, g: 14, b: 16 };
  return {
    r: Math.round(R / n),
    g: Math.round(G / n),
    b: Math.round(B / n),
  };
}

async function rebuildIcns() {
  const iconset = path.join(assetsDir, "AppIcon.iconset");
  fs.rmSync(iconset, { recursive: true, force: true });
  fs.mkdirSync(iconset, { recursive: true });
  const src = masterPng;
  const pairs = [
    ["icon_16x16.png", 16, 16],
    ["icon_16x16@2x.png", 32, 32],
    ["icon_32x32.png", 32, 32],
    ["icon_32x32@2x.png", 64, 64],
    ["icon_128x128.png", 128, 128],
    ["icon_128x128@2x.png", 256, 256],
    ["icon_256x256.png", 256, 256],
    ["icon_256x256@2x.png", 512, 512],
    ["icon_512x512.png", 512, 512],
    ["icon_512x512@2x.png", 1024, 1024],
  ];
  for (const [name, rw, rh] of pairs) {
    run(
      `sips -z ${rh} ${rw} "${src}" --out "${path.join(iconset, name)}"`,
      root,
    );
  }
  const icnsOut = path.join(assetsDir, "app-icon.icns");
  run(`iconutil -c icns "${iconset}" -o "${icnsOut}"`, root);
  fs.rmSync(iconset, { recursive: true, force: true });
}

/**
 * Kill light gray / off-white halos on the outer few pixels (export anti-alias + squircle edge).
 */
async function removeOuterFringe(pngBuffer, bg) {
  const { data, info } = await sharp(pngBuffer)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const ch = info.channels;
  const fringe = 6;
  const br = bg.r;
  const bgG = bg.g;
  const bb = bg.b;
  const bgLum = 0.299 * br + 0.587 * bgG + 0.114 * bb;
  const out = Buffer.from(data);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const edgeDist = Math.min(x, y, w - 1 - x, h - 1 - y);
      if (edgeDist > fringe) continue;
      const i = (y * w + x) * ch;
      const r = out[i];
      const g = out[i + 1];
      const b = out[i + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const sum = r + g + b;
      const tooBright =
        lum > bgLum + 6 ||
        sum > br + bgG + bb + 22 ||
        (edgeDist <= 2 && sum > 55);
      if (tooBright) {
        out[i] = br;
        out[i + 1] = bgG;
        out[i + 2] = bb;
      }
    }
  }
  return sharp(out, {
    raw: { width: w, height: h, channels: ch },
  })
    .png()
    .toBuffer();
}

async function syncWebIcons(bgStr) {
  const sizes = [
    ["favicon-32.png", 32],
    ["apple-touch-icon.png", 180],
    ["icon-512.png", 512],
  ];
  for (const [name, dim] of sizes) {
    await sharp(masterPng)
      .resize(dim, dim, {
        fit: "contain",
        background: bgStr,
        position: "centre",
      })
      .png()
      .toFile(path.join(clientPublic, name));
  }
}

async function main() {
  const raw = await fs.promises.readFile(masterPng);
  const trimmed = await sharp(raw)
    .flatten({ background: "#ffffff" })
    .trim({
      threshold: 18,
    })
    .png()
    .toBuffer();

  const bg = await sampleDarkestBackground(trimmed);
  const bgStr = `rgb(${bg.r},${bg.g},${bg.b})`;

  const inner = Math.round(CANVAS * CONTENT_FRAC);
  const scaled = await sharp(trimmed)
    .resize(inner, inner, {
      fit: "inside",
      background: bg,
      kernel: sharp.kernel.lanczos3,
    })
    .png()
    .toBuffer();

  let finalBuf = await sharp({
    create: {
      width: CANVAS,
      height: CANVAS,
      channels: 3,
      background: bg,
    },
  })
    .composite([{ input: scaled, gravity: "center" }])
    .png()
    .toBuffer();

  finalBuf = await removeOuterFringe(finalBuf, bg);

  await fs.promises.writeFile(masterPng, finalBuf);
  console.log("[normalize-app-icon] Wrote", masterPng, CANVAS, "px, bg", bgStr);

  await rebuildIcns();
  console.log("[normalize-app-icon] Rebuilt app-icon.icns");

  await syncWebIcons(bgStr);
  console.log("[normalize-app-icon] Synced client/public favicon PNGs");

  const pngToIco = (await import("png-to-ico")).default;
  const icoBuf = await pngToIco(masterPng);
  await fs.promises.writeFile(path.join(assetsDir, "app-icon.ico"), icoBuf);
  console.log("[normalize-app-icon] Wrote app-icon.ico");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
