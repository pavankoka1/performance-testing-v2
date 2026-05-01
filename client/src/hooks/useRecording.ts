import type { PerfReport } from "@/lib/reportTypes";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "react-hot-toast";

type CpuThrottle = 1 | 4 | 6 | 20;
export type TraceDetail = "light" | "full";

/** Must match server `NETWORK_PRESETS` keys in capture.js */
export type NetworkThrottlePreset =
  | "none"
  | "slow-3g"
  | "fast-3g"
  | "4g";

export type AutomationGameId = string;

export type AutomationStartPayload = {
  enabled: true;
  gameId: AutomationGameId;
  rounds: 1 | 3 | 5 | 10;
  casinoUser?: string;
  casinoPass?: string;
  /** When true, `url` must be the direct game URL (skips login + lobby). */
  skipLobby?: boolean;
};

export type RecordingStartOptions = {
  /** Defaults to true in the UI. */
  recordVideo?: boolean;
  /** Recording resolution preset (impacts CPU). */
  videoQuality?: "low" | "high";
  /** Comma-separated keys; URLs containing any key count as "game" assets. */
  assetGameKeys?: string[];
  /** Tracing detail: "light" is lower overhead. */
  traceDetail?: TraceDetail;
  /** Pragmatic Live: login → lobby → game → N rounds; server stops trace when done. */
  automation?: AutomationStartPayload;
  /** desktop = maximized Chromium; portrait / mobileLandscape = fixed mobile window (server presets). */
  layoutMode?: "desktop" | "portrait" | "mobileLandscape" | "landscape";
  /**
   * Manual SPA: start preload/network baseline when the visible tab URL contains this string.
   * Ignored if `assetBaselineUrlRegex` is set.
   */
  assetBaselineUrlContains?: string;
  /** Manual SPA: baseline when the URL matches this pattern (wins over contains). */
  assetBaselineUrlRegex?: string;
  /** Regex flags for `assetBaselineUrlRegex` (default `i`). */
  assetBaselineUrlRegexFlags?: string;
};

const readJsonResponse = async (response: Response) => {
  const text = await response.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { error: text || "Unexpected response from server." };
  }
};

export function useRecording() {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [report, setReport] = useState<PerfReport | null>(null);
  const stopAbortRef = useRef<AbortController | null>(null);
  const automationPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearAutomationPoll = useCallback(() => {
    if (automationPollRef.current) {
      clearInterval(automationPollRef.current);
      automationPollRef.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      stopAbortRef.current?.abort();
      clearAutomationPoll();
    },
    [clearAutomationPoll]
  );

  const start = useCallback(
    async (
      url: string,
      cpuThrottle: CpuThrottle,
      networkThrottle: NetworkThrottlePreset,
      options?: RecordingStartOptions
    ) => {
      clearAutomationPoll();
      setIsRecording(true);
      setReport(null);

      try {
        const automationBody =
          options?.automation?.enabled === true
            ? (() => {
                const r = Number(options.automation.rounds);
                const allowed = [1, 3, 5, 10] as const;
                const rounds = allowed.includes(r as (typeof allowed)[number])
                  ? (r as (typeof allowed)[number])
                  : 1;
                const u = options.automation.casinoUser?.trim();
                const p = options.automation.casinoPass?.trim();
                return {
                  enabled: true,
                  gameId: options.automation.gameId,
                  rounds,
                  casinoUser: u ? u : undefined,
                  casinoPass: p ? p : undefined,
                  skipLobby:
                    options.automation.skipLobby === true ? true : undefined,
                };
              })()
            : undefined;

        const netPresets: NetworkThrottlePreset[] = [
          "none",
          "slow-3g",
          "fast-3g",
          "4g",
        ];
        const netOk = netPresets.includes(networkThrottle)
          ? networkThrottle
          : "none";

        const response = await fetch("/api/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url,
            cpuThrottle,
            networkThrottle: netOk,
            recordVideo: options?.recordVideo !== false,
            videoQuality: options?.videoQuality ?? "high",
            traceDetail: options?.traceDetail ?? "full",
            assetGameKeys: options?.assetGameKeys ?? [],
            automation: automationBody,
            layoutMode:
              options?.layoutMode === "landscape"
                ? "desktop"
                : (options?.layoutMode ?? "desktop"),
            ...(typeof options?.assetBaselineUrlRegex === "string" &&
            options.assetBaselineUrlRegex.trim()
              ? {
                  assetBaselineUrlRegex: options.assetBaselineUrlRegex.trim(),
                  assetBaselineUrlRegexFlags:
                    typeof options.assetBaselineUrlRegexFlags === "string"
                      ? options.assetBaselineUrlRegexFlags
                      : "i",
                }
              : typeof options?.assetBaselineUrlContains === "string" &&
                  options.assetBaselineUrlContains.trim()
                ? {
                    assetBaselineUrlContains:
                      options.assetBaselineUrlContains.trim(),
                  }
                : {}),
          }),
        });
        const data = await readJsonResponse(response);
        if (!response.ok) {
          throw new Error(
            typeof data.error === "string"
              ? data.error
              : "Failed to start recording."
          );
        }
        const auto = data.automation as { enabled?: boolean } | undefined;
        if (auto?.enabled) {
          toast.success(
            "Automated script running — report appears when rounds complete."
          );
        } else {
          toast.success("Recording started. Browser session is active.");
        }

        if (auto?.enabled) {
          automationPollRef.current = setInterval(async () => {
            try {
              const sessionRes = await fetch("/api/session");
              const s = await readJsonResponse(sessionRes);
              if (s.processing) {
                setIsProcessing(true);
                setIsRecording(false);
              }
              if (s.report) {
                clearAutomationPoll();
                setReport(s.report as PerfReport);
                setIsRecording(false);
                setIsProcessing(false);
                const errMsg =
                  typeof s.error === "string" ? s.error : undefined;
                if (errMsg) {
                  toast.error(`Automation issue: ${errMsg}`);
                }
                toast.success("Trace processed. Report ready.");
              } else if (
                !s.recording &&
                !s.processing &&
                typeof s.error === "string" &&
                s.error
              ) {
                clearAutomationPoll();
                setIsRecording(false);
                setIsProcessing(false);
                toast.error(s.error);
              }
            } catch {
              /* keep polling */
            }
          }, 1200);
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unable to start recording.";
        toast.error(message);
        setIsRecording(false);
      }
    },
    [clearAutomationPoll]
  );

  const stop = useCallback(async () => {
    clearAutomationPoll();
    setIsRecording(false);
    setIsProcessing(true);
    stopAbortRef.current?.abort();
    const controller = new AbortController();
    stopAbortRef.current = controller;
    const timeoutId = setTimeout(() => controller.abort(), 120_000);

    try {
      const response = await fetch("/api/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const data = await readJsonResponse(response);
      if (!response.ok) {
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : "Failed to stop recording."
        );
      }
      setReport(data.report as PerfReport);
      toast.success("Trace processed. Report ready.");
    } catch (error) {
      const isAbort = error instanceof Error && error.name === "AbortError";
      const message = isAbort
        ? "Processing timed out. Try a shorter session or check server load."
        : error instanceof Error
          ? error.message
          : "Unable to stop recording.";
      toast.error(message);
    } finally {
      clearTimeout(timeoutId);
      stopAbortRef.current = null;
      setIsProcessing(false);
    }
  }, []);

  return { isRecording, isProcessing, report, start, stop };
}
