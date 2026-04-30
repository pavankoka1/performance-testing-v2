"use client";

import {
  animationDisplayLabel,
  effectiveBottleneck,
  filterAnimationPropertyKeys,
} from "@/lib/animationUtils";
import type { PerfReport } from "@/lib/reportTypes";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

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

function formatAnimDetail(
  anim: {
    name?: string;
    label?: string;
    id?: string;
    type?: string;
    startTimeSec?: number;
    durationMs?: number;
    delayMs?: number;
    properties?: string[];
    bottleneck?: string;
    bottleneckHint?: string;
    targetHint?: string;
  },
  formatNum: (n: number) => string
): string {
  const lines: string[] = [];
  lines.push(
    `Name / label: ${animationDisplayLabel(anim.name, anim.properties)}`
  );
  lines.push(`CDP / internal id: ${anim.id ?? "—"}`);
  lines.push(`Type: ${anim.type ?? "—"}`);
  lines.push(
    `Start (session timeline): ${anim.startTimeSec != null ? `${anim.startTimeSec.toFixed(3)}s` : "—"}`
  );
  lines.push(
    `Duration: ${anim.durationMs != null ? `${formatNum(anim.durationMs)} ms` : "—"}`
  );
  lines.push(
    `Delay: ${anim.delayMs != null ? `${formatNum(anim.delayMs)} ms` : "—"}`
  );
  const props = filterAnimationPropertyKeys(anim.properties ?? []);
  lines.push(
    `Animated CSS properties (${props.length}): ${props.length ? props.join(", ") : "—"}`
  );
  lines.push(
    `Bottleneck: ${anim.bottleneck ?? anim.bottleneckHint ?? "—"}`
  );
  if (anim.targetHint) lines.push(`Target hint: ${anim.targetHint}`);
  lines.push("");
  lines.push("Raw report entry (JSON):");
  lines.push(
    JSON.stringify(
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
    )
  );
  return lines.join("\n");
}

function AnimationTimelineInner({
  animations,
  durationSec,
  formatNumber,
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
            className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/55 p-4"
            role="presentation"
            onClick={closeModal}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="animation-detail-title"
              className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-card)] shadow-2xl ring-1 ring-black/20"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
                <p
                  id="animation-detail-title"
                  className="text-[10px] font-semibold uppercase tracking-wide text-[var(--accent)]"
                >
                  Animation details
                </p>
                <button
                  type="button"
                  className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--fg)] transition hover:bg-[var(--bg-elevated)]"
                  onClick={closeModal}
                >
                  Close
                </button>
              </div>
              <pre className="scrollbar-themed min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-[10px] leading-relaxed text-[var(--fg-muted)]">
                {formatAnimDetail(modalBar, formatNumber)}
              </pre>
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
