import { useRecording } from "@/hooks/useRecording";
import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Toaster } from "react-hot-toast";
import MetricHelpModal from "./MetricHelpModal";
import MetricsGlossary from "./MetricsGlossary";
import ProcessingLoader from "./ProcessingLoader";
import RecordFormSection from "./RecordFormSection";
import ReportViewer from "./ReportViewer";

export default function Dashboard() {
  const { isRecording, isProcessing, report, streamUrl, start, stop } =
    useRecording();
  const [helpModalMetricId, setHelpModalMetricId] = useState<string | null>(
    null
  );

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--fg)]">
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
          <div className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg-card)] px-4 py-2 text-sm text-[var(--fg-muted)]">
            <ShieldCheck className="h-4 w-4 text-violet-400" />
            Chromium + Playwright + VNC
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-10">
        <RecordFormSection
          isRecording={isRecording}
          isProcessing={isProcessing}
          streamUrl={streamUrl}
          onStart={start}
          onStop={stop}
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
  );
}
