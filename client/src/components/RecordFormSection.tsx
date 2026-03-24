import { Activity, ChevronDown, Cpu, Layers, Monitor } from "lucide-react";
import { memo, useCallback, useState } from "react";
import { toast } from "react-hot-toast";
import LiveMetricsPanel from "./LiveMetricsPanel";
import RecordButtons from "./RecordButtons";
import SystemStatusBanner from "./SystemStatusBanner";
import URLInput from "./URLInput";

type CpuThrottle = 1 | 4 | 6 | 20;

const isValidUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return ["http:", "https:"].includes(parsed.protocol);
  } catch {
    return false;
  }
};

type RecordFormSectionProps = {
  isRecording: boolean;
  isProcessing: boolean;
  streamUrl: string | null;
  onStart: (url: string, cpuThrottle: CpuThrottle) => void;
  onStop: () => void;
};

function RecordFormSectionInner({
  isRecording,
  isProcessing,
  streamUrl,
  onStart,
  onStop,
}: RecordFormSectionProps) {
  const [url, setUrl] = useState("https://gpu-vs-cpu-animations.vercel.app/");
  const [cpuThrottle, setCpuThrottle] = useState<CpuThrottle>(20);

  const handleStart = useCallback(() => {
    if (!isValidUrl(url)) {
      toast.error("Enter a valid URL starting with http:// or https://");
      return;
    }
    onStart(url, cpuThrottle);
  }, [url, cpuThrottle, onStart]);

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6 shadow-[var(--glow)]">
      <div className="flex flex-col gap-6">
        <SystemStatusBanner />
        <URLInput value={url} onChange={setUrl} />
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm font-medium text-[var(--fg)]">
            <Cpu className="h-4 w-4 text-[var(--accent)]" />
            CPU throttling (low-end device simulation)
          </label>
          <div className="relative w-full max-w-xs">
            <select
              value={cpuThrottle}
              onChange={(e) =>
                setCpuThrottle(Number(e.target.value) as CpuThrottle)
              }
              disabled={isRecording || isProcessing}
              className="w-full appearance-none rounded-xl border border-[var(--border)] bg-[var(--bg)] py-2.5 pl-4 pr-11 text-sm text-[var(--fg)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-dim)] focus:outline-none disabled:opacity-50"
            >
              <option value={1}>1× — No throttling</option>
              <option value={4}>4× — Slower CPU (e.g. low-end mobile)</option>
              <option value={6}>6× — Heavier throttle</option>
              <option value={20}>20× — Stress test (very slow CPU)</option>
            </select>
            <ChevronDown
              aria-hidden
              className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--fg-muted)]"
            />
          </div>
        </div>
        <label
          className="flex cursor-not-allowed items-center gap-2 text-sm text-[var(--fg)] opacity-60"
          title="Disabled for now"
        >
          <input
            type="checkbox"
            checked={false}
            onChange={() => {}}
            disabled
            className="h-4 w-4 rounded border-[var(--border)] text-[var(--accent)] focus:ring-[var(--accent)]"
          />
          <Layers className="h-4 w-4 text-[var(--accent)]" />
          <span>Track React re-renders</span>
          <span className="text-xs text-[var(--fg-muted)]">
            (disabled for now)
          </span>
        </label>
        <RecordButtons
          isRecording={isRecording}
          isProcessing={isProcessing}
          onStart={handleStart}
          onStop={onStop}
        />
        {streamUrl && (
          <a
            href={streamUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-400 transition hover:bg-emerald-500/20"
          >
            <Monitor className="h-4 w-4" />
            Open VNC stream to interact with browser
          </a>
        )}
        <div className="flex items-center gap-3 text-sm text-[var(--fg-muted)]">
          <span
            className={`h-2.5 w-2.5 rounded-full shadow-sm ${
              isRecording
                ? "bg-emerald-400 shadow-emerald-400/50"
                : "bg-[var(--fg-muted)]/40"
            }`}
          />
          {isRecording ? (
            <span className="flex items-center gap-2 font-medium text-emerald-400">
              <Activity className="h-4 w-4 animate-pulse" />
              Recording in progress…
            </span>
          ) : isProcessing ? (
            "Processing trace and generating report…"
          ) : (
            "Idle — paste a URL and launch to begin."
          )}
        </div>
        {isRecording && <LiveMetricsPanel isRecording={isRecording} />}
      </div>
    </section>
  );
}

export default memo(RecordFormSectionInner);
