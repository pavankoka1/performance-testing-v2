import type { MetricPoint, PerfReport } from "./reportTypes";

export type FrameAtTime = {
  timeSec: number;
  imageDataUrl: string;
  fps?: number;
};

export function getClosestFrameAtTime(
  report: PerfReport,
  timeSec: number
): FrameAtTime | null {
  const sessionFrames = report.sessionFrames ?? [];
  const spikeFrames = report.spikeFrames ?? [];
  const frames: FrameAtTime[] = sessionFrames.length
    ? sessionFrames.map((f) => ({
        timeSec: f.timeSec,
        imageDataUrl: f.imageDataUrl,
      }))
    : spikeFrames.map((f) => ({
        timeSec: f.timeSec,
        imageDataUrl: f.imageDataUrl,
        fps: f.fps,
      }));
  if (!frames.length) return null;
  const sorted = [...frames].sort(
    (a, b) => Math.abs(a.timeSec - timeSec) - Math.abs(b.timeSec - timeSec)
  );
  return sorted[0];
}

export function getVitalsAtTime(
  report: PerfReport,
  timeSec: number
): {
  fps: number | null;
  cpuBusyMs: number | null;
  cpuPercent: number | null;
  gpuBusyMs: number | null;
  jsHeapMb: number | null;
  domNodes: number | null;
} {
  const pick = (points: MetricPoint[]): number | null => {
    if (!points.length) return null;
    const sorted = [...points].sort((a, b) => a.timeSec - b.timeSec);
    let best = sorted[0];
    let bestDiff = Math.abs(best.timeSec - timeSec);
    for (const p of sorted) {
      const d = Math.abs(p.timeSec - timeSec);
      if (d < bestDiff) {
        bestDiff = d;
        best = p;
      }
    }
    return best.value;
  };
  const cpuVal = pick(report.cpuSeries.points);
  return {
    fps: pick(report.fpsSeries.points),
    cpuBusyMs: cpuVal,
    cpuPercent: cpuVal,
    gpuBusyMs: pick(report.gpuSeries.points),
    jsHeapMb: pick(report.memorySeries.points),
    domNodes: pick(report.domNodesSeries.points),
  };
}
