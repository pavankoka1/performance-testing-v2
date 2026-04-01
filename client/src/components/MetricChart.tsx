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
}: MetricChartProps) {
  const chartData = data.map((point, i) => ({
    id: i,
    time: labelFormatter
      ? labelFormatter(point)
      : `${Math.round(point.timeSec)}s`,
    timeSec: point.timeSec,
    value: formatValue(point.value),
  }));

  // Bar charts (e.g. layout vs paint totals) should still render at 0 ms; line charts
  // with no points are empty; lines with only zeros still show a flat series.
  const isEmpty =
    !chartData.length ||
    (type !== "bar" && chartData.every((d) => d.value === 0));

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
              Open in modal
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
                  contentStyle={{
                    background: "var(--bg-elevated)",
                    border: "1px solid var(--border)",
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
                      ? (t: number) => `${Math.round(t)}s`
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
                  contentStyle={{
                    background: "var(--bg-elevated)",
                    border: "1px solid var(--border)",
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
