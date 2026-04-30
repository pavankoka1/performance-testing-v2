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
  return "full";
}

