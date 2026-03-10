import {
  ChevronDown,
  ChevronUp,
  Cpu,
  Gauge,
  Layout,
  MemoryStick,
  MousePointer,
  Network,
  Paintbrush,
  Zap,
} from "lucide-react";
import { memo, useState } from "react";

const metrics = [
  {
    id: "fps",
    name: "FPS (Frames per second)",
    icon: Gauge,
    what: "Number of frames the browser paints per second. 60 FPS is the target for smooth visuals.",
    mitigate:
      "Reduce main-thread work, use requestAnimationFrame, avoid layout thrashing.",
  },
  {
    id: "cpu",
    name: "CPU busy time",
    icon: Cpu,
    what: "Time the main thread spent doing work. High CPU usage blocks input and animations.",
    mitigate: "Split long tasks, defer non-critical JS, use Web Workers.",
  },
  {
    id: "gpu",
    name: "GPU busy time",
    icon: Zap,
    what: "Time the GPU spent on compositing and rasterization.",
    mitigate:
      "Reduce layer count, use will-change sparingly, simplify shadows.",
  },
  {
    id: "js-heap",
    name: "JS Heap",
    icon: MemoryStick,
    what: "JavaScript heap memory used by the page.",
    mitigate: "Release references, avoid global caches that grow unbounded.",
  },
  {
    id: "dom-nodes",
    name: "DOM nodes",
    icon: Layout,
    what: "Number of DOM elements. Large trees slow down layout, style, and hit-testing.",
    mitigate:
      "Keep the DOM small: virtualize long lists, remove detached nodes.",
  },
  {
    id: "layout",
    name: "Layout / Reflow",
    icon: Layout,
    what: "Browser recalculating geometry. Forced synchronous layouts cause thrashing.",
    mitigate: "Batch reads and writes, use CSS containment.",
  },
  {
    id: "paint",
    name: "Paint",
    icon: Paintbrush,
    what: "Time spent painting pixels to layers.",
    mitigate: "Reduce paint area, simplify box-shadows and filters.",
  },
  {
    id: "fcp",
    name: "FCP (First Contentful Paint)",
    icon: Paintbrush,
    what: "When the first text or image is painted.",
    mitigate: "Minimize render-blocking resources, inline critical CSS.",
  },
  {
    id: "lcp",
    name: "LCP (Largest Contentful Paint)",
    icon: Paintbrush,
    what: "When the largest visible content element is painted.",
    mitigate:
      "Optimize LCP resource, use priority hints, preload key resources.",
  },
  {
    id: "cls",
    name: "CLS (Cumulative Layout Shift)",
    icon: MousePointer,
    what: "Stability of layout. Score under 0.1 is good.",
    mitigate: "Set width/height on images, reserve space for dynamic content.",
  },
  {
    id: "tbt",
    name: "TBT (Total Blocking Time)",
    icon: Cpu,
    what: "Total time the main thread was blocked (tasks over ~50ms).",
    mitigate: "Break up long tasks, reduce JavaScript execution time.",
  },
  {
    id: "network",
    name: "Network requests & latency",
    icon: Network,
    what: "Number of requests, total bytes, and average latency.",
    mitigate: "Reduce request count, compress assets, use a CDN.",
  },
];

function MetricsGlossary() {
  const [open, setOpen] = useState(false);
  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-6 py-4 text-left transition hover:bg-[var(--bg-elevated)]"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-[var(--fg)]">
          <Gauge className="h-4 w-4 text-amber-400/90" />
          Performance metrics explained
        </span>
        {open ? (
          <ChevronUp className="h-4 w-4 text-[var(--fg-muted)]" />
        ) : (
          <ChevronDown className="h-4 w-4 text-[var(--fg-muted)]" />
        )}
      </button>
      {open && (
        <div className="border-t border-[var(--border)] px-6 py-4">
          <p className="mb-4 text-xs text-[var(--fg-muted)]">
            What we measure and how to improve each metric.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {metrics.map((m) => {
              const Icon = m.icon;
              return (
                <div
                  key={m.id}
                  className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]/80 p-4"
                >
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium text-[var(--fg)]">
                    <Icon className="h-4 w-4 text-[var(--accent)]" />
                    {m.name}
                  </div>
                  <p className="mb-2 text-xs text-[var(--fg-muted)]">
                    {m.what}
                  </p>
                  <p className="text-xs text-emerald-400/90">
                    <span className="font-medium text-[var(--fg)]">
                      Mitigate:
                    </span>{" "}
                    {m.mitigate}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

export default memo(MetricsGlossary);
