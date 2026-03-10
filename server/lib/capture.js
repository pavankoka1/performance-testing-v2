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
const { parseTraceToReport } = require("./traceParser");

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
    const collector = { longTasks: [], cls: 0, fcp: undefined, lcp: undefined };
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
      });
      po.observe({ type: "paint", buffered: true });
    } catch {}
    try {
      const lcp = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        if (entries.length)
          collector.lcp = entries[entries.length - 1].startTime;
      });
      lcp.observe({ type: "largest-contentful-paint", buffered: true });
    } catch {}
    try {
      const cls = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          const c = e;
          if (!c.hadRecentInput && typeof c.value === "number")
            collector.cls += c.value;
        }
      });
      cls.observe({ type: "layout-shift", buffered: true });
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
          const name = anim.animationName || anim.transitionProperty || "";
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
    setInterval(poll, 400);
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
  try {
    await metricsCdp.send("Animation.enable");
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
      "disabled-by-default-devtools.timeline.frame",
      "disabled-by-default-devtools.timeline.paint",
      "disabled-by-default-devtools.timeline.layers",
      "disabled-by-default-devtools.timeline.stack",
      "blink.user_timing",
      "v8",
      "gpu",
    ].join(","),
    transferMode: "ReturnAsStream",
  });

  await ensureClientCollectors(page);
  await ensureMemoryAndDomCollector(page);
  await ensureAnimationPropertyCollector(page);

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
      const SAMPLE_WINDOW_MS = 2000;
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
  }, 2000);

  activeSession = {
    browser,
    context,
    page,
    traceCdp,
    metricsCdp,
    tracePath,
    startedAt: recordingStartMs,
    samples,
    fpsSamples,
    networkRequests,
    sampleInterval,
    cpuThrottle,
    rrtClient,
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
  if (!activeSession) throw new Error("No active session to stop.");

  const {
    browser,
    context,
    page,
    traceCdp,
    tracePath,
    startedAt,
    samples,
    fpsSamples,
    networkRequests,
    sampleInterval,
    rrtClient,
  } = activeSession;
  activeSession = null;

  if (sampleInterval) clearInterval(sampleInterval);

  let pageFps = [];
  try {
    pageFps = await page.evaluate(() => window.__perftrace?.samples ?? []);
  } catch {}
  fpsSamples.push(...pageFps);

  let clientCollector = null;
  try {
    clientCollector = await page.evaluate(
      () => window.__perftraceCollector ?? null
    );
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
  let traceText = "";
  try {
    await context.tracing.stop({ path: tracePath });
    const streamHandle = await new Promise((resolve, reject) => {
      const onComplete = (p) => {
        traceCdp.off("Tracing.tracingComplete", onComplete);
        resolve(p.stream ?? "");
      };
      traceCdp.on("Tracing.tracingComplete", onComplete);
      traceCdp.send("Tracing.end").catch((err) => {
        traceCdp.off("Tracing.tracingComplete", onComplete);
        reject(err);
      });
    });
    while (true) {
      const chunk = await traceCdp.send("IO.read", { handle: streamHandle });
      traceText += chunk.data;
      if (chunk.eof) break;
    }
    await traceCdp.send("IO.close", { handle: streamHandle });
  } finally {
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
  if (reactRerenderHint) {
    report.developerHints = {
      ...report.developerHints,
      reactRerenders: reactRerenderHint,
    };
  }
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
        value: Math.min(100, Math.max(0, (s.cpuBusyMs / 2000) * 100)),
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
      cls: clientCollector?.cls,
      tbtMs: tbt,
      longTaskCount: clientCollector?.longTasks?.length ?? 0,
      longTaskTotalMs:
        clientCollector?.longTasks?.reduce((s, t) => s + t.duration, 0) ?? 0,
    },
    spikeFrames: [],
    video: null,
    suggestions: [],
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
      ? Math.min(100, Math.max(0, (last.cpuBusyMs / 2000) * 100))
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
