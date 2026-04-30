import {
  clsHealth,
  cpuHealth,
  domHealth,
  fcpHealth,
  fpsHealth,
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
  AlertTriangle,
  BarChart2,
  ChevronDown,
  Download,
  FolderOpen,
  HelpCircle,
  Layers,
  MemoryStick,
  Wrench,
} from "lucide-react";
import { memo, useState, type ReactNode } from "react";
import AnimationLayersHelpModal from "./AnimationLayersHelpModal";
import AnimationTimeline from "./AnimationTimeline";
import DownloadedAssetsModal from "./DownloadedAssetsModal";
import GraphModal from "./GraphModal";
import MetricChart from "./MetricChart";
import SessionVideoPlayer from "./SessionVideoPlayer";
import TbtTimelineChart from "./TbtTimelineChart";

type ReportViewerProps = {
  report: PerfReport | null;
  onOpenHelp?: (metricId: string) => void;
};

type GraphModalState = {
  title: string;
  unit: string;
  data: PerfReport["fpsSeries"]["points"];
  report: PerfReport;
  /** X-axis domain for this metric (full session vs baseline-aligned window). */
  maxDurationSec?: number;
} | null;

const formatNumber = (value: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);

const formatBytes = (value: number) => {
  if (value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log10(value) / 3));
  return `${formatNumber(value / 1024 ** index)} ${units[index]}`;
};

function ReportCollapsible({
  title,
  subtitle,
  defaultOpen = true,
  badge,
  right,
  className = "",
  children,
}: {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  badge?: ReactNode;
  right?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      className={`rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]/85 shadow-[var(--glow)] overflow-hidden ${className}`}
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border)]/90 bg-[var(--bg-elevated)]/50 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-[color-mix(in_oklab,var(--accent)_14%,transparent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color-mix(in_oklab,var(--accent)_50%,transparent)]"
          aria-expanded={open}
        >
          <ChevronDown
            className={`h-5 w-5 shrink-0 text-[var(--accent)] transition-transform duration-200 ${
              open ? "rotate-180" : ""
            }`}
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-[var(--fg)]">
                {title}
              </span>
              {badge}
            </div>
            {subtitle ? (
              <p className="mt-0.5 text-xs text-[var(--fg-muted)]">
                {subtitle}
              </p>
            ) : null}
          </div>
        </button>
        {right ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {right}
          </div>
        ) : null}
      </div>
      {open ? (
        <div className="animate-fade-in border-t border-[var(--border)]/60 bg-[var(--bg)]/20 p-4 sm:p-5">
          {children}
        </div>
      ) : null}
    </div>
  );
}

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

  const sessionDurationSec = report ? report.durationMs / 1000 : 0;
  const alignedDurationSec =
    report?.alignedDurationMs != null && report.alignedDurationMs > 0
      ? report.alignedDurationMs / 1000
      : sessionDurationSec;
  /**
   * One shared timeline for all time-series charts: t=0 when the target surface/URL baseline
   * is committed; span = aligned window. Without a baseline, same as full session length.
   */
  const chartTimelineDurationSec =
    report?.alignedDurationMs != null && report.alignedDurationMs > 0
      ? alignedDurationSec
      : sessionDurationSec;
  const videoMaxDurationSec =
    report?.video != null && (report.video.timelineOffsetSec ?? 0) > 0
      ? alignedDurationSec
      : sessionDurationSec;
  const primaryDownloadButtonClass =
    "inline-flex items-center gap-2 rounded-full border border-[var(--accent)] bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-[var(--bg)] shadow-[0_0_24px_rgba(79,70,229,0.22)] transition hover:scale-[1.01] hover:bg-[var(--accent)]/90";

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

  const reportInstanceKey = `${report.startedAt}-${report.stoppedAt}-${report.captureSessionId ?? ""}`;

  return (
    <section
      key={reportInstanceKey}
      className="animate-fade-in rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6 shadow-[var(--glow)]"
    >
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
            {report.captureSessionId && (
              <span
                title="One Chromium browser context — all metrics in this report come from this capture only."
                className="ml-2 cursor-help font-mono text-[10px] text-[var(--fg-muted)]"
              >
                session {report.captureSessionId.slice(0, 8)}…
              </span>
            )}
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
            className={`${primaryDownloadButtonClass} cursor-pointer`}
          >
            <Download className="h-3.5 w-3.5" />
            Download report
          </button>
          <div className="rounded-full border border-[var(--border)] px-3 py-1">
            Requests: {report.networkSummary.requests}
          </div>
          <div
            title="Mean round-trip time per network request observed during the session (request start → response complete). Lower is better; not the same as document load time."
            className={`cursor-help rounded-full border px-3 py-1 ${healthToBorderClass(latencyHealth(report.networkSummary.averageLatencyMs))} ${healthToBgClass(latencyHealth(report.networkSummary.averageLatencyMs))}`}
          >
            <span
              className={healthToTextClass(
                latencyHealth(report.networkSummary.averageLatencyMs),
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
                <div
                  title="All bytes transferred over the network during the recording (every tab in the Chromium session)."
                  className="cursor-help rounded-full border border-[var(--accent)]/30 bg-[var(--accent-dim)] px-3 py-1 text-[var(--accent)]"
                >
                  Full session:{" "}
                  {formatBytes(
                    report.downloadedAssets.sessionTotalBytes ??
                      report.downloadedAssets.totalBytes,
                  )}
                </div>
                {report.downloadedAssets.byScope && (
                  <>
                    <div
                      title="Assets whose URLs match your game keys (e.g. colorgame) — typical game bundle footprint."
                      className="cursor-help rounded-full border border-violet-400/30 bg-violet-500/10 px-3 py-1 text-violet-200"
                    >
                      Game:{" "}
                      {formatBytes(
                        report.downloadedAssets.byScope.game.totalBytes,
                      )}{" "}
                      · {report.downloadedAssets.byScope.game.totalCount} files
                    </div>
                    <div
                      title="Shared/vendor assets whose URLs did not match game keys — frameworks, CDNs, lobby chunks."
                      className="cursor-help rounded-full border border-slate-400/25 bg-slate-500/10 px-3 py-1 text-slate-200"
                    >
                      Common:{" "}
                      {formatBytes(
                        report.downloadedAssets.byScope.common.totalBytes,
                      )}{" "}
                      · {report.downloadedAssets.byScope.common.totalCount}{" "}
                      files
                    </div>
                  </>
                )}
              </>
            )}
        </div>
      </div>

      {report.summaryStats && (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
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

      {report.downloadedAssets && report.downloadedAssets.totalCount > 0 && (
        <ReportCollapsible
          className="mt-6"
          title="Files loaded during this session"
          subtitle="Preload, categories, and full transfer footprint"
          defaultOpen={true}
          badge={
            <span className="rounded-full bg-[var(--accent)]/15 px-2 py-0.5 text-[10px] font-medium text-[var(--accent)]">
              {report.downloadedAssets.totalCount} files
            </span>
          }
          right={
            <button
              type="button"
              onClick={() => setAssetsModalOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-violet-600 to-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-fuchsia-950/35 transition hover:brightness-110 hover:shadow-xl active:scale-[0.98]"
            >
              <FolderOpen className="h-4 w-4 opacity-95" aria-hidden />
              Browse all files
            </button>
          }
        >
          <div className="space-y-5">
            {report.downloadedAssets.curtainLiftMs != null && (
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="relative overflow-hidden rounded-2xl border border-violet-500/50 bg-gradient-to-br from-violet-600/45 via-fuchsia-600/25 to-violet-950/50 p-6 shadow-xl shadow-violet-950/50">
                  <div
                    className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-fuchsia-400/25 blur-3xl"
                    aria-hidden
                  />
                  <p className="relative text-[10px] font-bold uppercase tracking-[0.22em] text-violet-100">
                    Preload size (until curtain lift)
                  </p>
                  <p className="relative mt-3 break-all font-mono text-4xl font-bold tabular-nums leading-none tracking-tight text-white drop-shadow-lg sm:text-5xl">
                    {formatBytes(
                      report.downloadedAssets.lifecycleTotals?.preload
                        .totalBytes ?? 0,
                    )}
                  </p>
                  <p className="relative mt-3 text-sm font-medium text-violet-50/95">
                    {report.downloadedAssets.lifecycleTotals?.preload
                      .totalCount ?? 0}{" "}
                    files transferred before the curtain clears — primary load
                    cost.
                  </p>
                </div>
                <div className="flex flex-col justify-center rounded-2xl border border-[var(--accent)]/50 bg-gradient-to-b from-[var(--accent)]/25 to-[var(--accent)]/8 p-6 shadow-lg shadow-[var(--accent)]/15">
                  <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--accent)]">
                    Curtain lift time
                  </p>
                  <p className="mt-3 font-mono text-4xl font-bold tabular-nums tracking-tight text-[var(--fg)] sm:text-5xl">
                    {(report.downloadedAssets.curtainLiftMs / 1000).toFixed(2)}
                    <span className="ml-2 align-top text-2xl font-semibold text-[var(--fg-muted)]">
                      s
                    </span>
                  </p>
                  <p className="mt-3 text-xs leading-relaxed text-[var(--fg-muted)]">
                    When the loading curtain finishes — use with preload bytes
                    to judge spinner vs payload.
                  </p>
                </div>
              </div>
            )}

            <div className="mb-4 flex flex-wrap gap-2 text-xs">
              {report.downloadedAssets.initialLoadBytes != null && (
                <span className="rounded-full border border-[var(--border)] bg-[var(--bg)]/50 px-3 py-1.5 text-[var(--fg-muted)]">
                  Initial screen (~FCP path):{" "}
                  <span className="font-semibold text-[var(--fg)]">
                    {formatBytes(report.downloadedAssets.initialLoadBytes)}
                  </span>
                </span>
              )}
              {report.downloadedAssets.curtainLiftMs != null && (
                <span className="rounded-full border border-sky-400/35 bg-sky-500/15 px-3 py-1.5 font-medium text-sky-100">
                  Post-load:{" "}
                  {formatBytes(
                    report.downloadedAssets.lifecycleTotals?.postload
                      .totalBytes ?? 0,
                  )}{" "}
                  <span className="text-sky-200/80">
                    (
                    {report.downloadedAssets.lifecycleTotals?.postload
                      .totalCount ?? 0}{" "}
                    files)
                  </span>
                </span>
              )}
              <span className="rounded-full border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-3 py-1.5 font-medium text-[var(--accent)]">
                Full session:{" "}
                {formatBytes(
                  report.downloadedAssets.sessionTotalBytes ??
                    report.downloadedAssets.totalBytes,
                )}{" "}
                <span className="text-[var(--fg-muted)]">
                  ({report.downloadedAssets.totalCount} files)
                </span>
              </span>
              {(report.downloadedAssets.duplicates?.length ?? 0) > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full border border-rose-400/30 bg-rose-500/10 px-3 py-1.5 text-rose-200">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Repeat fetches:{" "}
                  {report.downloadedAssets.duplicateStats?.uniqueUrls ??
                    report.downloadedAssets.duplicates?.length}
                  {report.downloadedAssets.duplicateStats != null
                    ? ` · +${report.downloadedAssets.duplicateStats.extraFetches} extra`
                    : ""}
                </span>
              )}
              {report.downloadedAssets.lifecycleTotalsByScope != null &&
                report.downloadedAssets.curtainLiftMs != null && (
                  <>
                    <span className="rounded-full border border-violet-400/40 bg-violet-500/15 px-3 py-1.5 font-medium text-violet-100">
                      Game preload:{" "}
                      <span className="font-bold text-white">
                        {formatBytes(
                          report.downloadedAssets.lifecycleTotalsByScope.game
                            .preload.totalBytes,
                        )}
                      </span>
                    </span>
                    <span className="rounded-full border border-slate-400/35 bg-slate-500/15 px-3 py-1.5 text-slate-100">
                      Common preload:{" "}
                      <span className="font-semibold text-white">
                        {formatBytes(
                          report.downloadedAssets.lifecycleTotalsByScope.common
                            .preload.totalBytes,
                        )}
                      </span>
                    </span>
                  </>
                )}
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
                  build: "Main document",
                  script: "Scripts (.js)",
                  stylesheet: "Stylesheets (.css)",
                  document: "Other documents",
                  json: "API / fetch calls",
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
                      <ul className="mt-2 space-y-1 truncate text-xs text-[var(--fg-muted)]">
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
        </ReportCollapsible>
      )}

      <ReportCollapsible
        className="mt-6"
        title="Live metric charts"
        subtitle="FPS, CPU, memory, DOM, layout vs paint, animation events"
        defaultOpen={true}
      >
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <MetricChart
            title="FPS over time"
            unit="fps"
            data={report.fpsSeries.points}
            durationSec={chartTimelineDurationSec}
            yDomain={[0, 120]}
            metricId="fps"
            onOpenHelp={onOpenHelp}
            onOpenModal={() =>
              setGraphModal({
                title: "FPS over time",
                unit: "fps",
                data: report.fpsSeries.points,
                report,
                maxDurationSec: chartTimelineDurationSec,
              })
            }
          />
          <MetricChart
            title="CPU utilisation"
            unit="%"
            data={report.cpuSeries.points}
            durationSec={chartTimelineDurationSec}
            yDomain={[0, 100]}
            metricId="cpu"
            onOpenHelp={onOpenHelp}
            onOpenModal={() =>
              setGraphModal({
                title: "CPU utilisation",
                unit: "%",
                data: report.cpuSeries.points,
                report,
                maxDurationSec: chartTimelineDurationSec,
              })
            }
          />
          <MetricChart
            title="JS heap"
            unit="MB"
            data={report.memorySeries.points}
            durationSec={chartTimelineDurationSec}
            metricId="js-heap"
            onOpenHelp={onOpenHelp}
            onOpenModal={() =>
              setGraphModal({
                title: "JS heap",
                unit: "MB",
                data: report.memorySeries.points,
                report,
                maxDurationSec: chartTimelineDurationSec,
              })
            }
          />
          <MetricChart
            title="DOM nodes"
            unit="count"
            data={report.domNodesSeries.points}
            durationSec={chartTimelineDurationSec}
            metricId="dom-nodes"
            onOpenHelp={onOpenHelp}
            onOpenModal={() =>
              setGraphModal({
                title: "DOM nodes",
                unit: "count",
                data: report.domNodesSeries.points,
                report,
                maxDurationSec: chartTimelineDurationSec,
              })
            }
          />
          <div className="flex min-w-0 flex-col gap-2">
            <MetricChart
              title="Layout & paint totals"
              unit="ms"
              type="bar"
              xAxisIsTimeSec={false}
              data={[
                { timeSec: 1, value: report.layoutMetrics.layoutTimeMs },
                { timeSec: 2, value: report.layoutMetrics.paintTimeMs },
              ]}
              labelFormatter={(p) => (p.timeSec === 1 ? "Layout" : "Paint")}
              metricId="layout"
              onOpenHelp={onOpenHelp}
            />
            <p className="text-[11px] leading-snug text-[var(--fg-muted)]">
              Sum of main-thread time from Chrome tracing across the session —
              layout work (Layout / UpdateLayoutTree) vs painting (Paint /
              FramePaint and related “Painting” slices), comparable to the
              Layout and Paint rows in DevTools Performance.
            </p>
          </div>
          <MetricChart
            title="Animation frames per second"
            unit="count"
            data={
              report.animationMetrics?.animationFrameEventsPerSec?.points ?? []
            }
            durationSec={chartTimelineDurationSec}
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
                maxDurationSec: chartTimelineDurationSec,
              })
            }
          />
        </div>
      </ReportCollapsible>

      {(report.animationMetrics?.animations?.length ?? 0) > 0 && (
        <ReportCollapsible
          className="mt-8"
          title="Animations & properties"
          subtitle="Timeline of CSS / Web Animations — compositor vs paint vs layout"
          defaultOpen={true}
          badge={
            <span className="rounded-full bg-fuchsia-500/15 px-2 py-0.5 text-[10px] font-medium text-fuchsia-200">
              {report.animationMetrics!.animations!.length} runs
            </span>
          }
          right={
            <button
              type="button"
              onClick={() => setAnimationLayersHelpOpen(true)}
              className="shrink-0 rounded-lg border border-violet-400/40 bg-gradient-to-r from-violet-600/40 to-fuchsia-600/35 px-3 py-2 text-xs font-semibold text-violet-50 shadow-md shadow-violet-950/40 transition hover:brightness-110"
            >
              How layers work
            </button>
          }
        >
          <div className="mb-4 flex flex-wrap items-center gap-2 text-[11px] text-[var(--fg-muted)]">
            {report.animationMetrics?.bottleneckCounts && (
              <>
                <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-emerald-200">
                  Compositor{" "}
                  {report.animationMetrics.bottleneckCounts.compositor}
                </span>
                <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-amber-200">
                  Paint {report.animationMetrics.bottleneckCounts.paint}
                </span>
                <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-rose-200">
                  Layout {report.animationMetrics.bottleneckCounts.layout}
                </span>
                {report.animationMetrics.bottleneckCounts.unclassified > 0 && (
                  <span className="rounded-full border border-slate-500/30 px-2 py-0.5 text-slate-300">
                    Other{" "}
                    {report.animationMetrics.bottleneckCounts.unclassified}
                  </span>
                )}
              </>
            )}
          </div>
          <AnimationTimeline
            animations={report.animationMetrics.animations}
            durationSec={chartTimelineDurationSec}
            formatNumber={formatNumber}
          />
        </ReportCollapsible>
      )}

      <ReportCollapsible
        className="mt-8"
        title="Detailed metrics"
        subtitle="Render breakdown, layout & paint, long tasks, Web Vitals"
        defaultOpen={true}
      >
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
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
                    paintMsHealth(report.layoutMetrics.layoutTimeMs),
                  )}
                >
                  {formatNumber(report.layoutMetrics.layoutTimeMs)}ms
                </span>
              </p>
              <p>
                Paint time:{" "}
                <span
                  className={healthToTextClass(
                    paintMsHealth(report.layoutMetrics.paintTimeMs),
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
                      fcpHealth(report.webVitals.fcpMs)!,
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
                      lcpHealth(report.webVitals.lcpMs)!,
                    )}
                  >
                    {formatNumber(report.webVitals.lcpMs)}ms
                  </span>
                </p>
              )}
              <p>
                TBT:{" "}
                <span
                  className={healthToTextClass(
                    tbtHealth(report.webVitals.tbtMs),
                  )}
                >
                  {formatNumber(report.webVitals.tbtMs)}ms
                </span>
              </p>
              <p>Long tasks: {report.webVitals.longTaskCount}</p>
              {report.webVitals.cls != null && (
                <p>
                  CLS:{" "}
                  <span
                    className={healthToTextClass(
                      clsHealth(report.webVitals.cls),
                    )}
                  >
                    {formatNumber(report.webVitals.cls)}
                  </span>
                </p>
              )}
            </div>
          </div>
        </div>
      </ReportCollapsible>

      {(report.blockingSummary &&
        (report.blockingSummary.longTaskCount > 0 ||
          report.webVitals.tbtMs > 0)) ||
      (report.longTasks.tbtTimeline &&
        report.longTasks.tbtTimeline.length > 0) ? (
        <ReportCollapsible
          className={`mt-8 ${healthToBorderClass(tbtHealth(report.webVitals.tbtMs))} ${healthToBgClass(tbtHealth(report.webVitals.tbtMs))}`}
          title="Total blocking time (TBT) & long tasks"
          subtitle="Main-thread gaps — sums, timeline, and DevTools-style TBT"
          defaultOpen={true}
          badge={
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${healthToTextClass(tbtHealth(report.webVitals.tbtMs))}`}
            >
              TBT {formatNumber(report.webVitals.tbtMs)} ms
            </span>
          }
        >
          {report.blockingSummary && (
            <div className="mb-4 grid gap-4 text-sm text-[var(--fg-muted)] sm:grid-cols-2 lg:grid-cols-4">
              <p>Long tasks: {report.blockingSummary.longTaskCount}</p>
              <p>
                Sum of long-task durations:{" "}
                {formatNumber(report.blockingSummary.totalBlockedMs)} ms
              </p>
              <p>
                TBT (blocking &gt;50ms):{" "}
                <span
                  className={healthToTextClass(
                    tbtHealth(report.webVitals.tbtMs),
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
            durationSec={chartTimelineDurationSec}
            entries={report.longTasks.tbtTimeline ?? []}
          />
        </ReportCollapsible>
      ) : null}

      {assetsModalOpen && report.downloadedAssets && (
        <DownloadedAssetsModal
          summary={report.downloadedAssets}
          formatBytes={formatBytes}
          onClose={() => setAssetsModalOpen(false)}
        />
      )}

      {animationLayersHelpOpen && (
        <AnimationLayersHelpModal
          onClose={() => setAnimationLayersHelpOpen(false)}
        />
      )}

      {report.frameTiming && (
        <ReportCollapsible
          className="mt-8"
          title="Frame pacing (jank / staggering)"
          subtitle="DrawFrame spacing vs average FPS — uneven delivery signal"
          defaultOpen={true}
        >
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
                  staggerHealth(report.frameTiming.staggerRisk),
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
        </ReportCollapsible>
      )}

      {(report.suggestions?.length ?? 0) > 0 && (
        <ReportCollapsible
          className="mt-8"
          title="Suggestions"
          subtitle="Heuristics from this session — expand to review"
          defaultOpen={true}
          badge={
            <span className="rounded-full bg-[var(--accent)]/12 px-2 py-0.5 text-[10px] font-medium text-[var(--accent)]">
              {(report.suggestions ?? []).length} items
            </span>
          }
        >
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
        </ReportCollapsible>
      )}

      {report.video && (
        <ReportCollapsible
          className="mt-8"
          title="Session recording"
          subtitle={`WebM aligned to trace (${alignedDurationSec.toFixed(1)}s window)`}
          defaultOpen={true}
          right={
            <a
              href="/api/video/download"
              className={primaryDownloadButtonClass}
              onClick={(e) => e.stopPropagation()}
            >
              <Download className="h-3.5 w-3.5" />
              Download video
            </a>
          }
        >
          <p className="mb-3 text-[11px] leading-relaxed text-[var(--fg-muted)]">
            <span className="font-medium text-[var(--fg)]">Controls:</span>{" "}
            Space play/pause ·{" "}
            <kbd className="rounded border border-[var(--border)] bg-[var(--bg-elevated)] px-1 py-0.5 font-mono text-[10px]">
              M
            </kbd>{" "}
            mute ·{" "}
            <kbd className="rounded border border-[var(--border)] bg-[var(--bg-elevated)] px-1 py-0.5 font-mono text-[10px]">
              F
            </kbd>{" "}
            fullscreen · seek bar · speed &amp; volume · PiP where supported.
          </p>
          <p className="mb-3 text-xs text-[var(--fg-muted)]">
            Tip: disable &quot;Record session video&quot; before very long runs
            if capture is slow or fails.
          </p>
          <SessionVideoPlayer
            key={`${report.startedAt}-${report.stoppedAt}`}
            src={`${report.video.url}?t=${encodeURIComponent(report.stoppedAt)}`}
            maxDurationSec={videoMaxDurationSec}
            timelineOffsetSec={report.video.timelineOffsetSec ?? 0}
          />
        </ReportCollapsible>
      )}

      {graphModal && (
        <GraphModal
          title={graphModal.title}
          unit={graphModal.unit}
          data={graphModal.data}
          report={graphModal.report}
          maxDurationSec={graphModal.maxDurationSec}
          onClose={() => setGraphModal(null)}
        />
      )}
    </section>
  );
}

export default memo(ReportViewer);
