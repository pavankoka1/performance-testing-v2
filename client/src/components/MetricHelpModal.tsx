"use client";

import { getMetricById } from "@/lib/metricsGlossary";
import { X } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";

type MetricHelpModalProps = {
  metricId: string;
  onClose: () => void;
};

const sectionClass =
  "rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)]/60 p-3";

export default function MetricHelpModal({
  metricId,
  onClose,
}: MetricHelpModalProps) {
  const metric = getMetricById(metricId);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  if (!metric) return null;

  const Icon = metric.icon;

  const content = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="metric-help-title"
    >
      <div
        className="absolute inset-0 cursor-pointer bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClose();
          }
        }}
        role="button"
        tabIndex={0}
        aria-label="Close"
      />
      <div className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6 shadow-[var(--glow)]">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent)]/20">
              <Icon className="h-5 w-5 text-[var(--accent)]" />
            </div>
            <div>
              <h2
                id="metric-help-title"
                className="text-lg font-semibold text-[var(--fg)]"
              >
                {metric.name}
              </h2>
              <p className="text-sm text-[var(--fg-muted)]">{metric.what}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg p-2 text-[var(--fg-muted)] transition hover:bg-[var(--bg-elevated)] hover:text-[var(--fg)]"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-3">
          <div className={sectionClass}>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--accent)]">
              How to understand
            </h3>
            <p className="text-sm text-[var(--fg-muted)]">
              {metric.howToUnderstand}
            </p>
          </div>

          <div className={sectionClass}>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--accent)]">
              Target / acceptable values
            </h3>
            <p className="text-sm text-[var(--fg-muted)]">
              {metric.targetValue}
            </p>
          </div>

          <div className={sectionClass}>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--accent)]">
              Behind the hood
            </h3>
            <p className="text-sm text-[var(--fg-muted)]">
              {metric.behindTheHood}
            </p>
          </div>

          <div className={sectionClass}>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--accent)]">
              Why optimize
            </h3>
            <p className="text-sm text-[var(--fg-muted)]">
              {metric.whyOptimize}
            </p>
          </div>

          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-400">
              Mitigation tips
            </h3>
            <p className="text-sm text-[var(--fg-muted)]">{metric.mitigate}</p>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
