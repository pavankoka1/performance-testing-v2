export type TraceDetail = "light" | "full";

export function isElectronRenderer(): boolean {
  try {
    const w = window as unknown as { perftrace?: { isElectron?: boolean } };
    return w.perftrace?.isElectron === true;
  } catch {
    return false;
  }
}

export function defaultTraceDetail(): TraceDetail {
  // Packaged Electron builds are more resource-constrained (Electron UI + Playwright Chromium).
  // Default to "light" to keep interactions smooth on weaker laptops.
  return isElectronRenderer() ? "light" : "full";
}

