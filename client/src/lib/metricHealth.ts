/** Traffic-light style health for summary metrics (QA thresholds — tune per product). */
import { METRIC_THRESHOLDS } from "./metricThresholds";

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
  if (avgFps >= METRIC_THRESHOLDS.fps.goodMin) return "good";
  if (avgFps >= METRIC_THRESHOLDS.fps.warnMin) return "warn";
  return "bad";
}

export function cpuHealth(avgCpu: number): MetricHealth {
  if (avgCpu < METRIC_THRESHOLDS.cpu.goodMax) return "good";
  if (avgCpu < METRIC_THRESHOLDS.cpu.warnMax) return "warn";
  return "bad";
}

export function gpuHealth(avgGpu: number): MetricHealth {
  if (avgGpu < METRIC_THRESHOLDS.gpu.goodMax) return "good";
  if (avgGpu < METRIC_THRESHOLDS.gpu.warnMax) return "warn";
  return "bad";
}

export function heapHealth(peakMb: number): MetricHealth {
  if (peakMb <= 0) return "good";
  if (peakMb < METRIC_THRESHOLDS.heapMb.goodMax) return "good";
  if (peakMb < METRIC_THRESHOLDS.heapMb.warnMax) return "warn";
  return "bad";
}

export function domHealth(peakNodes: number): MetricHealth {
  if (peakNodes <= 0) return "good";
  if (peakNodes < METRIC_THRESHOLDS.domNodes.goodMax) return "good";
  if (peakNodes < METRIC_THRESHOLDS.domNodes.warnMax) return "warn";
  return "bad";
}

export function tbtHealth(tbtMs: number): MetricHealth {
  if (tbtMs < METRIC_THRESHOLDS.tbtMs.goodMax) return "good";
  if (tbtMs < METRIC_THRESHOLDS.tbtMs.warnMax) return "warn";
  return "bad";
}

export function clsHealth(cls: number): MetricHealth {
  if (cls < METRIC_THRESHOLDS.cls.goodMax) return "good";
  if (cls < METRIC_THRESHOLDS.cls.warnMax) return "warn";
  return "bad";
}

export function paintMsHealth(ms: number): MetricHealth {
  if (ms < METRIC_THRESHOLDS.paintMs.goodMax) return "good";
  if (ms < METRIC_THRESHOLDS.paintMs.warnMax) return "warn";
  return "bad";
}

export function latencyHealth(ms: number): MetricHealth {
  if (ms <= 0) return "good";
  if (ms < METRIC_THRESHOLDS.latencyMs.goodMax) return "good";
  if (ms < METRIC_THRESHOLDS.latencyMs.warnMax) return "warn";
  return "bad";
}

export function fcpHealth(ms: number | undefined): MetricHealth | null {
  if (ms == null) return null;
  if (ms < METRIC_THRESHOLDS.fcpMs.goodMax) return "good";
  if (ms < METRIC_THRESHOLDS.fcpMs.warnMax) return "warn";
  return "bad";
}

export function lcpHealth(ms: number | undefined): MetricHealth | null {
  if (ms == null) return null;
  if (ms < METRIC_THRESHOLDS.lcpMs.goodMax) return "good";
  if (ms < METRIC_THRESHOLDS.lcpMs.warnMax) return "warn";
  return "bad";
}

export type StaggerRisk = "low" | "medium" | "high" | null;

export function staggerHealth(risk: StaggerRisk): MetricHealth {
  if (risk == null) return "good";
  if (risk === "low") return "good";
  if (risk === "medium") return "warn";
  return "bad";
}
