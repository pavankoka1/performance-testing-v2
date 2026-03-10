import type { MetricPoint } from "@/lib/reportTypes";
import { memo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type GraphModalProps = {
  title: string;
  unit: string;
  data: MetricPoint[];
  onClose: () => void;
};

function GraphModal({ title, unit, data, onClose }: GraphModalProps) {
  const chartData = data.map((p, i) => ({
    id: i,
    timeSec: p.timeSec,
    value: p.value,
  }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
        role="button"
        tabIndex={0}
        aria-label="Close modal"
      />
      <div className="relative max-h-[90vh] w-full max-w-4xl overflow-auto rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--fg)]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--fg)] hover:bg-[var(--bg-elevated)]"
          >
            Close
          </button>
        </div>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="timeSec"
                tickFormatter={(t) => `${Math.round(t)}s`}
                stroke="var(--fg-muted)"
              />
              <YAxis stroke="var(--fg-muted)" />
              <Tooltip
                contentStyle={{
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border)",
                }}
                formatter={(value: number) => [value, unit]}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="var(--accent)"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

export default memo(GraphModal);
