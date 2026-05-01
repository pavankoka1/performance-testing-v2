import {
  animationDisplayLabel,
  effectiveBottleneck,
  formatAnimationPropertiesForDisplay,
} from "@/lib/animationUtils";
import {
  cpuThrottleLabel,
  formatThroughputBps,
  networkThrottleLabel,
} from "@/lib/captureSettingsLabels";
import {
  clsHealth,
  cpuHealth,
  domHealth,
  fcpHealth,
  fpsHealth,
  gpuHealth,
  healthToHtmlClass,
  heapHealth,
  latencyHealth,
  lcpHealth,
  paintMsHealth,
  staggerHealth,
  tbtHealth,
} from "@/lib/metricHealth";
import type { CaptureSettings, PerfReport } from "./reportTypes";
import { buildTbtSvgString } from "./tbtChartSvg";

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

/** Downloadable HTML sections — open by default for a quick full read. */
function collapsibleSection(title: string, bodyHtml: string): string {
  return `<details class="report-details" open><summary class="report-details-summary">${escapeHtml(
    title
  )}</summary><div class="report-details-body">${bodyHtml}</div></details>`;
}

function avg(points: { value: number }[]): number {
  if (!points.length) return 0;
  return points.reduce((s, p) => s + p.value, 0) / points.length;
}

function spanClass(h: ReturnType<typeof fpsHealth>): string {
  return healthToHtmlClass(h);
}

/** Always-visible panel for downloaded HTML only — matches summary card styling. */
function buildCaptureSettingsPanel(cs: CaptureSettings): string {
  const netDetail = `RTT ${cs.networkProfile.latencyMs} ms · ↓ ${formatThroughputBps(cs.networkProfile.downloadBps)} · ↑ ${formatThroughputBps(cs.networkProfile.uploadBps)}`;
  const layoutLabel =
    cs.browserLayout.mode === "portrait"
      ? `Mobile portrait ${cs.browserLayout.width}×${cs.browserLayout.height} (fixed)`
      : cs.browserLayout.mode === "mobileLandscape"
        ? `Mobile landscape ${cs.browserLayout.width}×${cs.browserLayout.height} (fixed)`
        : cs.browserLayout.mode === "landscape"
          ? "Desktop (maximized)"
          : "Desktop (maximized)";
  const automationBlock =
    cs.automation?.enabled && cs.automation.gameId
      ? `<div class="card-val card-span-2"><span class="lbl">Automation</span><div class="card-value card-value-tight">${escapeHtml(String(cs.automation.gameId))}${cs.automation.rounds != null ? ` · ${cs.automation.rounds} rounds` : ""}${cs.automation.skipLobby ? " · skip lobby" : ""}</div></div>`
      : "";
  return `<section class="capture-panel">
    <h2 class="h-capture">Session capture settings</h2>
    <p class="muted capture-lead">CPU / network shaping, trace depth, recording, and layout used for this Chromium session — use when comparing runs or reading throttled metrics.</p>
    <div class="grid grid-capture">
      <div class="card-val"><span class="lbl">CPU throttle</span><div class="card-value card-value-tight">${escapeHtml(cpuThrottleLabel(cs.cpuThrottle))}</div></div>
      <div class="card-val card-span-2"><span class="lbl">Network (CDP shaping)</span><div class="card-value card-value-tight">${escapeHtml(networkThrottleLabel(cs.networkThrottle))}</div><p class="capture-detail muted">${escapeHtml(netDetail)}</p></div>
      <div class="card-val"><span class="lbl">Trace</span><div class="card-value card-value-tight">${cs.traceDetail === "light" ? "Light" : "Full"}</div></div>
      <div class="card-val"><span class="lbl">Session video</span><div class="card-value card-value-tight">${cs.recordVideo ? `On (${cs.videoQuality})` : "Off"}</div></div>
      <div class="card-val"><span class="lbl">Browser layout</span><div class="card-value card-value-tight">${escapeHtml(layoutLabel)}</div></div>
      ${automationBlock}
    </div>
  </section>`;
}

/** Mirrors the in-app “Files loaded” section: hero cards, pills, categories, then full table. */
function buildFilesLoadedSectionHtml(report: PerfReport): string {
  const da = report.downloadedAssets;
  if (!da || da.totalCount <= 0) return "";

  const assetLabels: Record<string, string> = {
    build: "Main document",
    script: "Scripts (.js)",
    stylesheet: "Stylesheets (.css)",
    document: "Other documents",
    json: "API / fetch calls",
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

  const dupList = da.duplicates ?? [];
  const dupStats = da.duplicateStats;
  const duplicatesSectionHtml =
    dupList.length > 0
      ? `
  <h3>Duplicate image fetches</h3>
  <p class="muted">Same image URL requested more than once in the captured network log (API / XHR repeats are excluded). Counts use CDP network data only (not double-counted with Resource Timing).</p>
  <p><strong>${dupStats?.uniqueUrls ?? dupList.length}</strong> URL${
    (dupStats?.uniqueUrls ?? dupList.length) === 1 ? "" : "s"
  } with repeated fetches · <strong>${
    dupStats?.extraFetches ??
    dupList.reduce((s, d) => s + Math.max(0, d.count - 1), 0)
  }</strong> extra round-trip${
    (dupStats?.extraFetches ??
      dupList.reduce((s, d) => s + Math.max(0, d.count - 1), 0)) === 1
      ? ""
      : "s"
  } vs loading each once</p>
  <div class="table-scroll scrollbar">
  <table>
    <thead><tr><th>URL</th><th>Fetches</th><th>Total transferred</th></tr></thead>
    <tbody>
      ${dupList
        .map(
          (d) =>
            `<tr><td class="url-cell">${escapeHtml(d.url)}</td><td>${d.count}</td><td>${formatBytes(d.totalBytes)}</td></tr>`
        )
        .join("")}
    </tbody>
  </table>
  </div>`
      : "";

  const heroHtml =
    da.curtainLiftMs != null
      ? `<div class="files-hero-grid">
    <div class="files-hero files-hero-preload">
      <p class="files-hero-kicker">Preload size (until curtain lift)</p>
      <p class="files-hero-value">${formatBytes(
        da.lifecycleTotals?.preload.totalBytes ?? 0
      )}</p>
      <p class="files-hero-desc">${da.lifecycleTotals?.preload.totalCount ?? 0} files transferred before the curtain clears — primary load cost.</p>
    </div>
    <div class="files-hero files-hero-curtain">
      <p class="files-hero-kicker">Curtain lift time</p>
      <p class="files-hero-value">${formatNum(da.curtainLiftMs / 1000)}<span class="files-hero-unit">s</span></p>
      <p class="files-hero-desc">When the loading curtain finishes — use with preload bytes to judge spinner vs payload.</p>
    </div>
  </div>`
      : "";

  const pills: string[] = [];
  if (da.initialLoadBytes != null) {
    pills.push(
      `<span class="files-pill files-pill-muted">Initial screen (~FCP path): <strong>${formatBytes(
        da.initialLoadBytes
      )}</strong></span>`
    );
  }
  if (da.curtainLiftMs != null) {
    pills.push(
      `<span class="files-pill files-pill-sky">Post-load: <strong>${formatBytes(
        da.lifecycleTotals?.postload.totalBytes ?? 0
      )}</strong> <span class="muted-inline">(${
        da.lifecycleTotals?.postload.totalCount ?? 0
      } files)</span></span>`
    );
  }
  pills.push(
    `<span class="files-pill files-pill-accent">Full session: <strong>${formatBytes(
      da.sessionTotalBytes ?? da.totalBytes
    )}</strong> <span class="muted-inline">(${da.totalCount} files)</span></span>`
  );
  if (dupList.length > 0) {
    pills.push(
      `<span class="files-pill files-pill-warn">Repeat fetches: ${
        dupStats?.uniqueUrls ?? dupList.length
      } URL${(dupStats?.uniqueUrls ?? dupList.length) === 1 ? "" : "s"}${
        dupStats != null ? ` · +${dupStats.extraFetches} extra` : ""
      }</span>`
    );
  }
  if (da.lifecycleTotalsByScope != null && da.curtainLiftMs != null) {
    pills.push(
      `<span class="files-pill files-pill-violet">Game preload: <strong>${formatBytes(
        da.lifecycleTotalsByScope.game.preload.totalBytes
      )}</strong></span>`
    );
    pills.push(
      `<span class="files-pill files-pill-slate">Common preload: <strong>${formatBytes(
        da.lifecycleTotalsByScope.common.preload.totalBytes
      )}</strong></span>`
    );
  }

  const categoryGrid = assetCategories
    .map((cat) => {
      const data = da.byCategory[cat];
      if (!data || data.count === 0) return "";
      return `<div class="card"><span class="card-label">${escapeHtml(assetLabels[cat] ?? cat)}</span><div class="card-value">${data.count} files · ${formatBytes(data.totalBytes)}</div></div>`;
    })
    .filter(Boolean)
    .join("");

  const fileRows = assetCategories
    .flatMap((cat) => {
      const data = da.byCategory[cat];
      if (!data || data.files.length === 0) return [];
      return data.files.map(
        (f) =>
          `<tr><td>${escapeHtml(assetLabels[cat] ?? cat)}</td><td class="url-cell">${escapeHtml(f.url)}</td><td>${f.transferSize != null ? formatBytes(f.transferSize) : "—"}</td></tr>`
      );
    })
    .join("");

  return `<section class="files-loaded-panel" aria-label="Files loaded during session">
  <h2 class="h-files">Files loaded during this session</h2>
  <p class="muted files-lead">Preload, categories, and full transfer footprint — matches the in-app report order (files before CDP charts &amp; trace metrics).</p>
  <p class="files-badge-wrap"><span class="files-count-badge">${da.totalCount} files</span></p>
  ${heroHtml}
  <div class="files-pills">${pills.join("")}</div>
  <div class="grid">${categoryGrid}</div>
  ${duplicatesSectionHtml}
  <h3 class="muted" style="font-size:0.9rem;margin-top:1.25rem">All captured files</h3>
  <div class="table-scroll scrollbar">
  <table>
    <thead><tr><th>Category</th><th>URL</th><th>Size</th></tr></thead>
    <tbody>${fileRows || "<tr><td colspan='3'>No files.</td></tr>"}</tbody>
  </table>
  </div>
</section>`;
}

export function buildReportHtml(report: PerfReport): string {
  const sessionWallDurationSec = report.durationMs / 1000;
  const chartDurationSec =
    report.alignedDurationMs != null && report.alignedDurationMs > 0
      ? report.alignedDurationMs / 1000
      : sessionWallDurationSec;
  const fpsAvg = report.summaryStats?.avgFps ?? avg(report.fpsSeries.points);
  const cpuAvg = report.summaryStats?.avgCpu ?? avg(report.cpuSeries.points);
  const memMax =
    report.summaryStats?.peakMemMb ??
    (report.memorySeries.points.length > 0
      ? Math.max(...report.memorySeries.points.map((p) => p.value))
      : 0);
  const domMax =
    report.summaryStats?.peakDomNodes ??
    (report.domNodesSeries.points.length > 0
      ? Math.max(...report.domNodesSeries.points.map((p) => p.value))
      : 0);

  const tbtTimeline = report.longTasks.tbtTimeline ?? [];

  const animRows = (report.animationMetrics?.animations ?? [])
    .map((a) => {
      const label = escapeHtml(animationDisplayLabel(a.name, a.properties));
      const b = effectiveBottleneck(a);
      const hint = b ?? "—";
      const props = escapeHtml(
        formatAnimationPropertiesForDisplay(a.properties, a.name)
      );
      return `<tr>
          <td>${label}</td>
          <td>${escapeHtml(a.type)}</td>
          <td>${props}</td>
          <td><span class="bottleneck-${hint === "—" ? "none" : hint}">${escapeHtml(String(hint))}</span></td>
          <td>${a.durationMs != null ? formatNum(a.durationMs) + " ms" : "—"}</td>
        </tr>`;
    })
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

  const filesLoadedSection = buildFilesLoadedSectionHtml(report);

  const blockingInner =
    report.blockingSummary &&
    (report.blockingSummary.longTaskCount > 0 || report.webVitals.tbtMs > 0)
      ? `<p>Long tasks: ${report.blockingSummary.longTaskCount} · Sum of durations: ${formatNum(
          report.blockingSummary.totalBlockedMs
        )} ms · TBT: <span class="${spanClass(tbtHealth(report.webVitals.tbtMs))}">${formatNum(
          report.blockingSummary.mainThreadBlockedMs
        )} ms</span> · Longest: ${formatNum(
          report.blockingSummary.maxBlockingMs
        )} ms</p>`
      : "";

  const blockingSection = blockingInner
    ? collapsibleSection("Main thread blocking", blockingInner)
    : "";

  const tbtChartInner =
    tbtTimeline.length > 0
      ? `<h3>TBT timeline (blocking ms per long task)</h3>${buildTbtSvgString(
          tbtTimeline,
          chartDurationSec
        )}`
      : `<p class="muted">No TBT timeline entries (no &gt;50ms tasks or trace unavailable).</p>`;

  const tbtSection = collapsibleSection(
    "Total blocking time (TBT)",
    tbtChartInner
  );

  const frameTimingInner = report.frameTiming
    ? `<p>From trace DrawFrame spacing — useful when FPS looks similar but motion feels uneven.</p>
  <div class="grid">
    <div class="card"><span class="card-label">Stagger risk</span><div class="card-value ${spanClass(staggerHealth(report.frameTiming.staggerRisk))}">${report.frameTiming.staggerRisk}</div></div>
    <div class="card"><span class="card-label">Avg frame Δ</span><div class="card-value">${formatNum(report.frameTiming.avgFrameMs)} ms</div></div>
    <div class="card"><span class="card-label">σ frame Δ</span><div class="card-value">${formatNum(report.frameTiming.stdDevDeltaMs)} ms</div></div>
    <div class="card"><span class="card-label">Max frame Δ</span><div class="card-value">${formatNum(report.frameTiming.maxDeltaMs)} ms</div></div>
  </div>`
    : "";

  const frameTimingSection = frameTimingInner
    ? collapsibleSection("Frame pacing (jank signal)", frameTimingInner)
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

  const layoutPaintInner = `<p class="muted">Totals sum Chrome trace event durations for the whole capture (same idea as DevTools Performance Layout vs Paint). Not “one frame” — session-wide.</p>
  <p>Layouts: ${report.layoutMetrics.layoutCount} | Paints: ${
    report.layoutMetrics.paintCount
  } | Layout time: <span class="${spanClass(paintMsHealth(report.layoutMetrics.layoutTimeMs))}">${formatNum(
    report.layoutMetrics.layoutTimeMs
  )} ms</span> | Paint time: <span class="${spanClass(paintMsHealth(report.layoutMetrics.paintTimeMs))}">${formatNum(
    report.layoutMetrics.paintTimeMs
  )} ms</span></p>`;

  const layoutPaintSection = collapsibleSection(
    "Layout & paint",
    layoutPaintInner
  );

  const renderBreakdownInner = `<p>Script: ${formatNum(
    report.renderBreakdown.scriptMs
  )} ms | Layout: ${formatNum(
    report.renderBreakdown.layoutMs
  )} ms | Raster: ${formatNum(
    report.renderBreakdown.rasterMs
  )} ms | Composite: ${formatNum(report.renderBreakdown.compositeMs)} ms</p>`;

  const renderBreakdownSection = collapsibleSection(
    "Render breakdown",
    renderBreakdownInner
  );

  const networkOverviewInner = `<p>Requests: ${report.networkSummary.requests} | Total: ${formatBytes(
    report.networkSummary.totalBytes
  )} | Avg latency: <span class="${spanClass(latencyHealth(report.networkSummary.averageLatencyMs))}">${formatNum(
    report.networkSummary.averageLatencyMs
  )} ms</span></p>`;

  const networkRequestsInner = `<div class="table-scroll scrollbar">
  <table>
    <thead><tr><th>URL</th><th>Method</th><th>Status</th><th>Type</th><th>Size</th><th>Duration</th></tr></thead>
    <tbody>${
      networkRows || "<tr><td colspan='6'>No requests.</td></tr>"
    }</tbody>
  </table>
  </div>`;

  const networkSection = collapsibleSection(
    "Network summary & request log (sample)",
    `${networkOverviewInner}<h3 class="muted" style="font-size:0.85rem;margin-top:1rem">Requests (up to 100)</h3>${networkRequestsInner}`
  );

  const animationsInner = `${
    report.animationMetrics?.bottleneckCounts
      ? `<p>By bottleneck: compositor ${report.animationMetrics.bottleneckCounts.compositor}, paint ${report.animationMetrics.bottleneckCounts.paint}, layout ${report.animationMetrics.bottleneckCounts.layout}${
          report.animationMetrics.bottleneckCounts.unclassified > 0
            ? `, other ${report.animationMetrics.bottleneckCounts.unclassified}`
            : ""
        }.</p>`
      : ""
  }
  <p class="muted" style="margin-bottom:1rem"><strong>Legend:</strong> <span class="bottleneck-compositor">Compositor</span> — GPU layer (typically <code>transform</code>, <code>opacity</code>). <span class="bottleneck-paint">Paint</span> — raster (colors, shadows, <code>border-*-radius</code>, filters). <span class="bottleneck-layout">Layout</span> — reflow (<code>width</code>, <code>height</code>, margins, flex/grid, font size…). Metadata keys like <code>computedOffset</code> are omitted from the property list.</p>
  <div class="table-scroll scrollbar">
  <table>
    <thead><tr><th>Name</th><th>Type</th><th>Properties</th><th>Bottleneck</th><th>Duration</th></tr></thead>
    <tbody>${
      animRows || "<tr><td colspan='5'>No animations captured.</td></tr>"
    }</tbody>
  </table>
  </div>`;

  const animationsSection = collapsibleSection(
    "Animations & properties",
    animationsInner
  );

  const longTasksInner = `<div class="table-scroll scrollbar">
  <table>
    <thead><tr><th>Task</th><th>Duration</th><th>Start (s)</th><th>Attribution</th></tr></thead>
    <tbody>${
      longTaskRows || "<tr><td colspan='4'>No long tasks.</td></tr>"
    }</tbody>
  </table>
  </div>`;

  const longTasksSection = collapsibleSection("Long tasks (top)", longTasksInner);

  const suggestionsInner = `<table>
    <thead><tr><th>Severity</th><th>Title</th><th>Detail</th></tr></thead>
    <tbody>${
      suggestionRows ||
      "<tr><td colspan='3'>No major bottlenecks detected.</td></tr>"
    }</tbody>
  </table>`;

  const suggestionsSection = collapsibleSection("Suggestions", suggestionsInner);

  const spikeSection = collapsibleSection(
    "FPS spike frames",
    `<div class="spike-frames">${spikeFramesHtml}</div>`
  );

  const captureSettingsPanel =
    report.captureSettings != null
      ? buildCaptureSettingsPanel(report.captureSettings)
      : "";

  const gpuAvg = report.summaryStats?.avgGpu;
  const gpuSummaryCard =
    gpuAvg != null
      ? `<div class="card-val"><span class="lbl">Avg GPU</span><div class="card-value ${spanClass(gpuHealth(gpuAvg))}">${formatNum(gpuAvg)}%</div></div>`
      : "";

  const ft = report.frameTiming;
  const framePacingCard =
    ft != null
      ? `<div class="card-val"><span class="lbl">Frame pacing risk</span><div class="card-value ${spanClass(staggerHealth(ft.staggerRisk))}">${escapeHtml(ft.staggerRisk)}</div></div>`
      : "";

  const blockingSummaryCard =
    report.blockingSummary != null
      ? `<div class="card-val"><span class="lbl">Main-thread blocked</span><div class="card-value ${spanClass(tbtHealth(report.blockingSummary.mainThreadBlockedMs))}">${formatNum(report.blockingSummary.mainThreadBlockedMs)} ms</div></div>`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>PerfTrace Report — ${escapeHtml(
    new Date(report.startedAt).toLocaleString()
  )}</title>
  <style>
    :root {
      --bg: #08080b;
      --fg: #fafafa;
      --muted: #a1a1aa;
      --accent: #8b5cf6;
      --border: rgba(255,255,255,0.08);
      --good: #34d399;
      --warn: #fbbf24;
      --bad: #fb7185;
    }
    * { box-sizing: border-box; }
    html { scrollbar-width: thin; scrollbar-color: rgba(139,92,246,0.45) rgba(255,255,255,0.06); }
    *::-webkit-scrollbar { width: 9px; height: 9px; }
    *::-webkit-scrollbar-track { background: rgba(255,255,255,0.04); border-radius: 6px; }
    *::-webkit-scrollbar-thumb {
      background: linear-gradient(180deg, rgba(139,92,246,0.55), rgba(124,58,237,0.45));
      border-radius: 6px;
    }
    body { font-family: system-ui, -apple-system, sans-serif; background: var(--bg); color: var(--fg); margin: 0; padding: 2rem; line-height: 1.6; max-width: 1100px; }
    h1 { font-size: 1.75rem; margin: 0 0 0.5rem; background: linear-gradient(135deg,#6d28d9,#a78bfa); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    h2 { font-size: 1.25rem; margin: 1.5rem 0 0.75rem; color: var(--fg); border-bottom: 1px solid var(--border); padding-bottom: 0.5rem; }
    h3 { font-size: 1rem; margin: 1rem 0 0.5rem; color: var(--muted); }
    p { margin: 0.5rem 0; color: var(--muted); }
    .muted { color: var(--muted); font-size: 0.875rem; }
    .table-scroll { overflow-x: auto; max-width: 100%; margin: 0.75rem 0; }
    table { width: 100%; border-collapse: collapse; font-size: 0.875rem; min-width: 520px; }
    th, td { padding: 0.5rem 0.75rem; text-align: left; border-bottom: 1px solid var(--border); }
    th { color: var(--muted); font-weight: 600; text-transform: uppercase; font-size: 0.7rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 1rem; margin: 1rem 0; }
    .card { background: #111114; border: 1px solid var(--border); border-radius: 0.75rem; padding: 1rem; }
    .card-label { font-size: 0.7rem; text-transform: uppercase; color: var(--muted); }
    .card-value { font-size: 1.35rem; font-weight: 600; color: var(--accent); }
    .card-val .lbl { display: block; font-size: 0.7rem; text-transform: uppercase; color: var(--muted); margin-bottom: 0.35rem; }
    .metric-good { color: var(--good) !important; }
    .metric-warn { color: var(--warn) !important; }
    .metric-bad { color: var(--bad) !important; }
    .metric-good.card-val { border-color: rgba(52,211,153,0.25); }
    .card-val { border: 1px solid var(--border); border-radius: 0.75rem; padding: 0.75rem 1rem; background: rgba(255,255,255,0.02); }
    .badge { padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.7rem; }
    .badge-warning { background: rgba(245,158,11,0.2); color: #f59e0b; }
    .badge-info { background: rgba(59,130,246,0.2); color: #3b82f6; }
    .badge-critical { background: rgba(239,68,68,0.2); color: #ef4444; }
    .bottleneck-compositor { color: #34d399; font-weight: 600; }
    .bottleneck-paint { color: #fbbf24; font-weight: 600; }
    .bottleneck-layout { color: #f87171; font-weight: 600; }
    .bottleneck-none { color: #94a3b8; }
    .spike-frames { display: flex; flex-wrap: wrap; gap: 1rem; margin: 1rem 0; }
    .spike-frame { flex: 1 1 180px; background: #111114; border-radius: 0.5rem; overflow: hidden; border: 1px solid var(--border); }
    .spike-frame img { width: 100%; height: auto; display: block; }
    .spike-frame p { padding: 0.5rem; margin: 0; font-size: 0.75rem; }
    .url-cell { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tbt-figure { margin: 0.5rem 0 1rem; }
    details.report-details {
      margin: 0.75rem 0;
      border: 1px solid var(--border);
      border-radius: 0.75rem;
      background: rgba(255,255,255,0.02);
      overflow: hidden;
    }
    details.report-details > summary.report-details-summary {
      cursor: pointer;
      list-style: none;
      padding: 0.75rem 1.1rem;
      margin: 0;
      font-size: 1rem;
      font-weight: 600;
      color: var(--fg);
      background: rgba(255,255,255,0.04);
      border-bottom: 1px solid transparent;
      border-radius: 0.65rem 0.65rem 0 0;
      transition: background 0.15s ease;
    }
    details.report-details > summary::-webkit-details-marker { display: none; }
    details.report-details[open] > summary.report-details-summary {
      border-bottom-color: var(--border);
    }
    details.report-details > summary.report-details-summary:hover {
      background: rgba(139,92,246,0.12);
    }
    details.report-details > summary.report-details-summary:focus {
      outline: none;
    }
    details.report-details > summary.report-details-summary:focus-visible {
      outline: 2px solid rgba(139,92,246,0.45);
      outline-offset: 2px;
    }
    .report-details-body { padding: 0.75rem 1rem 1rem; }
    .capture-panel {
      margin: 0 0 2rem;
      padding: 1.25rem 1.5rem;
      background: linear-gradient(165deg, rgba(109,40,217,0.14), rgba(8,8,11,0.5));
      border: 1px solid var(--border);
      border-radius: 0.75rem;
    }
    .h-capture { font-size: 1.25rem; margin: 0 0 0.35rem; border: none; padding: 0; color: var(--fg); }
    .capture-lead { margin: 0 0 1rem; max-width: 48rem; line-height: 1.55; }
    .grid-capture { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 0.75rem; }
    .card-span-2 { grid-column: span 2; }
    @media (max-width: 640px) { .card-span-2 { grid-column: span 1; } }
    .card-value-tight { font-size: 1.05rem; font-weight: 600; color: var(--accent); line-height: 1.35; }
    .capture-detail { margin: 0.35rem 0 0; font-size: 0.8rem; line-height: 1.45; }
    .session-pill { font-size: 0.8rem; margin: 0.6rem 0 0; color: var(--muted); }
    .session-pill code { font-size: 0.85em; padding: 0.15rem 0.5rem; background: rgba(139,92,246,0.12); border: 1px solid rgba(139,92,246,0.25); border-radius: 6px; color: #c4b5fd; }
    .files-loaded-panel {
      margin: 0 0 2.25rem;
      padding: 1.35rem 1.5rem 1.5rem;
      background: linear-gradient(165deg, rgba(109,40,217,0.1), rgba(8,8,11,0.4));
      border: 1px solid var(--border);
      border-radius: 0.85rem;
    }
    .h-files {
      font-size: 1.35rem;
      margin: 0 0 0.35rem;
      border: none;
      padding: 0;
      color: var(--fg);
      background: linear-gradient(135deg,#c4b5fd,#a78bfa);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .files-lead { margin: 0 0 0.75rem; max-width: 42rem; line-height: 1.55; }
    .files-badge-wrap { margin: 0 0 1rem; }
    .files-count-badge {
      display: inline-block;
      padding: 0.2rem 0.65rem;
      border-radius: 999px;
      font-size: 0.7rem;
      font-weight: 600;
      background: rgba(139,92,246,0.18);
      color: #c4b5fd;
      border: 1px solid rgba(139,92,246,0.35);
    }
    .files-hero-grid {
      display: grid;
      gap: 1rem;
      margin: 0 0 1.25rem;
    }
    @media (min-width: 900px) {
      .files-hero-grid { grid-template-columns: 1fr 1fr; }
    }
    .files-hero {
      border-radius: 1rem;
      padding: 1.35rem 1.25rem;
      position: relative;
      overflow: hidden;
    }
    .files-hero-preload {
      border: 1px solid rgba(167,139,250,0.55);
      background: linear-gradient(145deg, rgba(124,58,237,0.42), rgba(76,29,149,0.35), rgba(15,10,35,0.65));
      box-shadow: 0 18px 50px rgba(45,15,90,0.45);
    }
    .files-hero-curtain {
      border: 1px solid rgba(139,92,246,0.45);
      background: linear-gradient(180deg, rgba(139,92,246,0.22), rgba(139,92,246,0.06));
      box-shadow: 0 12px 40px rgba(79,70,229,0.12);
    }
    .files-hero-kicker {
      margin: 0;
      font-size: 0.62rem;
      font-weight: 700;
      letter-spacing: 0.22em;
      text-transform: uppercase;
      color: rgba(237,233,254,0.95);
    }
    .files-hero-curtain .files-hero-kicker { color: #a78bfa; }
    .files-hero-value {
      margin: 0.65rem 0 0;
      font-family: ui-monospace, monospace;
      font-size: clamp(2rem, 5vw, 2.75rem);
      font-weight: 700;
      line-height: 1.05;
      color: #fafafa;
      word-break: break-all;
    }
    .files-hero-curtain .files-hero-value { color: var(--fg); }
    .files-hero-unit {
      margin-left: 0.35rem;
      font-size: 1.35rem;
      font-weight: 600;
      vertical-align: super;
      color: var(--muted);
    }
    .files-hero-desc {
      margin: 0.75rem 0 0;
      font-size: 0.85rem;
      line-height: 1.5;
      color: rgba(237,233,254,0.92);
    }
    .files-hero-curtain .files-hero-desc { color: var(--muted); }
    .files-pills {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin: 0 0 1.25rem;
    }
    .files-pill {
      display: inline-block;
      padding: 0.45rem 0.75rem;
      border-radius: 999px;
      font-size: 0.78rem;
      line-height: 1.35;
    }
    .files-pill-muted {
      border: 1px solid var(--border);
      background: rgba(0,0,0,0.2);
      color: var(--muted);
    }
    .files-pill-sky {
      border: 1px solid rgba(56,189,248,0.4);
      background: rgba(14,165,233,0.12);
      color: #bae6fd;
      font-weight: 500;
    }
    .files-pill-accent {
      border: 1px solid rgba(139,92,246,0.45);
      background: rgba(139,92,246,0.12);
      color: #c4b5fd;
      font-weight: 500;
    }
    .files-pill-warn {
      border: 1px solid rgba(251,113,133,0.35);
      background: rgba(244,63,94,0.1);
      color: #fecdd3;
    }
    .files-pill-violet {
      border: 1px solid rgba(167,139,250,0.45);
      background: rgba(109,40,217,0.15);
      color: #e9d5ff;
      font-weight: 500;
    }
    .files-pill-slate {
      border: 1px solid rgba(148,163,184,0.35);
      background: rgba(71,85,105,0.15);
      color: #e2e8f0;
    }
    .muted-inline { color: var(--muted); font-weight: 400; }
  </style>
</head>
<body>
  <header>
    <h1>PerfTrace — Performance Report</h1>
    <p>${escapeHtml(new Date(report.startedAt).toLocaleString())} → ${escapeHtml(
      new Date(report.stoppedAt).toLocaleString()
    )} (${formatNum(sessionWallDurationSec)}s wall)</p>
    ${
      report.recordedUrl
        ? `<p><strong>URL:</strong> <a href="${escapeHtml(
            report.recordedUrl
          )}" style="color:var(--accent)">${escapeHtml(report.recordedUrl)}</a></p>`
        : ""
    }
    ${
      report.captureSessionId
        ? `<p class="session-pill">Session <code>${escapeHtml(report.captureSessionId)}</code></p>`
        : ""
    }
  </header>

  ${captureSettingsPanel}

  ${filesLoadedSection}

  <h2>Summary</h2>
  <div class="grid">
    <div class="card-val"><span class="lbl">Avg FPS</span><div class="card-value ${spanClass(fpsHealth(fpsAvg))}">${formatNum(fpsAvg)}</div></div>
    <div class="card-val"><span class="lbl">Avg CPU</span><div class="card-value ${spanClass(cpuHealth(cpuAvg))}">${formatNum(cpuAvg)}%</div></div>
    ${gpuSummaryCard}
    <div class="card-val"><span class="lbl">Peak heap</span><div class="card-value ${spanClass(heapHealth(memMax))}">${formatNum(memMax)} MB</div></div>
    <div class="card-val"><span class="lbl">Peak DOM</span><div class="card-value ${spanClass(domHealth(domMax))}">${formatNum(domMax)}</div></div>
    <div class="card-val"><span class="lbl">TBT</span><div class="card-value ${spanClass(tbtHealth(report.webVitals.tbtMs))}">${formatNum(report.webVitals.tbtMs)} ms</div></div>
    ${blockingSummaryCard}
    <div class="card-val"><span class="lbl">Long tasks</span><div class="card-value">${report.webVitals.longTaskCount}</div></div>
    <div class="card-val"><span class="lbl">FCP</span><div class="card-value ${report.webVitals.fcpMs != null ? spanClass(fcpHealth(report.webVitals.fcpMs)!) : ""}">${report.webVitals.fcpMs != null ? formatNum(report.webVitals.fcpMs) + " ms" : "—"}</div></div>
    <div class="card-val"><span class="lbl">LCP</span><div class="card-value ${report.webVitals.lcpMs != null ? spanClass(lcpHealth(report.webVitals.lcpMs)!) : ""}">${report.webVitals.lcpMs != null ? formatNum(report.webVitals.lcpMs) + " ms" : "—"}</div></div>
    <div class="card-val"><span class="lbl">CLS</span><div class="card-value ${report.webVitals.cls != null ? spanClass(clsHealth(report.webVitals.cls)) : ""}">${report.webVitals.cls != null ? formatNum(report.webVitals.cls) : "—"}</div></div>
    <div class="card-val"><span class="lbl">Avg latency</span><div class="card-value ${spanClass(latencyHealth(report.networkSummary.averageLatencyMs))}">${formatNum(report.networkSummary.averageLatencyMs)} ms</div></div>
    ${framePacingCard}
  </div>

  ${frameTimingSection}
  ${layoutPaintSection}
  ${renderBreakdownSection}
  ${blockingSection}
  ${tbtSection}
  ${networkSection}
  ${animationsSection}
  ${longTasksSection}
  ${suggestionsSection}
  ${spikeSection}

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
