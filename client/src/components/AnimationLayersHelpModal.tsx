import { BookOpen, X } from "lucide-react";
import { memo, useEffect } from "react";
import { createPortal } from "react-dom";

type Props = {
  onClose: () => void;
};

function AnimationLayersHelpModal({ onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const modal = (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="anim-layers-title"
      onClick={onClose}
    >
      <div
        className="scrollbar-themed max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 shrink-0 text-[var(--accent)]" />
            <h2
              id="anim-layers-title"
              className="text-lg font-semibold text-[var(--fg)]"
            >
              Compositor vs paint vs layout
            </h2>
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
        <div className="space-y-4 px-5 py-4 text-sm leading-relaxed text-[var(--fg-muted)]">
          <p className="text-[var(--fg)]">
            Browsers render in <strong>stages</strong>. CSS animations target
            different stages — that&apos;s what the colors in the timeline mean.
          </p>

          <section>
            <h3 className="mb-1.5 font-semibold text-emerald-400">
              Compositor (green)
            </h3>
            <p>
              Changes that can run on the <strong>GPU compositor thread</strong>{" "}
              without recalculating layout or repainting pixels every frame —
              most often <code className="text-[var(--accent)]">transform</code>{" "}
              and <code className="text-[var(--accent)]">opacity</code>.
              Typically the cheapest path for smooth motion.
            </p>
          </section>

          <section>
            <h3 className="mb-1.5 font-semibold text-amber-400">
              Paint (amber)
            </h3>
            <p>
              <strong>Rasterization</strong>: colors, shadows, filters, rounded
              corners (
              <code className="text-[var(--accent)]">border-*-radius</code>
              ), backgrounds, outlines. The engine repaints affected regions;
              cost grows with area and effect complexity.
            </p>
          </section>

          <section>
            <h3 className="mb-1.5 font-semibold text-rose-400">Layout (red)</h3>
            <p>
              <strong>Reflow</strong>: geometry and text —{" "}
              <code className="text-[var(--accent)]">width</code>,{" "}
              <code className="text-[var(--accent)]">height</code>,{" "}
              <code className="text-[var(--accent)]">margin</code>,{" "}
              <code className="text-[var(--accent)]">padding</code>,{" "}
              <code className="text-[var(--accent)]">flex</code>/
              <code>grid</code>,{" "}
              <code className="text-[var(--accent)]">font-size</code>, etc.
              Usually the most expensive for main-thread animation.
            </p>
          </section>

          <p className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)]/60 p-3 text-xs">
            PerfTrace classifies each animated property using these rules.
            Metadata keys from the Web Animations API (e.g.{" "}
            <code className="text-[var(--accent)]">computedOffset</code>) are
            stripped — they are not CSS properties. When transitions omit
            property lists, we infer from the animation name (e.g.{" "}
            <code className="text-[var(--accent)]">box-shadow</code>,{" "}
            <code className="text-[var(--accent)]">
              border-bottom-left-radius
            </code>
            ).
          </p>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(modal, document.body);
}

export default memo(AnimationLayersHelpModal);
