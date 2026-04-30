import { metricsGlossary } from "@/lib/metricsGlossary";
import { ChevronDown, ChevronUp, Gauge, HelpCircle } from "lucide-react";
import { memo, useState } from "react";

// Show core metrics in glossary (exclude future/advanced ones for brevity)
const glossaryMetricIds = [
  "fps",
  "cpu",
  "js-heap",
  "dom-nodes",
  "layout",
  "paint",
  "long-tasks",
  "fcp",
  "lcp",
  "cls",
  "tbt",
  "network",
];
const metrics = glossaryMetricIds
  .map((id) => metricsGlossary.find((m) => m.id === id))
  .filter(Boolean) as typeof metricsGlossary;

type MetricsGlossaryProps = {
  onOpenHelp?: (metricId: string) => void;
};

function MetricsGlossary({ onOpenHelp }: MetricsGlossaryProps) {
  const [open, setOpen] = useState(false);
  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full cursor-pointer items-center justify-between px-6 py-4 text-left transition hover:bg-[var(--bg-elevated)]"
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
            What we measure, how the app collects it (trace + in-page, full-session
            timeline for FPS), and practical ways to improve each signal.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {metrics.map((m) => {
              const Icon = m.icon;
              return (
                <div
                  key={m.id}
                  className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]/80 p-4"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-medium text-[var(--fg)]">
                      <Icon className="h-4 w-4 text-[var(--accent)]" />
                      {m.name}
                    </div>
                    {onOpenHelp && (
                      <button
                        type="button"
                        onClick={() => onOpenHelp(m.id)}
                        className="cursor-pointer rounded p-1 text-[var(--fg-muted)] transition hover:bg-[var(--bg-card)] hover:text-[var(--accent)]"
                        title="Learn more about this metric"
                        aria-label={`Learn more about ${m.name}`}
                      >
                        <HelpCircle className="h-4 w-4" />
                      </button>
                    )}
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
