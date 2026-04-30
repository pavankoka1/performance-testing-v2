import type {
  AssetCategory,
  DownloadedAsset,
  DownloadedAssetsSummary,
} from "@/lib/reportTypes";
import { AlertTriangle, Clock3, Layers3, Sparkles, X } from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

const CATEGORY_ORDER: AssetCategory[] = [
  "build",
  "script",
  "stylesheet",
  "document",
  "json",
  "image",
  "font",
  "other",
];

const LABELS: Record<AssetCategory, string> = {
  build: "Main document",
  script: "Scripts",
  stylesheet: "Stylesheets",
  document: "Other documents",
  json: "API / fetch calls",
  image: "Images",
  font: "Fonts",
  other: "Other",
};

const getDisplayName = (url: string) => {
  try {
    const parsed = new URL(url);
    const lastPart = parsed.pathname.split("/").filter(Boolean).pop();
    if (lastPart) return lastPart;
    return parsed.hostname || parsed.pathname || url;
  } catch {
    const lastPart = url.split("/").filter(Boolean).pop();
    return lastPart || url;
  }
};

const getHostName = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return "Unknown host";
  }
};

type Props = {
  summary: DownloadedAssetsSummary;
  formatBytes: (n: number) => string;
  onClose: () => void;
};

type LifecyclePhase = "full" | "preload" | "postload";

function DownloadedAssetsModal({ summary, formatBytes, onClose }: Props) {
  const [filter, setFilter] = useState<AssetCategory | "all">("all");
  const [scope, setScope] = useState<"all" | "common" | "game">("all");
  const [phase, setPhase] = useState<LifecyclePhase>("full");

  const scopedSummary = useMemo(() => {
    if (!summary.byScope) return summary;
    const s = summary.byScope[scope];
    return {
      ...summary,
      byCategory: s.byCategory,
      totalBytes: s.totalBytes,
      totalCount: s.totalCount,
    };
  }, [summary, scope]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  /** All files for current scope + lifecycle phase (category filter applied separately). */
  const phaseScopedFiles = useMemo(() => {
    const out: Array<DownloadedAsset & { category: AssetCategory }> = [];
    for (const cat of CATEGORY_ORDER) {
      const bucket = scopedSummary.byCategory[cat];
      if (!bucket?.files?.length) continue;
      for (const f of bucket.files) {
        out.push({ ...f, category: cat });
      }
    }
    if (phase === "full" || summary.curtainLiftMs == null) return out;
    return out.filter((r) => {
      const end =
        r.lifecycleAtMs ?? r.endTimeMs ?? Number.POSITIVE_INFINITY;
      return phase === "preload"
        ? end <= summary.curtainLiftMs
        : end > summary.curtainLiftMs;
    });
  }, [scopedSummary, phase, summary.curtainLiftMs]);

  const rows = useMemo(() => {
    const categoryFiltered =
      filter === "all"
        ? phaseScopedFiles
        : phaseScopedFiles.filter((r) => r.category === filter);
    return categoryFiltered.sort(
      (a, b) =>
        (a.lifecycleAtMs ?? a.endTimeMs ?? Number.POSITIVE_INFINITY) -
        (b.lifecycleAtMs ?? b.endTimeMs ?? Number.POSITIVE_INFINITY)
    );
  }, [phaseScopedFiles, filter]);

  const categoryStats = useMemo(
    () =>
      CATEGORY_ORDER.map((cat) => ({
        category: cat,
        count: rows.filter((row) => row.category === cat).length,
        totalBytes: rows.reduce(
          (sum, row) => sum + (row.category === cat ? row.transferSize ?? 0 : 0),
          0
        ),
      })).filter((entry) => entry.count > 0),
    [rows]
  );

  const lifecycleCards = [
    {
      id: "preload" as const,
      label: "Preload",
      helper: summary.curtainLiftMs != null ? "Before curtain lift" : "Curtain not detected",
      stats: summary.lifecycleTotals?.preload,
    },
    {
      id: "postload" as const,
      label: "Post-load",
      helper: "After curtain lift",
      stats: summary.lifecycleTotals?.postload,
    },
    {
      id: "full" as const,
      label: "Full game",
      helper: "Entire captured session",
      stats: summary.lifecycleTotals?.full,
    },
  ];

  const modal = (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="assets-modal-title"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--bg-card)] shadow-[0_30px_90px_rgba(0,0,0,0.45)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-[var(--border)] bg-[radial-gradient(circle_at_top_left,rgba(167,139,250,0.18),transparent_38%),linear-gradient(180deg,rgba(255,255,255,0.02),transparent)] px-6 py-5">
          <div className="flex items-center justify-between gap-3">
          <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-[var(--accent)]/25 bg-[var(--accent)]/10 px-3 py-1 text-[11px] font-medium text-[var(--accent)]">
                <Sparkles className="h-3.5 w-3.5" />
                Asset lifecycle explorer
              </div>
              <h2
                id="assets-modal-title"
                className="text-xl font-semibold text-[var(--fg)]"
              >
                Downloaded files
              </h2>
              <p className="mt-1 text-xs text-[var(--fg-muted)]">
              Showing{" "}
              <span className="text-[var(--fg)]">
                {scope === "all"
                  ? "all assets"
                  : scope === "game"
                    ? "game assets"
                    : "common assets"}
              </span>{" "}
              · {formatBytes(scopedSummary.totalBytes)} · {scopedSummary.totalCount}{" "}
              files
              {summary.curtainLiftMs != null && (
                <>
                  {" "}
                  ·{" "}
                  <span className="rounded-md bg-violet-500/25 px-2 py-0.5 font-semibold text-violet-100 ring-1 ring-violet-400/40">
                    Curtain lift at {(summary.curtainLiftMs / 1000).toFixed(2)}s
                  </span>
                </>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-[var(--fg-muted)] transition hover:bg-[var(--bg-elevated)] hover:text-[var(--fg)]"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
          </div>
        </div>
        <div className="grid gap-4 border-b border-[var(--border)] px-6 py-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              {lifecycleCards.map((card) => {
                const active = phase === card.id;
                const disabled = card.id !== "full" && summary.curtainLiftMs == null;
                return (
                  <button
                    key={card.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => setPhase(card.id)}
                    className={`rounded-2xl border p-4 text-left transition ${
                      active
                        ? "border-[var(--accent)]/50 bg-[var(--accent)]/10 shadow-[0_0_0_1px_rgba(167,139,250,0.12)]"
                        : "border-[var(--border)] bg-[var(--bg)]/35 hover:border-[var(--accent)]/25"
                    } ${disabled ? "cursor-not-allowed opacity-45" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-[var(--fg)]">
                        {card.label}
                      </div>
                      <Layers3 className="h-4 w-4 text-[var(--accent)]" />
                    </div>
                    <div className="mt-2 text-lg font-semibold text-[var(--accent)]">
                      {formatBytes(card.stats?.totalBytes ?? 0)}
                    </div>
                    <div className="mt-1 text-xs text-[var(--fg-muted)]">
                      {card.stats?.totalCount ?? 0} files · {card.helper}
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--bg)]/25 p-4">
              <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--fg-muted)]">
              Scope
            </span>
            <button
              type="button"
              onClick={() => setScope("all")}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                scope === "all"
                  ? "bg-[var(--accent)] text-[var(--bg)]"
                  : "border border-[var(--border)] text-[var(--fg-muted)] hover:border-[var(--accent)]/40"
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setScope("common")}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                scope === "common"
                  ? "bg-[var(--accent)] text-[var(--bg)]"
                  : "border border-[var(--border)] text-[var(--fg-muted)] hover:border-[var(--accent)]/40"
              }`}
            >
              Common
            </button>
            <button
              type="button"
              onClick={() => setScope("game")}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                scope === "game"
                  ? "bg-[var(--accent)] text-[var(--bg)]"
                  : "border border-[var(--border)] text-[var(--fg-muted)] hover:border-[var(--accent)]/40"
              }`}
            >
              Game
            </button>
              </div>
              {summary.byScope != null && (
                <p className="text-[11px] leading-relaxed text-[var(--fg-muted)]">
                  <span className="text-violet-200">
                    Game total:{" "}
                    {formatBytes(summary.byScope.game.totalBytes)} ·{" "}
                    {summary.byScope.game.totalCount} files
                  </span>
                  {" · "}
                  <span className="text-slate-200">
                    Common total:{" "}
                    {formatBytes(summary.byScope.common.totalBytes)} ·{" "}
                    {summary.byScope.common.totalCount} files
                  </span>
                  {summary.lifecycleTotalsByScope != null &&
                    summary.curtainLiftMs != null && (
                      <>
                        {" "}
                        — preload to curtain: Game{" "}
                        {formatBytes(
                          summary.lifecycleTotalsByScope.game.preload.totalBytes
                        )}{" "}
                        (
                        {summary.lifecycleTotalsByScope.game.preload.totalCount})
                        , Common{" "}
                        {formatBytes(
                          summary.lifecycleTotalsByScope.common.preload.totalBytes
                        )}{" "}
                        (
                        {summary.lifecycleTotalsByScope.common.preload.totalCount}
                        )
                      </>
                    )}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--fg-muted)]">
                  Category
                </span>
                <button
                  type="button"
                  onClick={() => setFilter("all")}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                    filter === "all"
                      ? "bg-[var(--accent)] text-[var(--bg)]"
                      : "border border-[var(--border)] text-[var(--fg-muted)] hover:border-[var(--accent)]/40"
                  }`}
                >
                  All files
                </button>
                {CATEGORY_ORDER.map((cat) => {
                  const c = phaseScopedFiles.filter((row) => row.category === cat)
                    .length;
                  if (c === 0) return null;
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setFilter(cat)}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                        filter === cat
                          ? "bg-[var(--accent)] text-[var(--bg)]"
                          : "border border-[var(--border)] text-[var(--fg-muted)] hover:border-[var(--accent)]/40"
                      }`}
                    >
                      {LABELS[cat]} ({c})
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg)]/25 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--fg)]">
              <AlertTriangle className="h-4 w-4 text-rose-300" />
              Duplicate images
            </div>
            {(summary.duplicates?.length ?? 0) > 0 ? (
              <>
                <p className="mt-1 text-xs text-[var(--fg-muted)]">
                  Same image URL fetched more than once (API / XHR repeats are not listed here).
                  QA can use this as an optimization flag.
                </p>
                <div className="mt-3 grid max-h-44 gap-2 overflow-y-auto pr-1">
                  {(summary.duplicates ?? []).slice(0, 8).map((d) => (
                    <div
                      key={d.normalizedUrl}
                      className="rounded-xl border border-rose-500/25 bg-rose-500/8 p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2 text-xs text-rose-200">
                        <span className="rounded-full bg-rose-500/20 px-2 py-0.5 font-semibold">
                          {d.count}x
                        </span>
                        <span>{formatBytes(d.totalBytes)}</span>
                      </div>
                      <div className="mt-2 break-all font-mono text-[11px] leading-relaxed text-rose-100/90">
                        {d.normalizedUrl}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="mt-2 text-xs text-[var(--fg-muted)]">
                No duplicate image fetches were detected in this session.
              </p>
            )}
          </div>
        </div>
        <div className="grid gap-3 border-b border-[var(--border)] px-6 py-4 sm:grid-cols-2 xl:grid-cols-4">
          {categoryStats.map((entry) => (
            <div
              key={entry.category}
              className="rounded-2xl border border-[var(--border)] bg-[var(--bg)]/45 p-4"
            >
              <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--fg-muted)]">
                {LABELS[entry.category]}
              </p>
              <p className="mt-2 text-base font-semibold text-[var(--fg)]">
                {entry.count} files
              </p>
              <p className="text-xs text-[var(--accent)]">
                {formatBytes(entry.totalBytes)}
              </p>
            </div>
          ))}
        </div>
        <div className="scrollbar-themed min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-[var(--bg-card)] text-[var(--fg-muted)]">
              <tr>
                <th className="pb-2 pr-2 font-medium">Type</th>
                <th className="pb-2 pr-2 font-medium">File / endpoint</th>
                <th className="pb-2 pr-2 font-medium">Source</th>
                <th className="pb-2 pr-2 font-medium">Phase</th>
                <th className="pb-2 pr-2 font-medium">Size</th>
                <th className="pb-2 pr-2 font-medium">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]/60 text-[var(--fg-muted)]">
              {rows.map((r, i) => (
                <tr key={`${r.url}-${i}`} className="align-top">
                  <td className="py-2 pr-2 whitespace-nowrap text-[var(--fg)]">
                    {LABELS[r.category]}
                  </td>
                  <td className="py-2 pr-2">
                    <div className="min-w-[180px]">
                      <div className="truncate font-medium text-[var(--fg)]">
                        {getDisplayName(r.url)}
                      </div>
                      <div className="mt-0.5 break-all font-mono text-[10px] text-[var(--fg-muted)]/85">
                        {r.url}
                      </div>
                    </div>
                  </td>
                  <td className="py-2 pr-2 whitespace-nowrap">
                    {getHostName(r.url)}
                  </td>
                  <td className="py-2 pr-2 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-2 py-1 text-[10px]">
                      <Clock3 className="h-3 w-3" />
                      {summary.curtainLiftMs == null
                        ? "Full"
                        : (r.lifecycleAtMs ?? r.endTimeMs ?? Number.POSITIVE_INFINITY) <=
                            summary.curtainLiftMs
                          ? "Preload"
                          : "Post-load"}
                    </span>
                  </td>
                  <td className="py-2 pr-2 whitespace-nowrap">
                    {formatBytes(r.transferSize ?? 0)}
                  </td>
                  <td className="py-2 pr-2 whitespace-nowrap">
                    {r.lifecycleAtMs != null
                      ? `${(r.lifecycleAtMs / 1000).toFixed(2)} s (game)`
                      : r.endTimeMs != null
                        ? `${(r.endTimeMs / 1000).toFixed(2)} s`
                        : r.durationMs != null
                          ? `${r.durationMs.toFixed(0)} ms`
                          : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(modal, document.body);
}

export default memo(DownloadedAssetsModal);
