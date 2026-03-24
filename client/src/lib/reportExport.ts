import type { PerfReport } from "./reportTypes";

const formatNum = (n: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n);

const formatBytes = (value: number) => {
  if (value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log10(value) / 3));
  return `${formatNum(value / 1024 ** index)} ${units[index]}`;
};

const escapeHtml = (s: string) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

function avg(points: { value: number }[]): number {
  if (!points.length) return 0;
  return points.reduce((s, p) => s + p.value, 0) / points.length;
}

export function buildReportHtml(report: PerfReport): string {
  const durationSec = report.durationMs / 1000;
  const fpsAvg = avg(report.fpsSeries.points);
  const cpuAvg = avg(report.cpuSeries.points);
  const gpuAvg = avg(report.gpuSeries.points);
  const memMax =
    report.memorySeries.points.length > 0
      ? Math.max(...report.memorySeries.points.map((p) => p.value))
      : 0;
  const domMax =
    report.domNodesSeries.points.length > 0
      ? Math.max(...report.domNodesSeries.points.map((p) => p.value))
      : 0;

  const animRows = (report.animationMetrics?.animations ?? [])
    .map(
      (a) =>
        `<tr>
          <td>${escapeHtml(a.name || "(unnamed)")}</td>
          <td>${escapeHtml(a.type)}</td>
          <td>${escapeHtml((a.properties ?? []).join(", ") || "—")}</td>
          <td>${a.bottleneckHint ?? "—"}</td>
          <td>${a.durationMs != null ? formatNum(a.durationMs) + " ms" : "—"}</td>
        </tr>`
    )
    .join("");

  const suggestionRows = (report.suggestions ?? [])
    .map(
      (s) =>
        `<tr>
          <td><span class="badge badge-${s.severity}">${s.severity}</span></td>
          <td><strong>${escapeHtml(s.title)}</strong></td>
          <td>${escapeHtml(s.detail)}</td>
        </tr>`
    )
    .join("");

  const longTaskRows = report.longTasks.topTasks
    .map(
      (t) =>
        `<tr>
          <td>${escapeHtml(t.name)}</td>
          <td>${formatNum(t.durationMs)} ms</td>
          <td>${formatNum(t.startSec)} s</td>
          <td>${t.attribution ? escapeHtml(t.attribution) : "—"}</td>
        </tr>`
    )
    .join("");

  const assetLabels: Record<string, string> = {
    build: "Build (main HTML)",
    script: "Scripts (.js)",
    stylesheet: "Styles (.css)",
    document: "Other documents",
    json: "API responses (XHR/fetch)",
    image: "Images",
    font: "Fonts",
    other: "Other",
  };
  const assetCategories = [
    "build",
    "script",
    "stylesheet",
    "document",
    "json",
    "image",
    "font",
    "other",
  ] as const;
  const downloadedAssetsHtml =
    report.downloadedAssets && report.downloadedAssets.totalCount > 0
      ? `
  <h2>Downloaded files — Build size, scripts, styles, API responses, assets</h2>
  <p>Total: ${formatBytes(report.downloadedAssets.totalBytes)} (${
    report.downloadedAssets.totalCount
  } files)</p>
  <div class="grid">
    ${assetCategories
      .map((cat) => {
        const data = report.downloadedAssets!.byCategory[cat];
        if (!data || data.count === 0) return "";
        return `<div class="card"><span class="card-label">${escapeHtml(assetLabels[cat] ?? cat)}</span><div class="card-value">${data.count} files · ${formatBytes(data.totalBytes)}</div></div>`;
      })
      .filter(Boolean)
      .join("")}
  </div>
  <table>
    <thead><tr><th>Category</th><th>URL</th><th>Size</th></tr></thead>
    <tbody>
      ${assetCategories
        .flatMap((cat) => {
          const data = report.downloadedAssets!.byCategory[cat];
          if (!data || data.files.length === 0) return [];
          return data.files
            .slice(0, 20)
            .map(
              (f) =>
                `<tr><td>${escapeHtml(assetLabels[cat] ?? cat)}</td><td class="url-cell">${escapeHtml(f.url)}</td><td>${f.transferSize != null ? formatBytes(f.transferSize) : "—"}</td></tr>`
            );
        })
        .join("")}
    </tbody>
  </table>`
      : "";

  const blockingHtml =
    report.blockingSummary && report.blockingSummary.longTaskCount > 0
      ? `
  <h2>Main thread blocking</h2>
  <p>Long tasks: ${report.blockingSummary.longTaskCount} | Total blocked: ${formatNum(
    report.blockingSummary.totalBlockedMs
  )} ms | Main thread blocked (TBT): ${formatNum(
    report.blockingSummary.mainThreadBlockedMs
  )} ms | Longest: ${formatNum(report.blockingSummary.maxBlockingMs)} ms</p>`
      : "";

  const networkRows = report.networkRequests
    .slice(0, 100)
    .map(
      (r) =>
        `<tr>
          <td class="url-cell">${escapeHtml(r.url)}</td>
          <td>${escapeHtml(r.method)}</td>
          <td>${r.status ?? "—"}</td>
          <td>${r.type ?? "—"}</td>
          <td>${r.transferSize != null ? formatBytes(r.transferSize) : "—"}</td>
          <td>${r.durationMs != null ? formatNum(r.durationMs) + " ms" : "—"}</td>
        </tr>`
    )
    .join("");

  const reactRerendersHtml =
    report.developerHints?.reactRerenders &&
    report.developerHints.reactRerenders.components?.length > 0
      ? `
  <h2>React re-renders</h2>
  <p>${report.developerHints.reactRerenders.totalEvents} events across ${
    report.developerHints.reactRerenders.components.length
  } components</p>
  <table>
    <thead><tr><th>Component</th><th>Re-renders</th><th>In bursts</th></tr></thead>
    <tbody>
      ${(report.developerHints.reactRerenders.topRerenderers ?? [])
        .slice(0, 15)
        .map(
          (c) =>
            `<tr><td>${escapeHtml(c.name)}</td><td>${c.count}</td><td>${
              c.inBursts ?? 0
            }</td></tr>`
        )
        .join("")}
    </tbody>
  </table>`
      : "";

  const spikeFramesHtml =
    (report.spikeFrames?.length ?? 0) > 0
      ? (report.spikeFrames ?? [])
          .map(
            (f) =>
              `<div class="spike-frame">
                <img src="${f.imageDataUrl}" alt="Spike at ${f.timeSec}s" />
                <p>${formatNum(f.timeSec)}s · ${Math.round(f.fps)} FPS</p>
              </div>`
          )
          .join("")
      : '<p class="muted">No spike frames captured.</p>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>PerfTrace Report — ${escapeHtml(
    new Date(report.startedAt).toLocaleString()
  )}</title>
  <style>
    :root { --bg: #0c0c0f; --fg: #f4f4f5; --muted: #a1a1aa; --accent: #8b5cf6; --border: rgba(255,255,255,0.08); }
    * { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; background: var(--bg); color: var(--fg); margin: 0; padding: 2rem; line-height: 1.6; max-width: 1000px; }
    h1 { font-size: 1.75rem; margin: 0 0 0.5rem; background: linear-gradient(135deg,#6d28d9,#a78bfa); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    h2 { font-size: 1.25rem; margin: 1.5rem 0 0.75rem; color: var(--fg); border-bottom: 1px solid var(--border); padding-bottom: 0.5rem; }
    p { margin: 0.5rem 0; color: var(--muted); }
    .muted { color: var(--muted); font-size: 0.875rem; }
    table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
    th, td { padding: 0.5rem 0.75rem; text-align: left; border-bottom: 1px solid var(--border); }
    th { color: var(--muted); font-weight: 600; text-transform: uppercase; font-size: 0.7rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 1rem; margin: 1rem 0; }
    .card { background: #141418; border: 1px solid var(--border); border-radius: 0.75rem; padding: 1rem; }
    .card-label { font-size: 0.7rem; text-transform: uppercase; color: var(--muted); }
    .card-value { font-size: 1.5rem; font-weight: 600; color: var(--accent); }
    .badge { padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.7rem; }
    .badge-warning { background: rgba(245,158,11,0.2); color: #f59e0b; }
    .badge-info { background: rgba(59,130,246,0.2); color: #3b82f6; }
    .badge-critical { background: rgba(239,68,68,0.2); color: #ef4444; }
    .spike-frames { display: flex; flex-wrap: wrap; gap: 1rem; margin: 1rem 0; }
    .spike-frame { flex: 1 1 180px; background: #141418; border-radius: 0.5rem; overflow: hidden; border: 1px solid var(--border); }
    .spike-frame img { width: 100%; height: auto; display: block; }
    .spike-frame p { padding: 0.5rem; margin: 0; font-size: 0.75rem; }
    .url-cell { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  </style>
</head>
<body>
  <header>
    <h1>PerfTrace — Performance Report</h1>
    <p>${escapeHtml(new Date(report.startedAt).toLocaleString())} → ${escapeHtml(
      new Date(report.stoppedAt).toLocaleString()
    )} (${formatNum(durationSec)}s)</p>
    ${
      report.recordedUrl
        ? `<p><strong>URL:</strong> <a href="${escapeHtml(
            report.recordedUrl
          )}" style="color:var(--accent)">${escapeHtml(report.recordedUrl)}</a></p>`
        : ""
    }
  </header>

  <h2>Summary</h2>
  <div class="grid">
    <div class="card"><span class="card-label">Avg FPS</span><div class="card-value">${formatNum(
      fpsAvg
    )}</div></div>
    <div class="card"><span class="card-label">Avg CPU</span><div class="card-value">${formatNum(
      cpuAvg
    )}%</div></div>
    <div class="card"><span class="card-label">Avg GPU</span><div class="card-value">${formatNum(
      gpuAvg
    )}%${report.gpuEstimated ? " *" : ""}</div></div>
    <div class="card"><span class="card-label">Peak heap</span><div class="card-value">${formatNum(
      memMax
    )} MB</div></div>
    <div class="card"><span class="card-label">Peak DOM nodes</span><div class="card-value">${formatNum(
      domMax
    )}</div></div>
    <div class="card"><span class="card-label">TBT</span><div class="card-value">${formatNum(
      report.webVitals.tbtMs
    )} ms</div></div>
    <div class="card"><span class="card-label">Long tasks</span><div class="card-value">${
      report.webVitals.longTaskCount
    }</div></div>
    <div class="card"><span class="card-label">FCP</span><div class="card-value">${
      report.webVitals.fcpMs != null
        ? formatNum(report.webVitals.fcpMs) + " ms"
        : "—"
    }</div></div>
    <div class="card"><span class="card-label">LCP</span><div class="card-value">${
      report.webVitals.lcpMs != null
        ? formatNum(report.webVitals.lcpMs) + " ms"
        : "—"
    }</div></div>
    <div class="card"><span class="card-label">CLS</span><div class="card-value">${
      report.webVitals.cls != null ? formatNum(report.webVitals.cls) : "—"
    }</div></div>
  </div>
  ${report.gpuEstimated ? '<p class="muted">* GPU estimated from raster+composite (no GPU trace events)</p>' : ""}

  <h2>Layout & Paint</h2>
  <p>Layouts: ${report.layoutMetrics.layoutCount} | Paints: ${
    report.layoutMetrics.paintCount
  } | Layout time: ${formatNum(
    report.layoutMetrics.layoutTimeMs
  )} ms | Paint time: ${formatNum(report.layoutMetrics.paintTimeMs)} ms</p>

  <h2>Render breakdown</h2>
  <p>Script: ${formatNum(
    report.renderBreakdown.scriptMs
  )} ms | Layout: ${formatNum(
    report.renderBreakdown.layoutMs
  )} ms | Raster: ${formatNum(
    report.renderBreakdown.rasterMs
  )} ms | Composite: ${formatNum(report.renderBreakdown.compositeMs)} ms</p>

  ${blockingHtml}

  ${downloadedAssetsHtml}

  <h2>Network</h2>
  <p>Requests: ${report.networkSummary.requests} | Total: ${formatBytes(
    report.networkSummary.totalBytes
  )} | Avg latency: ${formatNum(report.networkSummary.averageLatencyMs)} ms</p>

  <h2>Web Vitals</h2>
  <p>FCP: ${
    report.webVitals.fcpMs != null
      ? formatNum(report.webVitals.fcpMs) + " ms"
      : "—"
  } | LCP: ${
    report.webVitals.lcpMs != null
      ? formatNum(report.webVitals.lcpMs) + " ms"
      : "—"
  } | CLS: ${
    report.webVitals.cls != null ? formatNum(report.webVitals.cls) : "—"
  } | TBT: ${formatNum(report.webVitals.tbtMs)} ms | Long tasks: ${
    report.webVitals.longTaskCount
  }</p>

  <h2>Animations & properties</h2>
  <table>
    <thead><tr><th>Name</th><th>Type</th><th>Properties</th><th>Bottleneck</th><th>Duration</th></tr></thead>
    <tbody>${
      animRows || "<tr><td colspan='5'>No animations captured.</td></tr>"
    }</tbody>
  </table>

  <h2>Long tasks</h2>
  <table>
    <thead><tr><th>Task</th><th>Duration</th><th>Start (s)</th><th>Attribution</th></tr></thead>
    <tbody>${
      longTaskRows || "<tr><td colspan='4'>No long tasks.</td></tr>"
    }</tbody>
  </table>

  <h2>Network requests</h2>
  <table>
    <thead><tr><th>URL</th><th>Method</th><th>Status</th><th>Type</th><th>Size</th><th>Duration</th></tr></thead>
    <tbody>${
      networkRows || "<tr><td colspan='6'>No requests.</td></tr>"
    }</tbody>
  </table>

  <h2>Suggestions</h2>
  <table>
    <thead><tr><th>Severity</th><th>Title</th><th>Detail</th></tr></thead>
    <tbody>${
      suggestionRows ||
      "<tr><td colspan='3'>No major bottlenecks detected.</td></tr>"
    }</tbody>
  </table>

  <h2>FPS spike frames</h2>
  <div class="spike-frames">${spikeFramesHtml}</div>

  ${reactRerendersHtml}

  <footer style="margin-top: 3rem; padding-top: 1rem; border-top: 1px solid var(--border); font-size: 0.75rem; color: var(--muted);">
    Generated by PerfTrace — ${new Date().toISOString()}
  </footer>
</body>
</html>`;
}

export function downloadReportHtml(report: PerfReport) {
  const html = buildReportHtml(report);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `perftrace-report-${new Date(report.startedAt)
    .toISOString()
    .slice(0, 19)
    .replace(/[:-]/g, "")}.html`;
  a.click();
  URL.revokeObjectURL(url);
}
