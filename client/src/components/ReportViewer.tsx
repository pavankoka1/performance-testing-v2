import {
  clsHealth,
  cpuHealth,
  domHealth,
  fcpHealth,
  fpsHealth,
  gpuHealth,
  healthToBgClass,
  healthToBorderClass,
  healthToTextClass,
  heapHealth,
  latencyHealth,
  lcpHealth,
  paintMsHealth,
  staggerHealth,
  tbtHealth,
  type MetricHealth,
} from "@/lib/metricHealth";
import { downloadReportHtml } from "@/lib/reportExport";
import type { PerfReport } from "@/lib/reportTypes";
import {
  BarChart2,
  Download,
  FileCode,
  Film,
  HelpCircle,
  Layers,
  ListChecks,
  MemoryStick,
  Wrench,
  ZapOff,
} from "lucide-react";
import { memo, useEffect, useState } from "react";
import AnimationLayersHelpModal from "./AnimationLayersHelpModal";
import AnimationTimeline from "./AnimationTimeline";
import DownloadedAssetsModal from "./DownloadedAssetsModal";
import GraphModal from "./GraphModal";
import MetricChart from "./MetricChart";
import ReactRerendersSection from "./ReactRerendersSection";
import TbtTimelineChart from "./TbtTimelineChart";
import SessionVideoPlayer from "./SessionVideoPlayer";

type ReportViewerProps = {
  report: PerfReport | null;
  onOpenHelp?: (metricId: string) => void;
};

type GraphModalState = {
  title: string;
  unit: string;
  data: PerfReport["fpsSeries"]["points"];
  report: PerfReport;
} | null;

const formatNumber = (value: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);

const formatBytes = (value: number) => {
  if (value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log10(value) / 3));
  return `${formatNumber(value / 1024 ** index)} ${units[index]}`;
};

function SummaryStatCard({
  label,
  value,
  health,
}: {
  label: string;
  value: string;
  health: MetricHealth;
}) {
  return (
    <div
      className={`rounded-xl border px-4 py-3 ${healthToBorderClass(health)} ${healthToBgClass(health)}`}
    >
      <p className="text-[10px] uppercase tracking-wider text-[var(--fg-muted)]">
        {label}
      </p>
      <p className={`text-lg font-semibold ${healthToTextClass(health)}`}>
        {value}
      </p>
    </div>
  );
}

function ReportViewer({ report, onOpenHelp }: ReportViewerProps) {
  const [graphModal, setGraphModal] = useState<GraphModalState>(null);
  const [assetsModalOpen, setAssetsModalOpen] = useState(false);
  const [animationLayersHelpOpen, setAnimationLayersHelpOpen] = useState(false);

  const durationSec = report ? report.durationMs / 1000 : 0;

  if (!report) {
    return (
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]/80 p-12 text-center">
        <p className="text-sm text-[var(--fg-muted)]">
          Run a session to generate a performance report.
        </p>
        <p className="mt-2 text-xs text-[var(--fg-muted)]/70">
          Paste a URL, click Start, interact with the page, then Stop to see
          metrics.
        </p>
      </section>
    );
  }

  return (
    <section className="animate-fade-in rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6 shadow-[var(--glow)]">
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
          {report.recordedUrl && (
            <p className="mt-1 text-xs text-[var(--fg-muted)]">
              URL:{" "}
              <a
                href={report.recordedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--accent)] hover:underline truncate max-w-md inline-block"
              >
                {report.recordedUrl}
              </a>
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--fg-muted)]">
          <button
            type="button"
            onClick={() => downloadReportHtml(report)}
            className="flex cursor-pointer items-center gap-2 rounded-full border border-[var(--border)] px-3 py-1.5 transition hover:border-[var(--accent)]/50 hover:bg-[var(--accent-dim)]"
          >
            <Download className="h-3.5 w-3.5" />
            Export HTML Report
          </button>
          <div className="rounded-full border border-[var(--border)] px-3 py-1">
            Requests: {report.networkSummary.requests}
          </div>
          <div
            className={`rounded-full border px-3 py-1 ${healthToBorderClass(latencyHealth(report.networkSummary.averageLatencyMs))} ${healthToBgClass(latencyHealth(report.networkSummary.averageLatencyMs))}`}
          >
            <span
              className={healthToTextClass(
                latencyHealth(report.networkSummary.averageLatencyMs)
              )}
            >
              Avg latency:{" "}
              {formatNumber(report.networkSummary.averageLatencyMs)} ms
            </span>
          </div>
          <div className="rounded-full border border-[var(--border)] px-3 py-1 text-[var(--fg-muted)]">
            Transfer: {formatBytes(report.networkSummary.totalBytes)}
          </div>
          {report.downloadedAssets &&
            report.downloadedAssets.totalCount > 0 && (
              <>
                {report.downloadedAssets.initialLoadBytes != null && (
                  <div className="rounded-full border border-[var(--border)] px-3 py-1 text-[var(--fg-muted)]">
                    Initial load ~{" "}
                    {formatBytes(report.downloadedAssets.initialLoadBytes)}
                  </div>
                )}
                <div className="rounded-full border border-[var(--accent)]/30 bg-[var(--accent-dim)] px-3 py-1 text-[var(--accent)]">
                  Full session build:{" "}
                  {formatBytes(
                    report.downloadedAssets.sessionTotalBytes ??
                      report.downloadedAssets.totalBytes
                  )}
                </div>
              </>
            )}
        </div>
      </div>

      {report.summaryStats && (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <SummaryStatCard
            label="Avg FPS"
            value={formatNumber(report.summaryStats.avgFps)}
            health={fpsHealth(report.summaryStats.avgFps)}
          />
          <SummaryStatCard
            label="Avg CPU"
            value={`${formatNumber(report.summaryStats.avgCpu)}%`}
            health={cpuHealth(report.summaryStats.avgCpu)}
          />
          <SummaryStatCard
            label="Avg GPU"
            value={`${formatNumber(report.summaryStats.avgGpu)}%`}
            health={gpuHealth(report.summaryStats.avgGpu)}
          />
          <SummaryStatCard
            label="Peak heap"
            value={`${formatNumber(report.summaryStats.peakMemMb)} MB`}
            health={heapHealth(report.summaryStats.peakMemMb)}
          />
          <SummaryStatCard
            label="Peak DOM"
            value={formatNumber(report.summaryStats.peakDomNodes)}
            health={domHealth(report.summaryStats.peakDomNodes)}
          />
          {report.blockingSummary &&
            (report.blockingSummary.longTaskCount > 0 ||
              report.webVitals.tbtMs > 0) && (
              <SummaryStatCard
                label="TBT (main-thread)"
                value={`${formatNumber(report.blockingSummary.mainThreadBlockedMs)} ms`}
                health={tbtHealth(report.webVitals.tbtMs)}
              />
            )}
          {report.frameTiming && (
            <SummaryStatCard
              label="Frame pacing risk"
              value={report.frameTiming.staggerRisk}
              health={staggerHealth(report.frameTiming.staggerRisk)}
            />
          )}
        </div>
      )}

      <div className="mt-6 grid min-w-0 gap-4 lg:grid-cols-2">
        <MetricChart
          title="FPS over time"
          unit="fps"
          data={report.fpsSeries.points}
          durationSec={durationSec}
          yDomain={[0, 120]}
          metricId="fps"
          onOpenHelp={onOpenHelp}
          onOpenModal={() =>
            setGraphModal({
              title: "FPS over time",
              unit: "fps",
              data: report.fpsSeries.points,
              report,
            })
          }
        />
        <MetricChart
          title="CPU utilisation"
          unit="%"
          data={report.cpuSeries.points}
          durationSec={durationSec}
          yDomain={[0, 100]}
          metricId="cpu"
          onOpenHelp={onOpenHelp}
          onOpenModal={() =>
            setGraphModal({
              title: "CPU utilisation",
              unit: "%",
              data: report.cpuSeries.points,
              report,
            })
          }
        />
        <MetricChart
          title="GPU utilisation"
          unit="%"
          data={report.gpuSeries.points}
          durationSec={durationSec}
          yDomain={[0, 100]}
          subtitle={
            report.gpuEstimated ? "Estimated from raster+composite" : undefined
          }
          metricId="gpu"
          onOpenHelp={onOpenHelp}
          onOpenModal={() =>
            setGraphModal({
              title: "GPU utilisation",
              unit: "%",
              data: report.gpuSeries.points,
              report,
            })
          }
        />
        <MetricChart
          title="JS heap"
          unit="MB"
          data={report.memorySeries.points}
          durationSec={durationSec}
          metricId="js-heap"
          onOpenHelp={onOpenHelp}
          onOpenModal={() =>
            setGraphModal({
              title: "JS heap",
              unit: "MB",
              data: report.memorySeries.points,
              report,
            })
          }
        />
        <MetricChart
          title="DOM nodes"
          unit="count"
          data={report.domNodesSeries.points}
          durationSec={durationSec}
          metricId="dom-nodes"
          onOpenHelp={onOpenHelp}
          onOpenModal={() =>
            setGraphModal({
              title: "DOM nodes",
              unit: "count",
              data: report.domNodesSeries.points,
              report,
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
          metricId="layout"
          onOpenHelp={onOpenHelp}
        />
        <MetricChart
          title="Animation frames per second"
          unit="count"
          data={
            report.animationMetrics?.animationFrameEventsPerSec?.points ?? []
          }
          durationSec={durationSec}
          metricId="animation-frames"
          onOpenHelp={onOpenHelp}
          onOpenModal={() =>
            setGraphModal({
              title: "Animation frames per second",
              unit: "count",
              data:
                report.animationMetrics?.animationFrameEventsPerSec?.points ??
                [],
              report,
            })
          }
        />
      </div>

      {(report.animationMetrics?.animations?.length ?? 0) > 0 && (
        <div className="mt-8 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]/80 p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-[var(--fg)]">
              Animations & properties — timeline
            </h3>
            <button
              type="button"
              onClick={() => setAnimationLayersHelpOpen(true)}
              className="shrink-0 rounded-full border border-[var(--accent)]/35 bg-[var(--accent-dim)] px-3 py-1.5 text-xs font-medium text-[var(--accent)] transition hover:bg-[var(--accent)]/15"
            >
              Compositor vs paint vs layout
            </button>
          </div>
          <AnimationTimeline
            animations={report.animationMetrics.animations}
            durationSec={durationSec}
            formatNumber={formatNumber}
          />
          {animationLayersHelpOpen && (
            <AnimationLayersHelpModal
              onClose={() => setAnimationLayersHelpOpen(false)}
            />
          )}
        </div>
      )}

      <div className="mt-8 grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]/80 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--fg)]">
              <BarChart2 className="h-4 w-4 text-[var(--accent)]" />
              Render breakdown
            </div>
            <button
              type="button"
              onClick={() => onOpenHelp?.("render-breakdown")}
              className="cursor-pointer rounded p-1 text-[var(--fg-muted)] transition hover:bg-[var(--bg-card)] hover:text-[var(--accent)]"
              title="Learn about this metric"
              aria-label="Learn about render breakdown"
            >
              <HelpCircle className="h-4 w-4" />
            </button>
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
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--fg)]">
              <Layers className="h-4 w-4 text-[var(--accent)]" />
              Layout & paint
            </div>
            <button
              type="button"
              onClick={() => onOpenHelp?.("layout")}
              className="cursor-pointer rounded p-1 text-[var(--fg-muted)] transition hover:bg-[var(--bg-card)] hover:text-[var(--accent)]"
              title="Learn about this metric"
              aria-label="Learn about layout and paint"
            >
              <HelpCircle className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-2 text-sm text-[var(--fg-muted)]">
            <p>Layouts: {report.layoutMetrics.layoutCount}</p>
            <p>Paints: {report.layoutMetrics.paintCount}</p>
            <p>
              Layout time:{" "}
              <span
                className={healthToTextClass(
                  paintMsHealth(report.layoutMetrics.layoutTimeMs)
                )}
              >
                {formatNumber(report.layoutMetrics.layoutTimeMs)}ms
              </span>
            </p>
            <p>
              Paint time:{" "}
              <span
                className={healthToTextClass(
                  paintMsHealth(report.layoutMetrics.paintTimeMs)
                )}
              >
                {formatNumber(report.layoutMetrics.paintTimeMs)}ms
              </span>
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]/80 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--fg)]">
              <Wrench className="h-4 w-4 text-[var(--accent)]" />
              Long tasks
            </div>
            <button
              type="button"
              onClick={() => onOpenHelp?.("long-tasks")}
              className="cursor-pointer rounded p-1 text-[var(--fg-muted)] transition hover:bg-[var(--bg-card)] hover:text-[var(--accent)]"
              title="Learn about this metric"
              aria-label="Learn about long tasks"
            >
              <HelpCircle className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-2 text-sm text-[var(--fg-muted)]">
            <p>Count: {report.longTasks.count}</p>
            <p>Total: {formatNumber(report.longTasks.totalTimeMs)}ms</p>
            {report.longTasks.topTasks.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs">
                {report.longTasks.topTasks.map((t, i) => (
                  <li key={i}>
                    {formatNumber(t.durationMs)}ms @ {t.startSec.toFixed(1)}s
                    {t.attribution && t.attribution !== "RunTask" && (
                      <span className="text-[var(--fg)]">
                        {" "}
                        — {t.attribution}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]/80 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--fg)]">
              <MemoryStick className="h-4 w-4 text-[var(--accent)]" />
              Web Vitals
            </div>
            <button
              type="button"
              onClick={() => onOpenHelp?.("web-vitals")}
              className="cursor-pointer rounded p-1 text-[var(--fg-muted)] transition hover:bg-[var(--bg-card)] hover:text-[var(--accent)]"
              title="Learn about this metric"
              aria-label="Learn about Web Vitals"
            >
              <HelpCircle className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-2 text-sm text-[var(--fg-muted)]">
            {report.webVitals.fcpMs != null && (
              <p>
                FCP:{" "}
                <span
                  className={healthToTextClass(
                    fcpHealth(report.webVitals.fcpMs)!
                  )}
                >
                  {formatNumber(report.webVitals.fcpMs)}ms
                </span>
              </p>
            )}
            {report.webVitals.lcpMs != null && (
              <p>
                LCP:{" "}
                <span
                  className={healthToTextClass(
                    lcpHealth(report.webVitals.lcpMs)!
                  )}
                >
                  {formatNumber(report.webVitals.lcpMs)}ms
                </span>
              </p>
            )}
            <p>
              TBT:{" "}
              <span
                className={healthToTextClass(tbtHealth(report.webVitals.tbtMs))}
              >
                {formatNumber(report.webVitals.tbtMs)}ms
              </span>
            </p>
            <p>Long tasks: {report.webVitals.longTaskCount}</p>
            {report.webVitals.cls != null && (
              <p>
                CLS:{" "}
                <span
                  className={healthToTextClass(clsHealth(report.webVitals.cls))}
                >
                  {formatNumber(report.webVitals.cls)}
                </span>
              </p>
            )}
          </div>
        </div>
      </div>

      {(report.blockingSummary &&
        (report.blockingSummary.longTaskCount > 0 ||
          report.webVitals.tbtMs > 0)) ||
      (report.longTasks.tbtTimeline &&
        report.longTasks.tbtTimeline.length > 0) ? (
        <div
          className={`mt-8 rounded-xl border p-4 ${healthToBorderClass(tbtHealth(report.webVitals.tbtMs))} ${healthToBgClass(tbtHealth(report.webVitals.tbtMs))}`}
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--fg)]">
              <ZapOff
                className={`h-4 w-4 ${healthToTextClass(tbtHealth(report.webVitals.tbtMs))}`}
              />
              Total blocking time (TBT) & long tasks
            </div>
          </div>
          {report.blockingSummary && (
            <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-sm text-[var(--fg-muted)]">
              <p>Long tasks: {report.blockingSummary.longTaskCount}</p>
              <p>
                Sum of long-task durations:{" "}
                {formatNumber(report.blockingSummary.totalBlockedMs)} ms
              </p>
              <p>
                TBT (blocking &gt;50ms):{" "}
                <span
                  className={healthToTextClass(
                    tbtHealth(report.webVitals.tbtMs)
                  )}
                >
                  {formatNumber(report.blockingSummary.mainThreadBlockedMs)} ms
                </span>
              </p>
              <p>
                Longest task:{" "}
                {formatNumber(report.blockingSummary.maxBlockingMs)} ms
              </p>
            </div>
          )}
          <TbtTimelineChart
            durationSec={durationSec}
            entries={report.longTasks.tbtTimeline ?? []}
          />
        </div>
      ) : null}

      {report.downloadedAssets && report.downloadedAssets.totalCount > 0 && (
        <div className="mt-8 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]/80 p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--fg)]">
              <FileCode className="h-4 w-4 text-[var(--accent)]" />
              Downloaded files — initial vs full session
            </div>
            <button
              type="button"
              onClick={() => setAssetsModalOpen(true)}
              className="rounded-full border border-[var(--accent)]/40 bg-[var(--accent-dim)] px-4 py-1.5 text-xs font-medium text-[var(--accent)] transition hover:bg-[var(--accent)]/20"
            >
              View all files…
            </button>
          </div>
          <div className="mb-4 flex flex-wrap gap-3 text-xs text-[var(--fg-muted)]">
            {report.downloadedAssets.initialLoadBytes != null && (
              <span className="rounded-full border border-[var(--border)] px-3 py-1">
                Initial bundle (FCP path ~):{" "}
                {formatBytes(report.downloadedAssets.initialLoadBytes)}
              </span>
            )}
            <span className="rounded-full border border-[var(--accent)]/30 px-3 py-1 text-[var(--accent)]">
              Full session / game build:{" "}
              {formatBytes(
                report.downloadedAssets.sessionTotalBytes ??
                  report.downloadedAssets.totalBytes
              )}{" "}
              ({report.downloadedAssets.totalCount} files)
            </span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {(
              [
                "build",
                "script",
                "stylesheet",
                "document",
                "json",
                "image",
                "font",
                "other",
              ] as const
            ).map((cat) => {
              const data = report.downloadedAssets!.byCategory[cat];
              if (!data || data.count === 0) return null;
              const labels: Record<string, string> = {
                build: "Build (main HTML doc)",
                script: "Scripts (.js)",
                stylesheet: "Styles (.css)",
                document: "Other documents",
                json: "API responses (XHR/fetch)",
                image: "Images",
                font: "Fonts",
                other: "Other",
              };
              return (
                <div
                  key={cat}
                  className="rounded-lg border border-[var(--border)] bg-[var(--bg)]/60 p-3"
                >
                  <p className="text-[10px] uppercase text-[var(--fg-muted)]">
                    {labels[cat] ?? cat}
                  </p>
                  <p className="font-semibold text-[var(--accent)]">
                    {data.count} files · {formatBytes(data.totalBytes)}
                  </p>
                  {data.files.length > 0 && data.files.length <= 5 && (
                    <ul className="mt-2 space-y-1 text-xs text-[var(--fg-muted)] truncate">
                      {data.files.slice(0, 5).map((f, i) => (
                        <li key={i} className="truncate" title={f.url}>
                          {formatBytes(f.transferSize ?? 0)} —{" "}
                          {f.url.split("/").pop()?.slice(0, 30) ?? "—"}
                        </li>
                      ))}
                    </ul>
                  )}
                  {data.files.length > 5 && (
                    <button
                      type="button"
                      onClick={() => setAssetsModalOpen(true)}
                      className="mt-2 text-xs text-[var(--accent)] underline-offset-2 hover:underline"
                    >
                      +{data.files.length - 5} more (open list)
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {assetsModalOpen && report.downloadedAssets && (
        <DownloadedAssetsModal
          summary={report.downloadedAssets}
          formatBytes={formatBytes}
          onClose={() => setAssetsModalOpen(false)}
        />
      )}

      {report.frameTiming && (
        <div className="mt-8 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]/80 p-4">
          <h3 className="mb-2 text-sm font-semibold text-[var(--fg)]">
            Frame pacing (jank / staggering signal)
          </h3>
          <p className="mb-3 text-xs text-[var(--fg-muted)]">
            From trace <code className="text-[var(--accent)]">DrawFrame</code>{" "}
            spacing: high variance with similar average FPS often indicates
            uneven delivery (CPU-driven jank vs smoother compositor paths).
          </p>
          <div className="grid gap-2 text-sm text-[var(--fg-muted)] sm:grid-cols-2 lg:grid-cols-4">
            <p>
              Risk:{" "}
              <span
                className={healthToTextClass(
                  staggerHealth(report.frameTiming.staggerRisk)
                )}
              >
                {report.frameTiming.staggerRisk}
              </span>
            </p>
            <p>Avg frame Δ: {formatNumber(report.frameTiming.avgFrameMs)} ms</p>
            <p>
              σ frame Δ: {formatNumber(report.frameTiming.stdDevDeltaMs)} ms
            </p>
            <p>Max frame Δ: {formatNumber(report.frameTiming.maxDeltaMs)} ms</p>
            <p>Irregular frames: {report.frameTiming.irregularFrames}</p>
            <p>Samples: {report.frameTiming.sampleCount}</p>
          </div>
        </div>
      )}

      {report.developerHints?.reactRerenders && (
        <div className="mt-8 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]/80 p-6">
          <div className="mb-4 flex items-center justify-between gap-2">
            <h3 className="text-lg font-semibold text-[var(--fg)]">
              React re-renders
            </h3>
            <button
              type="button"
              onClick={() => onOpenHelp?.("react-rerenders")}
              className="cursor-pointer rounded p-1 text-[var(--fg-muted)] transition hover:bg-[var(--bg-card)] hover:text-[var(--accent)]"
              title="Learn about this metric"
              aria-label="Learn about React re-renders"
            >
              <HelpCircle className="h-4 w-4" />
            </button>
          </div>
          <ReactRerendersSection
            data={report.developerHints.reactRerenders}
            durationSec={durationSec}
            formatNumber={formatNumber}
          />
        </div>
      )}

      {(report.suggestions?.length ?? 0) > 0 && (
        <div className="mt-8 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]/80 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--fg)]">
            <ListChecks className="h-4 w-4 text-[var(--accent)]" />
            Suggestions
          </div>
          <ul className="space-y-2 text-sm">
            {(report.suggestions ?? []).map((s, i) => (
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
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--fg)]">
                <Film className="h-4 w-4 text-[var(--accent)]" />
                Session recording
              </h3>
              <p className="mt-1 text-xs text-[var(--fg-muted)]">
                WebM capture aligned to your trace (
                <span className="text-[var(--fg)]">
                  {durationSec.toFixed(1)}s
                </span>{" "}
                session window). Playback stops at the report end.
              </p>
            </div>
            <p className="max-w-sm text-[11px] leading-relaxed text-[var(--fg-muted)]">
              <span className="font-medium text-[var(--fg)]">Controls:</span>{" "}
              Space play/pause ·{" "}
              <kbd className="rounded border border-[var(--border)] bg-[var(--bg-elevated)] px-1 py-0.5 font-mono text-[10px]">
                M
              </kbd>{" "}
              mute ·{" "}
              <kbd className="rounded border border-[var(--border)] bg-[var(--bg-elevated)] px-1 py-0.5 font-mono text-[10px]">
                F
              </kbd>{" "}
              fullscreen · seek bar · speed &amp; volume in the bar · PiP where
              supported.
            </p>
          </div>
          <p className="mb-3 text-xs text-[var(--fg-muted)]">
            Tip: disable &quot;Record session video&quot; before very long runs
            if capture is slow or fails.
          </p>
          <SessionVideoPlayer
            key={`${report.startedAt}-${report.stoppedAt}`}
            src={`${report.video.url}?t=${encodeURIComponent(report.stoppedAt)}`}
            maxDurationSec={durationSec}
          />
        </div>
      )}

      {graphModal && (
        <GraphModal
          title={graphModal.title}
          unit={graphModal.unit}
          data={graphModal.data}
          report={graphModal.report}
          onClose={() => setGraphModal(null)}
        />
      )}
    </section>
  );
}

export default memo(ReportViewer);
