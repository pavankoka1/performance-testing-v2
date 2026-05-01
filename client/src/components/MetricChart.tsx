import type { MetricPoint } from "@/lib/reportTypes";
import { HelpCircle } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type MetricChartProps = {
  title: string;
  unit: string;
  data: MetricPoint[];
  type?: "line" | "bar";
  labelFormatter?: (point: MetricPoint) => string;
  durationSec?: number;
  onOpenModal?: () => void;
  yDomain?: [number, number];
  /** Optional subtitle, e.g. "(estimated from raster+composite)" */
  subtitle?: string;
  /** Metric ID for help modal; if set, shows help icon */
  metricId?: string;
  onOpenHelp?: (metricId: string) => void;
  /** When true, tooltip / X-axis treat the horizontal position as time in seconds (show "s") */
  xAxisIsTimeSec?: boolean;
};

const formatValue = (value: number) =>
  value > 1000 ? Math.round(value) : Math.round(value * 100) / 100;

export default function MetricChart({
  title,
  unit,
  data,
  type = "line",
  labelFormatter,
  durationSec,
  onOpenModal,
  yDomain,
  subtitle,
  metricId,
  onOpenHelp,
  xAxisIsTimeSec = true,
}: MetricChartProps) {
  const chartData = [...data]
    .sort((a, b) => a.timeSec - b.timeSec)
    .map((point, i) => ({
      id: i,
      time: labelFormatter
        ? labelFormatter(point)
        : xAxisIsTimeSec
          ? `${Math.round(point.timeSec)}s`
          : String(Math.round(point.timeSec)),
      timeSec: point.timeSec,
      value: formatValue(point.value),
    }));

  // Bar charts (e.g. layout vs paint totals) should still render at 0 ms. Line charts with
  // all-zero values are still valid data (e.g. CPU idle, throttled FPS) — only empty when
  // there are no points.
  const isEmpty = !chartData.length;

  return (
    <div className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]/80 p-4 transition-all duration-200 hover:border-[var(--accent)]/25 hover:shadow-[0_0_20px_rgba(139,92,246,0.08)]">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-[var(--fg)]">{title}</h3>
          {subtitle && (
            <p className="mt-0.5 text-xs text-[var(--fg-muted)]">{subtitle}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {metricId && onOpenHelp && (
            <button
              type="button"
              onClick={() => onOpenHelp(metricId)}
              className="cursor-pointer rounded p-1 text-[var(--fg-muted)] transition hover:bg-[var(--bg-elevated)] hover:text-[var(--accent)]"
              title="Learn about this metric"
              aria-label="Learn about this metric"
            >
              <HelpCircle className="h-4 w-4" />
            </button>
          )}
          {onOpenModal && (
            <button
              type="button"
              onClick={onOpenModal}
              className="cursor-pointer text-xs text-[var(--accent)] hover:underline"
            >
              Detailed chart view
            </button>
          )}
          <span className="text-xs text-[var(--fg-muted)]">{unit}</span>
        </div>
      </div>
      <div
        className="h-48 w-full min-w-0 cursor-pointer"
        onClick={onOpenModal ?? undefined}
        onKeyDown={(e) => onOpenModal && e.key === "Enter" && onOpenModal()}
        role={onOpenModal ? "button" : undefined}
        tabIndex={onOpenModal ? 0 : undefined}
      >
        {isEmpty ? (
          <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-[var(--border)] text-xs text-[var(--fg-muted)]">
            No data in this session
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%" minHeight={160}>
            {type === "bar" ? (
              <BarChart
                data={chartData}
                margin={{ top: 20, right: 20, bottom: 8, left: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="time" stroke="var(--fg-muted)" />
                <YAxis stroke="var(--fg-muted)" />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const row = payload[0]
                      .payload as (typeof chartData)[0];
                    return (
                      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-xs shadow-lg">
                        <p className="font-medium text-[var(--fg)]">{title}</p>
                        <p className="mt-1 text-[var(--fg-muted)]">
                          {row.time}
                        </p>
                        <p className="mt-1 font-mono text-[var(--fg)]">
                          {row.value} {unit}
                        </p>
                      </div>
                    );
                  }}
                />
                <Bar
                  dataKey="value"
                  fill="var(--accent)"
                  radius={[6, 6, 0, 0]}
                />
              </BarChart>
            ) : (
              <LineChart
                data={chartData}
                margin={{ top: 20, right: 20, bottom: 8, left: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis
                  dataKey={durationSec != null ? "timeSec" : "time"}
                  type={durationSec != null ? "number" : "category"}
                  domain={durationSec != null ? [0, durationSec] : undefined}
                  tickFormatter={
                    durationSec != null
                      ? (t: number) =>
                          xAxisIsTimeSec ? `${Math.round(t)}s` : String(t)
                      : undefined
                  }
                  stroke="var(--fg-muted)"
                />
                <YAxis
                  stroke="var(--fg-muted)"
                  domain={yDomain ? [yDomain[0], yDomain[1]] : undefined}
                  tickFormatter={
                    unit === "%" ? (v: number) => `${v}%` : undefined
                  }
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const row = payload[0]
                      .payload as (typeof chartData)[0];
                    const timeLabel =
                      durationSec != null && xAxisIsTimeSec
                        ? `${Number(row.timeSec).toFixed(2)}s`
                        : row.time;
                    return (
                      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-xs shadow-lg">
                        <p className="text-[10px] uppercase tracking-wide text-[var(--fg-muted)]">
                          Time (session)
                        </p>
                        <p className="font-mono text-[var(--fg)]">{timeLabel}</p>
                        <p className="mt-2 text-[10px] uppercase tracking-wide text-[var(--fg-muted)]">
                          {title}
                        </p>
                        <p className="font-mono text-[var(--fg)]">
                          {row.value}
                          {unit ? ` ${unit}` : ""}
                        </p>
                      </div>
                    );
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="var(--accent)"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            )}
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
