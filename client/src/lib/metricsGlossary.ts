/**
 * Shared metric definitions for glossary and help modals.
 * Each metric includes: what it is, how to understand it, thresholds,
 * behind-the-scenes behavior, and why to optimize.
 */
import type { LucideIcon } from "lucide-react";
import {
  Cpu,
  Gauge,
  Layout,
  MemoryStick,
  MousePointer,
  Network,
  Paintbrush,
  Radio,
  Zap,
} from "lucide-react";

export type MetricDefinition = {
  id: string;
  name: string;
  icon: LucideIcon;
  /** Brief one-liner */
  what: string;
  /** How to interpret the value */
  howToUnderstand: string;
  /** Target / acceptable values */
  targetValue: string;
  /** What happens under the hood */
  behindTheHood: string;
  /** Why optimization matters */
  whyOptimize: string;
  /** Mitigation tips */
  mitigate: string;
};

export const metricsGlossary: MetricDefinition[] = [
  {
    id: "fps",
    name: "FPS (Frames per second)",
    icon: Gauge,
    what: "Number of frames the browser paints per second.",
    howToUnderstand:
      "60 FPS = smooth. Below 45 FPS users notice jank. p50/p95/p99 distributions show sustained performance; drops during animations or bet updates indicate bottlenecks.",
    targetValue:
      "Target 60 FPS. p95 ≥ 55, p99 ≥ 45 acceptable. Gaming/betting UIs should sustain 60 during video + odds updates.",
    behindTheHood:
      "Measured via requestAnimationFrame callbacks. Each callback ≈ 1 frame. Gaps >16.67ms (60 FPS) mean missed frames. CDP tracing also records DrawFrame events.",
    whyOptimize:
      "Low FPS causes visible stutter in video, odds animations, and bet boards. Users perceive sluggishness and may mistrust real-time data.",
    mitigate:
      "Reduce main-thread work, use requestAnimationFrame for animations, avoid layout thrashing, defer non-critical JS.",
  },
  {
    id: "cpu",
    name: "CPU busy time",
    icon: Cpu,
    what: "Time the main thread spent doing work.",
    howToUnderstand:
      "High CPU % blocks input handling and animations. Spikes during odds updates or bet submissions indicate heavy JS. Sustained high CPU suggests inefficient loops or excessive re-renders.",
    targetValue:
      "Keep main-thread busy time < 50% during active interaction. Spikes < 200ms acceptable; sustained > 80% is problematic.",
    behindTheHood:
      "Derived from CDP Performance.getMetrics or trace events (RunTask, EvaluateScript). Main thread = single-threaded JS execution; blocking it delays everything.",
    whyOptimize:
      "Blocked main thread = unresponsive UI, delayed bet confirmations, video stalls. In betting, latency directly affects user trust.",
    mitigate:
      "Split long tasks, defer non-critical JS, use Web Workers for heavy computation.",
  },
  {
    id: "gpu",
    name: "GPU busy time",
    icon: Zap,
    what: "Time the GPU spent on compositing and rasterization.",
    howToUnderstand:
      "GPU handles layer compositing, rasterization, and some animations. High GPU with low FPS suggests GPU bottleneck (e.g. too many layers, complex effects).",
    targetValue:
      "GPU should not be saturated. If estimated from raster+composite, correlate with FPS; high GPU + low FPS = optimize layers.",
    behindTheHood:
      "Often estimated from CDP raster/composite events when native GPU metrics unavailable. Real GPU metrics require Chrome flags or DevTools.",
    whyOptimize:
      "GPU overload causes frame drops in video and animations. Excessive layers (e.g. many odds cells with shadows) can throttle compositing.",
    mitigate:
      "Reduce layer count, use will-change sparingly, simplify box-shadows and filters.",
  },
  {
    id: "js-heap",
    name: "JS Heap",
    icon: MemoryStick,
    what: "JavaScript heap memory used by the page.",
    howToUnderstand:
      "Heap grows as objects are allocated. Steady growth across rounds = leak. Spikes during interactions are normal; failure to drop = retained references.",
    targetValue:
      "Stable or slight variance. Delta > +2MB per round without GC drop = potential leak. Gaming UIs: watch for growth over 5–10 rounds.",
    behindTheHood:
      "performance.memory.usedJSHeapSize (Chrome) or CDP Runtime.getHeapUsage. Sampled periodically; GC can cause dips. Detached DOM shows in heap snapshots.",
    whyOptimize:
      "Leaks cause OOM over long sessions. In betting, users may keep the app open for hours; unbounded growth leads to crashes.",
    mitigate:
      "Release references, avoid global caches that grow unbounded, clean up event listeners and timers.",
  },
  {
    id: "dom-nodes",
    name: "DOM nodes",
    icon: Layout,
    what: "Number of DOM elements in the document.",
    howToUnderstand:
      "Large trees slow layout, style, and hit-testing. Growth without corresponding UI = detached or duplicated nodes. Odds boards with many cells can bloat quickly.",
    targetValue:
      "Keep minimal. < 1500 nodes for simple UIs; < 3000 for complex dashboards. Delta per round should be small; +50+ nodes/round = investigate.",
    behindTheHood:
      "document.querySelectorAll('*').length. Each node incurs style, layout, and paint cost. Virtualization reduces visible nodes; detached nodes still count in heap.",
    whyOptimize:
      "Large DOM = slower layout recalculations, more memory, sluggish scrolling. Bet boards with hundreds of cells benefit from virtualization.",
    mitigate:
      "Keep the DOM small: virtualize long lists, remove detached nodes, avoid unnecessary wrappers.",
  },
  {
    id: "layout",
    name: "Layout / Reflow",
    icon: Layout,
    what: "Browser recalculating element geometry (positions, sizes).",
    howToUnderstand:
      "Layout is triggered by style changes, DOM mutations, or resize. Forced synchronous layouts (read-then-write) cause thrashing. High layout count = inefficient updates.",
    targetValue:
      "Minimize layout count. Layout time < 10% of script time. Thrashing = many layouts in quick succession.",
    behindTheHood:
      "CDP trace events: Layout, UpdateLayoutTree. Browser computes computed style → layout tree → geometry. Forced sync layout = style read triggers immediate recalc.",
    whyOptimize:
      "Layout thrashing blocks the main thread. Odds updates that trigger full-board reflows cause jank during live games.",
    mitigate:
      "Batch reads and writes, use CSS containment, avoid reading layout (offset, scroll) during write loops.",
  },
  {
    id: "paint",
    name: "Paint",
    icon: Paintbrush,
    what: "Time spent painting pixels to layers.",
    howToUnderstand:
      "Paint area = repainted regions. Full repaints of large areas (e.g. entire odds board) are expensive. Small, targeted paint regions = efficient.",
    targetValue:
      "Paint time < 5ms per frame ideal. Paint count should correlate with visual changes; excessive paints = over-invalidation.",
    behindTheHood:
      "CDP Paint events. Browser rasterizes layers to pixels. Paint area from trace; large areas = more work. Compositing can skip paint for transform/opacity-only changes.",
    whyOptimize:
      "Heavy paint blocks compositing. Video + animated odds + bet highlights = competing for paint budget.",
    mitigate:
      "Reduce paint area, simplify box-shadows and filters, use compositor-only animations (transform, opacity).",
  },
  {
    id: "long-tasks",
    name: "Long tasks",
    icon: Cpu,
    what: "Main-thread tasks over ~50ms that block input and rendering.",
    howToUnderstand:
      "Long tasks = RunTask events > 50ms. They block input (clicks, typing) and prevent frame rendering. Count and total time indicate responsiveness.",
    targetValue:
      "Zero long tasks ideal. < 5 per session acceptable. Total TBT < 200ms for good INP.",
    behindTheHood:
      "CDP trace RunTask events. Tasks > 50ms are considered long per RAIL. Long Task API and PerformanceObserver can detect in-page.",
    whyOptimize:
      "Long tasks cause input delay (e.g. bet button feels unresponsive). In betting, quick bet placement is critical.",
    mitigate:
      "Break up long tasks, reduce JavaScript execution time, use async/await and code splitting.",
  },
  {
    id: "fcp",
    name: "FCP (First Contentful Paint)",
    icon: Paintbrush,
    what: "When the first text or image is painted.",
    howToUnderstand:
      "First meaningful paint. Users see something. FCP < 1.8s = good. Delayed FCP = render-blocking resources or slow server.",
    targetValue: "Good: < 1.8s. Needs improvement: 1.8–3s. Poor: > 3s.",
    behindTheHood:
      "PerformanceObserver for 'paint' with name 'first-contentful-paint'. Browser fires when first pixel of text/image is drawn.",
    whyOptimize:
      "FCP is the first impression. Slow FCP = users think the app is broken.",
    mitigate:
      "Minimize render-blocking resources, inline critical CSS, optimize server response time.",
  },
  {
    id: "lcp",
    name: "LCP (Largest Contentful Paint)",
    icon: Paintbrush,
    what: "When the largest visible content element is painted.",
    howToUnderstand:
      "LCP = main content. Usually hero image, video, or large text block. LCP < 2.5s = good.",
    targetValue: "Good: < 2.5s. Needs improvement: 2.5–4s. Poor: > 4s.",
    behindTheHood:
      "PerformanceObserver for 'largest-contentful-paint'. Tracks largest image, video, or text block. Can change as page loads.",
    whyOptimize:
      "LCP = perceived load speed. For gaming, video stream often is LCP; slow LCP = delayed video.",
    mitigate:
      "Optimize LCP resource, use priority hints, preload key resources.",
  },
  {
    id: "cls",
    name: "CLS (Cumulative Layout Shift)",
    icon: MousePointer,
    what: "Stability of layout. Measures unexpected layout shifts.",
    howToUnderstand:
      "CLS score = sum of impact × distance for unexpected shifts. 0 = perfect. < 0.1 = good. Shifts = content jumping (e.g. ads, odds loading).",
    targetValue: "Good: < 0.1. Needs improvement: 0.1–0.25. Poor: > 0.25.",
    behindTheHood:
      "PerformanceObserver for 'layout-shift'. Layout shift = visible content moved without user input. Impact = size of shift × distance.",
    whyOptimize:
      "Layout shifts cause misclicks (e.g. bet placed on wrong outcome). Critical for betting UIs.",
    mitigate:
      "Set width/height on images, reserve space for dynamic content, avoid inserting content above existing.",
  },
  {
    id: "tbt",
    name: "TBT (Total Blocking Time)",
    icon: Cpu,
    what: "Total time the main thread was blocked (tasks over ~50ms).",
    howToUnderstand:
      "TBT = sum of (task duration - 50ms) for long tasks. Measures input responsiveness. TBT < 200ms = good.",
    targetValue: "Good: < 200ms. Needs improvement: 200–600ms. Poor: > 600ms.",
    behindTheHood:
      "Derived from long tasks. TBT = Σ max(0, taskDuration - 50). Correlates with INP (Interaction to Next Paint).",
    whyOptimize:
      "High TBT = input lag. Bet buttons, scroll, dropdowns feel sluggish.",
    mitigate: "Break up long tasks, reduce JavaScript execution time.",
  },
  {
    id: "web-vitals",
    name: "Web Vitals",
    icon: Gauge,
    what: "Core user experience metrics: FCP, LCP, TBT, CLS.",
    howToUnderstand:
      "FCP = first paint. LCP = main content. TBT = input blocking. CLS = layout stability. Together they measure perceived performance and responsiveness.",
    targetValue:
      "FCP < 1.8s, LCP < 2.5s, TBT < 200ms, CLS < 0.1. Long task count should be low.",
    behindTheHood:
      "PerformanceObserver APIs for paint and layout-shift. Long tasks from trace. LCP can change as page loads.",
    whyOptimize:
      "Web Vitals correlate with user satisfaction and search rankings. Poor scores = slow, janky, or unstable UI.",
    mitigate:
      "Optimize critical path, reduce JS, break long tasks, reserve space for dynamic content.",
  },
  {
    id: "network",
    name: "Network requests & latency",
    icon: Network,
    what: "Number of requests, total bytes, and average latency.",
    howToUnderstand:
      "Request count = API calls, assets. Latency = server round-trip. High tail latency (p95/p99) for bet POSTs = slow confirmations.",
    targetValue:
      "Minimize requests. API p95 < 500ms for bet submission. p99 < 1s for critical paths.",
    behindTheHood:
      "CDP Network domain or Performance.getEntriesByType('resource'). Request timing: DNS, connect, TTFB, download.",
    whyOptimize:
      "Network latency directly affects bet confirmation speed. Users expect instant feedback.",
    mitigate:
      "Reduce request count, compress assets, use CDN, optimize API endpoints.",
  },
  {
    id: "render-breakdown",
    name: "Render breakdown",
    icon: Layout,
    what: "Time spent in script, layout, raster, and composite.",
    howToUnderstand:
      "Script = JS execution. Layout = geometry. Raster = paint to pixels. Composite = layer composition. Imbalance = bottleneck (e.g. high script = optimize JS).",
    targetValue:
      "Script usually dominant. Layout < 10% of script. Raster+composite scale with visual complexity.",
    behindTheHood:
      "CDP trace events: EvaluateScript, Layout, Rasterize, CompositeLayers. Summed per frame or session.",
    whyOptimize:
      "Identifies where time is spent. High layout = thrashing. High raster = too many layers.",
    mitigate:
      "Reduce dominant phase: script → code split; layout → containment; raster → fewer layers.",
  },
  {
    id: "react-rerenders",
    name: "React re-renders",
    icon: Layout,
    what: "Count of React component re-renders per second.",
    howToUnderstand:
      "High re-renders in odds/bet boards = unnecessary updates. Each re-render triggers reconciliation and possibly layout/paint.",
    targetValue:
      "Minimize. Stable components should not re-render on unrelated updates. < 10–20/sec for high-update areas acceptable.",
    behindTheHood:
      "React Profiler or custom hook. Tracks render phase. Re-renders = component function called again.",
    whyOptimize:
      "Excessive re-renders = CPU waste, layout thrash. Odds updates should not re-render entire board.",
    mitigate:
      "Memo, useMemo, useCallback; split components; avoid unnecessary state updates.",
  },
  {
    id: "animation-frames",
    name: "Animation frames per second",
    icon: Gauge,
    what: "Number of animation frame events (requestAnimationFrame) per second.",
    howToUnderstand:
      "Should correlate with FPS. Low = fewer rAF callbacks. Indicates animation workload.",
    targetValue: "~60 for 60 FPS. Drops during heavy load.",
    behindTheHood:
      "CDP Animation events or requestAnimationFrame instrumentation. Each rAF callback = one frame opportunity.",
    whyOptimize:
      "Low animation frame rate = missed animation updates, stutter.",
    mitigate: "Keep rAF work under 16ms, defer non-critical work.",
  },
  // Future metrics (gaming/betting specific) — ready for when implemented
  {
    id: "ws-latency",
    name: "WebSocket message-to-DOM latency",
    icon: Radio,
    what: "Time from WebSocket message receipt to UI update.",
    howToUnderstand:
      "Delta from WS receipt to DOM change. High latency = slow odds updates. Critical for real-time betting.",
    targetValue: "p95 < 100ms for odds display. p99 < 200ms.",
    behindTheHood:
      "Playwright page.on('websocket') for timestamps; MutationObserver on odds elements for DOM update time.",
    whyOptimize:
      "Stale odds = wrong bets, user confusion. Real-time requires sub-100ms updates.",
    mitigate: "Optimize React updates, reduce re-renders, batch WS messages.",
  },
  {
    id: "sync-integrity",
    name: "Sync integrity (video vs odds)",
    icon: Gauge,
    what: "Delta between video timestamp and odds display.",
    howToUnderstand:
      "Desync = video shows event X but odds show pre-event state. Gap > 5s = problematic.",
    targetValue:
      "p95 < 5s. Zero stale renders (old value flashed after update).",
    behindTheHood:
      "Compare video currentTime at odds update with server timestamp. MutationObserver for stale value detection.",
    whyOptimize:
      "Desync causes bet placement on wrong game state. Real-money correctness.",
    mitigate: "Sync timestamps, use server time as source of truth.",
  },
  {
    id: "video-buffer",
    name: "Video buffer health",
    icon: Paintbrush,
    what: "Buffered ranges, stall events, recovery time.",
    howToUnderstand:
      "Stalls = video waiting for data. Long stalls = poor UX. Buffered range = how much is preloaded.",
    targetValue: "Minimal stalls. Buffered range > 5s ahead. Recovery < 2s.",
    behindTheHood:
      "video.buffered, event listeners for 'waiting', 'playing'. CDP for media metrics.",
    whyOptimize:
      "Video stalls = user frustration. Gaming streams must stay smooth.",
    mitigate:
      "Optimize streaming, reduce bitrate spikes, use adaptive bitrate.",
  },
];

export function getMetricById(id: string): MetricDefinition | undefined {
  return metricsGlossary.find((m) => m.id === id);
}
