import { AlertTriangle, Cpu, HardDrive, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type SystemStatus = {
  cpuPercent: number | null;
  memoryPercent: number | null;
  memoryUsedMb: number | null;
  memoryTotalMb: number | null;
  isHighLoad: boolean;
  isHighCpu: boolean;
  isHighMemory: boolean;
  suggestion: string | null;
  error?: string;
};

export default function SystemStatusBanner() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/system-status");
      const data = await res.json();
      setStatus(data);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 10000); // Refresh every 10s
    return () => clearInterval(interval);
  }, [fetchStatus]);

  if (loading && !status) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3 text-sm text-[var(--fg-muted)]">
        Checking system status…
      </div>
    );
  }

  if (!status || status.error) {
    return null;
  }

  const { cpuPercent, memoryPercent, isHighLoad, suggestion } = status;

  return (
    <div
      className={`rounded-xl border px-4 py-3 ${
        isHighLoad
          ? "border-amber-500/50 bg-amber-500/10"
          : "border-[var(--border)] bg-[var(--bg-card)]"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2 text-sm">
            <Cpu className="h-4 w-4 text-[var(--fg-muted)]" />
            <span className="text-[var(--fg-muted)]">Machine CPU:</span>
            <span
              className={
                status.isHighCpu
                  ? "font-semibold text-amber-400"
                  : "text-[var(--fg)]"
              }
            >
              {cpuPercent != null ? `${cpuPercent}%` : "—"}
            </span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <HardDrive className="h-4 w-4 text-[var(--fg-muted)]" />
            <span className="text-[var(--fg-muted)]">Machine memory:</span>
            <span
              className={
                status.isHighMemory
                  ? "font-semibold text-amber-400"
                  : "text-[var(--fg)]"
              }
            >
              {memoryPercent != null ? `${memoryPercent}%` : "—"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isHighLoad && (
            <div className="flex items-center gap-2 text-amber-400">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span className="text-sm font-medium">
                {suggestion ||
                  "Machine CPU or memory is high — metrics may be inaccurate."}
              </span>
            </div>
          )}
          <button
            type="button"
            onClick={fetchStatus}
            disabled={loading}
            className="rounded-lg p-1.5 text-[var(--fg-muted)] transition hover:bg-[var(--bg-elevated)] hover:text-[var(--fg)] disabled:opacity-50"
            title="Refresh system status"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>
      {isHighLoad && (
        <p className="mt-2 text-xs text-amber-400/90">
          High machine CPU skews recorded metrics. Close other apps before
          recording for accurate FPS, CPU, and timing data.
        </p>
      )}
    </div>
  );
}
