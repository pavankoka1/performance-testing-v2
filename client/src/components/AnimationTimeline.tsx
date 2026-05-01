"use client";

import {
  animationDisplayLabel,
  effectiveBottleneck,
  filterAnimationPropertyKeys,
} from "@/lib/animationUtils";
import type { PerfReport } from "@/lib/reportTypes";
import { Braces, Cpu, Gauge, X } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type MetricPoint = { timeSec: number; value: number };

type AnimationTimelineProps = {
  animations: NonNullable<PerfReport["animationMetrics"]>["animations"];
  durationSec: number;
  formatNumber: (value: number) => string;
  /** Session FPS samples — used to correlate animation start with frame rate */
  fpsPoints?: MetricPoint[];
  /** Session CPU % samples — same timeline as charts */
  cpuPoints?: MetricPoint[];
};

const BOTTLENECK_COLORS = {
  compositor: "var(--compositor, #10b981)",
  paint: "var(--paint, #f59e0b)",
  layout: "var(--layout, #ef4444)",
} as const;

const DEFAULT_BAR_MS = 500;

function valueNearestTime(
  points: MetricPoint[] | undefined,
  timeSec: number,
): number | null {
  if (!points?.length) return null;
  let best = points[0];
  let bestD = Math.abs(points[0].timeSec - timeSec);
  for (const p of points) {
    const d = Math.abs(p.timeSec - timeSec);
    if (d < bestD) {
      best = p;
      bestD = d;
    }
  }
  return best.value;
}

type AnimationEntry = NonNullable<
  PerfReport["animationMetrics"]
>["animations"][number];

type TimelineBar = AnimationEntry & {
  leftPct: number;
  widthPct: number;
  durationSecBar: number;
  bottleneck: "compositor" | "paint" | "layout" | undefined;
  label: string;
  propsDisplay: string;
};

function animationPayloadJson(anim: {
  id?: string;
  name?: string;
  type?: string;
  startTimeSec?: number;
  durationMs?: number;
  delayMs?: number;
  properties?: string[];
  bottleneckHint?: string;
  targetHint?: string;
}): string {
  return JSON.stringify(
    {
      id: anim.id,
      name: anim.name,
      type: anim.type,
      startTimeSec: anim.startTimeSec,
      durationMs: anim.durationMs,
      delayMs: anim.delayMs,
      properties: anim.properties,
      bottleneckHint: anim.bottleneckHint,
      targetHint: anim.targetHint,
    },
    null,
    2
  );
}

function AnimationTimelineInner({
  animations,
  durationSec,
  formatNumber,
  fpsPoints,
  cpuPoints,
}: AnimationTimelineProps) {
  const effectiveDuration = Math.max(durationSec, 1);
  const [modalBar, setModalBar] = useState<TimelineBar | null>(null);

  const closeModal = useCallback(() => setModalBar(null), []);

  useEffect(() => {
    if (!modalBar) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalBar, closeModal]);

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
        const propsDisplay = filterAnimationPropertyKeys(
          anim.properties ?? []
        ).join(", ");
        return {
          ...anim,
          leftPct,
          widthPct: Math.max(widthPct, 1.5),
          durationSecBar,
          bottleneck,
          label,
          propsDisplay,
        } satisfies TimelineBar;
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
      <p className="mb-3 text-[11px] leading-relaxed text-[var(--fg-muted)]">
        Timeline matches the session graphs: horizontal axis is{" "}
        <strong className="text-[var(--fg)]">0s → {effectiveDuration.toFixed(1)}s</strong>{" "}
        (same as FPS / CPU). Each bar starts at{" "}
        <code className="rounded bg-[var(--bg-elevated)] px-1">startTimeSec</code> with
        width ∝ duration. Click a row for full details.
      </p>

      <div className="scrollbar-themed relative overflow-x-auto rounded-lg border border-[var(--border)]/80 bg-[var(--bg)]/40">
        <div
          className="min-w-[min(100%,720px)] px-3 py-4"
          style={{ minWidth: 480 }}
        >
          <div
            className="relative mb-4 h-6 border-b border-[var(--border)]"
            style={{ minHeight: 24 }}
          >
            {ticks.map((t, i) => (
              <span
                key={`tick-${i}-${t}`}
                className="absolute -translate-x-1/2 text-[11px] text-[var(--fg-muted)]"
                style={{
                  left: `${(t / effectiveDuration) * 100}%`,
                }}
              >
                {Math.round(t)}s
              </span>
            ))}
          </div>

          <div className="scrollbar-themed min-h-[min(50vh,480px)] max-h-[min(65vh,600px)] space-y-3 overflow-y-auto pr-2">
            {bars.map((bar, i) => {
              const propsStr = bar.propsDisplay || "—";
              return (
                <div
                  key={`anim-${i}-${bar.id ?? i}`}
                  className="group relative flex cursor-pointer items-stretch gap-3 rounded-lg border border-transparent px-1 py-2 transition hover:border-[var(--accent)]/35 hover:bg-[var(--accent)]/[0.06]"
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    setModalBar(bar);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setModalBar(bar);
                    }
                  }}
                >
                  <div className="flex w-[min(38%,14rem)] shrink-0 flex-col justify-center gap-1 text-right">
                    <span className="text-[12px] font-semibold leading-snug text-[var(--fg)]">
                      {bar.label}
                    </span>
                    <span className="break-words text-[11px] leading-snug text-violet-300/95">
                      {propsStr}
                    </span>
                    <div className="flex flex-wrap justify-end gap-1">
                      {bar.bottleneck && (
                        <span
                          className="inline-block rounded px-1.5 py-px text-[10px] font-medium"
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
                      <span className="text-[10px] text-[var(--fg-muted)]">
                        @{(bar.startTimeSec ?? 0).toFixed(2)}s ·{" "}
                        {bar.durationMs != null
                          ? `${formatNumber(bar.durationMs)}ms`
                          : "—"}
                        {bar.delayMs != null
                          ? ` · delay ${formatNumber(bar.delayMs)}ms`
                          : ""}
                      </span>
                    </div>
                  </div>
                  <div
                    className="relative min-w-0 flex-1 overflow-hidden rounded-md border border-[var(--border)]/50 bg-[var(--bg-elevated)]/30"
                    style={{ minHeight: 36 }}
                  >
                    <div
                      className="absolute top-1/2 h-[28px] -translate-y-1/2 rounded-sm opacity-95 shadow-sm ring-1 ring-black/10 transition-opacity group-hover:opacity-100"
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

      {modalBar &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/70 p-4 backdrop-blur-md"
            role="presentation"
            onClick={closeModal}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="animation-detail-title"
              className="flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-violet-500/35 bg-gradient-to-b from-[#141018] via-[var(--bg-card)] to-[var(--bg-card)] shadow-[0_28px_90px_rgba(0,0,0,0.65)] ring-1 ring-violet-500/25"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex shrink-0 items-start justify-between gap-3 border-b border-violet-500/25 bg-violet-950/35 px-5 py-4">
                <div className="min-w-0">
                  <p
                    id="animation-detail-title"
                    className="text-[11px] font-bold uppercase tracking-[0.2em] text-violet-300"
                  >
                    Animation details
                  </p>
                  <p className="mt-2 text-lg font-bold leading-snug text-[var(--fg)]">
                    {modalBar.label}
                  </p>
                  <p className="mt-1 text-xs text-zinc-400">
                    Nearest samples on the session timeline when this animation
                    starts — compare with FPS / CPU graphs for spikes or dips.
                  </p>
                </div>
                <button
                  type="button"
                  className="shrink-0 rounded-xl border border-white/15 p-2 text-zinc-400 transition hover:bg-white/10 hover:text-white"
                  onClick={closeModal}
                  aria-label="Close"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="scrollbar-themed min-h-0 flex-1 overflow-y-auto px-5 py-5">
                {(() => {
                  const t0 = modalBar.startTimeSec ?? 0;
                  const fpsVal = valueNearestTime(fpsPoints, t0);
                  const cpuVal = valueNearestTime(cpuPoints, t0);
                  const showCorr =
                    fpsVal != null || cpuVal != null;

                  return (
                    <>
                      {showCorr && (
                        <div className="mb-5 flex flex-wrap gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 sm:gap-3">
                          <div className="flex min-w-[140px] flex-1 items-center gap-3 rounded-lg border border-emerald-500/20 bg-emerald-950/25 px-3 py-2">
                            <Gauge className="h-4 w-4 shrink-0 text-emerald-400/90" />
                            <div className="min-w-0">
                              <p className="text-[10px] font-medium uppercase tracking-wider text-emerald-200/75">
                                FPS @ {t0.toFixed(2)}s
                              </p>
                              <p className="font-mono text-lg font-semibold tabular-nums leading-tight text-emerald-100/95 sm:text-xl">
                                {fpsVal != null ? formatNumber(fpsVal) : "—"}
                              </p>
                            </div>
                          </div>
                          <div className="flex min-w-[140px] flex-1 items-center gap-3 rounded-lg border border-amber-500/20 bg-amber-950/20 px-3 py-2">
                            <Cpu className="h-4 w-4 shrink-0 text-amber-400/90" />
                            <div className="min-w-0">
                              <p className="text-[10px] font-medium uppercase tracking-wider text-amber-200/75">
                                CPU @ {t0.toFixed(2)}s
                              </p>
                              <p className="font-mono text-lg font-semibold tabular-nums leading-tight text-amber-50/95 sm:text-xl">
                                {cpuVal != null
                                  ? `${formatNumber(cpuVal)}%`
                                  : "—"}
                              </p>
                            </div>
                          </div>
                          <p className="w-full text-[11px] leading-snug text-zinc-500">
                            Nearest samples on the same timeline as your charts —
                            use with the FPS / CPU graphs to spot dips or spikes.
                          </p>
                        </div>
                      )}

                      <dl className="grid gap-3 text-sm text-zinc-200">
                        <div className="rounded-lg border border-white/10 bg-black/25 px-4 py-3">
                          <dt className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                            Type
                          </dt>
                          <dd className="mt-1 font-medium text-[var(--fg)]">
                            {modalBar.type ?? "—"}
                          </dd>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-black/25 px-4 py-3">
                          <dt className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                            Timeline
                          </dt>
                          <dd className="mt-1">
                            Start{" "}
                            <span className="font-mono font-semibold text-violet-200">
                              {modalBar.startTimeSec != null
                                ? `${modalBar.startTimeSec.toFixed(3)}s`
                                : "—"}
                            </span>
                            {" · "}
                            Duration{" "}
                            <span className="font-mono font-semibold text-violet-200">
                              {modalBar.durationMs != null
                                ? `${formatNumber(modalBar.durationMs)} ms`
                                : "—"}
                            </span>
                            {modalBar.delayMs != null && (
                              <>
                                {" · "}
                                Delay{" "}
                                <span className="font-mono">
                                  {formatNumber(modalBar.delayMs)} ms
                                </span>
                              </>
                            )}
                          </dd>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-black/25 px-4 py-3">
                          <dt className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                            Animated properties
                          </dt>
                          <dd className="mt-1 break-words text-[13px] leading-relaxed text-zinc-100">
                            {modalBar.propsDisplay || "—"}
                          </dd>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-black/25 px-4 py-3">
                          <dt className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                            Bottleneck hint
                          </dt>
                          <dd className="mt-1 font-semibold capitalize text-[var(--fg)]">
                            {modalBar.bottleneck ?? "—"}
                          </dd>
                        </div>
                      </dl>

                      <section className="mt-8 overflow-hidden rounded-xl border border-fuchsia-500/35 bg-gradient-to-br from-[#1c1030] via-[#120a1a] to-[#0a0810] shadow-[0_0_40px_-12px_rgba(192,38,211,0.35),inset_0_1px_0_rgba(255,255,255,0.06)]">
                        <div className="flex items-center justify-between gap-3 border-b border-fuchsia-500/25 bg-gradient-to-r from-fuchsia-950/50 to-violet-950/30 px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Braces className="h-4 w-4 text-fuchsia-300" />
                            <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-fuchsia-100">
                              Serialized capture (JSON)
                            </span>
                          </div>
                          <span className="rounded-md bg-black/40 px-2 py-0.5 font-mono text-[10px] text-fuchsia-200/90 ring-1 ring-fuchsia-500/25">
                            report slice
                          </span>
                        </div>
                        <pre className="scrollbar-themed max-h-[min(42vh,320px)] overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-[11px] leading-relaxed text-cyan-50/95 [text-shadow:0_0_24px_rgba(34,211,238,0.12)]">
                          {animationPayloadJson(modalBar)}
                        </pre>
                      </section>
                    </>
                  );
                })()}
              </div>
            </div>
          </div>,
          document.body
        )}

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
          Unclassified
        </span>
      </div>
    </div>
  );
}

export default memo(AnimationTimelineInner);
