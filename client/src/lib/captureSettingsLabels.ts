import type { CaptureSettings } from "./reportTypes";

const NET_LABELS: Record<string, string> = {
  none: "No network throttling",
  "slow-3g": "Slow 3G (high RTT, ~400 Kbps)",
  "fast-3g": "Fast 3G",
  "4g": "4G (moderate mobile)",
};

export function networkThrottleLabel(key: string): string {
  return NET_LABELS[key] ?? key;
}

export function cpuThrottleLabel(rate: number): string {
  if (rate <= 1) return "1× (no CPU throttling)";
  if (rate === 4) return "4× slower (low-end mobile–like)";
  if (rate === 6) return "6× slower (heavier throttle)";
  if (rate === 20) return "20× slower (stress)";
  return `${rate}× CPU slowdown`;
}

export function formatThroughputBps(bps: number | null | undefined): string {
  if (bps == null || bps < 0) return "unlimited";
  if (bps >= 1024 * 1024)
    return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
  if (bps >= 1024) return `${(bps / 1024).toFixed(0)} KB/s`;
  return `${bps} B/s`;
}

/** Single readable line for exports / tooltips */
export function summarizeCaptureSettings(cs: CaptureSettings): string {
  const parts = [
    cpuThrottleLabel(cs.cpuThrottle),
    `${networkThrottleLabel(cs.networkThrottle)} · RTT ${cs.networkProfile.latencyMs} ms · ↓ ${formatThroughputBps(cs.networkProfile.downloadBps)} · ↑ ${formatThroughputBps(cs.networkProfile.uploadBps)}`,
    `Trace ${cs.traceDetail}`,
    cs.recordVideo ? `Video ${cs.videoQuality}` : "Video off",
    cs.browserLayout.mode === "portrait"
      ? `Portrait ${cs.browserLayout.width}×${cs.browserLayout.height}`
      : "Landscape / maximized",
  ];
  if (cs.automation?.enabled && cs.automation.gameId) {
    parts.push(
      `Automation: ${cs.automation.gameId}${cs.automation.rounds != null ? ` (${cs.automation.rounds} rounds)` : ""}${cs.automation.skipLobby ? ", skip lobby" : ""}`
    );
  }
  return parts.join(" · ");
}
