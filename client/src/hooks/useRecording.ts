import type { PerfReport } from "@/lib/reportTypes";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "react-hot-toast";

type CpuThrottle = 1 | 4 | 6 | 20;

export type RecordingStartOptions = {
  /** Default true. Disable for long sessions to avoid Playwright video issues. */
  recordVideo?: boolean;
  trackReactRerenders?: boolean;
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
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const stopAbortRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      stopAbortRef.current?.abort();
    },
    []
  );

  const start = useCallback(
    async (
      url: string,
      cpuThrottle: CpuThrottle,
      options?: RecordingStartOptions
    ) => {
      setIsRecording(true);
      setReport(null);
      setStreamUrl(null);

      try {
        const response = await fetch("/api/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url,
            cpuThrottle,
            trackReactRerenders: !!options?.trackReactRerenders,
            recordVideo: options?.recordVideo !== false,
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
        if (data.streamUrl) {
          setStreamUrl(data.streamUrl as string);
          toast.success(
            "Recording started. Open the VNC stream to interact with the browser."
          );
        } else {
          toast.success("Recording started. Browser session is active.");
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unable to start recording.";
        toast.error(message);
        setIsRecording(false);
      }
    },
    []
  );

  const stop = useCallback(async () => {
    setIsRecording(false);
    setStreamUrl(null);
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

  return { isRecording, isProcessing, report, streamUrl, start, stop };
}
