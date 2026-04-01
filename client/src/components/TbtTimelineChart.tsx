import type { TbtTimelineEntry } from "@/lib/reportTypes";
import { computeTbtChartLayout } from "@/lib/tbtChartSvg";
import { memo, useId, useMemo, type ReactNode } from "react";

type Props = {
  durationSec: number;
  entries: TbtTimelineEntry[];
};

function TbtTimelineChart({ durationSec, entries }: Props) {
  const uid = useId();
  const gradId = `tbt-grad-${uid.replace(/:/g, "")}`;

  const layout = useMemo(
    () => computeTbtChartLayout(entries, durationSec),
    [entries, durationSec]
  );

  const { width, height, padL, padT, plotW, plotH, maxBlocking, span } = layout;

  const plotBottom = padT + plotH;
  const gridLines = 4;

  if (entries.length === 0) {
    return (
      <p className="text-xs text-[var(--fg-muted)]">
        No long tasks (&gt;50ms) in trace — TBT timeline is empty.
      </p>
    );
  }

  return (
    <div className="w-full space-y-2">
      <p className="text-[11px] leading-snug text-[var(--fg-muted)]">
        Each bar is one long task:{" "}
        <span className="text-[var(--fg)]">width</span> = task duration on the
        clock, <span className="text-[var(--fg)]">height</span> ={" "}
        <strong className="text-rose-400">blocking ms</strong> (time above
        50ms). Hover a bar for attribution.
      </p>
      <svg
        className="h-auto w-full max-h-[240px] rounded-lg border border-[var(--border)] bg-[var(--bg)]/90"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Total blocking time timeline"
      >
        <defs>
          <linearGradient id={gradId} x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stopColor="#9f1239" stopOpacity={0.85} />
            <stop offset="100%" stopColor="#fb7185" stopOpacity={0.95} />
          </linearGradient>
        </defs>
        <rect
          x={padL}
          y={padT}
          width={plotW}
          height={plotH}
          fill="rgba(255,255,255,0.02)"
          stroke="rgba(255,255,255,0.08)"
          rx={6}
        />
        {Array.from({ length: gridLines + 1 }, (_, g) => {
          const y = padT + (g / gridLines) * plotH;
          const val = maxBlocking * (1 - g / gridLines);
          return (
            <g key={g}>
              <line
                x1={padL}
                y1={y}
                x2={padL + plotW}
                y2={y}
                stroke="rgba(255,255,255,0.06)"
              />
              <text
                x={padL - 6}
                y={y + 4}
                textAnchor="end"
                fill="#71717a"
                fontSize={10}
              >
                {Math.round(val)}
              </text>
            </g>
          );
        })}
        {entries.map((e, i) => {
          const x1 = padL + (e.startSec / span) * plotW;
          const x2 = padL + (e.endSec / span) * plotW;
          const bw = Math.max(2, x2 - x1);
          const bh = (e.blockingMs / maxBlocking) * plotH;
          const y = plotBottom - bh;
          const title = `${e.blockingMs.toFixed(0)}ms blocking · ${e.durationMs.toFixed(0)}ms total @ ${e.startSec.toFixed(2)}s — ${e.attribution ?? ""}`;
          return (
            <rect
              key={i}
              x={x1}
              y={y}
              width={bw}
              height={bh}
              fill={`url(#${gradId})`}
              rx={2}
              stroke="rgba(251,113,133,0.45)"
              strokeWidth={0.5}
            >
              <title>{title}</title>
            </rect>
          );
        })}
        {(() => {
          const tickCount = Math.min(8, Math.max(4, Math.ceil(span)));
          const ticks: ReactNode[] = [];
          for (let t = 0; t <= tickCount; t++) {
            const sec = (t / tickCount) * span;
            const x = padL + (sec / span) * plotW;
            ticks.push(
              <g key={`v-${t}`}>
                <line
                  x1={x}
                  y1={plotBottom}
                  x2={x}
                  y2={plotBottom + 4}
                  stroke="rgba(255,255,255,0.12)"
                />
                <text
                  x={x}
                  y={height - 8}
                  textAnchor="middle"
                  fill="#71717a"
                  fontSize={10}
                >
                  {sec.toFixed(1)}s
                </text>
              </g>
            );
          }
          return ticks;
        })()}
        <text
          x={padL + plotW / 2}
          y={14}
          textAnchor="middle"
          fill="#a1a1aa"
          fontSize={11}
        >
          Blocking time (ms beyond 50ms per task)
        </text>
        <text
          x={padL + plotW / 2}
          y={height - 2}
          textAnchor="middle"
          fill="#52525b"
          fontSize={9}
        >
          Session timeline 0 → {span.toFixed(1)}s
        </text>
      </svg>
      <p className="text-[10px] text-[var(--fg-muted)]">
        Y-axis: blocking ms (max {Math.round(maxBlocking)} ms in view). Compare
        with TBT total in Web Vitals.
      </p>
    </div>
  );
}

export default memo(TbtTimelineChart);
