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
};

export type DownloadedAssetsSummary = {
  byCategory: Record<
    AssetCategory,
    { count: number; totalBytes: number; files: DownloadedAsset[] }
  >;
  totalBytes: number;
  totalCount: number;
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
  avgGpu: number;
  peakMemMb: number;
  peakDomNodes: number;
};

export type PerfReport = {
  startedAt: string;
  stoppedAt: string;
  durationMs: number;
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
    }>;
    animationFrameEventsPerSec: MetricSeries;
    totalAnimations: number;
  };
  webVitals: {
    fcpMs?: number;
    lcpMs?: number;
    cls?: number;
    tbtMs: number;
    longTaskCount: number;
    longTaskTotalMs: number;
  };
  spikeFrames: Array<{ timeSec: number; fps: number; imageDataUrl: string }>;
  /** True when GPU data came from raster+composite fallback, not real GPU trace events */
  gpuEstimated?: boolean;
  sessionFrames?: Array<{
    timeSec: number;
    imageDataUrl: string;
    fps?: number;
  }>;
  video: { url: string; format: string } | null;
  suggestions: BottleneckSuggestion[];
  /** Downloaded files by category (JS, CSS, HTML, JSON, images, fonts) */
  downloadedAssets?: DownloadedAssetsSummary;
  /** Main thread blocking from long tasks */
  blockingSummary?: BlockingSummary;
  /** Precomputed summary stats (avg CPU, avg FPS, etc.) */
  summaryStats?: SummaryStats;
  developerHints?: {
    reactRerenders?: {
      totalEvents: number;
      durationSec: number;
      components: Array<{
        name: string;
        renderCount: number;
        triggeredBy?: string;
        inBursts: number;
      }>;
      topRerenderers: Array<{
        name: string;
        count: number;
        triggeredBy?: string;
        parentHierarchy?: string;
        inBursts: number;
      }>;
      chartData?: Array<{
        timeSec: number;
        value: number;
        components: Array<{ name: string; count: number; hierarchy?: string }>;
      }>;
      timeline?: Array<{
        index: number;
        timeSec: number;
        componentName: string;
        triggeredBy?: string;
        parentHierarchy?: string;
        inBurst: boolean;
      }>;
      bursts?: Array<{
        startIndex: number;
        endIndex: number;
        count: number;
        startTimeSec: number;
        endTimeSec: number;
        topComponents: Array<{ name: string; count: number }>;
      }>;
    };
  };
};
