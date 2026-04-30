export type MetricBand = {
  goodMax?: number;
  warnMax?: number;
  goodMin?: number;
  warnMin?: number;
};

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
} as const satisfies Record<string, MetricBand>;

export function describeMaxThresholds(
  band: MetricBand,
  unit: string,
  zeroIsGood = false
) {
  const goodText =
    band.goodMax == null ? "" : `${zeroIsGood ? "<= " : "< "}${band.goodMax}${unit}`;
  const warnText =
    band.goodMax == null || band.warnMax == null
      ? ""
      : `${band.goodMax}${unit}-${band.warnMax}${unit}`;
  const badText =
    band.warnMax == null ? "" : `${zeroIsGood ? "> " : ">= "}${band.warnMax}${unit}`;
  return { goodText, warnText, badText };
}

export function describeMinThresholds(band: MetricBand, unit: string) {
  const goodText = band.goodMin == null ? "" : `>= ${band.goodMin}${unit}`;
  const warnText =
    band.goodMin == null || band.warnMin == null
      ? ""
      : `${band.warnMin}${unit}-${band.goodMin}${unit}`;
  const badText = band.warnMin == null ? "" : `< ${band.warnMin}${unit}`;
  return { goodText, warnText, badText };
}
