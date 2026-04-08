import { useCallback, useEffect, useState } from "react";

/** v2: default off; old key ignored so everyone starts without WebGL until they opt in. */
const STORAGE_KEY = "perftrace-webgl-background-v2";

/** Off by default; users enable via header toggle. Choice is persisted. */
export function useWebglBackgroundPreference() {
  const [enabled, setEnabledState] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(STORAGE_KEY) === "true";
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, enabled ? "true" : "false");
  }, [enabled]);

  const setEnabled = useCallback((value: boolean) => {
    setEnabledState(value);
  }, []);

  return { enabled, setEnabled };
}
