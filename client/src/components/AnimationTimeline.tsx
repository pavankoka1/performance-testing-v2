"use client";

import {
  animationDisplayLabel,
  effectiveBottleneck,
} from "@/lib/animationUtils";
import type { PerfReport } from "@/lib/reportTypes";
import { memo, useMemo } from "react";

type AnimationTimelineProps = {
  animations: NonNullable<PerfReport["animationMetrics"]>["animations"];
  durationSec: number;
  formatNumber: (value: number) => string;
};

const BOTTLENECK_COLORS = {
  compositor: "var(--compositor, #10b981)",
  paint: "var(--paint, #f59e0b)",
  layout: "var(--layout, #ef4444)",
} as const;

const DEFAULT_BAR_MS = 500;

function AnimationTimelineInner({
  animations,
  durationSec,
  formatNumber,
}: AnimationTimelineProps) {
  const effectiveDuration = Math.max(durationSec, 1);

  const bars = useMemo(() => {
    return animations
      .map((anim, i) => {
        const start = anim.startTimeSec ?? i * 0.3;
        const durationSecBar =
          anim.durationMs != null
            ? anim.durationMs / 1000
            : DEFAULT_BAR_MS / 1000;
        const leftPct = Math.max(
          0,
          Math.min(99, (start / effectiveDuration) * 100)
        );
        const widthPct = Math.min(
          Math.max(0, 100 - leftPct),
          (durationSecBar / effectiveDuration) * 100
        );
        const bottleneck = effectiveBottleneck(anim);
        const label = animationDisplayLabel(anim.name, anim.properties);
        return {
          ...anim,
          leftPct,
          widthPct: Math.max(widthPct, 1.5),
          durationSecBar,
          bottleneck,
          label,
        };
      })
      .filter((b) => b.widthPct > 0.5);
  }, [animations, effectiveDuration]);

  if (bars.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-[var(--border)] text-xs text-[var(--fg-muted)]">
        No animations captured. Record a page with CSS/Web Animations to see the
        timeline.
      </div>
    );
  }

  const ticks: number[] = [];
  const step = Math.max(1, Math.floor(effectiveDuration / 8));
  for (let t = 0; t < effectiveDuration; t += step) {
    ticks.push(t);
  }
  const lastTick = ticks[ticks.length - 1];
  if (lastTick === undefined || Math.abs(lastTick - effectiveDuration) > 0.1) {
    ticks.push(effectiveDuration);
  }

  return (
    <div className="w-full">
      <div className="scrollbar-themed relative overflow-x-auto rounded-lg border border-[var(--border)]/80 bg-[var(--bg)]/40">
        <div
          className="min-w-[min(100%,520px)] px-2 py-3"
          style={{ minWidth: 400 }}
        >
          <div
            className="relative mb-3 h-5 border-b border-[var(--border)]"
            style={{ minHeight: 20 }}
          >
            {ticks.map((t, i) => (
              <span
                key={`tick-${i}-${t}`}
                className="absolute -translate-x-1/2 text-[10px] text-[var(--fg-muted)]"
                style={{
                  left: `${(t / effectiveDuration) * 100}%`,
                }}
              >
                {Math.round(t)}s
              </span>
            ))}
          </div>

          <div className="scrollbar-themed max-h-72 space-y-2 overflow-y-auto pr-1">
            {bars.map((bar, i) => {
              const propsStr =
                bar.properties?.filter(Boolean).join(", ") || "—";
              return (
                <div
                  key={`anim-${i}-${bar.id ?? i}`}
                  className="group relative flex min-h-9 items-center gap-2"
                  title={`${bar.label} • ${bar.type} • ${propsStr} • ${formatNumber(bar.durationSecBar * 1000)}ms`}
                >
                  <div className="w-[min(28%,9rem)] shrink-0 text-right text-[11px] leading-tight text-[var(--fg-muted)]">
                    <span className="line-clamp-2 text-[var(--fg)]">
                      {bar.label}
                    </span>
                    {bar.bottleneck && (
                      <span
                        className="mt-0.5 inline-block rounded px-1.5 py-px text-[10px] font-medium"
                        style={{
                          backgroundColor:
                            bar.bottleneck === "compositor"
                              ? "rgba(16,185,129,0.2)"
                              : bar.bottleneck === "paint"
                                ? "rgba(245,158,11,0.2)"
                                : "rgba(239,68,68,0.2)",
                          color:
                            bar.bottleneck === "compositor"
                              ? "#34d399"
                              : bar.bottleneck === "paint"
                                ? "#fbbf24"
                                : "#f87171",
                        }}
                      >
                        {bar.bottleneck}
                      </span>
                    )}
                  </div>
                  <div
                    className="relative min-w-0 flex-1 overflow-hidden rounded-md border border-[var(--border)]/50 bg-[var(--bg-elevated)]/30"
                    style={{ height: 22 }}
                  >
                    <div
                      className="absolute top-1/2 h-[18px] -translate-y-1/2 rounded-sm opacity-95 shadow-sm transition-opacity group-hover:opacity-100"
                      style={{
                        left: `${bar.leftPct}%`,
                        width: `${bar.widthPct}%`,
                        minWidth: 4,
                        backgroundColor: bar.bottleneck
                          ? BOTTLENECK_COLORS[bar.bottleneck]
                          : "#64748b",
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-[11px] text-[var(--fg-muted)]">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-3 rounded"
            style={{ backgroundColor: BOTTLENECK_COLORS.compositor }}
          />
          Compositor (transform / opacity)
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-3 rounded"
            style={{ backgroundColor: BOTTLENECK_COLORS.paint }}
          />
          Paint (color, shadow, filter…)
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-3 rounded"
            style={{ backgroundColor: BOTTLENECK_COLORS.layout }}
          />
          Layout (size, position, flex…)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-3 rounded bg-slate-500/90" />
          Unclassified — rare custom property
        </span>
      </div>
    </div>
  );
}

export default memo(AnimationTimelineInner);
