import type {
  AssetCategory,
  DownloadedAsset,
  DownloadedAssetsSummary,
} from "@/lib/reportTypes";
import { X } from "lucide-react";
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
  build: "Build (main HTML)",
  script: "Scripts",
  stylesheet: "Stylesheets",
  document: "Documents",
  json: "API / fetch",
  image: "Images",
  font: "Fonts",
  other: "Other",
};

type Props = {
  summary: DownloadedAssetsSummary;
  formatBytes: (n: number) => string;
  onClose: () => void;
};

function DownloadedAssetsModal({ summary, formatBytes, onClose }: Props) {
  const [filter, setFilter] = useState<AssetCategory | "all">("all");
  const [scope, setScope] = useState<"all" | "common" | "game">("all");

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

  const rows = useMemo(() => {
    const out: Array<DownloadedAsset & { category: AssetCategory }> = [];
    for (const cat of CATEGORY_ORDER) {
      const bucket = scopedSummary.byCategory[cat];
      if (!bucket?.files?.length) continue;
      for (const f of bucket.files) {
        out.push({ ...f, category: cat });
      }
    }
    if (filter === "all") return out;
    return out.filter((r) => r.category === filter);
  }, [scopedSummary, filter]);

  const modal = (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="assets-modal-title"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
          <div>
            <h2
              id="assets-modal-title"
              className="text-lg font-semibold text-[var(--fg)]"
            >
              Downloaded assets
            </h2>
            <p className="text-xs text-[var(--fg-muted)]">
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
              {summary.initialLoadBytes != null && scope === "all" && (
                <> · Initial load ~{formatBytes(summary.initialLoadBytes)}</>
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
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-5 py-3">
          <div className="flex flex-wrap gap-2">
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
          <button
            type="button"
            onClick={() => setFilter("all")}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              filter === "all"
                ? "bg-[var(--accent)] text-[var(--bg)]"
                : "border border-[var(--border)] text-[var(--fg-muted)] hover:border-[var(--accent)]/40"
            }`}
          >
            All
          </button>
          {CATEGORY_ORDER.map((cat) => {
            const c = scopedSummary.byCategory[cat]?.count ?? 0;
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
        {(summary.duplicates?.length ?? 0) > 0 && scope === "all" && (
          <div className="border-b border-[var(--border)] px-5 py-3">
            <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3">
              <p className="text-sm font-medium text-rose-300">
                Duplicate assets detected
              </p>
              <p className="mt-1 text-xs text-[var(--fg-muted)]">
                Same URL downloaded multiple times (query stripped). Top items:
              </p>
              <ul className="mt-2 space-y-1 text-xs">
                {(summary.duplicates ?? []).slice(0, 6).map((d) => (
                  <li key={d.normalizedUrl} className="text-rose-200/90">
                    {d.count}× · {formatBytes(d.totalBytes)} ·{" "}
                    <span className="font-mono">{d.normalizedUrl}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
        <div className="scrollbar-themed min-h-0 flex-1 overflow-y-auto px-5 py-3">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-[var(--bg-card)] text-[var(--fg-muted)]">
              <tr>
                <th className="pb-2 pr-2 font-medium">Category</th>
                <th className="pb-2 pr-2 font-medium">Size</th>
                <th className="pb-2 pr-2 font-medium">Time</th>
                <th className="pb-2 font-medium">URL</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]/60 text-[var(--fg-muted)]">
              {rows.map((r, i) => (
                <tr key={`${r.url}-${i}`} className="align-top">
                  <td className="py-2 pr-2 whitespace-nowrap text-[var(--fg)]">
                    {LABELS[r.category]}
                  </td>
                  <td className="py-2 pr-2 whitespace-nowrap">
                    {formatBytes(r.transferSize ?? 0)}
                  </td>
                  <td className="py-2 pr-2 whitespace-nowrap">
                    {r.durationMs != null
                      ? `${r.durationMs.toFixed(0)} ms`
                      : "—"}
                  </td>
                  <td className="py-2 break-all font-mono text-[10px] text-[var(--accent)]/90">
                    {r.url}
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
