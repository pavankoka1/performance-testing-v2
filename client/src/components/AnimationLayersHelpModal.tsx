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
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="anim-layers-title"
      onClick={onClose}
    >
      <div
        className="scrollbar-themed max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-violet-500/35 bg-gradient-to-b from-[#14141c] to-[var(--bg-card)] shadow-[0_24px_80px_rgba(0,0,0,0.65)] ring-1 ring-violet-500/20"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-violet-500/25 bg-violet-950/30 px-6 py-5">
          <div className="flex items-center gap-3">
            <BookOpen className="h-6 w-6 shrink-0 text-violet-300" />
            <h2
              id="anim-layers-title"
              className="text-xl font-bold tracking-tight text-[var(--fg)]"
            >
              Compositor vs paint vs layout
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-zinc-400 transition hover:bg-white/10 hover:text-white"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-6 px-6 py-6 text-base leading-relaxed text-zinc-300">
          <p className="text-[17px] font-medium text-zinc-100">
            Browsers render in <strong className="text-white">stages</strong>.
            CSS animations target different stages — that&apos;s what the colors
            in the timeline mean.
          </p>

          <section className="rounded-xl border border-emerald-500/25 bg-emerald-950/40 p-5">
            <h3 className="mb-2 text-lg font-bold text-emerald-300">
              Compositor (green)
            </h3>
            <p className="text-[15px] text-zinc-200">
              Changes that can run on the{" "}
              <strong className="text-white">GPU compositor thread</strong>{" "}
              without recalculating layout or repainting pixels every frame —
              most often{" "}
              <code className="rounded bg-emerald-950/80 px-1.5 py-0.5 text-sm text-emerald-200">
                transform
              </code>{" "}
              and{" "}
              <code className="rounded bg-emerald-950/80 px-1.5 py-0.5 text-sm text-emerald-200">
                opacity
              </code>
              . Typically the cheapest path for smooth motion.
            </p>
          </section>

          <section className="rounded-xl border border-amber-500/30 bg-amber-950/35 p-5">
            <h3 className="mb-2 text-lg font-bold text-amber-300">
              Paint (amber)
            </h3>
            <p className="text-[15px] text-zinc-200">
              <strong className="text-white">Rasterization</strong>: colors,
              shadows, filters, rounded corners (
              <code className="rounded bg-amber-950/80 px-1.5 py-0.5 text-sm text-amber-100">
                border-*-radius
              </code>
              ), backgrounds, outlines. The engine repaints affected regions;
              cost grows with area and effect complexity.
            </p>
          </section>

          <section className="rounded-xl border border-rose-500/30 bg-rose-950/35 p-5">
            <h3 className="mb-2 text-lg font-bold text-rose-300">Layout (red)</h3>
            <p className="text-[15px] text-zinc-200">
              <strong className="text-white">Reflow</strong>: geometry and text
              — width, height, margin, padding, flex/grid, font-size, etc.
              Usually the most expensive for main-thread animation.
            </p>
          </section>

          <p className="rounded-xl border border-violet-500/25 bg-violet-950/40 p-4 text-sm leading-relaxed text-zinc-300">
            PerfTrace classifies each animated property using these rules.
            Metadata keys from the Web Animations API (e.g.{" "}
            <code className="text-violet-200">computedOffset</code>) are
            stripped — they are not CSS properties. When transitions omit
            property lists, we infer from the animation name.
          </p>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(modal, document.body);
}

export default memo(AnimationLayersHelpModal);
