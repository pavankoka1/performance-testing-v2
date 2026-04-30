# Metric Thresholds

PerfTrace health cutoffs now live in one config file:

- `client/src/lib/metricThresholds.ts`

That file is the source of truth for the traffic-light thresholds used by the
report UI.

## Where Thresholds Are Used

- `client/src/lib/metricHealth.ts`
  Turns raw metric values into `good`, `warn`, or `bad`.

- `client/src/lib/metricsGlossary.ts`
  Reuses the same threshold config when describing target values in the help
  content.

## Current Threshold Config

```ts
export const METRIC_THRESHOLDS = {
  fps: { goodMin: 55, warnMin: 45 },
  cpu: { goodMax: 45, warnMax: 72 },
  gpu: { goodMax: 55, warnMax: 82 },
  heapMb: { goodMax: 80, warnMax: 180 },
  domNodes: { goodMax: 2500, warnMax: 7000 },
  tbtMs: { goodMax: 200, warnMax: 600 },
  cls: { goodMax: 0.1, warnMax: 0.25 },
  paintMs: { goodMax: 120, warnMax: 400 },
  latencyMs: { goodMax: 250, warnMax: 900 },
  fcpMs: { goodMax: 1800, warnMax: 3000 },
  lcpMs: { goodMax: 2500, warnMax: 4000 },
};
```

## How To Change A Threshold

Example: make FPS stricter.

1. Open `client/src/lib/metricThresholds.ts`
2. Change:

```ts
fps: { goodMin: 55, warnMin: 45 }
```

to:

```ts
fps: { goodMin: 58, warnMin: 50 }
```

3. Rebuild or restart the app.

The report cards and glossary text will both follow the new values.

## Metric Interpretation

- `goodMin` / `warnMin`
  Used for metrics where higher is better, such as FPS.

- `goodMax` / `warnMax`
  Used for metrics where lower is better, such as CPU, TBT, FCP, and CLS.

## Important Scope Note

These are UI/report thresholds, not capture-engine math. They do **not** change
how the browser metrics are collected. They only change how PerfTrace labels the
results and explains the target ranges.
