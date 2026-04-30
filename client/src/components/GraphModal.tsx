"use client";

import type { MetricPoint, PerfReport } from "@/lib/reportTypes";
import { getClosestFrameAtTime, getVitalsAtTime } from "@/lib/reportUtils";
import { Activity, Play, Sparkles, Square, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import SessionTimeline from "./SessionTimeline";

type GraphModalProps = {
  title: string;
  unit: string;
  data: MetricPoint[];
  report: PerfReport;
  /** Overrides report.durationMs for X-axis when metric uses baseline-aligned window */
  maxDurationSec?: number;
  onClose: () => void;
};

const formatValue = (v: number) =>
  v > 1000 ? Math.round(v) : Math.round(v * 100) / 100;

export default function GraphModal({
  title,
  unit,
  data,
  report,
  maxDurationSec: maxDurationSecProp,
  onClose,
}: GraphModalProps) {
  const durationSec =
    maxDurationSecProp ??
    (report.alignedDurationMs != null && report.alignedDurationMs > 0
      ? report.alignedDurationMs / 1000
      : report.durationMs / 1000);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [playing, setPlaying] = useState(false);
  const playRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!playing) return;
    playRef.current = setInterval(() => {
      setCurrentTimeSec((t) => {
        if (t >= durationSec - 0.5) {
          setPlaying(false);
          if (playRef.current) clearInterval(playRef.current);
          return durationSec;
        }
        return Math.min(durationSec, t + 0.5);
      });
    }, 100);
    return () => {
      if (playRef.current) clearInterval(playRef.current);
    };
  }, [playing, durationSec]);

  const chartData = [...data]
    .sort((a, b) => a.timeSec - b.timeSec)
    .map((p) => ({
      timeSec: p.timeSec,
      value: formatValue(p.value),
    }));

  const handleChartClick = useCallback(
    (state: unknown) => {
      const s = state as {
        activePayload?: Array<{ payload?: { timeSec: number } }>;
      };
      const payload = s?.activePayload?.[0]?.payload;
      if (payload != null && typeof payload.timeSec === "number") {
        setCurrentTimeSec(Math.max(0, Math.min(durationSec, payload.timeSec)));
      }
    },
    [durationSec]
  );

  const vitals = getVitalsAtTime(report, currentTimeSec);
  const closestFrame = getClosestFrameAtTime(report, currentTimeSec);
  const isEmpty = !chartData.length;
  const isAnimationStyleMetric = /animation/i.test(title);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 animate-fade-in">
      <div
        className="absolute inset-0 cursor-pointer bg-black/75 backdrop-blur-md"
        onClick={onClose}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClose();
          }
        }}
        aria-label="Close"
      />
      <div
        className={`relative z-10 flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border bg-[var(--bg-card)] shadow-2xl shadow-black/50 ${
          isAnimationStyleMetric
            ? "border-fuchsia-500/40 shadow-fuchsia-950/30"
            : "border-[var(--border)]"
        }`}
        role="dialog"
        aria-modal="true"
        aria-label={`Graph: ${title}`}
      >
        <div
          className={`flex items-center justify-between gap-3 px-4 py-3.5 ${
            isAnimationStyleMetric
              ? "border-b border-fuchsia-500/25 bg-gradient-to-r from-violet-700/90 via-fuchsia-700/85 to-violet-900/90"
              : "border-b border-[var(--border)] bg-[var(--bg-elevated)]/40"
          }`}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            {isAnimationStyleMetric ? (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/15 text-white shadow-inner ring-1 ring-white/20">
                <Sparkles className="h-4 w-4" aria-hidden />
              </span>
            ) : (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)]/15 text-[var(--accent)] ring-1 ring-[var(--accent)]/25">
                <Activity className="h-4 w-4" aria-hidden />
              </span>
            )}
            <div className="min-w-0">
              <h3
                className={`truncate text-lg font-semibold tracking-tight ${
                  isAnimationStyleMetric ? "text-white" : "text-[var(--fg)]"
                }`}
              >
                {title}
              </h3>
              <p
                className={`text-[11px] font-medium uppercase tracking-wider ${
                  isAnimationStyleMetric ? "text-violet-100/90" : "text-[var(--fg-muted)]"
                }`}
              >
                {unit} · scrub timeline below
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setPlaying((p) => !p)}
              className={`cursor-pointer rounded-lg p-2 transition ${
                isAnimationStyleMetric
                  ? "text-white/90 hover:bg-white/15 hover:text-white"
                  : "text-[var(--fg-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--fg)]"
              }`}
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? (
                <Square className="h-5 w-5" />
              ) : (
                <Play className="h-5 w-5" />
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              className={`cursor-pointer rounded-lg p-2 transition ${
                isAnimationStyleMetric
                  ? "text-white/90 hover:bg-white/15 hover:text-white"
                  : "text-[var(--fg-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--fg)]"
              }`}
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="scrollbar-themed flex-1 overflow-auto p-4">
          <div className="mb-4 h-64 w-full cursor-pointer">
            {isEmpty ? (
              <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-[var(--border)] text-sm text-[var(--fg-muted)]">
                No data
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={chartData}
                  margin={{ top: 20, right: 20, left: 8, bottom: 8 }}
                  onClick={handleChartClick}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis
                    dataKey="timeSec"
                    type="number"
                    domain={[0, durationSec]}
                    tickFormatter={(t: number) => `${Math.round(t)}s`}
                    stroke="var(--fg-muted)"
                  />
                  <YAxis
                    stroke="var(--fg-muted)"
                    domain={
                      unit === "fps"
                        ? [0, 120]
                        : unit === "%"
                          ? [0, 100]
                          : undefined
                    }
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--bg-elevated)",
                      border: "1px solid var(--border)",
                    }}
                    formatter={(value: number | undefined) => [
                      value ?? 0,
                      unit,
                    ]}
                    labelFormatter={(_, payload) =>
                      payload?.[0]?.payload?.timeSec != null
                        ? `Time: ${Number(payload[0].payload.timeSec).toFixed(
                            1
                          )}s`
                        : ""
                    }
                  />
                  <ReferenceLine
                    x={currentTimeSec}
                    stroke={isAnimationStyleMetric ? "#f0abfc" : "var(--accent)"}
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="value"
                    fill={isAnimationStyleMetric ? "#a855f7" : "var(--accent)"}
                    fillOpacity={isAnimationStyleMetric ? 0.28 : 0.2}
                    stroke="none"
                  />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke={isAnimationStyleMetric ? "#e879f9" : "var(--accent)"}
                    strokeWidth={2}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
          <p className="mb-3 text-xs text-[var(--fg-muted)]">
            Click a point on the graph to jump to that time.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div
              className={`rounded-xl border p-4 shadow-inner ${
                isAnimationStyleMetric
                  ? "border-violet-500/35 bg-gradient-to-br from-violet-950/50 via-[var(--bg-elevated)]/95 to-fuchsia-950/40"
                  : "border-[var(--border)] bg-[var(--bg-elevated)]/80"
              }`}
            >
              <h4 className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--fg-muted)]">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]" />
                Live vitals @ {currentTimeSec.toFixed(1)}s
              </h4>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-xs">
                {(
                  [
                    ["FPS", vitals.fps != null ? String(vitals.fps) : "—"],
                    [
                      "CPU",
                      vitals.cpuPercent != null ? `${vitals.cpuPercent}%` : "—",
                    ],
                    [
                      "GPU",
                      vitals.gpuBusyMs != null ? `${vitals.gpuBusyMs}%` : "—",
                    ],
                    ["Heap MB", vitals.jsHeapMb != null ? String(vitals.jsHeapMb) : "—"],
                    [
                      "DOM",
                      vitals.domNodes != null ? String(vitals.domNodes) : "—",
                    ],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-[var(--fg-muted)]">{k}</dt>
                    <dd className="font-mono text-sm font-semibold tabular-nums text-[var(--fg)]">
                      {v}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
            <div
              className={`rounded-xl border p-4 ${
                isAnimationStyleMetric
                  ? "border-fuchsia-500/35 bg-gradient-to-br from-fuchsia-950/35 via-[var(--bg-elevated)]/90 to-violet-950/50"
                  : "border-[var(--border)] bg-[var(--bg-elevated)]/80"
              }`}
            >
              <h4 className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--fg-muted)]">
                <span className="h-1.5 w-1.5 rounded-full bg-fuchsia-400 shadow-[0_0_8px_rgba(232,121,249,0.65)]" />
                Closest video frame
              </h4>
              {closestFrame ? (
                <div className="flex gap-3">
                  <img
                    src={closestFrame.imageDataUrl}
                    alt={`Frame at ${closestFrame.timeSec.toFixed(1)}s`}
                    className={`h-24 w-32 shrink-0 rounded-lg object-cover shadow-lg ${
                      isAnimationStyleMetric
                        ? "ring-2 ring-fuchsia-500/40"
                        : "border border-[var(--border)]"
                    }`}
                  />
                  <div className="flex min-w-0 flex-col justify-center text-xs">
                    <p className="font-mono text-base font-bold tabular-nums text-[var(--fg)]">
                      t = {closestFrame.timeSec.toFixed(2)}s
                    </p>
                    <p className="mt-1 text-[var(--fg-muted)]">
                      Stream FPS:{" "}
                      <span className="font-semibold text-[var(--accent)]">
                        {closestFrame.fps != null
                          ? Math.round(closestFrame.fps)
                          : "—"}
                      </span>
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-sm leading-relaxed text-[var(--fg-muted)]">
                  No captured frame near this time — video may be off or samples
                  sparse.
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="border-t border-[var(--border)] px-4 py-3">
          <SessionTimeline
            durationSec={durationSec}
            currentTimeSec={currentTimeSec}
            onTimeChange={(t) => {
              setCurrentTimeSec(t);
              setPlaying(false);
            }}
            showLabels={true}
          />
        </div>
      </div>
    </div>,
    document.body
  );
}
