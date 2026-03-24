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
  readTraceFromZip,
  computeClsFromEntries,
} = require("./traceParser");

const LAYOUT_PROPS = new Set([
  "width",
  "height",
  "top",
  "left",
  "right",
  "bottom",
  "margin",
  "padding",
  "border",
  "font-size",
  "display",
  "position",
]);
const PAINT_PROPS = new Set([
  "color",
  "background",
  "box-shadow",
  "outline",
  "filter",
  "border-radius",
]);
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
  networkRequests
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
  return { byCategory, totalBytes, totalCount };
}

const SKIP_KEYFRAME_KEYS = new Set([
  "offset",
  "easing",
  "composite",
  "compositeoperation",
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

function inferBottleneck(properties, animationName) {
  if (properties?.length) {
    const lower = properties.map((p) => p.toLowerCase());
    if (
      lower.some(
        (p) =>
          LAYOUT_PROPS.has(p) || p.includes("margin") || p.includes("padding")
      )
    )
      return "layout";
    if (
      lower.some(
        (p) =>
          PAINT_PROPS.has(p) || p.includes("shadow") || p.includes("background")
      )
    )
      return "paint";
    if (lower.some((p) => p === "transform" || p === "opacity"))
      return "compositor";
  }
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
  return {
    headless,
    args: [
      "--disable-dev-shm-usage",
      "--window-size=1366,768",
      "--window-position=0,0",
    ],
    defaultViewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
  };
}

async function ensureClientCollectors(page) {
  await page.addInitScript(() => {
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

async function ensureMemoryAndDomCollector(page) {
  await page.addInitScript(() => {
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

async function ensureResourceTimingCollector(page) {
  await page.addInitScript(() => {
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
          })),
          navigation: navEntries.map((e) => ({
            url: e.name,
            transferSize: e.transferSize ?? 0,
            encodedBodySize: e.encodedBodySize ?? 0,
            decodedBodySize: e.decodedBodySize ?? 0,
            duration: e.duration ?? 0,
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

async function ensureAnimationPropertyCollector(page) {
  await page.addInitScript(() => {
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
                  !["offset", "easing", "composite"].includes(
                    key.toLowerCase()
                  ) &&
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

async function createCaptureSession(
  url,
  cpuThrottle = 1,
  trackReactRerenders = false
) {
  if (activeSession) {
    throw new Error("A recording session is already running.");
  }

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
    recordVideo: {
      dir: videoDir,
      size: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
    },
  });
  const page = await context.newPage();
  const traceCdp = await context.newCDPSession(page);
  const metricsCdp = await context.newCDPSession(page);

  const tracePath = path.join(os.tmpdir(), `perftrace-${randomUUID()}.zip`);
  await context.tracing.start({
    screenshots: true,
    snapshots: true,
    sources: true,
    title: "PerfTrace Session",
  });

  await metricsCdp.send("Performance.enable");
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
  if (cpuThrottle > 1) {
    try {
      await metricsCdp.send("Emulation.setCPUThrottlingRate", {
        rate: cpuThrottle,
      });
    } catch {}
  }
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

  await ensureClientCollectors(page);
  await ensureMemoryAndDomCollector(page);
  await ensureAnimationPropertyCollector(page);
  await ensureResourceTimingCollector(page);

  let rrtClient = null;
  if (trackReactRerenders) {
    try {
      const newTrackerClient = (
        await import("react-render-tracker/headless-browser-client")
      ).default;
      rrtClient = await newTrackerClient(page);
    } catch {}
  }

  const recordingStartMs = Date.now();
  await page.goto(safeUrl, { waitUntil: "domcontentloaded" });
  await ensureFpsCollector(page);

  const samples = [];
  const fpsSamples = [];
  const networkRequests = [];
  const requestIds = new WeakMap();
  const pendingRequests = new Map();
  let lastPerfTotals;

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
        jsHeapSize,
        nodes,
      };
      const lastTotals = lastPerfTotals;
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
      lastPerfTotals = totals;
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
    tracePath,
    startedAt: recordingStartMs,
    recordedUrl: safeUrl,
    samples,
    fpsSamples,
    networkRequests,
    sampleInterval,
    cpuThrottle,
    rrtClient,
    collectedAnimations,
  };

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
  };
}

async function stopCaptureSession() {
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

  const {
    browser,
    context,
    page,
    tracePath,
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
      const events = (await rrtClient.getEvents()) || [];
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

  // Stop tracing (writes to tracePath) and close context immediately so the video
  // stops recording at the moment the user clicked stop. Trace parsing happens after.
  await context.tracing.stop({ path: tracePath });

  const candidates = [];
  const pageVideo = page.video();
  if (pageVideo) {
    try {
      const fp = await pageVideo.path();
      const st = await fs.stat(fp);
      candidates.push({ path: fp, size: st.size });
    } catch {}
  }
  for (const p of context.pages()) {
    const v = p.video();
    if (v && v !== pageVideo) {
      try {
        const fp = await v.path();
        const st = await fs.stat(fp);
        candidates.push({ path: fp, size: st.size });
      } catch {}
    }
  }
  if (candidates.length > 0) {
    candidates.sort((a, b) => b.size - a.size);
    lastVideoPath = candidates[0].path;
  }

  await context.close().catch(() => {});
  await browser.close().catch(() => {});

  let traceText = "";
  try {
    traceText = await readTraceFromZip(tracePath);
  } catch (err) {
    console.warn("[PerfTrace] readTraceFromZip failed:", err?.message || err);
  }

  let report;
  try {
    report = await parseTraceToReport(
      tracePath,
      traceText,
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
    networkRequests
  );

  const mainThreadBlockedMs = report.longTasks.topTasks.reduce(
    (s, t) => s + Math.max(0, t.durationMs - 50),
    0
  );
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
    animations: allAnims,
    totalAnimations: allAnims.length,
  };
  await fs.unlink(tracePath).catch(() => {});

  return report;
}

function buildFallbackReport(startedAt, stoppedAt, fallback) {
  const durationMs = Math.max(0, stoppedAt - startedAt);
  const { samples, fpsSamples, networkRequests, clientCollector } = fallback;
  const totalScript = samples.reduce((s, x) => s + x.scriptMs, 0);
  const totalLayout = samples.reduce((s, x) => s + x.layoutMs, 0);
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
      paintTimeMs: 0,
    },
    longTasks: { count: 0, totalTimeMs: 0, topTasks: [] },
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

module.exports = {
  createCaptureSession,
  stopCaptureSession,
  getLiveMetrics,
  getLatestVideo,
};
