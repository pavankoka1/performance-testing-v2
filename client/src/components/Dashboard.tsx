import { useRecording } from "@/hooks/useRecording";
import { useWebglBackgroundPreference } from "@/hooks/useWebglBackgroundPreference";
import { ShieldCheck, Sparkles } from "lucide-react";
import { useState } from "react";
import { Toaster } from "react-hot-toast";
import MetricHelpModal from "./MetricHelpModal";
import MetricsGlossary from "./MetricsGlossary";
import ProcessingLoader from "./ProcessingLoader";
import RecordFormSection from "./RecordFormSection";
import ReportViewer from "./ReportViewer";
import WebglBackground from "./WebglBackground";

export default function Dashboard() {
  const { isRecording, isProcessing, report, start, stop } = useRecording();
  const { enabled: webglBgEnabled, setEnabled: setWebglBgEnabled } =
    useWebglBackgroundPreference();
  const [helpModalMetricId, setHelpModalMetricId] = useState<string | null>(
    null
  );

  const sessionBusy = isRecording || isProcessing;

  return (
    <div className="relative min-h-screen text-[var(--fg)]">
      {/* Solid base so theme matches; WebGL draws above this (z-1), not behind parent bg. */}
      <div
        className="pointer-events-none fixed inset-0 z-0 bg-[var(--bg)]"
        aria-hidden
      />
      {webglBgEnabled && <WebglBackground active={!sessionBusy} />}
      <div className="relative z-10 min-h-screen">
        <Toaster
          position="top-right"
          toastOptions={{
            className: "!bg-[var(--bg-elevated)] !border-[var(--border)]",
          }}
        />
        <header className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--bg)]/90 backdrop-blur-xl">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.25em] text-[var(--fg-muted)]">
                Performance testing
              </p>
              <h1 className="text-2xl font-bold tracking-tight text-gradient sm:text-3xl">
                PerfTrace
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label
                title="Fullscreen WebGL2 shader behind the UI (GPU). Uses extra GPU when idle; automatically paused while recording/processing so traces stay representative."
                className="flex cursor-help items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-xs text-[var(--fg-muted)] transition hover:border-[var(--accent)]/30"
              >
                <input
                  type="checkbox"
                  checked={webglBgEnabled}
                  onChange={(e) => setWebglBgEnabled(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-[var(--border)] text-[var(--accent)] focus:ring-[var(--accent)]"
                  aria-label="Toggle WebGL background animation"
                />
                <Sparkles className="h-3.5 w-3.5 text-violet-400" aria-hidden />
                <span>WebGL background</span>
                {sessionBusy && webglBgEnabled && (
                  <span className="text-[10px] text-amber-400/90">
                    (paused)
                  </span>
                )}
              </label>
              <div className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg-card)] px-4 py-2 text-sm text-[var(--fg-muted)]">
                <ShieldCheck className="h-4 w-4 text-violet-400" />
                Chromium + Playwright
              </div>
            </div>
          </div>
        </header>

        <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-10">
          <RecordFormSection
            isRecording={isRecording}
            isProcessing={isProcessing}
            onStart={start}
            onStop={stop}
            encourageStart={report == null && !isRecording && !isProcessing}
          />

          <MetricsGlossary onOpenHelp={setHelpModalMetricId} />

          {isProcessing ? (
            <ProcessingLoader />
          ) : (
            <ReportViewer report={report} onOpenHelp={setHelpModalMetricId} />
          )}

          {helpModalMetricId && (
            <MetricHelpModal
              metricId={helpModalMetricId}
              onClose={() => setHelpModalMetricId(null)}
            />
          )}
        </main>
      </div>
    </div>
  );
}
