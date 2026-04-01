import type { TbtTimelineEntry } from "@/lib/reportTypes";

export type TbtChartDimensions = {
  width: number;
  height: number;
  padL: number;
  padR: number;
  padT: number;
  padB: number;
  plotW: number;
  plotH: number;
  maxBlocking: number;
  span: number;
};

export function computeTbtChartLayout(
  entries: TbtTimelineEntry[],
  durationSec: number
): TbtChartDimensions {
  const span = Math.max(durationSec, 0.001);
  const maxBlocking =
    entries.length === 0 ? 1 : Math.max(...entries.map((e) => e.blockingMs), 1);
  const width = 720;
  const height = 220;
  const padL = 44;
  const padR = 12;
  const padT = 16;
  const padB = 36;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  return {
    width,
    height,
    padL,
    padR,
    padT,
    padB,
    plotW,
    plotH,
    maxBlocking,
    span,
  };
}

/** Inline SVG string for HTML export (standalone file). */
export function buildTbtSvgString(
  entries: TbtTimelineEntry[],
  durationSec: number
): string {
  if (entries.length === 0) {
    return `<p class="muted">No blocking segments in timeline.</p>`;
  }
  const L = computeTbtChartLayout(entries, durationSec);
  const { width, height, padL, padT, plotW, plotH, maxBlocking, span } = L;
  const plotBottom = padT + plotH;
  const gridLines = 4;
  let rects = "";
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const x1 = padL + (e.startSec / span) * plotW;
    const x2 = padL + (e.endSec / span) * plotW;
    const bw = Math.max(2, x2 - x1);
    const bh = (e.blockingMs / maxBlocking) * plotH;
    const y = plotBottom - bh;
    const title = `${e.blockingMs.toFixed(0)}ms blocking · ${e.durationMs.toFixed(0)}ms total @ ${e.startSec.toFixed(2)}s — ${escapeAttr(e.attribution ?? "")}`;
    rects += `<rect x="${x1.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" fill="url(#tbtGrad)" rx="2" stroke="rgba(251,113,133,0.5)" stroke-width="0.5"><title>${title}</title></rect>`;
  }
  let hGrid = "";
  for (let g = 0; g <= gridLines; g++) {
    const y = padT + (g / gridLines) * plotH;
    const val = maxBlocking * (1 - g / gridLines);
    hGrid += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${padL + plotW}" y2="${y.toFixed(1)}" stroke="rgba(255,255,255,0.06)"/>`;
    hGrid += `<text x="${padL - 6}" y="${(y + 4).toFixed(1)}" text-anchor="end" fill="#71717a" font-size="10">${Math.round(val)}</text>`;
  }
  let vTicks = "";
  const tickCount = Math.min(8, Math.ceil(span));
  for (let t = 0; t <= tickCount; t++) {
    const sec = (t / tickCount) * span;
    const x = padL + (sec / span) * plotW;
    vTicks += `<line x1="${x.toFixed(1)}" y1="${plotBottom}" x2="${x.toFixed(1)}" y2="${plotBottom + 4}" stroke="rgba(255,255,255,0.12)"/>`;
    vTicks += `<text x="${x.toFixed(1)}" y="${height - 8}" text-anchor="middle" fill="#71717a" font-size="10">${sec.toFixed(1)}s</text>`;
  }
  return `<figure class="tbt-figure">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" style="max-height:240px;display:block" role="img" aria-label="TBT timeline">
<defs>
<linearGradient id="tbtGrad" x1="0%" y1="100%" x2="0%" y2="0%">
<stop offset="0%" style="stop-color:#9f1239;stop-opacity:0.85"/>
<stop offset="100%" style="stop-color:#fb7185;stop-opacity:0.95"/>
</linearGradient>
</defs>
<rect x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="rgba(255,255,255,0.02)" stroke="rgba(255,255,255,0.08)" rx="6"/>
${hGrid}
${rects}
${vTicks}
<text x="${padL + plotW / 2}" y="14" text-anchor="middle" fill="#a1a1aa" font-size="11">Blocking time (main thread, &gt;50ms tasks) — ms after the first 50ms per task</text>
<text x="${padL + plotW / 2}" y="${height - 2}" text-anchor="middle" fill="#71717a" font-size="9">Session time (0–${span.toFixed(1)}s)</text>
</svg>
</figure>`;
}

function escapeAttr(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}
