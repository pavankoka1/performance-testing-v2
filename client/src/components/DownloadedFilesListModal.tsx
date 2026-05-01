import type {
  AssetCategory,
  DownloadedAssetsSummary,
} from "@/lib/reportTypes";
import {
  ASSET_LABELS,
  CATEGORY_ORDER,
  type FileRow,
  getDisplayName,
  getHostName,
} from "@/components/downloadedAssetsUi";
import { ArrowDownWideNarrow, Clock3, ListFilter, Search, X } from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type Props = {
  summary: DownloadedAssetsSummary;
  formatBytes: (n: number) => string;
  /** Subset from browse modal: scope + lifecycle phase + type filter */
  initialRows: FileRow[];
  onClose: () => void;
};

type SortKey = "time" | "size" | "name" | "category";

/** Table for the current browse selection only (search / sort / type refine). */
function DownloadedFilesListModal({
  summary,
  formatBytes,
  initialRows,
  onClose,
}: Props) {
  const [filter, setFilter] = useState<AssetCategory | "all">("all");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("time");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const searchLc = search.trim().toLowerCase();
  const rows = useMemo(() => {
    const categoryFiltered =
      filter === "all"
        ? initialRows
        : initialRows.filter((r) => r.category === filter);
    let list = categoryFiltered;
    if (searchLc) {
      list = list.filter((r) => {
        const name = getDisplayName(r.url).toLowerCase();
        return (
          r.url.toLowerCase().includes(searchLc) ||
          name.includes(searchLc) ||
          getHostName(r.url).toLowerCase().includes(searchLc)
        );
      });
    }
    const sorted = [...list];
    sorted.sort((a, b) => {
      if (sortKey === "size") {
        return (b.transferSize ?? 0) - (a.transferSize ?? 0);
      }
      if (sortKey === "name") {
        return getDisplayName(a.url).localeCompare(getDisplayName(b.url));
      }
      if (sortKey === "category") {
        return ASSET_LABELS[a.category].localeCompare(ASSET_LABELS[b.category]);
      }
      const ta =
        a.lifecycleAtMs ?? a.endTimeMs ?? Number.POSITIVE_INFINITY;
      const tb =
        b.lifecycleAtMs ?? b.endTimeMs ?? Number.POSITIVE_INFINITY;
      return ta - tb;
    });
    return sorted;
  }, [initialRows, filter, searchLc, sortKey]);

  const selectionBytes = useMemo(
    () => initialRows.reduce((s, r) => s + (r.transferSize ?? 0), 0),
    [initialRows],
  );

  const modal = (
    <div
      className="fixed inset-0 z-[201] flex items-end justify-center bg-black/70 backdrop-blur-md sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="file-list-modal-title"
      onClick={onClose}
    >
      <div
        className="flex h-[min(96dvh,920px)] max-h-[96vh] w-full max-w-5xl flex-col overflow-hidden rounded-t-[20px] border border-[var(--border)] bg-[var(--bg-card)] shadow-[0_32px_120px_rgba(0,0,0,0.55)] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="shrink-0 border-b border-[var(--border)] px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2
                id="file-list-modal-title"
                className="text-lg font-bold text-[var(--fg)] sm:text-xl"
              >
                Selected files
              </h2>
              <p className="mt-1 text-xs text-[var(--fg-muted)]">
                <span className="tabular-nums font-medium text-violet-200">
                  {formatBytes(selectionBytes)}
                </span>
                {" · "}
                <span className="tabular-nums">{initialRows.length}</span>{" "}
                in browse selection
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-xl border border-[var(--border)] p-2 text-[var(--fg-muted)] transition hover:bg-[var(--bg-elevated)] hover:text-[var(--fg)]"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
              <div className="relative min-w-0 flex-1 sm:max-w-md">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--accent)]" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search URL, file name, or host…"
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg)]/80 py-2.5 pl-10 pr-3 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)]/55 focus:ring-2 focus:ring-[var(--accent)]/25"
                  aria-label="Search files"
                />
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <ListFilter className="h-4 w-4 text-[var(--fg-muted)]" />
                <select
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value as SortKey)}
                  className="rounded-xl border border-[var(--border)] bg-[var(--bg)]/80 px-3 py-2 text-xs font-medium text-[var(--fg)] outline-none focus:border-[var(--accent)]/55"
                  aria-label="Sort"
                >
                  <option value="time">Sort: timeline</option>
                  <option value="size">Sort: largest first</option>
                  <option value="name">Sort: file name</option>
                  <option value="category">Sort: category</option>
                </select>
              </div>
            </div>
            <p className="text-[11px] text-[var(--fg-muted)]">
              Showing{" "}
              <span className="tabular-nums text-[var(--fg)]">{rows.length}</span>{" "}
              rows
            </p>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--fg-muted)]">
              Filter type
            </span>
            <button
              type="button"
              onClick={() => setFilter("all")}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                filter === "all"
                  ? "bg-[var(--accent)] text-[var(--bg)]"
                  : "border border-[var(--border)] text-[var(--fg-muted)] hover:border-[var(--accent)]/40"
              }`}
            >
              All
            </button>
            {CATEGORY_ORDER.map((cat) => {
              const c = initialRows.filter((r) => r.category === cat).length;
              if (c === 0) return null;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setFilter(cat)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
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
        </header>

        <div className="scrollbar-themed min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[var(--bg)]/15 px-3 py-3 sm:px-4">
          <div className="overflow-x-auto rounded-xl border border-[var(--border)]/80 bg-[var(--bg-card)]/95">
            <table className="w-full min-w-[720px] text-left text-xs sm:text-sm">
              <thead className="sticky top-0 z-[1] border-b border-[var(--border)] bg-[var(--bg-card)] text-[var(--fg-muted)]">
                <tr>
                  <th className="px-3 py-3 pl-4 font-semibold sm:px-4">
                    <span className="inline-flex items-center gap-1">
                      <ArrowDownWideNarrow className="h-3.5 w-3.5 opacity-70" />
                      Type
                    </span>
                  </th>
                  <th className="px-3 py-3 font-semibold sm:px-4">
                    File / endpoint
                  </th>
                  <th className="px-3 py-3 font-semibold sm:px-4">Source</th>
                  <th className="px-3 py-3 font-semibold sm:px-4">Phase</th>
                  <th className="px-3 py-3 font-semibold sm:px-4">Size</th>
                  <th className="px-3 py-3 pr-4 font-semibold sm:px-4">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]/70 text-[var(--fg-muted)]">
                {rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-12 text-center text-sm text-[var(--fg-muted)]"
                    >
                      No files match filters or search.
                    </td>
                  </tr>
                ) : (
                  rows.map((r, i) => (
                    <tr
                      key={`${r.url}-${i}`}
                      className="align-top transition hover:bg-[color-mix(in_oklab,var(--accent)_8%,transparent)]"
                    >
                      <td className="whitespace-nowrap px-3 py-2.5 pl-4 font-medium text-[var(--fg)] sm:px-4 sm:py-3">
                        {ASSET_LABELS[r.category]}
                      </td>
                      <td className="px-3 py-2.5 sm:px-4 sm:py-3">
                        <div className="min-w-[200px] max-w-[min(420px,40vw)]">
                          <div className="truncate font-medium text-[var(--fg)]">
                            {getDisplayName(r.url)}
                          </div>
                          <div className="mt-0.5 break-all font-mono text-[10px] leading-relaxed text-[var(--fg-muted)]/90 sm:text-[11px]">
                            {r.url}
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 sm:px-4 sm:py-3">
                        {getHostName(r.url)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 sm:px-4 sm:py-3">
                        <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--bg)]/50 px-2 py-1 text-[10px] font-medium">
                          <Clock3 className="h-3 w-3 opacity-80" />
                          {summary.curtainLiftMs == null
                            ? "Full"
                            : (r.lifecycleAtMs ??
                                  r.endTimeMs ??
                                  Number.POSITIVE_INFINITY) <=
                                summary.curtainLiftMs
                              ? "Preload"
                              : "Post-load"}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 tabular-nums sm:px-4 sm:py-3">
                        {formatBytes(r.transferSize ?? 0)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 pr-4 tabular-nums sm:px-4 sm:py-3">
                        {r.lifecycleAtMs != null
                          ? `${(r.lifecycleAtMs / 1000).toFixed(2)} s`
                          : r.endTimeMs != null
                            ? `${(r.endTimeMs / 1000).toFixed(2)} s`
                            : r.durationMs != null
                              ? `${r.durationMs.toFixed(0)} ms`
                              : "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(modal, document.body);
}

export default memo(DownloadedFilesListModal);
