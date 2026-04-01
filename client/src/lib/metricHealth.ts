/** Traffic-light style health for summary metrics (QA thresholds — tune per product). */

export type MetricHealth = "good" | "warn" | "bad";

export function healthToTextClass(h: MetricHealth): string {
  if (h === "good") return "text-emerald-400";
  if (h === "warn") return "text-amber-400";
  return "text-rose-400";
}

export function healthToBorderClass(h: MetricHealth): string {
  if (h === "good") return "border-emerald-500/25";
  if (h === "warn") return "border-amber-500/35";
  return "border-rose-500/35";
}

export function healthToBgClass(h: MetricHealth): string {
  if (h === "good") return "bg-emerald-500/5";
  if (h === "warn") return "bg-amber-500/5";
  return "bg-rose-500/5";
}

/** CSS class names for standalone HTML export (no Tailwind). */
export function healthToHtmlClass(h: MetricHealth): string {
  return `metric-${h}`;
}

export function fpsHealth(avgFps: number): MetricHealth {
  if (avgFps <= 0) return "good";
  if (avgFps >= 55) return "good";
  if (avgFps >= 45) return "warn";
  return "bad";
}

export function cpuHealth(avgCpu: number): MetricHealth {
  if (avgCpu < 45) return "good";
  if (avgCpu < 72) return "warn";
  return "bad";
}

export function gpuHealth(avgGpu: number): MetricHealth {
  if (avgGpu < 55) return "good";
  if (avgGpu < 82) return "warn";
  return "bad";
}

export function heapHealth(peakMb: number): MetricHealth {
  if (peakMb <= 0) return "good";
  if (peakMb < 80) return "good";
  if (peakMb < 180) return "warn";
  return "bad";
}

export function domHealth(peakNodes: number): MetricHealth {
  if (peakNodes <= 0) return "good";
  if (peakNodes < 2500) return "good";
  if (peakNodes < 7000) return "warn";
  return "bad";
}

export function tbtHealth(tbtMs: number): MetricHealth {
  if (tbtMs < 200) return "good";
  if (tbtMs < 600) return "warn";
  return "bad";
}

export function clsHealth(cls: number): MetricHealth {
  if (cls < 0.1) return "good";
  if (cls < 0.25) return "warn";
  return "bad";
}

export function paintMsHealth(ms: number): MetricHealth {
  if (ms < 120) return "good";
  if (ms < 400) return "warn";
  return "bad";
}

export function latencyHealth(ms: number): MetricHealth {
  if (ms <= 0) return "good";
  if (ms < 250) return "good";
  if (ms < 900) return "warn";
  return "bad";
}

export function fcpHealth(ms: number | undefined): MetricHealth | null {
  if (ms == null) return null;
  if (ms < 1800) return "good";
  if (ms < 3000) return "warn";
  return "bad";
}

export function lcpHealth(ms: number | undefined): MetricHealth | null {
  if (ms == null) return null;
  if (ms < 2500) return "good";
  if (ms < 4000) return "warn";
  return "bad";
}

export type StaggerRisk = "low" | "medium" | "high" | null;

export function staggerHealth(risk: StaggerRisk): MetricHealth {
  if (risk == null) return "good";
  if (risk === "low") return "good";
  if (risk === "medium") return "warn";
  return "bad";
}
