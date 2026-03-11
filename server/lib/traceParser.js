/**
 * Parse Chrome trace events into PerfReport format.
 * Adapted from performance-testing-app playwrightUtils.
 */
const fs = require("fs/promises");
const yauzl = require("yauzl");

const FRAME_EVENT_NAMES = new Set([
  "DrawFrame",
  "BeginFrame",
  "SwapBuffers",
  "CompositeLayers",
]);
const SCRIPT_EVENT_NAMES = new Set([
  "EvaluateScript",
  "V8.Execute",
  "CompileScript",
  "V8.Compile",
  "FunctionCall",
]);
const RASTER_EVENT_NAMES = new Set([
  "Rasterize",
  "RasterTask",
  "GPUTask",
  "GPURasterization",
  "RasterizerTask",
  "DisplayItemList",
]);
const COMPOSITE_EVENT_NAMES = new Set([
  "CompositeLayers",
  "UpdateLayerTree",
  "BeginMainFrame",
  "Commit",
]);
const LAYOUT_EVENT_NAMES = new Set(["Layout", "UpdateLayoutTree"]);
const PAINT_EVENT_NAMES = new Set(["Paint", "PaintImage"]);

function parseTraceEvents(traceText) {
  try {
    const parsed = JSON.parse(traceText);
    return Array.isArray(parsed) ? parsed : (parsed.traceEvents ?? []);
  } catch {
    const lines = traceText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const events = [];
    for (const line of lines) {
      try {
        const p = JSON.parse(line);
        if (Array.isArray(p)) events.push(...p);
        else if (p.traceEvents) events.push(...p.traceEvents);
        else if (p.events) events.push(...p.events);
        else if (p.event) events.push(p.event);
        else if (p.name != null && p.ts != null) events.push(p);
      } catch {}
    }
    return events;
  }
}

async function readTraceFromZip(tracePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(tracePath, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) {
        reject(err ?? new Error("Failed to read trace zip."));
        return;
      }
      let resolved = false;
      zipfile.readEntry();
      zipfile.on("entry", (entry) => {
        if (
          entry.fileName.endsWith("trace.trace") ||
          entry.fileName.endsWith("trace.json")
        ) {
          zipfile.openReadStream(entry, (streamErr, stream) => {
            if (streamErr || !stream) {
              zipfile.close();
              reject(streamErr ?? new Error("Failed to read trace."));
              return;
            }
            const chunks = [];
            stream.on("data", (c) => chunks.push(c));
            stream.on("end", () => {
              resolved = true;
              zipfile.close();
              resolve(Buffer.concat(chunks).toString("utf-8"));
            });
          });
        } else {
          zipfile.readEntry();
        }
      });
      zipfile.on("end", () => {
        if (!resolved) {
          zipfile.close();
          reject(new Error("Trace data not found in zip."));
        }
      });
    });
  });
}

function parseTraceToReport(
  tracePath,
  traceText,
  startedAt,
  stoppedAt,
  fallback
) {
  const tracePayload = traceText || "";
  const events = tracePayload ? parseTraceEvents(tracePayload) : [];

  let startTs = Number.POSITIVE_INFINITY;
  let endTs = Number.NEGATIVE_INFINITY;
  for (const e of events) {
    if (typeof e.ts === "number") {
      if (e.ts < startTs) startTs = e.ts;
      if (e.ts > endTs) endTs = e.ts;
    }
  }
  if (!Number.isFinite(startTs) || !Number.isFinite(endTs)) {
    startTs = 0;
    endTs = 0;
  }

  const wallClockDurationMs = Math.max(0, stoppedAt - startedAt);
  const wallClockDurationSec = wallClockDurationMs / 1000;
  const rawTraceSpan = endTs - startTs;
  const traceTsIsMicroseconds = rawTraceSpan > 1e6;
  const traceTsToSec = traceTsIsMicroseconds ? 1_000_000 : 1000;

  const fpsMap = new Map();
  const cpuBusyMap = new Map();
  const gpuBusyMap = new Map();
  const memoryPoints = [];
  const domPoints = [];
  let layoutCount = 0;
  let paintCount = 0;
  let layoutTimeMs = 0;
  let paintTimeMs = 0;
  const longTasks = [];
  let scriptMs = 0;
  let layoutMs = 0;
  let rasterMs = 0;
  let compositeMs = 0;

  const tsToSec = (ts) =>
    Math.max(0, Math.min(wallClockDurationSec, (ts - startTs) / traceTsToSec));

  const addToBucket = (bucket, ts, value) => {
    const second = Math.floor(tsToSec(ts));
    bucket.set(second, (bucket.get(second) ?? 0) + value);
  };

  for (const event of events) {
    const name = event.name ?? "";
    const cat = event.cat ?? "";
    const ts = event.ts ?? 0;
    const dur = event.dur ?? 0;

    if (FRAME_EVENT_NAMES.has(name)) addToBucket(fpsMap, ts, 1);
    if (event.ph === "X" && dur > 0) {
      const durMs = dur / 1000;
      if (cat.includes("toplevel") || name === "RunTask")
        addToBucket(cpuBusyMap, ts, durMs);
      if (
        cat.includes("gpu") ||
        name.includes("GPU") ||
        RASTER_EVENT_NAMES.has(name) ||
        COMPOSITE_EVENT_NAMES.has(name) ||
        cat.includes("cc") ||
        cat.includes("raster")
      ) {
        addToBucket(gpuBusyMap, ts, durMs);
      }
    }
    if (LAYOUT_EVENT_NAMES.has(name)) {
      layoutCount++;
      layoutTimeMs += dur / 1000;
      layoutMs += dur / 1000;
    }
    if (PAINT_EVENT_NAMES.has(name)) {
      paintCount++;
      paintTimeMs += dur / 1000;
    }
    if (SCRIPT_EVENT_NAMES.has(name)) scriptMs += dur / 1000;
    if (RASTER_EVENT_NAMES.has(name)) rasterMs += dur / 1000;
    if (COMPOSITE_EVENT_NAMES.has(name)) compositeMs += dur / 1000;
    if (name === "RunTask" && dur / 1000 > 50) {
      longTasks.push({ name, durationMs: dur / 1000, startSec: tsToSec(ts) });
    }
    if (name === "UpdateCounters") {
      const data = (event.args?.data ?? {}) || {};
      const heap =
        data.jsHeapSizeUsed ?? data.jsHeapSize ?? data.usedJSHeapSize;
      const nodes = data.nodes ?? data.documentCount;
      if (typeof heap === "number")
        memoryPoints.push({
          timeSec: tsToSec(ts),
          value: heap / (1024 * 1024),
        });
      if (typeof nodes === "number")
        domPoints.push({ timeSec: tsToSec(ts), value: nodes });
    }
  }

  const mapToSeries = (bucket, label, unit) => {
    const points = [...bucket.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([timeSec, value]) => ({ timeSec, value }));
    return { label, unit, points };
  };

  const { samples, fpsSamples, networkRequests } = fallback;
  const totalScript = scriptMs || samples.reduce((s, x) => s + x.scriptMs, 0);
  const totalLayout = layoutMs || samples.reduce((s, x) => s + x.layoutMs, 0);

  const traceFpsPoints = mapToSeries(fpsMap, "FPS", "fps").points;
  const useTraceFps =
    fpsMap.size > 2 &&
    traceFpsPoints.length >= 2 &&
    Math.max(...traceFpsPoints.map((p) => p.value)) <= 200;
  const fpsSeries = useTraceFps
    ? {
        label: "FPS",
        unit: "fps",
        points: traceFpsPoints.map((p) => ({
          ...p,
          value: Math.min(120, Math.max(0, p.value)),
        })),
      }
    : {
        label: "FPS",
        unit: "fps",
        points: fpsSamples.map((p) => ({
          ...p,
          value: Math.min(120, Math.max(0, p.value)),
        })),
      };

  // CPU: convert to percentage (0-100). Sample window is ~1s per bucket from trace, 2s from CDP samples.
  const SAMPLE_WINDOW_MS = 2000; // 2-second sampling interval
  const toCpuPercent = (ms) =>
    Math.min(100, Math.max(0, (ms / SAMPLE_WINDOW_MS) * 100));

  const cpuPoints = mapToSeries(cpuBusyMap, "CPU", "%").points;
  const useTraceCpu = cpuBusyMap.size > 2 && cpuPoints.length >= 2;
  const cpuSeries = useTraceCpu
    ? {
        label: "CPU",
        unit: "%",
        points: cpuPoints.map((p) => ({ ...p, value: toCpuPercent(p.value) })),
      }
    : {
        label: "CPU",
        unit: "%",
        points: samples.map((s) => ({
          timeSec: s.timeSec,
          value: toCpuPercent(s.cpuBusyMs),
        })),
      };

  // GPU: ms per second -> percentage (0-100). Value is total ms in that second.
  const toGpuPercent = (ms) => Math.min(100, Math.max(0, (ms / 1000) * 100));
  let gpuPoints = mapToSeries(gpuBusyMap, "GPU", "%").points;
  let gpuFromFallback = false;
  if (gpuPoints.length === 0 && wallClockDurationSec > 0) {
    const totalGpuMs = rasterMs + compositeMs;
    const avgGpuPct = Math.min(
      100,
      totalGpuMs > 0 ? (totalGpuMs / wallClockDurationMs) * 100 : 0
    );
    const steps = Math.max(2, Math.floor(wallClockDurationSec));
    const step = wallClockDurationSec / steps;
    gpuPoints = [];
    for (let i = 0; i <= steps; i++) {
      gpuPoints.push({ timeSec: i * step, value: avgGpuPct });
    }
    gpuFromFallback = true;
  }
  const gpuSeries = {
    label: "GPU",
    unit: "%",
    points: gpuPoints.map((p) => ({
      ...p,
      value: gpuFromFallback ? p.value : toGpuPercent(p.value),
    })),
  };

  const memorySeries =
    memoryPoints.length > 0
      ? { label: "JS Heap", unit: "MB", points: memoryPoints }
      : {
          label: "JS Heap",
          unit: "MB",
          points: samples
            .filter((s) => typeof s.jsHeapMb === "number")
            .map((s) => ({ timeSec: s.timeSec, value: s.jsHeapMb })),
        };

  const domSeries =
    domPoints.length > 0
      ? { label: "DOM Nodes", unit: "count", points: domPoints }
      : {
          label: "DOM Nodes",
          unit: "count",
          points: samples
            .filter((s) => typeof s.nodes === "number")
            .map((s) => ({ timeSec: s.timeSec, value: s.nodes })),
        };

  const totalBytes = networkRequests.reduce(
    (s, r) => s + (r.transferSize ?? 0),
    0
  );
  const avgLatency =
    networkRequests.length === 0
      ? 0
      : networkRequests.reduce((s, r) => s + (r.durationMs ?? 0), 0) /
        networkRequests.length;

  const suggestions = [];
  const avgFps = fpsSeries.points.length
    ? fpsSeries.points.reduce((s, p) => s + p.value, 0) /
      fpsSeries.points.length
    : 0;
  if (avgFps > 0 && avgFps < 50) {
    suggestions.push({
      title: "Low frame rate",
      detail:
        "Average FPS below 50. Reduce main-thread work or optimize animations.",
      severity: "warning",
    });
  }
  if (longTasks.length > 10) {
    suggestions.push({
      title: "Long tasks detected",
      detail:
        "Multiple tasks exceeded 50ms. Split heavy work or debounce handlers.",
      severity: "warning",
    });
  }

  const tbt = (fallback.clientCollector?.longTasks ?? []).reduce(
    (s, t) => s + Math.max(0, t.duration - 50),
    0
  );

  return {
    startedAt: new Date(startedAt).toISOString(),
    stoppedAt: new Date(stoppedAt).toISOString(),
    durationMs: wallClockDurationMs,
    fpsSeries,
    cpuSeries,
    gpuSeries,
    memorySeries,
    domNodesSeries: domSeries,
    layoutMetrics: { layoutCount, paintCount, layoutTimeMs, paintTimeMs },
    longTasks: {
      count: longTasks.length,
      totalTimeMs: longTasks.reduce((s, t) => s + t.durationMs, 0),
      topTasks: longTasks
        .sort((a, b) => b.durationMs - a.durationMs)
        .slice(0, 5),
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
      rasterMs,
      compositeMs,
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
      fcpMs: fallback.clientCollector?.fcp,
      lcpMs: fallback.clientCollector?.lcp,
      cls: fallback.clientCollector?.cls,
      tbtMs: tbt,
      longTaskCount: fallback.clientCollector?.longTasks?.length ?? 0,
      longTaskTotalMs:
        fallback.clientCollector?.longTasks?.reduce(
          (s, t) => s + t.duration,
          0
        ) ?? 0,
    },
    spikeFrames: [],
    video: null,
    suggestions,
  };
}

module.exports = { parseTraceToReport, parseTraceEvents, readTraceFromZip };
