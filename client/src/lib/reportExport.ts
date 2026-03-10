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
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export function buildReportHtml(report: PerfReport): string {
  const suggestionRows = report.suggestions
    .map(
      (s) =>
        `<tr><td><span class="badge badge-${s.severity}">${
          s.severity
        }</span></td><td><strong>${escapeHtml(
          s.title
        )}</strong></td><td>${escapeHtml(s.detail)}</td></tr>`
    )
    .join("");

  const longTaskRows = report.longTasks.topTasks
    .map(
      (t) =>
        `<tr><td>${escapeHtml(t.name)}</td><td>${formatNum(
          t.durationMs
        )} ms</td><td>${formatNum(t.startSec)} s</td></tr>`
    )
    .join("");

  const networkRows = report.networkRequests
    .slice(0, 50)
    .map(
      (r) =>
        `<tr><td class="url-cell">${escapeHtml(r.url)}</td><td>${
          r.method
        }</td><td>${r.status ?? "—"}</td><td>${
          r.transferSize != null ? formatBytes(r.transferSize) : "—"
        }</td><td>${
          r.durationMs != null ? formatNum(r.durationMs) + " ms" : "—"
        }</td></tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><title>PerfTrace Report</title>
<style>
body{font-family:system-ui,sans-serif;background:#0c0c0f;color:#f4f4f5;padding:2rem;max-width:900px;margin:0 auto}
h1{color:#8b5cf6}.badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px}
.badge-warning{background:#f59e0b33;color:#f59e0b}.badge-info{background:#3b82f633;color:#3b82f6}.badge-critical{background:#ef444433;color:#ef4444}
table{width:100%;border-collapse:collapse;margin:1rem 0}.url-cell{max-width:300px;overflow:hidden;text-overflow:ellipsis}
th,td{border:1px solid rgba(255,255,255,0.1);padding:8px;text-align:left}
th{background:rgba(139,92,246,0.15)}
</style>
</head>
<body>
<h1>PerfTrace Report</h1>
<p>${new Date(report.startedAt).toLocaleString()} → ${new Date(
    report.stoppedAt
  ).toLocaleString()} (${(report.durationMs / 1000).toFixed(1)}s)</p>
<h2>Summary</h2>
<p>FPS avg: ${
    report.fpsSeries.points.length
      ? (
          report.fpsSeries.points.reduce((s, p) => s + p.value, 0) /
          report.fpsSeries.points.length
        ).toFixed(1)
      : "—"
  }</p>
<p>CPU avg: ${
    report.cpuSeries.points.length
      ? (
          report.cpuSeries.points.reduce((s, p) => s + p.value, 0) /
          report.cpuSeries.points.length
        ).toFixed(1) + " ms"
      : "—"
  }</p>
<p>Network: ${report.networkSummary.requests} requests, ${formatBytes(
    report.networkSummary.totalBytes
  )}, avg latency ${formatNum(report.networkSummary.averageLatencyMs)} ms</p>
<h2>Suggestions</h2>
<table>${suggestionRows || "<tr><td>None</td></tr>"}</table>
<h2>Long tasks</h2>
<table><tr><th>Name</th><th>Duration</th><th>Start</th></tr>${
    longTaskRows || "<tr><td>None</td></tr>"
  }</table>
<h2>Network requests</h2>
<table><tr><th>URL</th><th>Method</th><th>Status</th><th>Size</th><th>Duration</th></tr>${
    networkRows || "<tr><td>None</td></tr>"
  }</table>
</body>
</html>`;
}

export function downloadReportHtml(report: PerfReport) {
  const html = buildReportHtml(report);
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `perftrace-report-${new Date()
    .toISOString()
    .slice(0, 19)
    .replace(/[:-]/g, "")}.html`;
  a.click();
  URL.revokeObjectURL(url);
}
