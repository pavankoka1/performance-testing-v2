import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "perftrace-webgl-background";

/** Default on; persisted in localStorage. */
export function useWebglBackgroundPreference() {
  const [enabled, setEnabledState] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem(STORAGE_KEY) !== "false";
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, enabled ? "true" : "false");
  }, [enabled]);

  const setEnabled = useCallback((value: boolean) => {
    setEnabledState(value);
  }, []);

  return { enabled, setEnabled };
}
