import type { DownloadedAssetsSummary } from "@/lib/reportTypes";
import {
  ASSET_LABELS,
  CATEGORY_ORDER,
  type FileRow,
} from "@/components/downloadedAssetsUi";
import DownloadedFilesListModal from "@/components/DownloadedFilesListModal";
import {
  AlertTriangle,
  ChevronRight,
  Layers3,
  ListTree,
  Sparkles,
  X,
} from "lucide-react";
import { Fragment, memo, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type Props = {
  summary: DownloadedAssetsSummary;
  formatBytes: (n: number) => string;
  onClose: () => void;
};

type LifecyclePhase = "full" | "preload" | "postload";

function DownloadedAssetsModal({ summary, formatBytes, onClose }: Props) {
  const [fullListOpen, setFullListOpen] = useState(false);
  const [filter, setFilter] = useState<
    (typeof CATEGORY_ORDER)[number] | "all"
  >("all");
  const [scope, setScope] = useState<"all" | "common" | "game">("all");
  const [phase, setPhase] = useState<LifecyclePhase>("full");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (fullListOpen) setFullListOpen(false);
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, fullListOpen]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

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

  const phaseScopedFiles = useMemo(() => {
    const out: FileRow[] = [];
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
        ? end <= summary.curtainLiftMs!
        : end > summary.curtainLiftMs!;
    });
  }, [scopedSummary, phase, summary.curtainLiftMs]);

  const rows = useMemo(() => {
    if (filter === "all") return phaseScopedFiles;
    return phaseScopedFiles.filter((r) => r.category === filter);
  }, [phaseScopedFiles, filter]);

  const categoryStats = useMemo(
    () =>
      CATEGORY_ORDER.map((category) => ({
        category,
        count: rows.filter((row) => row.category === category).length,
        totalBytes: rows
          .filter((row) => row.category === category)
          .reduce((sum, row) => sum + (row.transferSize ?? 0), 0),
      })).filter((entry) => entry.count > 0),
    [rows],
  );

  const lifecycleCards = [
    {
      id: "preload" as const,
      label: "Preload",
      helper:
        summary.curtainLiftMs != null
          ? "Before curtain lift"
          : "Curtain not detected",
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
      label: "Full session",
      helper: "Entire captured session",
      stats: summary.lifecycleTotals?.full,
    },
  ];

  const modal = (
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="assets-modal-title"
      onClick={() => !fullListOpen && onClose()}
    >
      <div
        className="flex w-full max-w-6xl flex-col overflow-hidden rounded-t-[24px] border border-[var(--border)] bg-[var(--bg-card)] shadow-[0_30px_90px_rgba(0,0,0,0.45)] max-h-[min(94dvh,900px)] sm:max-h-[min(92dvh,880px)] sm:rounded-[28px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 border-b border-[var(--border)] bg-[radial-gradient(circle_at_top_left,rgba(167,139,250,0.18),transparent_38%),linear-gradient(180deg,rgba(255,255,255,0.02),transparent)] px-4 py-4 sm:px-6 sm:py-5">
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
                · {formatBytes(scopedSummary.totalBytes)} ·{" "}
                {scopedSummary.totalCount} files
                {summary.curtainLiftMs != null && (
                  <>
                    {" "}
                    ·{" "}
                    <span className="rounded-md bg-violet-500/25 px-2 py-0.5 font-semibold text-violet-100 ring-1 ring-violet-400/40">
                      Curtain lift at {(summary.curtainLiftMs / 1000).toFixed(2)}
                      s
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

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-b border-[var(--border)] px-3 py-2.5 sm:px-5 sm:py-3">
            <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-2.5 overflow-hidden sm:gap-3">
              <div className="grid shrink-0 grid-cols-3 gap-2 sm:gap-3">
                {lifecycleCards.map((card) => {
                  const active = phase === card.id;
                  const disabled =
                    card.id !== "full" && summary.curtainLiftMs == null;
                  return (
                    <button
                      key={card.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => setPhase(card.id)}
                      className={`rounded-xl border p-2.5 text-left transition sm:rounded-2xl sm:p-3 ${
                        active
                          ? "border-[var(--accent)]/50 bg-[var(--accent)]/10 shadow-[0_0_0_1px_rgba(167,139,250,0.12)]"
                          : "border-[var(--border)] bg-[var(--bg)]/35 hover:border-[var(--accent)]/25"
                      } ${disabled ? "cursor-not-allowed opacity-45" : ""}`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <div className="text-[11px] font-semibold leading-tight text-[var(--fg)] sm:text-sm">
                          {card.label}
                        </div>
                        <Layers3 className="h-3.5 w-3.5 shrink-0 text-[var(--accent)] sm:h-4 sm:w-4" />
                      </div>
                      <div className="mt-1.5 text-sm font-semibold tabular-nums text-[var(--accent)] sm:mt-2 sm:text-base">
                        {formatBytes(card.stats?.totalBytes ?? 0)}
                      </div>
                      <div className="mt-0.5 text-[10px] leading-snug text-[var(--fg-muted)] sm:text-xs">
                        {card.stats?.totalCount ?? 0} · {card.helper}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="flex shrink-0 flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg)]/25 p-2.5 sm:gap-3 sm:rounded-2xl sm:p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--fg-muted)]">
                    Scope
                  </span>
                  {(["all", "common", "game"] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setScope(s)}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                        scope === s
                          ? "bg-[var(--accent)] text-[var(--bg)]"
                          : "border border-[var(--border)] text-[var(--fg-muted)] hover:border-[var(--accent)]/40"
                      }`}
                    >
                      {s === "all" ? "All" : s === "common" ? "Common" : "Game"}
                    </button>
                  ))}
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
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--fg-muted)]">
                    Type
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
                    const c = phaseScopedFiles.filter(
                      (row) => row.category === cat,
                    ).length;
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
                        {ASSET_LABELS[cat]} ({c})
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="shrink-0 rounded-xl border border-[var(--border)] bg-[var(--bg)]/25 p-2.5 sm:rounded-2xl sm:p-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-[var(--fg)] sm:text-sm">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-rose-300 sm:h-4 sm:w-4" />
                  Duplicate images
                </div>
                {(summary.duplicates?.length ?? 0) > 0 ? (
                  <>
                    <p className="mt-0.5 text-[10px] text-[var(--fg-muted)] sm:text-xs">
                      Same URL fetched more than once (API / XHR excluded).
                    </p>
                    <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                      {(summary.duplicates ?? []).slice(0, 4).map((d) => (
                        <div
                          key={d.normalizedUrl}
                          className="rounded-lg border border-rose-500/25 bg-rose-500/8 p-2 sm:p-2.5"
                        >
                          <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-rose-200 sm:text-xs">
                            <span className="rounded-full bg-rose-500/20 px-1.5 py-0.5 font-semibold">
                              {d.count}x
                            </span>
                            <span>{formatBytes(d.totalBytes)}</span>
                          </div>
                          <div className="mt-1 line-clamp-2 break-all font-mono text-[9px] leading-snug text-rose-100/90 sm:text-[10px]">
                            {d.normalizedUrl}
                          </div>
                        </div>
                      ))}
                    </div>
                    {(summary.duplicates?.length ?? 0) > 4 && (
                      <p className="mt-1.5 text-[10px] text-[var(--fg-muted)]">
                        +{(summary.duplicates?.length ?? 0) - 4} more duplicate
                        URL
                        {(summary.duplicates?.length ?? 0) - 4 === 1 ? "" : "s"}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="mt-1 text-[10px] text-[var(--fg-muted)] sm:text-xs">
                    No duplicate image fetches detected.
                  </p>
                )}
              </div>

              <div className="grid min-h-0 shrink-0 grid-cols-2 gap-2 border-b border-[var(--border)] pb-2 sm:grid-cols-3 sm:gap-2.5 xl:grid-cols-4">
                {categoryStats.map((entry) => (
                  <div
                    key={entry.category}
                    className="rounded-xl border border-[var(--border)] bg-[var(--bg)]/45 p-2 sm:p-2.5"
                  >
                    <p className="text-[9px] uppercase tracking-wide text-[var(--fg-muted)] sm:text-[10px]">
                      {ASSET_LABELS[entry.category]}
                    </p>
                    <p className="mt-1 text-xs font-semibold tabular-nums text-[var(--fg)] sm:text-sm">
                      {entry.count} files
                    </p>
                    <p className="text-[10px] text-[var(--accent)] sm:text-xs">
                      {formatBytes(entry.totalBytes)}
                    </p>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setFullListOpen(true)}
                className="group mt-auto flex w-full shrink-0 items-center justify-center gap-2 rounded-xl border-2 border-[var(--accent)] bg-gradient-to-r from-violet-600 via-fuchsia-600 to-violet-600 px-3 py-3 text-xs font-bold text-white shadow-[0_10px_32px_-8px_rgba(139,92,246,0.45)] transition hover:brightness-110 active:scale-[0.99] sm:rounded-2xl sm:py-3.5 sm:text-sm"
              >
                <ListTree className="h-4 w-4 shrink-0 opacity-95 sm:h-5 sm:w-5" aria-hidden />
                <span className="min-w-0 flex-1 text-center">
                  Open file list
                  <span className="mt-0.5 block text-[10px] font-semibold text-white/90 sm:text-xs">
                    Uses current scope, phase &amp; type ·{" "}
                    <span className="tabular-nums">{rows.length}</span> files
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 transition group-hover:translate-x-0.5 sm:h-5 sm:w-5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(
    <Fragment>
      {modal}
      {fullListOpen && (
        <DownloadedFilesListModal
          summary={summary}
          formatBytes={formatBytes}
          initialRows={rows}
          onClose={() => setFullListOpen(false)}
        />
      )}
    </Fragment>,
    document.body,
  );
}

export default memo(DownloadedAssetsModal);
