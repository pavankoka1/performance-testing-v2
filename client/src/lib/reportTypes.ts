export const humanizeAnimationName = (name: string): string => {
  if (!name || name === "(unnamed)") return "(unnamed)";
  const n = name.toLowerCase();
  if (n.startsWith("cc-"))
    return `Compositor: ${name.slice(3).replace(/-/g, " ")}`;
  if (n.startsWith("blink-"))
    return `Style: ${name.slice(6).replace(/-/g, " ")}`;
  if (n.includes("skeleton")) return `Skeleton loader (${name})`;
  if (n.includes("shimmer")) return `Shimmer effect (${name})`;
  if (n.includes("fade")) return `Fade (${name})`;
  if (n.includes("pulse")) return `Pulse (${name})`;
  return name;
};

export type MetricPoint = { timeSec: number; value: number };

export type MetricSeries = {
  label: string;
  unit: string;
  points: MetricPoint[];
};

export type BottleneckSuggestion = {
  title: string;
  detail: string;
  severity: "info" | "warning" | "critical";
};

export type NetworkRequest = {
  url: string;
  method: string;
  status?: number;
  type?: string;
  transferSize?: number;
  durationMs?: number;
  startTimeMs?: number;
  endTimeMs?: number;
};

/** Asset category: build = main HTML doc, json = API responses (xhr/fetch), rest = static assets */
export type AssetCategory =
  | "build"
  | "script"
  | "stylesheet"
  | "document"
  | "json"
  | "image"
  | "font"
  | "other";

export type DownloadedAsset = {
  url: string;
  category: AssetCategory;
  transferSize?: number;
  durationMs?: number;
  endTimeMs?: number;
  /** Resource Timing `responseEnd` (ms since navigation); comparable to `curtainLiftMs` from `performance.now()` */
  lifecycleAtMs?: number;
};

export type DownloadedAssetsSummary = {
  byCategory: Record<
    AssetCategory,
    { count: number; totalBytes: number; files: DownloadedAsset[] }
  >;
  byScope?: {
    all: { byCategory: DownloadedAssetsSummary["byCategory"]; totalBytes: number; totalCount: number };
    game: { byCategory: DownloadedAssetsSummary["byCategory"]; totalBytes: number; totalCount: number };
    common: { byCategory: DownloadedAssetsSummary["byCategory"]; totalBytes: number; totalCount: number };
  };
  totalBytes: number;
  totalCount: number;
  /** Bytes for main doc + critical path resources before FCP (+ slack) */
  initialLoadBytes?: number;
  curtainLiftMs?: number;
  lifecycleTotals?: {
    preload: { totalBytes: number; totalCount: number };
    postload: { totalBytes: number; totalCount: number };
    full: { totalBytes: number; totalCount: number };
  };
  /** Same rollup as lifecycleTotals, split by URL scope (game keys vs common) */
  lifecycleTotalsByScope?: {
    game: {
      preload: { totalBytes: number; totalCount: number };
      postload: { totalBytes: number; totalCount: number };
      full: { totalBytes: number; totalCount: number };
    };
    common: {
      preload: { totalBytes: number; totalCount: number };
      postload: { totalBytes: number; totalCount: number };
      full: { totalBytes: number; totalCount: number };
    };
  };
  /** Same as totalBytes — everything transferred during the session */
  sessionTotalBytes?: number;
  gameAssetKeys?: string[];
  duplicates?: Array<{
    url: string;
    normalizedUrl: string;
    count: number;
    totalBytes: number;
  }>;
  /** Derived from duplicates: how many URLs repeat; extra redundant fetches vs once each */
  duplicateStats?: {
    uniqueUrls: number;
    extraFetches: number;
  };
};

export type TbtTimelineEntry = {
  startSec: number;
  endSec: number;
  durationMs: number;
  blockingMs: number;
  attribution?: string;
};

export type FrameTimingHealth = {
  sampleCount: number;
  avgFrameMs: number;
  stdDevDeltaMs: number;
  maxDeltaMs: number;
  irregularFrames: number;
  staggerRisk: "low" | "medium" | "high";
  wallClockDurationSec: number;
};

export type BlockingSummary = {
  totalBlockedMs: number;
  longTaskCount: number;
  maxBlockingMs: number;
  /** Main thread blocked time (sum of long task durations > 50ms) */
  mainThreadBlockedMs: number;
};

export type SummaryStats = {
  avgFps: number;
  avgCpu: number;
  /** Omitted when GPU chart is disabled */
  avgGpu?: number;
  peakMemMb: number;
  peakDomNodes: number;
};

/** Snapshot of Chromium / capture options used for this session (for interpreting metrics). */
export type CaptureSettings = {
  cpuThrottle: number;
  networkThrottle: "none" | "slow-3g" | "fast-3g" | "4g";
  networkProfile: {
    latencyMs: number;
    downloadBps: number | null;
    uploadBps: number | null;
  };
  traceDetail: "light" | "full";
  recordVideo: boolean;
  videoQuality: "low" | "high";
  browserLayout:
    | { mode: "desktop" }
    /** @deprecated Older reports used "landscape" for maximized desktop */
    | { mode: "landscape" }
    | { mode: "portrait"; width: number; height: number }
    | { mode: "mobileLandscape"; width: number; height: number };
  automation?: {
    enabled: boolean;
    gameId?: string;
    rounds?: number;
    skipLobby?: boolean;
  };
};

export type PerfReport = {
  startedAt: string;
  stoppedAt: string;
  durationMs: number;
  /**
   * When a game baseline exists, rebased series (CPU, heap, DOM, etc.) span this wall-clock
   * window only. FPS uses full-session `durationMs` on the time axis; use this for chart
   * domains of rebased metrics so the line fills the plot (no fake gap after the game window).
   */
  alignedDurationMs?: number;
  /** Single-browser-session correlation id — one Chromium context per report */
  captureSessionId?: string | null;
  /** CPU / network / trace / layout options applied during recording */
  captureSettings?: CaptureSettings;
  /** URL that was recorded (when available) */
  recordedUrl?: string | null;
  fpsSeries: MetricSeries;
  cpuSeries: MetricSeries;
  gpuSeries: MetricSeries;
  memorySeries: MetricSeries;
  domNodesSeries: MetricSeries;
  layoutMetrics: {
    layoutCount: number;
    paintCount: number;
    layoutTimeMs: number;
    paintTimeMs: number;
  };
  longTasks: {
    count: number;
    totalTimeMs: number;
    topTasks: Array<{
      name: string;
      durationMs: number;
      startSec: number;
      attribution?: string;
    }>;
    tbtTimeline?: TbtTimelineEntry[];
  };
  networkSummary: {
    requests: number;
    totalBytes: number;
    averageLatencyMs: number;
  };
  networkRequests: NetworkRequest[];
  renderBreakdown: {
    scriptMs: number;
    layoutMs: number;
    rasterMs: number;
    compositeMs: number;
  };
  webglMetrics: {
    drawCalls: number;
    shaderCompiles: number;
    otherEvents: number;
  };
  animationMetrics: {
    animations: Array<{
      id?: string;
      name: string;
      type: string;
      startTimeSec?: number;
      durationMs?: number;
      delayMs?: number;
      properties?: string[];
      bottleneckHint?: "compositor" | "paint" | "layout";
      /** Best-effort selector or tag hint when available from the capture pipeline */
      targetHint?: string;
    }>;
    animationFrameEventsPerSec: MetricSeries;
    totalAnimations: number;
    bottleneckCounts?: {
      compositor: number;
      paint: number;
      layout: number;
      unclassified: number;
    };
  };
  webVitals: {
    fcpMs?: number;
    lcpMs?: number;
    cls?: number;
    tbtMs: number;
    longTaskCount: number;
    longTaskTotalMs: number;
  };
  /** DrawFrame-derived frame pacing / jank proxy */
  frameTiming?: FrameTimingHealth | null;
  spikeFrames: Array<{ timeSec: number; fps: number; imageDataUrl: string }>;
  /** True when GPU data came from raster+composite fallback, not real GPU trace events */
  gpuEstimated?: boolean;
  sessionFrames?: Array<{
    timeSec: number;
    imageDataUrl: string;
    fps?: number;
  }>;
  video: {
    url: string;
    format: string;
    /** Seconds to skip in the WebM so t=0 matches chart time (URL baseline / game open). */
    timelineOffsetSec?: number;
  } | null;
  suggestions: BottleneckSuggestion[];
  /** Downloaded files by category (JS, CSS, HTML, JSON, images, fonts) */
  downloadedAssets?: DownloadedAssetsSummary;
  /** Main thread blocking from long tasks */
  blockingSummary?: BlockingSummary;
  /** Precomputed summary stats (avg CPU, avg FPS, etc.) */
  summaryStats?: SummaryStats;
};
