/**
 * Performance capture module: Playwright + CDP tracing + optional Xvfb/VNC.
 * Reuses logic from performance-testing-app playwrightUtils.
 */
const { randomUUID } = require("crypto");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { chromium } = require("playwright");
const yauzl = require("yauzl");
const {
  parseTraceToReport,
  computeClsFromEntries,
  parseTraceEvents,
} = require("./traceParser");

/** Read Chrome trace from CDP Tracing.end (stream or inline). Required for GPU/layout/paint in trace. */
async function readCdpTracingTrace(traceCdp) {
  if (!traceCdp) return "";
  try {
    const endResult = await traceCdp.send("Tracing.end");
    if (endResult?.data && typeof endResult.data === "string") {
      return endResult.data;
    }
    const stream =
      endResult?.stream ??
      endResult?.value?.stream ??
      endResult?.result?.stream;
    if (!stream) {
      return "";
    }
    const chunks = [];
    let eof = false;
    while (!eof) {
      const r = await traceCdp.send("IO.read", { stream });
      if (r?.data) {
        if (r.base64Encoded) {
          chunks.push(Buffer.from(r.data, "base64").toString("utf8"));
        } else {
          chunks.push(typeof r.data === "string" ? r.data : String(r.data));
        }
      }
      eof = !!r?.eof;
    }
    try {
      await traceCdp.send("IO.close", { stream });
    } catch {
      /* ignore */
    }
    return chunks.join("");
  } catch (e) {
    console.warn("[PerfTrace] CDP Tracing.end:", e?.message || e);
    return "";
  }
}

/**
 * Prefer CDP trace for GPU/layout/paint. Playwright's trace zip is large but often
 * lacks devtools.timeline GPU categories; CDP Tracing.start() is the source of truth.
 */
function pickTraceTextForParser(playwrightTraceText, cdpTraceText) {
  const pw = playwrightTraceText
    ? parseTraceEvents(playwrightTraceText).length
    : 0;
  const cdp = cdpTraceText ? parseTraceEvents(cdpTraceText).length : 0;
  if (cdp >= 400) return cdpTraceText;
  if (cdp > pw * 2 && cdp > 80) return cdpTraceText;
  if (
    cdp > 0 &&
    (cdpTraceText.includes("devtools.timeline") ||
      cdpTraceText.includes('"cat":"gpu"') ||
      cdpTraceText.includes('"cat":"cc"'))
  ) {
    return cdpTraceText;
  }
  if (pw > 0) return playwrightTraceText;
  return cdpTraceText || playwrightTraceText || "";
}

const ASSET_EXT_SCRIPT = /\.(js|mjs|cjs|ts)(\?|$)/i;
const ASSET_EXT_STYLE = /\.(css|scss|sass|less)(\?|$)/i;
const ASSET_EXT_DOC = /\.(html|htm)(\?|$)/i;
const ASSET_EXT_IMAGE = /\.(png|jpg|jpeg|gif|webp|svg|ico|avif)(\?|$)/i;
const ASSET_EXT_FONT = /\.(woff2?|ttf|otf|eot)(\?|$)/i;

function categorizeAsset(
  url,
  initiatorType = "",
  resourceType = "",
  isMainDocument = false
) {
  if (isMainDocument) return "build";
  const u = (url || "").toLowerCase();
  const it = (initiatorType || "").toLowerCase();
  const rt = (resourceType || "").toLowerCase();
  if (ASSET_EXT_SCRIPT.test(u) || rt === "script" || it === "script")
    return "script";
  if (
    ASSET_EXT_STYLE.test(u) ||
    rt === "stylesheet" ||
    it === "link" ||
    it === "css"
  )
    return "stylesheet";
  if (ASSET_EXT_DOC.test(u) || rt === "document") return "document";
  if (
    rt === "xhr" ||
    rt === "fetch" ||
    it === "xmlhttprequest" ||
    it === "fetch"
  )
    return "json";
  if (ASSET_EXT_IMAGE.test(u) || rt === "image" || it === "img") return "image";
  if (ASSET_EXT_FONT.test(u) || rt === "font") return "font";
  return "other";
}

function buildDownloadedAssetsSummary(
  resourceEntries,
  navigationEntries,
  networkRequests,
  fcpMs
) {
  const byCategory = {
    build: { count: 0, totalBytes: 0, files: [] },
    script: { count: 0, totalBytes: 0, files: [] },
    stylesheet: { count: 0, totalBytes: 0, files: [] },
    document: { count: 0, totalBytes: 0, files: [] },
    json: { count: 0, totalBytes: 0, files: [] },
    image: { count: 0, totalBytes: 0, files: [] },
    font: { count: 0, totalBytes: 0, files: [] },
    other: { count: 0, totalBytes: 0, files: [] },
  };
  const seen = new Set();
  let mainDocUrl = null;

  if (!navigationEntries?.length && networkRequests?.length > 0) {
    const firstDoc = networkRequests.find(
      (r) => (r.type || "").toLowerCase() === "document"
    );
    if (firstDoc) {
      const url = firstDoc.url || "";
      mainDocUrl = url;
      const size = firstDoc.transferSize ?? 0;
      const key = url.split("?")[0];
      seen.add("nav:" + key);
      seen.add(key);
      byCategory.build.count++;
      byCategory.build.totalBytes += size;
      byCategory.build.files.push({
        url,
        category: "build",
        transferSize: size > 0 ? size : undefined,
        durationMs: firstDoc.durationMs,
      });
    }
  }

  for (const e of navigationEntries || []) {
    const url = e.url || "";
    const key = "nav:" + url.split("?")[0];
    if (seen.has(key)) continue;
    seen.add(key);
    mainDocUrl = url;
    const size = e.transferSize ?? e.encodedBodySize ?? 0;
    const asset = {
      url,
      category: "build",
      transferSize: size > 0 ? size : undefined,
      durationMs: e.duration > 0 ? e.duration : undefined,
    };
    byCategory.build.count++;
    byCategory.build.totalBytes += size;
    byCategory.build.files.push(asset);
  }

  for (const e of resourceEntries || []) {
    const url = e.url || "";
    const key = url.split("?")[0];
    if (seen.has(key)) continue;
    if (url === mainDocUrl) continue;
    seen.add(key);
    const size = e.transferSize ?? e.encodedBodySize ?? 0;
    const cat = categorizeAsset(url, e.initiatorType, "", false);
    const asset = {
      url,
      category: cat,
      transferSize: size > 0 ? size : undefined,
      durationMs: e.duration > 0 ? e.duration : undefined,
    };
    byCategory[cat].count++;
    byCategory[cat].totalBytes += size;
    byCategory[cat].files.push(asset);
  }
  for (const r of networkRequests || []) {
    const url = r.url || "";
    const key = url.split("?")[0];
    if (seen.has(key)) continue;
    const size = r.transferSize ?? 0;
    if (size <= 0) continue;
    const navKey = "nav:" + key;
    if (seen.has(navKey)) continue;
    seen.add(key);
    const cat = categorizeAsset(url, "", r.type, false);
    const asset = {
      url,
      category: cat,
      transferSize: size,
      durationMs: r.durationMs,
    };
    byCategory[cat].count++;
    byCategory[cat].totalBytes += size;
    byCategory[cat].files.push(asset);
  }
  let totalBytes = 0;
  let totalCount = 0;
  for (const cat of Object.keys(byCategory)) {
    totalBytes += byCategory[cat].totalBytes;
    totalCount += byCategory[cat].count;
  }
  const initialLoadBytes = computeInitialLoadBytes(
    byCategory,
    resourceEntries,
    fcpMs
  );
  return {
    byCategory,
    totalBytes,
    totalCount,
    initialLoadBytes,
    /** Alias: everything transferred during the session */
    sessionTotalBytes: totalBytes,
  };
}

/** Resources finishing before FCP (+ slack) count toward "initial" bundle. */
function computeInitialLoadBytes(byCategory, resourceEntries, fcpMs) {
  const resByUrl = new Map();
  for (const e of resourceEntries || []) {
    const key = (e.url || e.name || "").split("?")[0];
    if (key) resByUrl.set(key, e);
  }
  const SLACK_MS = 500;
  const cutoff = fcpMs != null && fcpMs > 0 ? fcpMs + SLACK_MS : 3500;

  const cats = ["build", "script", "stylesheet", "font", "document"];
  let sum = 0;
  for (const cat of cats) {
    const bucket = byCategory[cat];
    if (!bucket?.files) continue;
    for (const f of bucket.files) {
      const key = (f.url || "").split("?")[0];
      const re = resByUrl.get(key);
      const end = re?.responseEnd;
      const size = f.transferSize ?? 0;
      if (size <= 0) continue;
      if (cat === "build") {
        sum += size;
        continue;
      }
      if (typeof end === "number" && end > 0 && end <= cutoff) sum += size;
    }
  }
  return sum;
}

const SKIP_KEYFRAME_KEYS = new Set([
  "offset",
  "easing",
  "composite",
  "compositeoperation",
  "computedoffset",
  "flex",
  "flexgrow",
  "flexshrink",
  "flexbasis",
]);

function extractAnimationProperties(a, source) {
  const props = [];
  if (a.type === "CSSTransition" && source) {
    const p =
      source.transitionProperty ?? source.cssProperty ?? source.property;
    if (typeof p === "string" && !SKIP_KEYFRAME_KEYS.has(p.toLowerCase()))
      props.push(p.trim());
    if (Array.isArray(source.transitionProperty)) {
      for (const x of source.transitionProperty) {
        if (typeof x === "string" && !SKIP_KEYFRAME_KEYS.has(x.toLowerCase()))
          props.push(x.trim());
      }
    }
    if (props.length) return props;
  }
  const kfRule = source?.keyframesRule;
  const kfList = kfRule?.keyframes ?? [];
  for (const kf of kfList) {
    const style = kf.style ?? kf;
    if (style && typeof style === "object") {
      for (const key of Object.keys(style)) {
        if (!SKIP_KEYFRAME_KEYS.has(key.toLowerCase()) && !props.includes(key))
          props.push(key);
      }
    }
  }
  for (const kf of kfList) {
    if (kf && typeof kf === "object") {
      for (const key of Object.keys(kf)) {
        if (!SKIP_KEYFRAME_KEYS.has(key.toLowerCase()) && !props.includes(key))
          props.push(key);
      }
    }
  }
  return props.length ? props : undefined;
}

function extractAnimationName(a, source) {
  if (typeof a.name === "string" && a.name.trim()) return a.name.trim();
  const kfName = source?.keyframesRule?.name;
  if (typeof kfName === "string" && kfName.trim()) return kfName.trim();
  if (a.type === "CSSTransition" && source) {
    const p =
      source.transitionProperty ?? source.cssProperty ?? source.property;
    if (typeof p === "string" && p.trim()) return `Transition (${p.trim()})`;
    if (Array.isArray(source.transitionProperty)) {
      const parts = (source.transitionProperty || [])
        .filter((x) => typeof x === "string" && x.trim())
        .map((x) => x.trim());
      if (parts.length) return `Transition (${parts.join(", ")})`;
    }
  }
  const props = extractAnimationProperties(a, source);
  if (props?.length && props[0]) {
    const p = props[0];
    return (
      p.charAt(0).toUpperCase() +
      p.slice(1).replace(/-./g, (m) => m[1].toUpperCase())
    );
  }
  return "";
}

function normalizeAnimationEntries(animations) {
  return animations.map((a) => {
    const raw = a.properties ?? [];
    const cleaned = sanitizeAnimationProperties(raw);
    const props = cleaned?.length ? cleaned : [];
    let name = (a.name || "").trim();
    if (!name || name === "(unnamed)") {
      if (props.length) {
        name = props
          .map((p) =>
            p
              ? p.charAt(0).toUpperCase() +
                p.slice(1).replace(/-([a-z])/g, (_, c) => c.toUpperCase())
              : ""
          )
          .filter(Boolean)
          .join(", ");
      } else {
        name = "Animation";
      }
    }
    const bottleneckHint =
      inferBottleneck(props.length ? props : undefined, name) ??
      a.bottleneckHint;
    return {
      ...a,
      name,
      bottleneckHint,
      properties: props.length ? props : undefined,
    };
  });
}

/** Web Animations / keyframes may use camelCase property names. */
function kebabCssProperty(prop) {
  if (typeof prop !== "string" || !prop.trim()) return "";
  const s = prop.trim();
  if (s.includes("-")) return s.toLowerCase();
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

/**
 * Classify one animated CSS property. Order: compositor → paint → layout checks
 * (inferBottleneck then applies worst-cost: layout &gt; paint &gt; compositor).
 */
function classifyCssAnimatedProperty(prop) {
  const p = kebabCssProperty(prop);
  if (!p) return null;

  if (
    p === "transform" ||
    p === "opacity" ||
    p === "perspective" ||
    p === "translate" ||
    p === "scale" ||
    p === "rotate"
  )
    return "compositor";
  if (
    p.startsWith("translate") ||
    p.startsWith("scale") ||
    p.startsWith("rotate")
  )
    return "compositor";
  if (p === "transform-origin" || p === "perspective-origin")
    return "compositor";
  if (p === "z-index" || p === "will-change") return "compositor";

  if (p.includes("radius")) return "paint";
  if (p === "box-shadow" || p === "text-shadow") return "paint";
  if (p.startsWith("background") || p === "color") return "paint";
  if (p === "fill" || p === "stroke") return "paint";
  if (
    p === "stroke-width" ||
    p === "stroke-dashoffset" ||
    p === "stroke-dasharray"
  )
    return "paint";
  if (p.endsWith("-opacity") && p !== "opacity") return "paint";
  if (p.includes("border") && p.includes("color")) return "paint";
  if (p === "border-image" || p.startsWith("border-image-")) return "paint";
  if (p === "outline" || p.startsWith("outline-")) return "paint";
  if (p === "filter" || p === "backdrop-filter" || p === "clip-path")
    return "paint";
  if (p === "mix-blend-mode" || p === "isolation") return "paint";

  if (
    [
      "width",
      "height",
      "min-width",
      "max-width",
      "min-height",
      "max-height",
    ].includes(p)
  )
    return "layout";
  if (
    ["top", "left", "right", "bottom", "inset"].includes(p) ||
    p.startsWith("inset-")
  )
    return "layout";
  if (p.startsWith("margin") || p.startsWith("padding")) return "layout";
  if (p === "border" || p === "border-width" || p === "border-style")
    return "layout";
  if (
    p.startsWith("border-") &&
    (p.includes("width") ||
      p.includes("spacing") ||
      /-(top|right|bottom|left|inline|block|start|end|horizontal|vertical)-(width|style)$/.test(
        p
      ))
  )
    return "layout";
  if (
    /^border-(top|right|bottom|left|inline|block|start|end|horizontal|vertical)$/.test(
      p
    )
  )
    return "layout";
  if (
    p.startsWith("flex") ||
    p.startsWith("grid") ||
    p === "gap" ||
    p === "row-gap" ||
    p === "column-gap" ||
    p === "place-content" ||
    p === "place-items" ||
    p === "align-content" ||
    p === "align-items" ||
    p === "justify-content"
  )
    return "layout";
  if (
    [
      "display",
      "position",
      "float",
      "clear",
      "font-size",
      "line-height",
      "letter-spacing",
      "word-spacing",
      "vertical-align",
      "text-align",
      "box-sizing",
      "white-space",
      "word-break",
      "aspect-ratio",
      "object-fit",
      "object-position",
    ].includes(p)
  )
    return "layout";
  if (p.startsWith("overflow") || p === "scroll-behavior") return "layout";

  return null;
}

/** Strip Web Animations metadata keys (not CSS properties). */
function sanitizeAnimationProperties(props) {
  if (!props?.length) return undefined;
  const META = new Set([
    "computedoffset",
    "offset",
    "easing",
    "composite",
    "compositeoperation",
    "flex",
    "flexgrow",
    "flexshrink",
    "flexbasis",
  ]);
  const out = props.filter((p) => {
    if (typeof p !== "string" || !p.trim()) return false;
    const norm = kebabCssProperty(p).replace(/-/g, "");
    if (META.has(norm)) return false;
    return true;
  });
  return out.length ? out : undefined;
}

/** When keyframes omit properties, infer from animation/transition name (e.g. box-shadow, border-*-radius). */
function inferBottleneckFromAnimationName(animationName) {
  if (!animationName || typeof animationName !== "string") return undefined;
  let s = animationName.trim();
  const trans = /^Transition\s*\(([\s\S]+)\)\s*$/i.exec(s);
  if (trans) s = trans[1].trim();
  const segments = s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const parts = segments.length ? segments : [s];
  let hasLayout = false;
  let hasPaint = false;
  let hasCompositor = false;
  for (const seg of parts) {
    const c = classifyCssAnimatedProperty(seg);
    if (c === "layout") hasLayout = true;
    else if (c === "paint") hasPaint = true;
    else if (c === "compositor") hasCompositor = true;
  }
  if (hasLayout) return "layout";
  if (hasPaint) return "paint";
  if (hasCompositor) return "compositor";
  return undefined;
}

function inferBottleneck(properties, animationName) {
  const cleaned = sanitizeAnimationProperties(properties);
  if (cleaned?.length) {
    let hasLayout = false;
    let hasPaint = false;
    let hasCompositor = false;
    for (const raw of cleaned) {
      const bucket = classifyCssAnimatedProperty(raw);
      if (bucket === "layout") hasLayout = true;
      else if (bucket === "paint") hasPaint = true;
      else if (bucket === "compositor") hasCompositor = true;
    }
    if (hasLayout) return "layout";
    if (hasPaint) return "paint";
    if (hasCompositor) return "compositor";
  }
  const fromName = inferBottleneckFromAnimationName(animationName);
  if (fromName) return fromName;
  const name = (animationName ?? "").toLowerCase();
  if (name.startsWith("cc-")) return "compositor";
  if (name.startsWith("blink-") || name.includes("style")) return "layout";
  if (
    name.includes("fade") ||
    name.includes("opacity") ||
    name.includes("transform")
  )
    return "compositor";
  return undefined;
}

const VNC_ENABLED = process.env.VNC_ENABLED === "true";
const DISPLAY_NUM = process.env.XVFB_DISPLAY || "99";
const VIEWPORT_WIDTH = 1366;
const VIEWPORT_HEIGHT = 768;

let activeSession = null;
let lastVideoPath = null;
let reportGenerationInProgress = false;
let cachedSessionReport = null;
let lastAutomationError = null;
let xvfbProcess = null;
let vncProcess = null;
let websockifyProcess = null;

function ensureValidUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Enter a valid URL including http:// or https://");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http and https URLs are supported.");
  }
  return parsed.toString();
}

async function startXvfb() {
  if (xvfbProcess) return;
  return new Promise((resolve, reject) => {
    xvfbProcess = spawn(
      "Xvfb",
      [`:${DISPLAY_NUM}`, "-screen", "0", "1280x720x24"],
      {
        stdio: "ignore",
        detached: true,
      }
    );
    xvfbProcess.on("error", reject);
    xvfbProcess.unref();
    setTimeout(resolve, 500);
  });
}

async function startVnc() {
  if (vncProcess) return;
  return new Promise((resolve, reject) => {
    vncProcess = spawn(
      "x11vnc",
      [
        "-display",
        `:${DISPLAY_NUM}`,
        "-forever",
        "-shared",
        "-rfbport",
        "5900",
      ],
      {
        stdio: "ignore",
        detached: true,
      }
    );
    vncProcess.on("error", reject);
    vncProcess.unref();
    setTimeout(resolve, 800);
  });
}

async function startWebsockify() {
  if (websockifyProcess) return;
  const novncPath = path.join(__dirname, "../../node_modules/@novnc/novnc");
  const hasNovnc = await fs
    .access(path.join(novncPath, "vnc.html"))
    .then(() => true)
    .catch(() => false);
  const webPath = hasNovnc
    ? novncPath
    : path.join(__dirname, "../../client/public/novnc");
  return new Promise((resolve, reject) => {
    const args = ["6080", "localhost:5900"];
    if (hasNovnc) args.unshift("--web", webPath);
    websockifyProcess = spawn("websockify", args, {
      stdio: "ignore",
      detached: true,
    });
    websockifyProcess.on("error", (err) => {
      console.warn(
        "[PerfTrace] websockify not found; VNC stream URL may not work. Install: pip install websockify"
      );
      resolve();
    });
    websockifyProcess.unref();
    setTimeout(resolve, 500);
  });
}

async function getLaunchOptions() {
  const isServerless = Boolean(process.env.VERCEL);
  if (isServerless) {
    try {
      const Chromium = (await import("@sparticuz/chromium")).default;
      return {
        headless: true,
        executablePath: await Chromium.executablePath(),
        args: Chromium.args,
        defaultViewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
      };
    } catch (err) {
      console.warn(
        "[PerfTrace] @sparticuz/chromium not available:",
        err?.message
      );
    }
  }
  const useVnc = VNC_ENABLED && process.platform === "linux";
  if (useVnc) {
    try {
      await startXvfb();
      await startVnc();
      await startWebsockify();
      process.env.DISPLAY = `:${DISPLAY_NUM}`;
      return {
        headless: false,
        args: [
          `--display=:${DISPLAY_NUM}`,
          "--enable-gpu",
          "--disable-dev-shm-usage",
          "--window-size=1280,720",
        ],
        defaultViewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
      };
    } catch (err) {
      console.warn(
        "[PerfTrace] VNC setup failed, falling back to headless:",
        err.message
      );
    }
  }
  // Use headed mode so the user can see and interact with the browser.
  // Set HEADLESS=true for remote servers / CI (no display).
  const headless = process.env.HEADLESS === "true";
  /**
   * On macOS, Chromium’s GPU process often floods stderr with harmless EGL errors (eglQueryDeviceAttribEXT).
   * `--disable-gpu` stops that without the heavier flags (e.g. SwiftShader) that can break a headed window.
   * For real GPU profiling, set PERFTRACE_KEEP_GPU=true (expect the noise back).
   */
  const macGpuNoise =
    process.platform === "darwin" && process.env.PERFTRACE_KEEP_GPU !== "true"
      ? ["--disable-gpu"]
      : [];
  return {
    headless,
    args: [
      "--disable-dev-shm-usage",
      "--window-size=1366,768",
      "--window-position=0,0",
      ...macGpuNoise,
    ],
    defaultViewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
  };
}

async function ensureClientCollectors(context) {
  await context.addInitScript(() => {
    const w = window;
    if (w.__perftraceCollector) return;
    const collector = {
      longTasks: [],
      cls: 0,
      layoutShiftEntries: [],
      fcp: undefined,
      lcp: undefined,
    };
    const syncFromPerf = () => {
      try {
        const paint = performance.getEntriesByType?.("paint") ?? [];
        const fcpEntry = paint.find((e) => e.name === "first-contentful-paint");
        if (fcpEntry) collector.fcp = fcpEntry.startTime;
      } catch {}
      try {
        const lcpEntries =
          performance.getEntriesByType?.("largest-contentful-paint") ?? [];
        if (lcpEntries.length)
          collector.lcp = lcpEntries[lcpEntries.length - 1].startTime;
      } catch {}
    };
    try {
      const lo = new PerformanceObserver((list) => {
        for (const e of list.getEntries())
          collector.longTasks.push({
            start: e.startTime,
            duration: e.duration,
          });
      });
      lo.observe({ type: "longtask", buffered: true });
    } catch {}
    try {
      const po = new PerformanceObserver((list) => {
        for (const e of list.getEntries())
          if (e.name === "first-contentful-paint") collector.fcp = e.startTime;
        syncFromPerf();
      });
      po.observe({ type: "paint", buffered: true });
      syncFromPerf();
    } catch {}
    try {
      const lcpObs = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        if (entries.length)
          collector.lcp = entries[entries.length - 1].startTime;
        syncFromPerf();
      });
      lcpObs.observe({ type: "largest-contentful-paint", buffered: true });
      syncFromPerf();
    } catch {}
    try {
      const clsObs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (!e.hadRecentInput && typeof e.value === "number")
            collector.layoutShiftEntries.push({
              startTime: e.startTime,
              value: e.value,
            });
        }
      });
      clsObs.observe({ type: "layout-shift", buffered: true });
    } catch {}
    w.__perftraceCollector = collector;
  });
}

async function ensureMemoryAndDomCollector(context) {
  await context.addInitScript(() => {
    const w = window;
    if (w.__perftraceMemory !== undefined) return;
    const sample = () => {
      try {
        let heapMb = 0;
        if (typeof performance.memory?.usedJSHeapSize === "number")
          heapMb = performance.memory.usedJSHeapSize / (1024 * 1024);
        const nodes = document.getElementsByTagName("*").length;
        w.__perftraceMemory = { heapMb, nodes };
      } catch {
        w.__perftraceMemory = { heapMb: 0, nodes: 0 };
      }
    };
    sample();
    setInterval(sample, 1500);
  });
}

async function ensureResourceTimingCollector(context) {
  await context.addInitScript(() => {
    const w = window;
    if (w.__perftraceResources !== undefined) return;
    w.__perftraceResources = { resources: [], navigation: [] };
    const poll = () => {
      try {
        const resources = performance.getEntriesByType?.("resource") ?? [];
        const navEntries = performance.getEntriesByType?.("navigation") ?? [];
        w.__perftraceResources = {
          resources: resources.map((e) => ({
            url: e.name,
            transferSize: e.transferSize ?? 0,
            encodedBodySize: e.encodedBodySize ?? 0,
            decodedBodySize: e.decodedBodySize ?? 0,
            duration: e.duration ?? 0,
            initiatorType: e.initiatorType ?? "",
            fetchStart: e.fetchStart ?? 0,
            responseEnd: e.responseEnd ?? 0,
          })),
          navigation: navEntries.map((e) => ({
            url: e.name,
            transferSize: e.transferSize ?? 0,
            encodedBodySize: e.encodedBodySize ?? 0,
            decodedBodySize: e.decodedBodySize ?? 0,
            duration: e.duration ?? 0,
            responseEnd: e.responseEnd ?? e.domContentLoadedEventEnd ?? 0,
          })),
        };
      } catch {}
    };
    poll();
    setInterval(poll, 2000);
  });
}

async function ensureFpsCollector(page) {
  await page.evaluate(() => {
    const w = window;
    if (w.__perftrace) return;
    const state = { frames: 0, last: performance.now(), samples: [] };
    const tick = () => {
      const now = performance.now();
      state.frames += 1;
      if (now - state.last >= 1000) {
        state.samples.push({
          timeSec: Math.max(0, Math.round(now / 1000)),
          value: state.frames,
        });
        state.frames = 0;
        state.last = now;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    w.__perftrace = state;
  });
}

async function ensureAnimationPropertyCollector(context) {
  await context.addInitScript(() => {
    const w = window;
    if (w.__perftraceAnimationProps !== undefined) return;
    w.__perftraceAnimationProps = [];
    const seen = new Set();
    const poll = () => {
      try {
        const anims = document.getAnimations?.() ?? [];
        for (const anim of anims) {
          const effect = anim.effect;
          if (!effect?.getKeyframes) continue;
          const keyframes = effect.getKeyframes();
          const props = [];
          for (const kf of keyframes) {
            if (kf && typeof kf === "object")
              for (const key of Object.keys(kf))
                if (
                  ![
                    "offset",
                    "easing",
                    "composite",
                    "computedoffset",
                    "compositeoperation",
                  ].includes(key.toLowerCase()) &&
                  !props.includes(key)
                )
                  props.push(key);
          }
          const name =
            anim.animationName ||
            anim.transitionProperty ||
            (props.length ? props[0] : "");
          const start = Number(anim.startTime) || 0;
          const dur = effect.getComputedTiming?.()?.duration ?? 0;
          const key = `${name}-${Math.round(start)}-${Math.round(dur)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          w.__perftraceAnimationProps.push({
            name,
            startTime: start,
            duration: dur,
            properties: props,
          });
        }
      } catch {}
    };
    poll();
    setInterval(poll, 800);
  });
}

/** Rounds from UI/API may be string, float, or missing — always 1 | 3 | 5 | 10. */
function normalizeAutomationRounds(raw) {
  const allowed = new Set([1, 3, 5, 10]);
  if (raw === undefined || raw === null || raw === "") {
    console.warn(
      "[PerfTrace] automation.rounds missing — defaulting to 1 (shortest run)"
    );
    return 1;
  }
  const n =
    typeof raw === "string" ? parseInt(raw.trim(), 10) : Number(raw);
  const r = Number.isFinite(n) ? Math.trunc(n) : NaN;
  if (allowed.has(r)) {
    console.log("[PerfTrace] automation rounds (normalized):", r);
    return r;
  }
  console.warn(
    "[PerfTrace] Invalid automation.rounds:",
    raw,
    "— defaulting to 1 (allowed: 1, 3, 5, 10)"
  );
  return 1;
}

/** Keys must match client `NetworkThrottlePreset` (useRecording.ts) and server/index.js. */
const NETWORK_PRESETS = {
  none: { latency: 0, downloadThroughput: -1, uploadThroughput: -1 },
  /** ~400 Kbps, high RTT — DevTools-style “Slow 3G”. */
  "slow-3g": {
    latency: 2000,
    downloadThroughput: 50 * 1024,
    uploadThroughput: 50 * 1024,
  },
  "fast-3g": {
    latency: 150,
    downloadThroughput: 200 * 1024,
    uploadThroughput: 200 * 1024,
  },
  /** Moderate mobile — still throttled vs desktop fiber. */
  "4g": {
    latency: 20,
    downloadThroughput: 5 * 1024 * 1024,
    uploadThroughput: 2 * 1024 * 1024,
  },
};

/**
 * CDP: network shaping + optional CPU slowdown on the page-attached session.
 * Re-applied after tab switches (automation opens game in a new page).
 */
async function applyPageEmulation(cdpSession, { cpuThrottle, networkThrottle }) {
  const key =
    networkThrottle && NETWORK_PRESETS[networkThrottle]
      ? networkThrottle
      : "none";
  const net = NETWORK_PRESETS[key];
  try {
    await cdpSession.send("Network.enable");
  } catch {
    /* ignore */
  }
  try {
    await cdpSession.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: net.latency,
      downloadThroughput: net.downloadThroughput,
      uploadThroughput: net.uploadThroughput,
    });
  } catch (e) {
    console.warn(
      "[PerfTrace] Network.emulateNetworkConditions:",
      e?.message || e
    );
  }
  if (cpuThrottle > 1) {
    try {
      await cdpSession.send("Emulation.setCPUThrottlingRate", {
        rate: cpuThrottle,
      });
    } catch {
      /* ignore */
    }
  }
}

/**
 * After navigating to a new tab, the old page may be closed — CDP sessions die with it.
 * Rebind metrics + trace CDP and reset perf deltas so sampling keeps working on the live tab.
 */
async function rebindCaptureSessionToPage(session, newPage) {
  if (!session?.context || !newPage) return;
  try {
    if (newPage.isClosed()) return;
  } catch {
    return;
  }
  session.page = newPage;
  const { context, cpuThrottle, networkThrottle } = session;
  try {
    const newMetrics = await context.newCDPSession(newPage);
    await newMetrics.send("Performance.enable");
    await applyPageEmulation(newMetrics, {
      cpuThrottle,
      networkThrottle: networkThrottle || "none",
    });
    session.metricsCdp = newMetrics;
    session.traceCdp = await context.newCDPSession(newPage);
    session.lastPerfTotals = undefined;
    await ensureFpsCollector(newPage);
    console.log(
      "[PerfTrace] Rebound CDP to active page:",
      newPage.url?.() || "(no url)"
    );
  } catch (e) {
    console.warn("[PerfTrace] rebindCaptureSessionToPage:", e?.message || e);
  }
}

async function createCaptureSession(
  url,
  cpuThrottle = 1,
  networkThrottle = "none",
  trackReactRerenders = false,
  recordVideo = true,
  automationOpts = null
) {
  if (activeSession) {
    throw new Error("A recording session is already running.");
  }

  cachedSessionReport = null;
  lastAutomationError = null;

  const safeUrl = ensureValidUrl(url);
  const launchOptions = await getLaunchOptions();
  const videoDir = path.join(os.tmpdir(), "perftrace-videos");
  await fs.mkdir(videoDir, { recursive: true });
  if (lastVideoPath) {
    await fs.unlink(lastVideoPath).catch(() => {});
    lastVideoPath = null;
  }

  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({
    viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
    ...(recordVideo
      ? {
          recordVideo: {
            dir: videoDir,
            size: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
          },
        }
      : {}),
  });
  await ensureClientCollectors(context);
  await ensureMemoryAndDomCollector(context);
  await ensureAnimationPropertyCollector(context);
  await ensureResourceTimingCollector(context);

  const page = await context.newPage();
  const recordingStartMs = Date.now();
  const traceCdp = await context.newCDPSession(page);
  const metricsCdp = await context.newCDPSession(page);

  // Do NOT use context.tracing.start() here: Chrome allows one global Tracing session.
  // Playwright's trace would conflict with our CDP Tracing.start below and yield empty
  // or wrong GPU/layout/paint data.

  await metricsCdp.send("Performance.enable");
  const networkThrottlePreset =
    networkThrottle && NETWORK_PRESETS[networkThrottle]
      ? networkThrottle
      : "none";
  await applyPageEmulation(metricsCdp, {
    cpuThrottle,
    networkThrottle: networkThrottlePreset,
  });
  const collectedAnimations = [];
  try {
    await metricsCdp.send("Animation.enable");
    metricsCdp.on("Animation.animationStarted", (params) => {
      const a = params?.animation;
      if (!a || typeof a.id !== "string") return;
      const source = a.source;
      const props = extractAnimationProperties(a, source);
      const duration =
        typeof source?.duration === "number" ? source.duration : undefined;
      const delay =
        typeof source?.delay === "number" ? source.delay : undefined;
      collectedAnimations.push({
        id: a.id,
        name: extractAnimationName(a, source),
        type: a.type || "WebAnimation",
        startTimeSec: (Date.now() - recordingStartMs) / 1000,
        durationMs: duration != null ? duration : undefined,
        delayMs: delay != null ? delay : undefined,
        properties: props,
      });
    });
  } catch {}
  await traceCdp.send("Tracing.start", {
    categories: [
      "devtools.timeline",
      "disabled-by-default-devtools.timeline",
      "disabled-by-default-devtools.timeline.frame",
      "disabled-by-default-devtools.timeline.paint",
      "disabled-by-default-devtools.timeline.layers",
      "disabled-by-default-devtools.timeline.stack",
      "blink.user_timing",
      "blink.resource",
      "v8",
      "gpu",
      "cc",
      "latencyInfo",
      "disabled-by-default-gpu.service",
    ].join(","),
    transferMode: "ReturnAsStream",
  });

  let rrtClient = null;
  if (trackReactRerenders) {
    try {
      const newTrackerClient = (
        await import("react-render-tracker/headless-browser-client")
      ).default;
      rrtClient = await newTrackerClient(page);
    } catch {}
  }

  await page.goto(safeUrl, { waitUntil: "domcontentloaded" });
  await ensureFpsCollector(page);

  const samples = [];
  const fpsSamples = [];
  const networkRequests = [];
  const requestIds = new WeakMap();
  const pendingRequests = new Map();

  context.on("request", (request) => {
    const id = randomUUID();
    requestIds.set(request, id);
    pendingRequests.set(id, {
      url: request.url(),
      method: request.method(),
      startAt: Date.now(),
    });
  });
  const onRequestEnd = async (request) => {
    const id = requestIds.get(request);
    if (!id) return;
    const pending = pendingRequests.get(id);
    if (!pending) return;
    pendingRequests.delete(id);
    const response = await request.response();
    networkRequests.push({
      url: pending.url,
      method: pending.method,
      status: response?.status(),
      type: request.resourceType(),
      durationMs: Date.now() - pending.startAt,
      transferSize: response?.headers()["content-length"]
        ? Number(response.headers()["content-length"])
        : undefined,
    });
  };
  context.on("requestfinished", onRequestEnd);
  context.on("requestfailed", onRequestEnd);

  const sampleInterval = setInterval(async () => {
    try {
      const metrics = await (activeSession?.metricsCdp ?? metricsCdp).send(
        "Performance.getMetrics"
      );
      const metricMap = new Map(metrics.metrics.map((m) => [m.name, m.value]));
      let jsHeapSize =
        metricMap.get("JSHeapUsedSize") ?? metricMap.get("JSHeapSize") ?? 0;
      let nodes = metricMap.get("Nodes") ?? metricMap.get("DOMNodeCount") ?? 0;
      const activePage = activeSession?.page ?? page;
      try {
        const client = await activePage.evaluate(
          () => window.__perftraceMemory ?? null
        );
        if (client) {
          if (client.heapMb > 0) jsHeapSize = client.heapMb * 1024 * 1024;
          if (client.nodes > 0) nodes = client.nodes;
        }
      } catch {}
      const totals = {
        taskDuration: metricMap.get("TaskDuration") ?? 0,
        scriptDuration: metricMap.get("ScriptDuration") ?? 0,
        layoutDuration: metricMap.get("LayoutDuration") ?? 0,
        paintDuration: metricMap.get("PaintDuration") ?? 0,
        jsHeapSize,
        nodes,
      };
      const sess = activeSession;
      const lastTotals = sess?.lastPerfTotals;
      const deltaTask = lastTotals
        ? Math.max(0, (totals.taskDuration - lastTotals.taskDuration) * 1000)
        : 0;
      const deltaScript = lastTotals
        ? Math.max(
            0,
            (totals.scriptDuration - lastTotals.scriptDuration) * 1000
          )
        : 0;
      const deltaLayout = lastTotals
        ? Math.max(
            0,
            (totals.layoutDuration - lastTotals.layoutDuration) * 1000
          )
        : 0;
      const deltaPaint = lastTotals
        ? Math.max(0, (totals.paintDuration - lastTotals.paintDuration) * 1000)
        : 0;
      if (sess) sess.lastPerfTotals = totals;
      const SAMPLE_WINDOW_MS = 1000;
      const cpuPercent = Math.min(
        100,
        Math.max(0, (deltaTask / SAMPLE_WINDOW_MS) * 100)
      );
      samples.push({
        timeSec: Math.max(0, (Date.now() - recordingStartMs) / 1000),
        cpuBusyMs: deltaTask,
        cpuPercent,
        scriptMs: deltaScript,
        layoutMs: deltaLayout,
        paintMs: deltaPaint,
        jsHeapMb: totals.jsHeapSize
          ? totals.jsHeapSize / (1024 * 1024)
          : undefined,
        nodes: totals.nodes || undefined,
      });
    } catch {}
  }, 1000);

  activeSession = {
    browser,
    context,
    page,
    traceCdp,
    metricsCdp,
    startedAt: recordingStartMs,
    recordedUrl: safeUrl,
    samples,
    fpsSamples,
    networkRequests,
    sampleInterval,
    cpuThrottle,
    networkThrottle: networkThrottlePreset,
    rrtClient,
    collectedAnimations,
    lastPerfTotals: undefined,
  };

  activeSession.rebindToActivePage = async function rebindPage(newPage) {
    await rebindCaptureSessionToPage(this, newPage);
  };

  if (automationOpts?.enabled) {
    const { runCasinoAutomation } = require("./casinoAutomation");
    const { getAutomationGame } = require("./casinoGames");
    const ac = new AbortController();
    activeSession.automationAbort = ac;
    const rounds = normalizeAutomationRounds(automationOpts.rounds);
    const gameId = automationOpts.gameId || "russian-roulette";
    const gameMeta = getAutomationGame(gameId);
    activeSession.automation = {
      gameId,
      rounds,
      phase: "starting",
      skipLobby: !!automationOpts.skipLobby,
    };
    const user =
      automationOpts.casinoUser ||
      process.env.CASINO_USER ||
      gameMeta?.defaultCasinoUser ||
      "abdulg";
    const password =
      automationOpts.casinoPass ||
      process.env.CASINO_PASS ||
      gameMeta?.defaultCasinoPass ||
      "abdulg123";

    void runCasinoAutomation(activeSession, {
      gameId,
      rounds,
      user,
      password,
      skipLobby: !!automationOpts.skipLobby,
      signal: ac.signal,
    })
      .then(async () => {
        if (activeSession) await stopCaptureSession();
      })
      .catch(async (err) => {
        if (err && err.code === "AUTOMATION_CANCELLED") {
          return;
        }
        lastAutomationError = err instanceof Error ? err.message : String(err);
        console.error("[PerfTrace] Automation failed:", err);
        if (activeSession) await stopCaptureSession();
      });
  }

  const baseUrl =
    process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;
  const streamUrl =
    VNC_ENABLED && process.platform === "linux"
      ? `${baseUrl.replace(/:\d+$/, "")}:6080/vnc.html`
      : null;

  return {
    status: "recording",
    url: safeUrl,
    streamUrl,
    automation: automationOpts?.enabled
      ? {
          enabled: true,
          gameId: activeSession.automation?.gameId ?? "russian-roulette",
          rounds: activeSession.automation?.rounds ?? 1,
          skipLobby: !!automationOpts.skipLobby,
        }
      : undefined,
  };
}

async function stopCaptureSession(opts = {}) {
  const userRequested = !!opts.userRequested;

  if (!activeSession) {
    const fallback = buildFallbackReport(Date.now() - 60000, Date.now(), {
      samples: [],
      fpsSamples: [],
      networkRequests: [],
      clientCollector: null,
    });
    fallback.suggestions.push({
      title: "No active session",
      detail: "No recording was in progress. Start a session first.",
      severity: "info",
    });
    return fallback;
  }

  if (userRequested && activeSession.automationAbort) {
    try {
      activeSession.automationAbort.abort();
    } catch {
      /* ignore */
    }
  }

  reportGenerationInProgress = true;
  try {
    const {
      browser,
      context,
      page,
      traceCdp,
      startedAt,
      recordedUrl = null,
      samples,
      fpsSamples,
      networkRequests,
      sampleInterval,
      rrtClient,
      collectedAnimations = [],
    } = activeSession;
    activeSession = null;

    if (sampleInterval) clearInterval(sampleInterval);

  let pageFps = [];
  try {
    pageFps = await page.evaluate(() => window.__perftrace?.samples ?? []);
  } catch {}
  fpsSamples.push(...pageFps);

  let resourceEntries = [];
  let navigationEntries = [];
  try {
    const data =
      (await page.evaluate(() => window.__perftraceResources ?? null)) || {};
    resourceEntries = Array.isArray(data) ? data : (data.resources ?? []);
    navigationEntries = Array.isArray(data) ? [] : (data.navigation ?? []);
  } catch {}

  let clientCollector = null;
  let clientAnimationProps = [];
  try {
    clientCollector = await page.evaluate(() => {
      const c = window.__perftraceCollector ?? null;
      if (!c) return null;
      try {
        const paint = performance.getEntriesByType?.("paint") ?? [];
        const fcp = paint.find((e) => e.name === "first-contentful-paint");
        if (fcp) c.fcp = fcp.startTime;
      } catch {}
      try {
        const lcp =
          performance.getEntriesByType?.("largest-contentful-paint") ?? [];
        if (lcp.length) c.lcp = lcp[lcp.length - 1].startTime;
      } catch {}
      return c;
    });
    clientAnimationProps =
      (await page.evaluate(() => window.__perftraceAnimationProps ?? [])) || [];
  } catch {}

  let reactRerenderHint = null;
  if (rrtClient) {
    try {
      const events = await Promise.race([
        rrtClient.getEvents().then((e) => e || []),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("RRT_TIMEOUT")), 12_000)
        ),
      ]).catch(() => []);
      const durationMs = Date.now() - startedAt;
      const durationSec = durationMs / 1000;
      const byComponent = new Map();
      for (const e of events) {
        const name =
          e.fiber?.type?.displayName ||
          e.fiber?.type?.name ||
          e.name ||
          e.componentName ||
          `Component#${e.fiberId ?? e.id ?? "?"}`;
        const cur = byComponent.get(name) || { count: 0 };
        cur.count += 1;
        byComponent.set(name, cur);
      }
      if (byComponent.size > 0) {
        reactRerenderHint = {
          totalEvents: events.length,
          durationSec,
          components: [...byComponent.entries()].map(([name, data]) => ({
            name,
            renderCount: data.count,
            inBursts: 0,
          })),
          topRerenderers: [...byComponent.entries()]
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, 15)
            .map(([name, data]) => ({
              name,
              count: data.count,
              inBursts: 0,
            })),
          chartData: [],
          timeline: [],
          bursts: [],
        };
      }
    } catch {}
  }

  const stopRequestedAt = Date.now();

  let cdpTraceText = "";
  try {
    cdpTraceText = await readCdpTracingTrace(traceCdp);
  } catch (e) {
    console.warn("[PerfTrace] CDP trace read:", e?.message || e);
  }

  /**
   * Playwright `Video.path()` waits for the page to close (artifact resolves on close).
   * Awaiting `path()` *before* `context.close()` deadlocks: path never resolves until the
   * context closes, so the browser window stays open forever. Collect handles first,
   * close the context, then read paths.
   */
  const videoHandles = [];
  try {
    for (const p of context.pages()) {
      if (p.isClosed()) continue;
      const v = p.video();
      if (v) videoHandles.push(v);
    }
  } catch {
    /* ignore */
  }

  await context.close().catch((e) =>
    console.warn("[PerfTrace] context.close:", e?.message || e)
  );
  await browser.close().catch((e) =>
    console.warn("[PerfTrace] browser.close:", e?.message || e)
  );

  const candidates = [];
  for (const v of videoHandles) {
    try {
      const fp = await v.path();
      const st = await fs.stat(fp);
      candidates.push({ path: fp, size: st.size });
    } catch {}
  }
  if (candidates.length > 0) {
    candidates.sort((a, b) => b.size - a.size);
    lastVideoPath = candidates[0].path;
  }

  const traceText = "";

  const traceTextForParser = pickTraceTextForParser(traceText, cdpTraceText);
  if (!cdpTraceText || cdpTraceText.length < 100) {
    console.warn(
      "[PerfTrace] CDP trace short or empty (",
      cdpTraceText?.length ?? 0,
      "chars); GPU/layout may be missing"
    );
  }
  if (cdpTraceText && traceTextForParser === cdpTraceText) {
    console.log(
      "[PerfTrace] Using CDP Chrome trace for metrics (",
      parseTraceEvents(cdpTraceText).length,
      "events)"
    );
  }

  let report;
  try {
    report = await parseTraceToReport(
      null,
      traceTextForParser,
      startedAt,
      stopRequestedAt,
      {
        samples,
        fpsSamples,
        networkRequests,
        clientCollector,
      }
    );
  } catch (err) {
    console.warn("[PerfTrace] parseTrace failed, using fallback:", err.message);
    report = buildFallbackReport(startedAt, stopRequestedAt, {
      samples,
      fpsSamples,
      networkRequests,
      clientCollector,
    });
  }

  report.video = lastVideoPath ? { url: "/api/video", format: "webm" } : null;
  report.recordedUrl = recordedUrl ?? null;

  report.downloadedAssets = buildDownloadedAssetsSummary(
    resourceEntries,
    navigationEntries,
    networkRequests,
    clientCollector?.fcp
  );

  const mainThreadBlockedMs = report.webVitals?.tbtMs ?? 0;
  report.blockingSummary = {
    totalBlockedMs: report.longTasks.totalTimeMs,
    longTaskCount: report.longTasks.count,
    maxBlockingMs:
      report.longTasks.topTasks.length > 0
        ? Math.max(...report.longTasks.topTasks.map((t) => t.durationMs))
        : 0,
    mainThreadBlockedMs,
  };

  const cpuPoints = report.cpuSeries?.points ?? [];
  const fpsPoints = report.fpsSeries?.points ?? [];
  const gpuPoints = report.gpuSeries?.points ?? [];
  const memPoints = report.memorySeries?.points ?? [];
  const domPoints = report.domNodesSeries?.points ?? [];
  report.summaryStats = {
    avgFps:
      fpsPoints.length > 0
        ? fpsPoints.reduce((s, p) => s + p.value, 0) / fpsPoints.length
        : 0,
    avgCpu:
      cpuPoints.length > 0
        ? cpuPoints.reduce((s, p) => s + p.value, 0) / cpuPoints.length
        : 0,
    avgGpu:
      gpuPoints.length > 0
        ? gpuPoints.reduce((s, p) => s + p.value, 0) / gpuPoints.length
        : 0,
    peakMemMb:
      memPoints.length > 0 ? Math.max(...memPoints.map((p) => p.value)) : 0,
    peakDomNodes:
      domPoints.length > 0 ? Math.max(...domPoints.map((p) => p.value)) : 0,
  };

  if (reactRerenderHint) {
    report.developerHints = {
      ...report.developerHints,
      reactRerenders: reactRerenderHint,
    };
  }
  const clientAnims = (clientAnimationProps || []).map((a) => {
    const propName =
      a.properties?.length && a.properties[0]
        ? a.properties[0].charAt(0).toUpperCase() +
          a.properties[0].slice(1).replace(/-./g, (m) => m[1].toUpperCase())
        : "";
    return {
      id: (a.name || propName) + "-" + (a.startTime ?? 0),
      name: a.name || propName || "(unnamed)",
      type: "CSSAnimation",
      startTimeSec: (a.startTime ?? 0) / 1000,
      durationMs: a.duration ?? 0,
      properties: a.properties ?? [],
      bottleneckHint: inferBottleneck(a.properties, a.name || propName),
    };
  });
  const cdpAnims = (collectedAnimations || []).map((a) => {
    const cdpPropName =
      a.properties?.length && a.properties[0]
        ? a.properties[0].charAt(0).toUpperCase() +
          a.properties[0].slice(1).replace(/-./g, (m) => m[1].toUpperCase())
        : "";
    return {
      id: a.id,
      name: a.name || cdpPropName || "(unnamed)",
      type: a.type || "WebAnimation",
      startTimeSec: a.startTimeSec ?? 0,
      durationMs: a.durationMs,
      properties: a.properties ?? [],
      bottleneckHint: inferBottleneck(a.properties, a.name || cdpPropName),
    };
  });
  const allAnims = [...clientAnims];
  for (const c of cdpAnims) {
    const dup = allAnims.some(
      (x) =>
        Math.abs(x.startTimeSec - c.startTimeSec) < 0.5 &&
        (x.name === c.name ||
          (x.properties?.length &&
            c.properties?.length &&
            x.properties[0] === c.properties[0]))
    );
    if (!dup) allAnims.push(c);
  }
  report.animationMetrics = {
    ...report.animationMetrics,
    animations: normalizeAnimationEntries(allAnims),
    totalAnimations: allAnims.length,
  };
    cachedSessionReport = report;
    return report;
  } finally {
    reportGenerationInProgress = false;
  }
}

function buildFallbackReport(startedAt, stoppedAt, fallback) {
  const durationMs = Math.max(0, stoppedAt - startedAt);
  const { samples, fpsSamples, networkRequests, clientCollector } = fallback;
  const totalScript = samples.reduce((s, x) => s + x.scriptMs, 0);
  const totalLayout = samples.reduce((s, x) => s + x.layoutMs, 0);
  const totalPaint = samples.reduce((s, x) => s + (x.paintMs ?? 0), 0);
  const tbt =
    clientCollector?.longTasks?.reduce(
      (s, t) => s + Math.max(0, t.duration - 50),
      0
    ) ?? 0;
  const avgLatency =
    networkRequests.length === 0
      ? 0
      : networkRequests.reduce((s, r) => s + (r.durationMs ?? 0), 0) /
        networkRequests.length;
  const totalBytes = networkRequests.reduce(
    (s, r) => s + (r.transferSize ?? 0),
    0
  );
  const clientLongTasks = clientCollector?.longTasks ?? [];
  const longTaskTotalMsFb = clientLongTasks.reduce(
    (s, t) => s + (t.duration ?? 0),
    0
  );
  const maxDurFb =
    clientLongTasks.length > 0
      ? Math.max(...clientLongTasks.map((t) => t.duration ?? 0))
      : 0;
  const topTasksFb = [...clientLongTasks]
    .sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0))
    .slice(0, 5)
    .map((t) => ({
      name: "longtask",
      durationMs: t.duration ?? 0,
      startSec: (t.start ?? 0) / 1000,
      attribution: "PerformanceObserver",
    }));
  const tbtTimelineFallback = clientLongTasks.map((t) => {
    const durationMs = t.duration ?? 0;
    const startSec = (t.start ?? 0) / 1000;
    const blockingMs = Math.max(0, durationMs - 50);
    return {
      startSec,
      endSec: startSec + durationMs / 1000,
      durationMs,
      blockingMs,
      attribution: "longtask (PerformanceObserver)",
    };
  });

  return {
    startedAt: new Date(startedAt).toISOString(),
    stoppedAt: new Date(stoppedAt).toISOString(),
    durationMs,
    fpsSeries: { label: "FPS", unit: "fps", points: fpsSamples },
    cpuSeries: {
      label: "CPU",
      unit: "%",
      points: samples.map((s) => ({
        timeSec: s.timeSec,
        value: Math.min(100, Math.max(0, (s.cpuBusyMs / 1000) * 100)),
      })),
    },
    gpuSeries: { label: "GPU", unit: "%", points: [] },
    memorySeries: {
      label: "JS Heap",
      unit: "MB",
      points: samples
        .filter((s) => typeof s.jsHeapMb === "number")
        .map((s) => ({ timeSec: s.timeSec, value: s.jsHeapMb })),
    },
    domNodesSeries: {
      label: "DOM Nodes",
      unit: "count",
      points: samples
        .filter((s) => typeof s.nodes === "number")
        .map((s) => ({ timeSec: s.timeSec, value: s.nodes })),
    },
    layoutMetrics: {
      layoutCount: 0,
      paintCount: 0,
      layoutTimeMs: totalLayout,
      paintTimeMs: totalPaint,
    },
    longTasks: {
      count: clientLongTasks.length,
      totalTimeMs: longTaskTotalMsFb,
      topTasks: topTasksFb,
      tbtTimeline: tbtTimelineFallback,
    },
    frameTiming: null,
    blockingSummary: {
      totalBlockedMs: longTaskTotalMsFb,
      longTaskCount: clientLongTasks.length,
      maxBlockingMs: maxDurFb,
      mainThreadBlockedMs: tbt,
    },
    networkSummary: {
      requests: networkRequests.length,
      totalBytes,
      averageLatencyMs: avgLatency,
    },
    networkRequests,
    renderBreakdown: {
      scriptMs: totalScript,
      layoutMs: totalLayout,
      rasterMs: 0,
      compositeMs: 0,
    },
    webglMetrics: { drawCalls: 0, shaderCompiles: 0, otherEvents: 0 },
    animationMetrics: {
      animations: [],
      animationFrameEventsPerSec: {
        label: "Animation frames",
        unit: "count",
        points: fpsSamples,
      },
      totalAnimations: 0,
    },
    webVitals: {
      fcpMs: clientCollector?.fcp,
      lcpMs: clientCollector?.lcp,
      cls:
        clientCollector?.layoutShiftEntries != null
          ? computeClsFromEntries(clientCollector.layoutShiftEntries)
          : (clientCollector?.cls ?? 0),
      tbtMs: tbt,
      longTaskCount: clientCollector?.longTasks?.length ?? 0,
      longTaskTotalMs:
        clientCollector?.longTasks?.reduce((s, t) => s + t.duration, 0) ?? 0,
    },
    spikeFrames: [],
    video: null,
    suggestions: [],
    gpuEstimated: true,
  };
}

async function getLiveMetrics() {
  const session = activeSession;
  if (!session) return null;
  const elapsedSec = (Date.now() - session.startedAt) / 1000;
  const last = session.samples[session.samples.length - 1];
  let fps = null;
  try {
    const state = await session.page.evaluate(() => {
      const p = window.__perftrace;
      if (!p) return null;
      if (p.samples?.length) return p.samples[p.samples.length - 1].value;
      return p.frames;
    });
    fps = state;
  } catch {}
  const cpuPercent =
    last?.cpuPercent ??
    (last?.cpuBusyMs != null
      ? Math.min(100, Math.max(0, (last.cpuBusyMs / 1000) * 100))
      : null);
  return {
    recording: true,
    elapsedSec,
    fps,
    cpuPercent,
    cpuBusyMs: last ? last.cpuBusyMs : null,
    jsHeapMb: last?.jsHeapMb ?? null,
    domNodes: last?.nodes ?? null,
  };
}

async function getLatestVideo() {
  if (!lastVideoPath) throw new Error("No video available.");
  const data = await fs.readFile(lastVideoPath);
  return { data, contentType: "video/webm" };
}

function getSessionSnapshot() {
  return {
    recording: !!activeSession,
    processing: reportGenerationInProgress,
    report: cachedSessionReport,
    automation: activeSession?.automation ?? null,
    error: lastAutomationError,
  };
}

module.exports = {
  createCaptureSession,
  stopCaptureSession,
  getLiveMetrics,
  getLatestVideo,
  getSessionSnapshot,
};
