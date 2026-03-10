import { downloadReportHtml } from "@/lib/reportExport";
import type { PerfReport } from "@/lib/reportTypes";
import {
  BarChart2,
  Download,
  Layers,
  ListChecks,
  MemoryStick,
  Wrench,
} from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import GraphModal from "./GraphModal";
import MetricChart from "./MetricChart";
import ReactRerendersSection from "./ReactRerendersSection";

type ReportViewerProps = { report: PerfReport | null };

type GraphModalState = {
  title: string;
  unit: string;
  data: PerfReport["fpsSeries"]["points"];
} | null;

const formatNumber = (value: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);

const formatBytes = (value: number) => {
  if (value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log10(value) / 3));
  return `${formatNumber(value / 1024 ** index)} ${units[index]}`;
};

function ReportViewer({ report }: ReportViewerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [reportTimeSec, setReportTimeSec] = useState(0);
  const [graphModal, setGraphModal] = useState<GraphModalState>(null);

  const durationSec = report ? report.durationMs / 1000 : 0;

  useEffect(() => {
    if (!report) return;
    setReportTimeSec(0);
  }, [report]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !report?.video) return;
    const syncFromVideo = () => setReportTimeSec(v.currentTime);
    v.addEventListener("timeupdate", syncFromVideo);
    return () => v.removeEventListener("timeupdate", syncFromVideo);
  }, [report?.video]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !report?.video) return;
    if (Number.isNaN(v.duration) || v.duration <= 0) return;
    if (Math.abs(v.currentTime - reportTimeSec) < 0.25) return;
    v.currentTime = reportTimeSec;
  }, [report?.video, reportTimeSec]);

  if (!report) {
    return (
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]/80 p-8 text-center text-sm text-[var(--fg-muted)]">
        Run a session to generate a performance report.
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-[var(--fg)]">
            Session Report
          </h2>
          <p className="text-sm text-[var(--fg-muted)]">
            {new Date(report.startedAt).toLocaleString()} →{" "}
            {new Date(report.stoppedAt).toLocaleString()}{" "}
            <span className="text-[var(--fg)]">
              ({(report.durationMs / 1000).toFixed(1)}s full session)
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--fg-muted)]">
          <button
            type="button"
            onClick={() => downloadReportHtml(report)}
            className="flex items-center gap-2 rounded-full border border-[var(--border)] px-3 py-1.5 transition hover:border-[var(--accent)]/50 hover:bg-[var(--accent-dim)]"
          >
            <Download className="h-3.5 w-3.5" />
            Export HTML Report
          </button>
          <div className="rounded-full border border-[var(--border)] px-3 py-1">
            Requests: {report.networkSummary.requests}
          </div>
          <div className="rounded-full border border-[var(--border)] px-3 py-1">
            Avg latency: {formatNumber(report.networkSummary.averageLatencyMs)}{" "}
            ms
          </div>
          <div className="rounded-full border border-[var(--border)] px-3 py-1">
            Transfer: {formatBytes(report.networkSummary.totalBytes)}
          </div>
        </div>
      </div>

      <div className="mt-6 grid min-w-0 gap-4 lg:grid-cols-2">
        <MetricChart
          title="FPS over time"
          unit="fps"
          data={report.fpsSeries.points}
          durationSec={durationSec}
          yDomain={[0, 120]}
          onOpenModal={() =>
            setGraphModal({
              title: "FPS over time",
              unit: "fps",
              data: report.fpsSeries.points,
            })
          }
        />
        <MetricChart
          title="CPU utilisation"
          unit="%"
          data={report.cpuSeries.points}
          durationSec={durationSec}
          yDomain={[0, 100]}
          onOpenModal={() =>
            setGraphModal({
              title: "CPU utilisation",
              unit: "%",
              data: report.cpuSeries.points,
            })
          }
        />
        <MetricChart
          title="GPU utilisation"
          unit="%"
          data={report.gpuSeries.points}
          durationSec={durationSec}
          yDomain={[0, 100]}
          onOpenModal={() =>
            setGraphModal({
              title: "GPU utilisation",
              unit: "%",
              data: report.gpuSeries.points,
            })
          }
        />
        <MetricChart
          title="JS heap"
          unit="MB"
          data={report.memorySeries.points}
          durationSec={durationSec}
          onOpenModal={() =>
            setGraphModal({
              title: "JS heap",
              unit: "MB",
              data: report.memorySeries.points,
            })
          }
        />
        <MetricChart
          title="DOM nodes"
          unit="count"
          data={report.domNodesSeries.points}
          durationSec={durationSec}
          onOpenModal={() =>
            setGraphModal({
              title: "DOM nodes",
              unit: "count",
              data: report.domNodesSeries.points,
            })
          }
        />
        <MetricChart
          title="Layout & paint totals"
          unit="ms"
          type="bar"
          data={[
            { timeSec: 1, value: report.layoutMetrics.layoutTimeMs },
            { timeSec: 2, value: report.layoutMetrics.paintTimeMs },
          ]}
          labelFormatter={(p) => (p.timeSec === 1 ? "Layout" : "Paint")}
        />
        <MetricChart
          title="Animation frames per second"
          unit="count"
          data={
            report.animationMetrics?.animationFrameEventsPerSec?.points ?? []
          }
          durationSec={durationSec}
          onOpenModal={() =>
            setGraphModal({
              title: "Animation frames per second",
              unit: "count",
              data:
                report.animationMetrics?.animationFrameEventsPerSec?.points ??
                [],
            })
          }
        />
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]/80 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--fg)]">
            <BarChart2 className="h-4 w-4 text-[var(--accent)]" />
            Render breakdown
          </div>
          <div className="space-y-2 text-sm text-[var(--fg-muted)]">
            <p>Script: {formatNumber(report.renderBreakdown.scriptMs)}ms</p>
            <p>Layout: {formatNumber(report.renderBreakdown.layoutMs)}ms</p>
            <p>Raster: {formatNumber(report.renderBreakdown.rasterMs)}ms</p>
            <p>
              Composite: {formatNumber(report.renderBreakdown.compositeMs)}ms
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]/80 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--fg)]">
            <Layers className="h-4 w-4 text-[var(--accent)]" />
            Layout & paint
          </div>
          <div className="space-y-2 text-sm text-[var(--fg-muted)]">
            <p>Layouts: {report.layoutMetrics.layoutCount}</p>
            <p>Paints: {report.layoutMetrics.paintCount}</p>
            <p>
              Layout time: {formatNumber(report.layoutMetrics.layoutTimeMs)}ms
            </p>
            <p>
              Paint time: {formatNumber(report.layoutMetrics.paintTimeMs)}ms
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]/80 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--fg)]">
            <Wrench className="h-4 w-4 text-[var(--accent)]" />
            Long tasks
          </div>
          <div className="space-y-2 text-sm text-[var(--fg-muted)]">
            <p>Count: {report.longTasks.count}</p>
            <p>Total: {formatNumber(report.longTasks.totalTimeMs)}ms</p>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]/80 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--fg)]">
            <MemoryStick className="h-4 w-4 text-[var(--accent)]" />
            Web Vitals
          </div>
          <div className="space-y-2 text-sm text-[var(--fg-muted)]">
            <p>TBT: {formatNumber(report.webVitals.tbtMs)}ms</p>
            <p>Long tasks: {report.webVitals.longTaskCount}</p>
            {report.webVitals.cls != null && (
              <p>CLS: {formatNumber(report.webVitals.cls)}</p>
            )}
          </div>
        </div>
      </div>

      {report.developerHints?.reactRerenders && (
        <div className="mt-8 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]/80 p-6">
          <h3 className="mb-4 text-lg font-semibold text-[var(--fg)]">
            React re-renders
          </h3>
          <ReactRerendersSection
            data={report.developerHints.reactRerenders}
            durationSec={durationSec}
            formatNumber={formatNumber}
          />
        </div>
      )}

      {report.suggestions.length > 0 && (
        <div className="mt-8 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]/80 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--fg)]">
            <ListChecks className="h-4 w-4 text-[var(--accent)]" />
            Suggestions
          </div>
          <ul className="space-y-2 text-sm">
            {report.suggestions.map((s, i) => (
              <li key={i} className="flex items-start gap-2">
                <span
                  className={`rounded px-2 py-0.5 text-xs ${
                    s.severity === "critical"
                      ? "bg-rose-500/30 text-rose-400"
                      : s.severity === "warning"
                      ? "bg-amber-500/30 text-amber-400"
                      : "bg-blue-500/30 text-blue-400"
                  }`}
                >
                  {s.severity}
                </span>
                <span className="text-[var(--fg-muted)]">
                  <strong className="text-[var(--fg)]">{s.title}</strong> —{" "}
                  {s.detail}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {report.video && (
        <div className="mt-8">
          <h3 className="mb-3 text-sm font-semibold text-[var(--fg)]">
            Session recording
          </h3>
          <video
            ref={videoRef}
            src={report.video.url}
            controls
            className="max-h-96 w-full rounded-xl border border-[var(--border)]"
          />
        </div>
      )}

      {graphModal && (
        <GraphModal
          title={graphModal.title}
          unit={graphModal.unit}
          data={graphModal.data}
          onClose={() => setGraphModal(null)}
        />
      )}
    </section>
  );
}

export default memo(ReportViewer);
