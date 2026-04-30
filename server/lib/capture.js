/**
 * Performance capture module: Playwright + CDP tracing + optional Xvfb/VNC.
 * Reuses logic from performance-testing-app playwrightUtils.
 */
const { randomUUID } = require("crypto");
const fs = require("fs/promises");
const fsSync = require("fs");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright");
const {
  parseTraceToReport,
  computeClsFromEntries,
  parseTraceEvents,
} = require("./traceParser");

/** Read Chrome trace from CDP Tracing.end (stream or inline). Required for GPU/layout/paint in trace. */
async function readCdpTracingTrace(traceCdp) {
  if (!traceCdp) return "";
  try {
    const endResult = await traceCdp.send("Tracing.end");
    if (endResult?.data && typeof endResult.data === "string") {
      return endResult.data;
    }
    const stream =
      endResult?.stream ??
      endResult?.value?.stream ??
      endResult?.result?.stream;
    if (!stream) {
      return "";
    }
    const chunks = [];
    let eof = false;
    while (!eof) {
      const r = await traceCdp.send("IO.read", { stream });
      if (r?.data) {
        if (r.base64Encoded) {
          chunks.push(Buffer.from(r.data, "base64").toString("utf8"));
        } else {
          chunks.push(typeof r.data === "string" ? r.data : String(r.data));
        }
      }
      eof = !!r?.eof;
    }
    try {
      await traceCdp.send("IO.close", { stream });
    } catch {
      /* ignore */
    }
    return chunks.join("");
  } catch (e) {
    console.warn("[PerfTrace] CDP Tracing.end:", e?.message || e);
    return "";
  }
}

/**
 * Prefer CDP trace for GPU/layout/paint. Playwright's trace zip is large but often
 * lacks devtools.timeline GPU categories; CDP Tracing.start() is the source of truth.
 */
function pickTraceTextForParser(playwrightTraceText, cdpTraceText) {
  const pw = playwrightTraceText
    ? parseTraceEvents(playwrightTraceText).length
    : 0;
  const cdp = cdpTraceText ? parseTraceEvents(cdpTraceText).length : 0;
  if (cdp >= 400) return cdpTraceText;
  if (cdp > pw * 2 && cdp > 80) return cdpTraceText;
  if (
    cdp > 0 &&
    (cdpTraceText.includes("devtools.timeline") ||
      cdpTraceText.includes('"cat":"gpu"') ||
      cdpTraceText.includes('"cat":"cc"'))
  ) {
    return cdpTraceText;
  }
  if (pw > 0) return playwrightTraceText;
  return cdpTraceText || playwrightTraceText || "";
}

const ASSET_EXT_SCRIPT = /\.(js|mjs|cjs|ts)(\?|$)/i;
const ASSET_EXT_STYLE = /\.(css|scss|sass|less)(\?|$)/i;
const ASSET_EXT_DOC = /\.(html|htm)(\?|$)/i;
// Bitmap/SVG assets; ico covers favicon.ico; paths named favicon without extension are rare but tagged below
const ASSET_EXT_IMAGE =
  /\.(png|jpe?g|gif|webp|svg|ico|avif|bmp|heic|heif)(\?|$)/i;
const ASSET_PATH_FAVICON = /(?:^|\/)favicon(?:\.ico)?$/i;
const ASSET_EXT_FONT = /\.(woff2?|ttf|otf|eot)(\?|$)/i;
const CURTAIN_SELECTORS = [
  '[data-testid="curtain"]',
  ".curtain.core-curtain",
  ".core-curtain",
  ".curtain",
];

/** Substrings for CDP Animation name / keyframes name (e.g. liftCurtain). Comma-separated env override. */
const CURTAIN_LIFT_ANIMATION_NAMES = (
  process.env.PERFTRACE_CURTAIN_LIFT_ANIMATIONS || "liftcurtain"
)
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

/**
 * CDP may report CSS duration in seconds (0.5) or ms (500). Heuristic: small values → seconds.
 */
function cssTimingValueToMs(raw) {
  if (raw == null || !Number.isFinite(raw)) return 0;
  const x = Number(raw);
  if (x > 0 && x <= 120) return Math.round(x * 1000);
  return Math.round(x);
}

/** First DOM observation of curtain_dead (game-relative wall ms). */
function setCurtainLiftDomMs(session, candidateMs) {
  if (!session?.curtainLifecycle || candidateMs == null || !Number.isFinite(candidateMs))
    return;
  if (session.curtainLifecycleFrozen) return;
  if (session.curtainLifecycle.liftMsDom != null) return;
  session.curtainLifecycle.liftMsDom = Math.max(0, candidateMs);
}

/**
 * liftCurtain timing — keep earliest animation-derived candidate when CDP fires multiple times.
 */
function setCurtainLiftAnimationMs(session, candidateMs) {
  if (!session?.curtainLifecycle || candidateMs == null || !Number.isFinite(candidateMs))
    return;
  if (session.curtainLifecycleFrozen) return;
  const c = Math.max(0, candidateMs);
  const prev = session.curtainLifecycle.liftMsAnimation;
  if (prev == null || c < prev) session.curtainLifecycle.liftMsAnimation = c;
}

/**
 * Final curtain moment: min(DOM, animation) when both exist (earlier = assets during the
 * lift animation count as post-load). If curtain_dead missing, use animation only; else client poll.
 */
function resolveCurtainLiftMs(curtainLifecycle, clientCurtainLiftMs) {
  const dom = curtainLifecycle?.liftMsDom;
  const anim = curtainLifecycle?.liftMsAnimation;
  let resolved;
  if (dom != null && anim != null) resolved = Math.min(dom, anim);
  else resolved = dom ?? anim;
  if (resolved == null && clientCurtainLiftMs != null && Number.isFinite(clientCurtainLiftMs))
    resolved = clientCurtainLiftMs;
  return resolved;
}

/**
 * Curtain instant in the same timeline as Resource Timing `responseEnd` (ms since game
 * navigation). Server-side lift is wall-ms **from asset baseline**; add baseline perf
 * snapshot so it aligns with performance.now() at curtain on the game document.
 */
function curtainLiftPerfMsForRollup(
  lifecycleTimings,
  curtainLifecycle,
  assetBaselinePerfMs
) {
  const client = lifecycleTimings?.curtainLiftMs;
  if (client != null && Number.isFinite(client) && client > 0) return client;
  const wallFromBaseline = resolveCurtainLiftMs(curtainLifecycle, null);
  if (wallFromBaseline != null && Number.isFinite(wallFromBaseline)) {
    const basePerf = assetBaselinePerfMs;
    if (basePerf != null && Number.isFinite(basePerf) && basePerf > 0) {
      return wallFromBaseline + basePerf;
    }
    return wallFromBaseline;
  }
  return null;
}

function animationNameMatchesCurtainLift(name) {
  const n = (name || "").trim().toLowerCase();
  if (!n) return false;
  return CURTAIN_LIFT_ANIMATION_NAMES.some((frag) => n.includes(frag));
}

/**
 * CDP Animation.animationStarted — use liftCurtain (etc.) timing for curtain lift.
 * PERFTRACE_CURTAIN_LIFT_AT=end (default) → start + delay + duration ("fully raised").
 * PERFTRACE_CURTAIN_LIFT_AT=start → animation start only (closer to curtain_dead).
 */
function recordCurtainLiftFromAnimation(session, animation, source) {
  if (!session?.curtainLifecycle || session.curtainLifecycleFrozen) return;
  const base = session.assetCaptureStartTimeMs ?? 0;
  const name = extractAnimationName(animation, source || {});
  if (!animationNameMatchesCurtainLift(name)) return;

  const delayRaw =
    source && typeof source.delay === "number" ? source.delay : undefined;
  const durationRaw =
    source && typeof source.duration === "number" ? source.duration : undefined;
  const delayMs = cssTimingValueToMs(delayRaw);
  const durationMs = cssTimingValueToMs(durationRaw);

  const atEventWallGameMs = Math.max(
    0,
    Date.now() - session.startedAt - base
  );
  const mode = (process.env.PERFTRACE_CURTAIN_LIFT_AT || "end").toLowerCase();
  const candidate =
    mode === "start"
      ? atEventWallGameMs
      : Math.max(0, atEventWallGameMs + delayMs + durationMs);

  setCurtainLiftAnimationMs(session, candidate);
}

function isCurtainDeadInDocument(doc) {
  try {
    const root =
      doc?.querySelector?.('[data-testid="curtain"]') ||
      doc?.querySelector?.(".curtain") ||
      null;
    if (!root) return { seen: false, dead: false };
    const seen = true;
    const dead =
      root.classList?.contains?.("curtain_dead") ||
      !!root.querySelector?.(".curtain_dead");
    return { seen, dead };
  } catch {
    return { seen: false, dead: false };
  }
}

function categorizeAsset(
  url,
  initiatorType = "",
  resourceType = "",
  isMainDocument = false
) {
  if (isMainDocument) return "build";
  const u = (url || "").toLowerCase();
  const pathOnly = u.split("?")[0] || u;
  const it = (initiatorType || "").toLowerCase();
  const rt = (resourceType || "").toLowerCase();
  if (ASSET_EXT_SCRIPT.test(u) || rt === "script" || it === "script")
    return "script";
  // Image + font before stylesheet: <link> can load CSS, preloaded images, or fonts;
  // initiator "link" was incorrectly classing .png as stylesheet.
  if (
    ASSET_EXT_IMAGE.test(u) ||
    ASSET_PATH_FAVICON.test(pathOnly) ||
    rt === "image" ||
    it === "img" ||
    it === "image"
  )
    return "image";
  if (ASSET_EXT_FONT.test(u) || rt === "font") return "font";
  if (
    ASSET_EXT_STYLE.test(u) ||
    rt === "stylesheet" ||
    it === "link" ||
    it === "css"
  )
    return "stylesheet";
  if (ASSET_EXT_DOC.test(u) || rt === "document") return "document";
  if (
    rt === "xhr" ||
    rt === "fetch" ||
    it === "xmlhttprequest" ||
    it === "fetch"
  )
    return "json";
  return "other";
}

function buildEmptyAssetsByCategory() {
  return {
    build: { count: 0, totalBytes: 0, files: [] },
    script: { count: 0, totalBytes: 0, files: [] },
    stylesheet: { count: 0, totalBytes: 0, files: [] },
    document: { count: 0, totalBytes: 0, files: [] },
    json: { count: 0, totalBytes: 0, files: [] },
    image: { count: 0, totalBytes: 0, files: [] },
    font: { count: 0, totalBytes: 0, files: [] },
    other: { count: 0, totalBytes: 0, files: [] },
  };
}

function normalizeAssetKey(url) {
  return (url || "").split("?")[0];
}

/**
 * Count how many times each normalized URL was fetched, for duplicate detection.
 * Resource Timing and CDP network lists both reflect the same HTTP requests; merging
 * counts from both would label every asset as duplicated (~2×). Prefer CDP rows when
 * present (one row per request); otherwise use Performance Resource Timing only.
 */
function buildAssetOccurrenceMap(resourceEntries, networkRequests) {
  const map = new Map();
  const preferNetwork = (networkRequests?.length ?? 0) > 0;

  if (preferNetwork) {
    for (const r of networkRequests || []) {
      const url = r.url || "";
      const key = normalizeAssetKey(url);
      if (!key) continue;
      const cur = map.get(key) || {
        count: 0,
        exampleUrl: url,
        totalBytes: 0,
      };
      cur.count += 1;
      cur.exampleUrl = cur.exampleUrl || url;
      cur.totalBytes += r.transferSize ?? 0;
      map.set(key, cur);
    }
  } else {
    for (const e of resourceEntries || []) {
      const url = e.url || e.name || "";
      const key = normalizeAssetKey(url);
      if (!key) continue;
      const size = e.transferSize ?? e.encodedBodySize ?? 0;
      const cur = map.get(key) || {
        count: 0,
        exampleUrl: url,
        totalBytes: 0,
      };
      cur.count += 1;
      cur.exampleUrl = cur.exampleUrl || url;
      cur.totalBytes += size;
      map.set(key, cur);
    }
  }
  return map;
}

function inferAssetScope(url, gameAssetKeys) {
  const keys = Array.isArray(gameAssetKeys) ? gameAssetKeys : [];
  if (!keys.length) return "common";
  const u = String(url || "").toLowerCase();
  for (const k of keys) {
    const key = String(k || "").trim().toLowerCase();
    if (!key) continue;
    if (u.includes(key)) return "game";
  }
  return "common";
}

function computeTotals(byCategory) {
  let totalBytes = 0;
  let totalCount = 0;
  for (const cat of Object.keys(byCategory)) {
    totalBytes += byCategory[cat].totalBytes;
    totalCount += byCategory[cat].count;
  }
  return { totalBytes, totalCount };
}

function classifyAssetLifecycle(endTimeMs, curtainLiftMs) {
  if (curtainLiftMs == null || !Number.isFinite(curtainLiftMs) || curtainLiftMs <= 0) {
    return "full";
  }
  if (endTimeMs != null && Number.isFinite(endTimeMs) && endTimeMs <= curtainLiftMs) {
    return "preload";
  }
  return "postload";
}

/**
 * Map URL → Resource Timing `responseEnd` (ms since navigation / time origin).
 * Must align with `curtainLiftMs` from the page (`performance.now()` when the curtain dies).
 */
function buildPerfResponseEndMap(resourceEntries, navigationEntries) {
  const m = new Map();
  const put = (url, end) => {
    if (end == null || !Number.isFinite(end) || end <= 0) return;
    const key = normalizeAssetKey(url);
    if (!key) return;
    const prev = m.get(key);
    if (prev == null || end > prev) m.set(key, end);
  };
  for (const e of navigationEntries || []) put(e.url, e.responseEnd);
  for (const e of resourceEntries || []) put(e.url, e.responseEnd);
  return m;
}

function perfLifecycleEndForUrl(url, perfEndMap) {
  const key = normalizeAssetKey(url);
  const v = perfEndMap.get(key);
  return v != null && v > 0 ? v : undefined;
}

function flattenCategoryFiles(byCategory) {
  const files = [];
  for (const cat of Object.keys(byCategory || {})) {
    const b = byCategory[cat];
    if (b?.files?.length) files.push(...b.files);
  }
  return files;
}

function rollupLifecycleTotals(files, curtainLiftPerfMs, rollupOpts = {}) {
  const perfEndMap = rollupOpts.perfEndMap;
  const assetCaptureStartTimeMs = rollupOpts.assetCaptureStartTimeMs;
  const assetBaselinePerfMs = rollupOpts.assetBaselinePerfMs;

  const comparableEndMs = (file) => {
    const url = file.url || "";
    const perfEnd =
      perfEndMap != null ? perfLifecycleEndForUrl(url, perfEndMap) : undefined;
    if (perfEnd != null && perfEnd > 0) return perfEnd;
    const net = file.endTimeMs;
    if (
      net != null &&
      Number.isFinite(net) &&
      assetCaptureStartTimeMs != null &&
      Number.isFinite(assetCaptureStartTimeMs) &&
      assetBaselinePerfMs != null &&
      Number.isFinite(assetBaselinePerfMs)
    ) {
      return assetBaselinePerfMs + Math.max(0, net - assetCaptureStartTimeMs);
    }
    return file.lifecycleAtMs ?? file.endTimeMs;
  };

  const acc = {
    preload: { totalBytes: 0, totalCount: 0 },
    postload: { totalBytes: 0, totalCount: 0 },
    full: { totalBytes: 0, totalCount: 0 },
  };
  for (const file of files) {
    const size = file.transferSize ?? 0;
    acc.full.totalBytes += size;
    acc.full.totalCount += 1;
    const phase = classifyAssetLifecycle(
      comparableEndMs(file),
      curtainLiftPerfMs
    );
    if (phase === "preload") {
      acc.preload.totalBytes += size;
      acc.preload.totalCount += 1;
    } else {
      acc.postload.totalBytes += size;
      acc.postload.totalCount += 1;
    }
  }
  return acc;
}

function buildDownloadedAssetsSummary(
  resourceEntries,
  navigationEntries,
  networkRequests,
  fcpMs,
  gameAssetKeys = [],
  curtainLiftPerfMs = undefined,
  assetCaptureStartTimeMs = undefined,
  assetBaselinePerfMsForTimeline = undefined
) {
  /** Use full Resource Timing rows from the collected page (game tab). Do not filter by
   * `assetBaselinePerfMs`: that snapshot is taken when the baseline commits — often *after*
   * main bundle/CSS already finished (automation waits for load). Filtering would drop those
   * entries and shrink preload to near-zero. Network rows remain gated by assetCaptureStartTimeMs. */
  const perfEndMap = buildPerfResponseEndMap(resourceEntries, navigationEntries);

  const byCategoryAll = buildEmptyAssetsByCategory();
  const byCategoryGame = buildEmptyAssetsByCategory();
  const byCategoryCommon = buildEmptyAssetsByCategory();

  const seenUnique = new Set();
  let mainDocUrl = null;

  if (!navigationEntries?.length && networkRequests?.length > 0) {
    const firstDoc = networkRequests.find(
      (r) => (r.type || "").toLowerCase() === "document"
    );
    if (firstDoc) {
      const url = firstDoc.url || "";
      mainDocUrl = url;
      const size = firstDoc.transferSize ?? 0;
      const key = normalizeAssetKey(url);
      seenUnique.add("nav:" + key);
      seenUnique.add(key);
      const scope = inferAssetScope(url, gameAssetKeys);

      const add = (bucket) => {
        bucket.build.count++;
        bucket.build.totalBytes += size;
        bucket.build.files.push({
          url,
          category: "build",
          transferSize: size > 0 ? size : undefined,
          durationMs: firstDoc.durationMs,
          endTimeMs: firstDoc.endTimeMs,
          lifecycleAtMs: perfLifecycleEndForUrl(url, perfEndMap) ?? undefined,
        });
      };
      add(byCategoryAll);
      add(scope === "game" ? byCategoryGame : byCategoryCommon);
    }
  }

  for (const e of navigationEntries || []) {
    const url = e.url || "";
    const key = "nav:" + normalizeAssetKey(url);
    if (seenUnique.has(key)) continue;
    seenUnique.add(key);
    mainDocUrl = url;
    const size = e.transferSize ?? e.encodedBodySize ?? 0;
    const scope = inferAssetScope(url, gameAssetKeys);
    const rel = e.responseEnd > 0 ? e.responseEnd : undefined;
    const asset = {
      url,
      category: "build",
      transferSize: size > 0 ? size : undefined,
      durationMs: e.duration > 0 ? e.duration : undefined,
      endTimeMs: e.responseEnd > 0 ? e.responseEnd : undefined,
      lifecycleAtMs: rel,
    };
    const add = (bucket) => {
      bucket.build.count++;
      bucket.build.totalBytes += size;
      bucket.build.files.push(asset);
    };
    add(byCategoryAll);
    add(scope === "game" ? byCategoryGame : byCategoryCommon);
  }

  for (const e of resourceEntries || []) {
    const url = e.url || "";
    const key = normalizeAssetKey(url);

    if (seenUnique.has(key)) continue;
    if (url === mainDocUrl) continue;
    seenUnique.add(key);
    const size = e.transferSize ?? e.encodedBodySize ?? 0;
    const cat = categorizeAsset(url, e.initiatorType, "", false);
    const scope = inferAssetScope(url, gameAssetKeys);
    const rel = e.responseEnd > 0 ? e.responseEnd : undefined;
    const asset = {
      url,
      category: cat,
      transferSize: size > 0 ? size : undefined,
      durationMs: e.duration > 0 ? e.duration : undefined,
      endTimeMs: e.responseEnd > 0 ? e.responseEnd : undefined,
      lifecycleAtMs: rel,
    };
    const add = (bucket) => {
      bucket[cat].count++;
      bucket[cat].totalBytes += size;
      bucket[cat].files.push(asset);
    };
    add(byCategoryAll);
    add(scope === "game" ? byCategoryGame : byCategoryCommon);
  }
  for (const r of networkRequests || []) {
    const url = r.url || "";
    const key = normalizeAssetKey(url);

    if (seenUnique.has(key)) continue;
    const size = r.transferSize ?? 0;
    if (size <= 0) continue;
    const navKey = "nav:" + key;
    if (seenUnique.has(navKey)) continue;
    seenUnique.add(key);
    const cat = categorizeAsset(url, "", r.type, false);
    const scope = inferAssetScope(url, gameAssetKeys);
    const asset = {
      url,
      category: cat,
      transferSize: size,
      durationMs: r.durationMs,
      endTimeMs: r.endTimeMs,
      lifecycleAtMs: perfLifecycleEndForUrl(url, perfEndMap) ?? undefined,
    };
    const add = (bucket) => {
      bucket[cat].count++;
      bucket[cat].totalBytes += size;
      bucket[cat].files.push(asset);
    };
    add(byCategoryAll);
    add(scope === "game" ? byCategoryGame : byCategoryCommon);
  }

  const { totalBytes, totalCount } = computeTotals(byCategoryAll);
  const gameTotals = computeTotals(byCategoryGame);
  const commonTotals = computeTotals(byCategoryCommon);

  const initialLoadBytes = computeInitialLoadBytes(
    byCategoryAll,
    resourceEntries,
    fcpMs
  );

  const occurrences = buildAssetOccurrenceMap(resourceEntries, networkRequests);
  const duplicates = [];
  for (const [key, info] of occurrences.entries()) {
    if (info.count > 1) {
      duplicates.push({
        url: info.exampleUrl || key,
        normalizedUrl: key,
        count: info.count,
        totalBytes: info.totalBytes || 0,
      });
    }
  }
  duplicates.sort((a, b) => b.totalBytes - a.totalBytes || b.count - a.count);

  /** Duplicates list: images only (same URL fetched multiple times). API/XHR repeats are excluded. */
  const duplicatesForReport = duplicates.filter((d) => {
    const cat = categorizeAsset(d.url || d.normalizedUrl || "", "", "", false);
    return cat === "image";
  });

  const duplicateExtraFetches = duplicatesForReport.reduce(
    (s, d) => s + Math.max(0, d.count - 1),
    0
  );

  const rollupOpts = {
    perfEndMap,
    assetCaptureStartTimeMs,
    assetBaselinePerfMs: assetBaselinePerfMsForTimeline,
  };

  const allFiles = flattenCategoryFiles(byCategoryAll);
  const lifecycleTotals = rollupLifecycleTotals(
    allFiles,
    curtainLiftPerfMs,
    rollupOpts
  );
  const lifecycleTotalsByScope =
    curtainLiftPerfMs != null &&
    Number.isFinite(curtainLiftPerfMs) &&
    curtainLiftPerfMs > 0
      ? {
          game: rollupLifecycleTotals(
            flattenCategoryFiles(byCategoryGame),
            curtainLiftPerfMs,
            rollupOpts
          ),
          common: rollupLifecycleTotals(
            flattenCategoryFiles(byCategoryCommon),
            curtainLiftPerfMs,
            rollupOpts
          ),
        }
      : undefined;

  return {
    byCategory: byCategoryAll,
    byScope: {
      all: {
        byCategory: byCategoryAll,
        ...computeTotals(byCategoryAll),
      },
      game: {
        byCategory: byCategoryGame,
        ...gameTotals,
      },
      common: {
        byCategory: byCategoryCommon,
        ...commonTotals,
      },
    },
    totalBytes,
    totalCount,
    initialLoadBytes,
    curtainLiftMs:
      curtainLiftPerfMs != null &&
      Number.isFinite(curtainLiftPerfMs) &&
      curtainLiftPerfMs > 0
        ? curtainLiftPerfMs
        : undefined,
    lifecycleTotals,
    lifecycleTotalsByScope,
    duplicates: duplicatesForReport,
    duplicateStats:
      duplicatesForReport.length > 0
        ? {
            uniqueUrls: duplicatesForReport.length,
            extraFetches: duplicateExtraFetches,
          }
        : undefined,
    gameAssetKeys: Array.isArray(gameAssetKeys) ? gameAssetKeys : [],
    /** Alias: everything transferred during the session */
    sessionTotalBytes: totalBytes,
  };
}

/** Resources finishing before FCP (+ slack) count toward "initial" bundle. */
function computeInitialLoadBytes(byCategory, resourceEntries, fcpMs) {
  const resByUrl = new Map();
  for (const e of resourceEntries || []) {
    const key = (e.url || e.name || "").split("?")[0];
    if (key) resByUrl.set(key, e);
  }
  const SLACK_MS = 500;
  const cutoff = fcpMs != null && fcpMs > 0 ? fcpMs + SLACK_MS : 3500;

  const cats = ["build", "script", "stylesheet", "font", "document"];
  let sum = 0;
  for (const cat of cats) {
    const bucket = byCategory[cat];
    if (!bucket?.files) continue;
    for (const f of bucket.files) {
      const key = (f.url || "").split("?")[0];
      const re = resByUrl.get(key);
      const end = re?.responseEnd;
      const size = f.transferSize ?? 0;
      if (size <= 0) continue;
      if (cat === "build") {
        sum += size;
        continue;
      }
      if (typeof end === "number" && end > 0 && end <= cutoff) sum += size;
    }
  }
  return sum;
}

const SKIP_KEYFRAME_KEYS = new Set([
  "offset",
  "easing",
  "composite",
  "compositeoperation",
  "computedoffset",
  "flex",
  "flexgrow",
  "flexshrink",
  "flexbasis",
]);

function extractAnimationProperties(a, source) {
  const props = [];
  if (a.type === "CSSTransition" && source) {
    const p =
      source.transitionProperty ?? source.cssProperty ?? source.property;
    if (typeof p === "string" && !SKIP_KEYFRAME_KEYS.has(p.toLowerCase()))
      props.push(p.trim());
    if (Array.isArray(source.transitionProperty)) {
      for (const x of source.transitionProperty) {
        if (typeof x === "string" && !SKIP_KEYFRAME_KEYS.has(x.toLowerCase()))
          props.push(x.trim());
      }
    }
    if (props.length) return props;
  }
  const kfRule = source?.keyframesRule;
  const kfList = kfRule?.keyframes ?? [];
  for (const kf of kfList) {
    const style = kf.style ?? kf;
    if (style && typeof style === "object") {
      for (const key of Object.keys(style)) {
        if (!SKIP_KEYFRAME_KEYS.has(key.toLowerCase()) && !props.includes(key))
          props.push(key);
      }
    }
  }
  for (const kf of kfList) {
    if (kf && typeof kf === "object") {
      for (const key of Object.keys(kf)) {
        if (!SKIP_KEYFRAME_KEYS.has(key.toLowerCase()) && !props.includes(key))
          props.push(key);
      }
    }
  }
  return props.length ? props : undefined;
}

function extractAnimationName(a, source) {
  if (typeof a.name === "string" && a.name.trim()) return a.name.trim();
  const kfName = source?.keyframesRule?.name;
  if (typeof kfName === "string" && kfName.trim()) return kfName.trim();
  if (a.type === "CSSTransition" && source) {
    const p =
      source.transitionProperty ?? source.cssProperty ?? source.property;
    if (typeof p === "string" && p.trim()) return `Transition (${p.trim()})`;
    if (Array.isArray(source.transitionProperty)) {
      const parts = (source.transitionProperty || [])
        .filter((x) => typeof x === "string" && x.trim())
        .map((x) => x.trim());
      if (parts.length) return `Transition (${parts.join(", ")})`;
    }
  }
  const props = extractAnimationProperties(a, source);
  if (props?.length && props[0]) {
    const p = props[0];
    return (
      p.charAt(0).toUpperCase() +
      p.slice(1).replace(/-./g, (m) => m[1].toUpperCase())
    );
  }
  return "";
}

function countAnimationBottlenecks(normalized) {
  const o = { compositor: 0, paint: 0, layout: 0, unclassified: 0 };
  for (const a of normalized) {
    const h = a.bottleneckHint;
    if (h === "layout") o.layout += 1;
    else if (h === "paint") o.paint += 1;
    else if (h === "compositor") o.compositor += 1;
    else o.unclassified += 1;
  }
  return o;
}

/** Minified @keyframes names (e.g. bo_br) — align with client `isOpaqueKeyframeName`. */
function isOpaqueKeyframeName(name) {
  const n = String(name || "").trim();
  if (!n || n === "(unnamed)") return true;
  if (/^(cc-|blink-)/i.test(n)) return false;
  if (/\s/.test(n)) return false;
  if (/^[a-z]+(?:[A-Z][a-z0-9]*)+$/.test(n)) return false;
  if (/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(n) && n.length <= 64) return true;
  if (/^[a-f0-9]{16,}$/i.test(n)) return true;
  return false;
}

function displayLabelFromProperties(props) {
  return props
    .map((p) =>
      p
        ? p.charAt(0).toUpperCase() +
          p.slice(1).replace(/-([a-z])/g, (_, c) => c.toUpperCase())
        : ""
    )
    .filter(Boolean)
    .join(", ");
}

function normalizeAnimationEntries(animations) {
  return animations.map((a) => {
    const raw = a.properties ?? [];
    const cleaned = sanitizeAnimationProperties(raw);
    const props = cleaned?.length ? cleaned : [];
    let name = (a.name || "").trim();
    if (props.length && isOpaqueKeyframeName(name)) {
      name = displayLabelFromProperties(props);
    } else if (!name || name === "(unnamed)") {
      if (props.length) {
        name = displayLabelFromProperties(props);
      } else {
        name = "Animation";
      }
    }
    const bottleneckHint =
      inferBottleneck(props.length ? props : undefined, name) ??
      a.bottleneckHint;
    return {
      ...a,
      name,
      bottleneckHint,
      properties: props.length ? props : undefined,
    };
  });
}

/** Web Animations / keyframes may use camelCase property names. */
function kebabCssProperty(prop) {
  if (typeof prop !== "string" || !prop.trim()) return "";
  const s = prop.trim();
  if (s.includes("-")) return s.toLowerCase();
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

/**
 * Classify one animated CSS property. Order: compositor → paint → layout checks
 * (inferBottleneck then applies worst-cost: layout &gt; paint &gt; compositor).
 */
function classifyCssAnimatedProperty(prop) {
  const p = kebabCssProperty(prop);
  if (!p) return null;

  if (
    p === "transform" ||
    p === "opacity" ||
    p === "perspective" ||
    p === "translate" ||
    p === "scale" ||
    p === "rotate"
  )
    return "compositor";
  if (
    p.startsWith("translate") ||
    p.startsWith("scale") ||
    p.startsWith("rotate")
  )
    return "compositor";
  if (p === "transform-origin" || p === "perspective-origin")
    return "compositor";
  if (p === "z-index" || p === "will-change") return "compositor";

  if (p.includes("radius")) return "paint";
  if (p === "box-shadow" || p === "text-shadow") return "paint";
  if (p.startsWith("background") || p === "color") return "paint";
  if (p === "fill" || p === "stroke") return "paint";
  if (
    p === "stroke-width" ||
    p === "stroke-dashoffset" ||
    p === "stroke-dasharray"
  )
    return "paint";
  if (p.endsWith("-opacity") && p !== "opacity") return "paint";
  if (p.includes("border") && p.includes("color")) return "paint";
  if (p === "border-image" || p.startsWith("border-image-")) return "paint";
  if (p === "outline" || p.startsWith("outline-")) return "paint";
  if (p === "filter" || p === "backdrop-filter" || p === "clip-path")
    return "paint";
  if (p === "mix-blend-mode" || p === "isolation") return "paint";

  if (
    [
      "width",
      "height",
      "min-width",
      "max-width",
      "min-height",
      "max-height",
    ].includes(p)
  )
    return "layout";
  if (
    ["top", "left", "right", "bottom", "inset"].includes(p) ||
    p.startsWith("inset-")
  )
    return "layout";
  if (p.startsWith("margin") || p.startsWith("padding")) return "layout";
  if (p === "border" || p === "border-width" || p === "border-style")
    return "layout";
  if (
    p.startsWith("border-") &&
    (p.includes("width") ||
      p.includes("spacing") ||
      /-(top|right|bottom|left|inline|block|start|end|horizontal|vertical)-(width|style)$/.test(
        p
      ))
  )
    return "layout";
  if (
    /^border-(top|right|bottom|left|inline|block|start|end|horizontal|vertical)$/.test(
      p
    )
  )
    return "layout";
  if (
    p.startsWith("flex") ||
    p.startsWith("grid") ||
    p === "gap" ||
    p === "row-gap" ||
    p === "column-gap" ||
    p === "place-content" ||
    p === "place-items" ||
    p === "align-content" ||
    p === "align-items" ||
    p === "justify-content"
  )
    return "layout";
  if (
    [
      "display",
      "position",
      "float",
      "clear",
      "font-size",
      "line-height",
      "letter-spacing",
      "word-spacing",
      "vertical-align",
      "text-align",
      "box-sizing",
      "white-space",
      "word-break",
      "aspect-ratio",
      "object-fit",
      "object-position",
    ].includes(p)
  )
    return "layout";
  if (p.startsWith("overflow") || p === "scroll-behavior") return "layout";

  return null;
}

/** Strip Web Animations metadata keys (not CSS properties). */
function sanitizeAnimationProperties(props) {
  if (!props?.length) return undefined;
  const META = new Set([
    "computedoffset",
    "offset",
    "easing",
    "composite",
    "compositeoperation",
    "flex",
    "flexgrow",
    "flexshrink",
    "flexbasis",
  ]);
  const out = props.filter((p) => {
    if (typeof p !== "string" || !p.trim()) return false;
    const norm = kebabCssProperty(p).replace(/-/g, "");
    if (META.has(norm)) return false;
    return true;
  });
  return out.length ? out : undefined;
}

/** When keyframes omit properties, infer from animation/transition name (e.g. box-shadow, border-*-radius). */
function inferBottleneckFromAnimationName(animationName) {
  if (!animationName || typeof animationName !== "string") return undefined;
  let s = animationName.trim();
  const trans = /^Transition\s*\(([\s\S]+)\)\s*$/i.exec(s);
  if (trans) s = trans[1].trim();
  const segments = s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const parts = segments.length ? segments : [s];
  let hasLayout = false;
  let hasPaint = false;
  let hasCompositor = false;
  for (const seg of parts) {
    const c = classifyCssAnimatedProperty(seg);
    if (c === "layout") hasLayout = true;
    else if (c === "paint") hasPaint = true;
    else if (c === "compositor") hasCompositor = true;
  }
  if (hasLayout) return "layout";
  if (hasPaint) return "paint";
  if (hasCompositor) return "compositor";
  return undefined;
}

function inferBottleneck(properties, animationName) {
  const cleaned = sanitizeAnimationProperties(properties);
  if (cleaned?.length) {
    let hasLayout = false;
    let hasPaint = false;
    let hasCompositor = false;
    for (const raw of cleaned) {
      const bucket = classifyCssAnimatedProperty(raw);
      if (bucket === "layout") hasLayout = true;
      else if (bucket === "paint") hasPaint = true;
      else if (bucket === "compositor") hasCompositor = true;
    }
    if (hasLayout) return "layout";
    if (hasPaint) return "paint";
    if (hasCompositor) return "compositor";
  }
  const fromName = inferBottleneckFromAnimationName(animationName);
  if (fromName) return fromName;
  const name = (animationName ?? "").toLowerCase();
  if (name.startsWith("cc-")) return "compositor";
  if (name.startsWith("blink-") || name.includes("style")) return "layout";
  if (
    name.includes("fade") ||
    name.includes("opacity") ||
    name.includes("transform")
  )
    return "compositor";
  return undefined;
}

// VNC streaming removed: keep capture simple (record video + download).
const VIEWPORT_WIDTH = 1366;
const VIEWPORT_HEIGHT = 768;

const PORTRAIT_VIEWPORT_MIN_W = 280;
const PORTRAIT_VIEWPORT_MIN_H = 400;
const PORTRAIT_VIEWPORT_MAX = 4096;
const DEFAULT_PORTRAIT_W = 390;
const DEFAULT_PORTRAIT_H = 844;

function normalizeBrowserLayout(input) {
  const rawMode = input?.layoutMode ?? input?.mode;
  const mode =
    rawMode === "portrait" || rawMode === "Portrait" ? "portrait" : "landscape";
  if (mode !== "portrait") return { mode: "landscape" };
  let w = Number(input?.viewportWidth ?? input?.width);
  let h = Number(input?.viewportHeight ?? input?.height);
  if (!Number.isFinite(w)) w = DEFAULT_PORTRAIT_W;
  if (!Number.isFinite(h)) h = DEFAULT_PORTRAIT_H;
  w = Math.round(
    Math.min(PORTRAIT_VIEWPORT_MAX, Math.max(PORTRAIT_VIEWPORT_MIN_W, w))
  );
  h = Math.round(
    Math.min(PORTRAIT_VIEWPORT_MAX, Math.max(PORTRAIT_VIEWPORT_MIN_H, h))
  );
  if (w > h) {
    const t = w;
    w = h;
    h = t;
  }
  return { mode: "portrait", width: w, height: h };
}

let activeSession = null;
let lastVideo = null;
let reportGenerationInProgress = false;
let cachedSessionReport = null;
let lastAutomationError = null;

function ensureValidUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Enter a valid URL including http:// or https://");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http and https URLs are supported.");
  }
  return parsed.toString();
}

async function getLaunchOptions(browserLayout = { mode: "landscape" }) {
  const layout = normalizeBrowserLayout(browserLayout);
  /** Explicit path avoids wrong Chromium resolution on Windows (bundled browser under PLAYWRIGHT_BROWSERS_PATH). */
  let bundledChromeExe;
  try {
    const p = chromium.executablePath();
    if (p && fsSync.existsSync(p)) bundledChromeExe = p;
  } catch {
    /* playwright resolves after env set */
  }
  const isServerless = Boolean(process.env.VERCEL);
  if (isServerless) {
    try {
      const Chromium = (await import("@sparticuz/chromium")).default;
      const vp =
        layout.mode === "portrait"
          ? { width: layout.width, height: layout.height }
          : { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT };
      return {
        headless: true,
        executablePath: await Chromium.executablePath(),
        args: Chromium.args,
        defaultViewport: vp,
      };
    } catch (err) {
      console.warn(
        "[PerfTrace] @sparticuz/chromium not available:",
        err?.message
      );
    }
  }
  // Use headed mode so the user can see and interact with the browser.
  // Set HEADLESS=true for remote servers / CI (no display).
  const headless = process.env.HEADLESS === "true";
  /**
   * Keep GPU ON by default for smoother headed rendering on macOS.
   * If stderr GPU/EGL logs are too noisy, allow explicitly disabling via env.
   */
  const macGpuFlags =
    process.platform === "darwin" && process.env.PERFTRACE_DISABLE_GPU === "true"
      ? ["--disable-gpu"]
      : [];

  if (layout.mode === "portrait") {
    const { width: pw, height: ph } = layout;
    return {
      headless,
      ...(bundledChromeExe ? { executablePath: bundledChromeExe } : {}),
      args: [
        "--disable-dev-shm-usage",
        `--window-size=${pw},${ph}`,
        "--window-position=120,48",
        ...macGpuFlags,
      ],
      defaultViewport: { width: pw, height: ph },
    };
  }

  return {
    headless,
    ...(bundledChromeExe ? { executablePath: bundledChromeExe } : {}),
    args: [
      "--disable-dev-shm-usage",
      "--window-size=1366,768",
      "--window-position=0,0",
      "--start-maximized",
      ...macGpuFlags,
    ],
    defaultViewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
  };
}

async function ensureClientCollectors(context) {
  await context.addInitScript(() => {
    const w = window;
    if (w.__perftraceCollector) return;
    const collector = {
      longTasks: [],
      cls: 0,
      layoutShiftEntries: [],
      fcp: undefined,
      lcp: undefined,
    };
    const syncFromPerf = () => {
      try {
        const paint = performance.getEntriesByType?.("paint") ?? [];
        const fcpEntry = paint.find((e) => e.name === "first-contentful-paint");
        if (fcpEntry) collector.fcp = fcpEntry.startTime;
      } catch {}
      try {
        const lcpEntries =
          performance.getEntriesByType?.("largest-contentful-paint") ?? [];
        if (lcpEntries.length)
          collector.lcp = lcpEntries[lcpEntries.length - 1].startTime;
      } catch {}
    };
    try {
      const lo = new PerformanceObserver((list) => {
        for (const e of list.getEntries())
          collector.longTasks.push({
            start: e.startTime,
            duration: e.duration,
          });
      });
      lo.observe({ type: "longtask", buffered: true });
    } catch {}
    try {
      const po = new PerformanceObserver((list) => {
        for (const e of list.getEntries())
          if (e.name === "first-contentful-paint") collector.fcp = e.startTime;
        syncFromPerf();
      });
      po.observe({ type: "paint", buffered: true });
      syncFromPerf();
    } catch {}
    try {
      const lcpObs = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        if (entries.length)
          collector.lcp = entries[entries.length - 1].startTime;
        syncFromPerf();
      });
      lcpObs.observe({ type: "largest-contentful-paint", buffered: true });
      syncFromPerf();
    } catch {}
    try {
      const clsObs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (!e.hadRecentInput && typeof e.value === "number")
            collector.layoutShiftEntries.push({
              startTime: e.startTime,
              value: e.value,
            });
        }
      });
      clsObs.observe({ type: "layout-shift", buffered: true });
    } catch {}
    w.__perftraceCollector = collector;
  });
}

async function ensureMemoryAndDomCollector(context) {
  await context.addInitScript(() => {
    const w = window;
    if (w.__perftraceMemory !== undefined) return;
    const sample = () => {
      try {
        let heapMb = 0;
        if (typeof performance.memory?.usedJSHeapSize === "number")
          heapMb = performance.memory.usedJSHeapSize / (1024 * 1024);
        const nodes = document.getElementsByTagName("*").length;
        w.__perftraceMemory = { heapMb, nodes };
      } catch {
        w.__perftraceMemory = { heapMb: 0, nodes: 0 };
      }
    };
    sample();
    setInterval(sample, 1500);
  });
}

async function ensureResourceTimingCollector(context) {
  await context.addInitScript(() => {
    const w = window;
    if (w.__perftraceResources !== undefined) return;
    w.__perftraceResources = {
      resources: [],
      navigation: [],
      lifecycle: { curtainSeen: false, curtainLiftMs: undefined },
    };
    const curtainState = { curtainSeen: false, curtainLiftMs: undefined };
    const poll = () => {
      try {
        const resources = performance.getEntriesByType?.("resource") ?? [];
        const navEntries = performance.getEntriesByType?.("navigation") ?? [];
        try {
          const root =
            document.querySelector('[data-testid="curtain"]') ||
            document.querySelector(".curtain");
          const seen = !!root;
          if (seen) curtainState.curtainSeen = true;
          const dead =
            !!root &&
            (root.classList.contains("curtain_dead") ||
              !!root.querySelector(".curtain_dead"));
          if (dead && curtainState.curtainLiftMs == null) {
            curtainState.curtainLiftMs = performance.now();
          }
        } catch {}
        w.__perftraceResources = {
          resources: resources.map((e) => ({
            url: e.name,
            transferSize: e.transferSize ?? 0,
            encodedBodySize: e.encodedBodySize ?? 0,
            decodedBodySize: e.decodedBodySize ?? 0,
            duration: e.duration ?? 0,
            initiatorType: e.initiatorType ?? "",
            fetchStart: e.fetchStart ?? 0,
            responseEnd: e.responseEnd ?? 0,
          })),
          navigation: navEntries.map((e) => ({
            url: e.name,
            transferSize: e.transferSize ?? 0,
            encodedBodySize: e.encodedBodySize ?? 0,
            decodedBodySize: e.decodedBodySize ?? 0,
            duration: e.duration ?? 0,
            responseEnd: e.responseEnd ?? e.domContentLoadedEventEnd ?? 0,
          })),
          lifecycle: curtainState,
        };
      } catch {}
    };
    poll();
    setInterval(poll, 2000);
  });
}

/**
 * Flush wall-clock FPS buckets into `__perftrace.samples` before reading them.
 * `includePartial`: when true (session end), record the in-progress second using elapsed ms.
 * When false (tab switch while the page may keep running), only flush **completed** seconds
 * so we do not double-record the same second if rAF continues.
 */
/**
 * @param {import('playwright').Page | import('playwright').Frame} frameLike
 */
async function finalizeInPageFpsSamples(frameLike, opts = {}) {
  const includePartial = opts.includePartial !== false;
  if (!frameLike) return;
  try {
    if (typeof frameLike.isClosed === "function" && frameLike.isClosed()) return;
  } catch {
    return;
  }
  try {
    await frameLike.evaluate(
      (includePartialFlag) => {
        const st = window.__perftrace;
        if (!st || st.currentSec < 0 || typeof st.t0 !== "number") return;
        const nowWall = Date.now();
        const sec = Math.floor(Math.max(0, nowWall - st.t0) / 1000);
        while (st.currentSec < sec) {
          st.samples.push({
            timeSec: st.currentSec,
            value: Math.min(240, Math.max(0, st.framesThisSec)),
          });
          st.framesThisSec = 0;
          st.currentSec += 1;
        }
        if (
          includePartialFlag &&
          st.framesThisSec > 0
        ) {
          const secStart = st.t0 + st.currentSec * 1000;
          const partialMs = Math.max(1, nowWall - secStart);
          st.samples.push({
            timeSec: st.currentSec,
            value: Math.min(240, (st.framesThisSec * 1000) / partialMs),
          });
          st.framesThisSec = 0;
        }
      },
      [includePartial]
    );
  } catch {
    /* ignore */
  }
}

async function registerFpsCollectorInitScript(context, wallClockStartMs) {
  const t0 =
    typeof wallClockStartMs === "number" && Number.isFinite(wallClockStartMs)
      ? wallClockStartMs
      : Date.now();
  /**
   * Runs in every frame on navigation (main + same-origin iframes). Must be self-contained —
   * Playwright serializes this function into the page (no closure over Node).
   */
  await context.addInitScript((startMs) => {
    const w = window;
    if (w.__perftrace) return;
    const wallStart =
      typeof startMs === "number" && Number.isFinite(startMs)
        ? startMs
        : Date.now();
    const state = {
      t0: wallStart,
      samples: [],
      currentSec: -1,
      framesThisSec: 0,
    };
    const tick = () => {
      const nowWall = Date.now();
      const sec = Math.floor(Math.max(0, nowWall - wallStart) / 1000);
      if (state.currentSec < 0) {
        state.currentSec = sec;
      }
      while (state.currentSec < sec) {
        state.samples.push({
          timeSec: state.currentSec,
          value: Math.min(240, Math.max(0, state.framesThisSec)),
        });
        state.framesThisSec = 0;
        state.currentSec += 1;
      }
      state.framesThisSec += 1;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    w.__perftrace = state;
  }, t0);
}

async function ensureFpsCollector(page, opts = {}) {
  const force = opts.force === true;
  /** Wall time when the PerfTrace session started — aligns FPS seconds with CPU graphs */
  const wallClockStartMs = opts.wallClockStartMs;
  const wallStart = wallClockStartMs ?? Date.now();
  const frames = page.frames();
  for (const frame of frames) {
    try {
      await frame.evaluate(
        ([ws, forceReinstall]) => {
          const w = window;
          if (w.__perftrace && !forceReinstall) return;
          if (forceReinstall) delete w.__perftrace;
          const t0 =
            typeof ws === "number" && Number.isFinite(ws) ? ws : Date.now();
          const state = {
            t0,
            samples: [],
            currentSec: -1,
            framesThisSec: 0,
          };
          const tick = () => {
            const nowWall = Date.now();
            const sec = Math.floor(Math.max(0, nowWall - t0) / 1000);
            if (state.currentSec < 0) {
              state.currentSec = sec;
            }
            while (state.currentSec < sec) {
              state.samples.push({
                timeSec: state.currentSec,
                value: Math.min(240, Math.max(0, state.framesThisSec)),
              });
              state.framesThisSec = 0;
              state.currentSec += 1;
            }
            state.framesThisSec += 1;
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
          w.__perftrace = state;
        },
        [wallStart, force]
      );
    } catch {
      /* cross-origin iframe — cannot inject */
    }
  }
}

/**
 * CDP Animation events must be subscribed on each page's metrics session. After a tab
 * switch (automation), the old metrics CDP is stale — without this, animations/FPS/canvas
 * metrics miss the game tab.
 */
async function attachAnimationListenersOnMetricsCdp(
  metricsCdp,
  collectedAnimations,
  recordingStartMs,
  curtainLiftSessionRef
) {
  if (!metricsCdp || !Array.isArray(collectedAnimations)) return;
  try {
    await metricsCdp.send("Animation.enable");
    metricsCdp.on("Animation.animationStarted", (params) => {
      const a = params?.animation;
      if (!a || typeof a.id !== "string") return;
      const source = a.source;
      const props = extractAnimationProperties(a, source);
      const duration =
        typeof source?.duration === "number" ? source.duration : undefined;
      const delay =
        typeof source?.delay === "number" ? source.delay : undefined;
      collectedAnimations.push({
        id: a.id,
        name: extractAnimationName(a, source),
        type: a.type || "WebAnimation",
        startTimeSec: (Date.now() - recordingStartMs) / 1000,
        durationMs:
          duration != null ? cssTimingValueToMs(duration) : undefined,
        delayMs: delay != null ? cssTimingValueToMs(delay) : undefined,
        properties: props,
      });
      recordCurtainLiftFromAnimation(curtainLiftSessionRef?.current, a, source);
    });
  } catch (e) {
    console.warn("[PerfTrace] Animation.enable (rebind):", e?.message || e);
  }
}

async function ensureAnimationPropertyCollector(context) {
  await context.addInitScript(() => {
    const w = window;
    if (w.__perftraceAnimationProps !== undefined) return;
    w.__perftraceAnimationProps = [];
    const seen = new Set();
    const poll = () => {
      try {
        const anims = document.getAnimations?.() ?? [];
        for (const anim of anims) {
          const effect = anim.effect;
          if (!effect?.getKeyframes) continue;
          const keyframes = effect.getKeyframes();
          const props = [];
          for (const kf of keyframes) {
            if (kf && typeof kf === "object")
              for (const key of Object.keys(kf))
                if (
                  ![
                    "offset",
                    "easing",
                    "composite",
                    "computedoffset",
                    "compositeoperation",
                  ].includes(key.toLowerCase()) &&
                  !props.includes(key)
                )
                  props.push(key);
          }
          const name =
            anim.animationName ||
            anim.transitionProperty ||
            (props.length ? props[0] : "");
          const start = Number(anim.startTime) || 0;
          const dur = effect.getComputedTiming?.()?.duration ?? 0;
          const key = `${name}-${Math.round(start)}-${Math.round(dur)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          w.__perftraceAnimationProps.push({
            name,
            startTime: start,
            duration: dur,
            properties: props,
          });
        }
      } catch {}
    };
    poll();
    setInterval(poll, 800);
  });
}

/** Rounds from UI/API may be string, float, or missing — always 1 | 3 | 5 | 10. */
function normalizeAutomationRounds(raw) {
  const allowed = new Set([1, 3, 5, 10]);
  if (raw === undefined || raw === null || raw === "") {
    console.warn(
      "[PerfTrace] automation.rounds missing — defaulting to 1 (shortest run)"
    );
    return 1;
  }
  const n =
    typeof raw === "string" ? parseInt(raw.trim(), 10) : Number(raw);
  const r = Number.isFinite(n) ? Math.trunc(n) : NaN;
  if (allowed.has(r)) {
    console.log("[PerfTrace] automation rounds (normalized):", r);
    return r;
  }
  console.warn(
    "[PerfTrace] Invalid automation.rounds:",
    raw,
    "— defaulting to 1 (allowed: 1, 3, 5, 10)"
  );
  return 1;
}

/** Keys must match client `NetworkThrottlePreset` (useRecording.ts) and server/index.js. */
const NETWORK_PRESETS = {
  none: { latency: 0, downloadThroughput: -1, uploadThroughput: -1 },
  /** ~400 Kbps, high RTT — DevTools-style “Slow 3G”. */
  "slow-3g": {
    latency: 2000,
    downloadThroughput: 50 * 1024,
    uploadThroughput: 50 * 1024,
  },
  "fast-3g": {
    latency: 150,
    downloadThroughput: 200 * 1024,
    uploadThroughput: 200 * 1024,
  },
  /** Moderate mobile — still throttled vs desktop fiber. */
  "4g": {
    latency: 20,
    downloadThroughput: 5 * 1024 * 1024,
    uploadThroughput: 2 * 1024 * 1024,
  },
};

/**
 * CDP: network shaping + optional CPU slowdown on the page-attached session.
 * Re-applied after tab switches (automation opens game in a new page).
 */
async function applyPageEmulation(cdpSession, { cpuThrottle, networkThrottle }) {
  const key =
    networkThrottle && NETWORK_PRESETS[networkThrottle]
      ? networkThrottle
      : "none";
  const net = NETWORK_PRESETS[key];
  try {
    await cdpSession.send("Network.enable");
  } catch {
    /* ignore */
  }
  try {
    await cdpSession.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: net.latency,
      downloadThroughput: net.downloadThroughput,
      uploadThroughput: net.uploadThroughput,
    });
  } catch (e) {
    console.warn(
      "[PerfTrace] Network.emulateNetworkConditions:",
      e?.message || e
    );
  }
  if (cpuThrottle > 1) {
    try {
      await cdpSession.send("Emulation.setCPUThrottlingRate", {
        rate: cpuThrottle,
      });
    } catch {
      /* ignore */
    }
  }
}

async function maximizeBrowserWindow(cdpSession) {
  if (!cdpSession) return;
  try {
    const { windowId } = await cdpSession.send("Browser.getWindowForTarget");
    if (!windowId) return;
    await cdpSession.send("Browser.setWindowBounds", {
      windowId,
      bounds: { windowState: "maximized" },
    });
  } catch {
    /* ignore in headless or unsupported environments */
  }
}

/** Portrait: fixed window size (no maximize). Best-effort CDP sync after launch. */
async function setPortraitWindowBounds(cdpSession, width, height) {
  if (!cdpSession || !width || !height) return;
  try {
    const { windowId } = await cdpSession.send("Browser.getWindowForTarget");
    if (!windowId) return;
    await cdpSession.send("Browser.setWindowBounds", {
      windowId,
      bounds: {
        windowState: "normal",
        left: 80,
        top: 40,
        width,
        height,
      },
    });
  } catch {
    /* ignore */
  }
}

async function applySessionWindowChromeLayout(cdpSession, browserLayout) {
  if (!cdpSession) return;
  const layout = normalizeBrowserLayout(browserLayout);
  if (layout.mode === "portrait") {
    await setPortraitWindowBounds(cdpSession, layout.width, layout.height);
  } else {
    await maximizeBrowserWindow(cdpSession);
  }
}

/**
 * After navigating to a new tab, the old page may be closed — CDP sessions die with it.
 * Rebind metrics + trace CDP and reset perf deltas so sampling keeps working on the live tab.
 */
async function rebindCaptureSessionToPage(session, newPage) {
  if (!session?.context || !newPage) return;
  try {
    if (newPage.isClosed()) return;
  } catch {
    return;
  }
  const prevPage = session.page;
  if (prevPage && prevPage !== newPage && Array.isArray(session.fpsSamples)) {
    try {
      let closed = false;
      try {
        closed = prevPage.isClosed();
      } catch {
        closed = true;
      }
      if (!closed) {
        const frameList = prevPage.frames();
        for (const fr of frameList) {
          try {
            await finalizeInPageFpsSamples(fr, { includePartial: false });
            const chunk =
              (await fr.evaluate(
                () => window.__perftrace?.samples ?? []
              )) || [];
            for (const s of chunk) {
              if (
                s &&
                typeof s.timeSec === "number" &&
                Number.isFinite(s.timeSec) &&
                typeof s.value === "number" &&
                Number.isFinite(s.value)
              ) {
                session.fpsSamples.push({ timeSec: s.timeSec, value: s.value });
              }
            }
          } catch {
            /* cross-origin or detached */
          }
        }
      }
    } catch {
      /* ignore */
    }
  }
  session.page = newPage;
  const { context, cpuThrottle, networkThrottle } = session;
  try {
    await newPage.bringToFront().catch(() => {});
    const newMetrics = await context.newCDPSession(newPage);
    await newMetrics.send("Performance.enable");
    await applyPageEmulation(newMetrics, {
      cpuThrottle,
      networkThrottle: networkThrottle || "none",
    });
    await applySessionWindowChromeLayout(
      newMetrics,
      session.browserLayout ?? { mode: "landscape" }
    );
    session.metricsCdp = newMetrics;
    session.traceCdp = await context.newCDPSession(newPage);
    session.lastPerfTotals = undefined;
    const curtainLiftSessionRef = { current: session };
    await attachAnimationListenersOnMetricsCdp(
      newMetrics,
      session.collectedAnimations,
      session.startedAt,
      curtainLiftSessionRef
    );
    await ensureFpsCollector(newPage, {
      force: true,
      wallClockStartMs: session.startedAt,
    });
    session._foregroundBindPage = newPage;
    console.log(
      "[PerfTrace] Rebound CDP to active page:",
      newPage.url?.() || "(no url)"
    );
  } catch (e) {
    console.warn("[PerfTrace] rebindCaptureSessionToPage:", e?.message || e);
  }
}

async function detectCurtainLifecycle(session, page) {
  if (!session?.curtainLifecycle || !page) return;
  if (session.curtainLifecycleFrozen) return;
  if (session.curtainLifecycle.liftMsDom != null) return;
  try {
    if (page.isClosed()) return;
  } catch {
    return;
  }
  let seen = false;
  let dead = false;
  try {
    const frames = page.frames();
    for (const frame of frames) {
      const root = await frame
        .locator('[data-testid="curtain"], .curtain')
        .first()
        .elementHandle()
        .catch(() => null);
      if (!root) continue;
      seen = true;
      const hasDead = await frame
        .locator('[data-testid="curtain"].curtain_dead, .curtain.curtain_dead, [data-testid="curtain"] .curtain_dead, .curtain .curtain_dead')
        .first()
        .count()
        .then((c) => c > 0)
        .catch(() => false);
      if (hasDead) {
        dead = true;
        break;
      }
    }
  } catch {
    return;
  }
  if (seen) session.curtainLifecycle.seen = true;
  if (dead) {
    const base = session.assetCaptureStartTimeMs ?? 0;
    setCurtainLiftDomMs(
      session,
      Math.max(0, Date.now() - session.startedAt - base)
    );
  }
}

async function waitForPageToBecomeUsable(page) {
  if (!page) return false;
  try {
    if (page.isClosed()) return false;
  } catch {
    return false;
  }
  try {
    await page.waitForLoadState("domcontentloaded", { timeout: 15000 });
  } catch {
    /* allow already-open or slow pages */
  }
  try {
    return !page.isClosed();
  } catch {
    return false;
  }
}

/**
 * The browser tab the user is looking at (Chromium throttles background tabs).
 * Used to rebind CDP metrics so CPU / DOM / heap follow the active tab.
 */
async function findForegroundPage(context, fallbackPage) {
  let list = [];
  try {
    list = context.pages();
  } catch {
    return fallbackPage;
  }
  /** One tab: visibilityState can be wrong in embedded/OS focus edge cases — always use the live page. */
  if (list.length === 1) {
    const only = list[0];
    try {
      if (!only.isClosed()) return only;
    } catch {
      return only;
    }
  }
  /** Prefer the session-bound page if it is still open (stable for manual same-tab runs). */
  if (fallbackPage) {
    try {
      if (!fallbackPage.isClosed()) {
        for (const p of list) {
          if (p === fallbackPage) return fallbackPage;
        }
      }
    } catch {
      /* continue */
    }
  }
  for (const p of list) {
    try {
      if (p.isClosed()) continue;
    } catch {
      continue;
    }
    const vs = await p
      .evaluate(() => document.visibilityState)
      .catch(() => null);
    if (vs === "visible") return p;
  }
  return fallbackPage ?? list[0] ?? null;
}

/**
 * Manual SPA: optional matcher so preload/network baseline starts when the address bar
 * matches (substring or regex). Regex wins if both are provided.
 */
function normalizeAssetBaselineUrlMatcher(input) {
  if (!input || typeof input !== "object") return null;
  const contains =
    typeof input.assetBaselineUrlContains === "string"
      ? input.assetBaselineUrlContains.trim()
      : "";
  const regex =
    typeof input.assetBaselineUrlRegex === "string"
      ? input.assetBaselineUrlRegex.trim()
      : "";
  const flags =
    typeof input.assetBaselineUrlRegexFlags === "string"
      ? input.assetBaselineUrlRegexFlags
      : "i";
  if (regex) {
    try {
      const re = new RegExp(regex, flags);
      return (url) => re.test(url || "");
    } catch (e) {
      console.warn("[PerfTrace] Invalid assetBaselineUrlRegex:", e.message);
      return null;
    }
  }
  if (contains) {
    return (url) => (url || "").includes(contains);
  }
  return null;
}

/**
 * When the session starts on casino auth and the user did not set a preload baseline,
 * start counting downloads when the URL first matches any assetGameKeys substring (regex).
 * Aligns manual auth→lobby→game runs with direct game URL reports.
 */
function tryImplicitAssetBaselineFromAuthEntry(
  startUrl,
  assetGameKeys,
  userBaselineInput,
  automationEnabled
) {
  if (automationEnabled) return null;
  if (normalizeAssetBaselineUrlMatcher(userBaselineInput)) return null;
  const keys = [
    ...new Set(
      (assetGameKeys || [])
        .map((k) => String(k || "").trim())
        .filter(Boolean)
    ),
  ];
  if (keys.length === 0) return null;
  try {
    const u = new URL(startUrl);
    if (!/authenticate/i.test(u.pathname || "")) return null;
  } catch {
    return null;
  }
  try {
    const escaped = keys.map((k) =>
      k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    );
    return {
      assetBaselineUrlRegex: escaped.join("|"),
      assetBaselineUrlRegexFlags: "i",
    };
  } catch {
    return null;
  }
}

/**
 * Charts and report duration use wall-clock t=0 at `timelineZeroMs` (first baseline commit).
 * Trim pre-baseline rows so series match session video (see `report.video.timelineOffsetSec`).
 */
function rebaseSampleRows(samples, deltaMs) {
  if (!deltaMs || deltaMs <= 0 || !Array.isArray(samples)) return samples || [];
  const offSec = deltaMs / 1000;
  return samples
    .filter((s) => (s.timeSec ?? 0) * 1000 >= deltaMs - 1e-3)
    .map((s) => ({ ...s, timeSec: Math.max(0, (s.timeSec ?? 0) - offSec) }));
}

/**
 * Merged __perftrace samples from every tab can list the same wall second more than once.
 * Take the max FPS per second so the game tab (highest rAF rate) wins vs idle tabs, and we
 * do not average a 60fps game with a 0fps lobby into a misleading number.
 */
function dedupeFpsSamplesBySecondMax(samples) {
  if (!Array.isArray(samples) || samples.length === 0) return samples || [];
  const bySec = new Map();
  for (const p of samples) {
    const t = typeof p.timeSec === "number" ? p.timeSec : 0;
    const sec = Math.floor(t + 1e-9);
    const v = typeof p.value === "number" && Number.isFinite(p.value) ? p.value : 0;
    bySec.set(sec, Math.max(bySec.get(sec) ?? 0, v));
  }
  return [...bySec.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([timeSec, value]) => ({ timeSec, value }));
}

function rebaseNetworkRequestsForReport(rows, deltaMs) {
  if (!deltaMs || deltaMs <= 0 || !Array.isArray(rows)) return rows || [];
  return rows
    .filter((r) => (r.endTimeMs ?? 0) >= deltaMs - 1e-3)
    .map((r) => ({
      ...r,
      startTimeMs:
        r.startTimeMs != null
          ? Math.max(0, r.startTimeMs - deltaMs)
          : r.startTimeMs,
      endTimeMs:
        r.endTimeMs != null ? Math.max(0, r.endTimeMs - deltaMs) : r.endTimeMs,
    }));
}

function rebaseCollectedAnimations(anims, deltaMs) {
  if (!deltaMs || deltaMs <= 0 || !Array.isArray(anims)) return anims || [];
  const offSec = deltaMs / 1000;
  return anims.map((a) => ({
    ...a,
    startTimeSec:
      a.startTimeSec != null
        ? Math.max(0, a.startTimeSec - offSec)
        : a.startTimeSec,
  }));
}

/**
 * Align long-task timestamps with rebased CPU/FPS (same performance timeline origin as session
 * start for the captured document — subtract pre-baseline lobby time).
 */
function rebaseLongTaskTimelinesForReport(report, deltaMs) {
  if (!deltaMs || deltaMs <= 0 || !report?.longTasks) return;
  const off = deltaMs / 1000;
  const lt = report.longTasks;
  if (Array.isArray(lt.tbtTimeline)) {
    lt.tbtTimeline = lt.tbtTimeline
      .filter((e) => (e.startSec ?? 0) >= off - 1e-6)
      .map((e) => ({
        ...e,
        startSec: Math.max(0, (e.startSec ?? 0) - off),
        endSec: Math.max(0, (e.endSec ?? 0) - off),
      }));
  }
  if (Array.isArray(lt.topTasks)) {
    lt.topTasks = lt.topTasks
      .filter((t) => (t.startSec ?? 0) >= off - 1e-6)
      .map((t) => ({
        ...t,
        startSec: Math.max(0, (t.startSec ?? 0) - off),
      }));
  }
}

/** Same baseline as automation when the game surface opens: wall-clock + perf timeline origin for SPAs. */
async function commitAssetBaseline(session, newPage) {
  if (!session || !newPage) return;
  try {
    if (newPage.isClosed()) return;
  } catch {
    return;
  }
  session.page = newPage;
  try {
    session.recordedUrl = newPage.url() || session.recordedUrl;
  } catch {
    /* ignore */
  }
  if (!session._gameSurfaceBaselineCommitted) {
    if (session.reportTimelineZeroMs == null) {
      session.reportTimelineZeroMs = Date.now();
    }
    session.assetCaptureStartTimeMs = Math.max(0, Date.now() - session.startedAt);
    try {
      session.assetBaselinePerfMs = await newPage.evaluate(() => performance.now());
    } catch {
      session.assetBaselinePerfMs = undefined;
    }
    session.curtainLifecycle = {
      seen: false,
      liftMsDom: undefined,
      liftMsAnimation: undefined,
    };
    session.curtainLifecycleFrozen = false;
    session._gameSurfaceBaselineCommitted = true;
    console.log(
      "[PerfTrace] Asset capture baseline set (first game surface):",
      session.recordedUrl || "(no url)"
    );
  } else {
    session.curtainLifecycleFrozen = true;
    console.log(
      "[PerfTrace] Game page updated — curtain/preload baseline kept from first open:",
      session.recordedUrl || "(no url)"
    );
  }
}

function scorePageForGameArtifacts(p, assetGameKeys, recordedUrlHint) {
  let u = "";
  try {
    u = p.url() || "";
  } catch {
    return -1;
  }
  const lower = u.toLowerCase();
  let s = 0;
  const keys = (assetGameKeys || [])
    .map((k) => String(k || "").trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (lower.includes(k.toLowerCase())) s += 4;
  }
  if (lower.includes("/desktop/colorgame")) s += 3;
  if (lower.includes("gametype=colorgame")) s += 2;
  if (
    typeof recordedUrlHint === "string" &&
    recordedUrlHint.trim() &&
    lower.includes(recordedUrlHint.trim().toLowerCase().split("?")[0])
  )
    s += 1;
  return s;
}

/**
 * Prefer the tab whose URL matches game asset keys so Resource Timing / curtain / FCP match
 * the game surface even if another tab is technically “primary”.
 */
function pickArtifactSourcePage(pages, primaryPage, assetGameKeys, recordedUrlHint) {
  const list =
    pages?.length > 0 ? pages : primaryPage ? [primaryPage] : [];
  let best = primaryPage ?? list[0];
  let bestScore = best ? scorePageForGameArtifacts(best, assetGameKeys, recordedUrlHint) : -1;
  for (const p of list) {
    const sc = scorePageForGameArtifacts(p, assetGameKeys, recordedUrlHint);
    if (sc > bestScore) {
      bestScore = sc;
      best = p;
    }
  }
  return best ?? primaryPage;
}

/**
 * FPS samples are merged from every tab (session timeline). Resource Timing, navigation,
 * curtain lifecycle, Web Vitals collectors, and animation metadata come from one tab —
 * the game surface when detectable — so lobby/auth timings do not skew preload/FCP.
 */
async function collectMergedClientArtifacts(context, primaryPage, opts = {}) {
  let pageFps = [];
  let resourceEntries = [];
  let navigationEntries = [];
  let lifecycleTimings = null;
  let clientCollector = null;
  let clientAnimationProps = [];

  const pages = [];
  try {
    for (const p of context.pages()) {
      if (!p) continue;
      let closed = false;
      try {
        closed = p.isClosed();
      } catch {
        closed = true;
      }
      if (closed) continue;
      pages.push(p);
    }
  } catch {
    if (primaryPage) pages.push(primaryPage);
  }
  if (pages.length === 0 && primaryPage) pages.push(primaryPage);

  const { assetGameKeys = [], recordedUrl = "" } = opts;
  const picked = pickArtifactSourcePage(pages, primaryPage, assetGameKeys, recordedUrl);
  let resourcePages = [picked ?? primaryPage ?? pages[0]].filter(Boolean);
  if (resourcePages.length === 0) resourcePages = pages;
  try {
    if (resourcePages[0]?.isClosed?.()) resourcePages = pages.length ? [pages[0]] : [];
  } catch {
    resourcePages = pages;
  }

  for (const p of pages) {
    let pageUrl = "";
    try {
      pageUrl = p.url();
    } catch {
      pageUrl = "";
    }

    const frameList = [];
    try {
      frameList.push(...p.frames());
    } catch {
      try {
        frameList.push(p.mainFrame());
      } catch {
        /* ignore */
      }
    }
    for (const fr of frameList) {
      try {
        await finalizeInPageFpsSamples(fr);
        const extra =
          (await fr.evaluate(() => window.__perftrace?.samples ?? [])) || [];
        for (const s of extra) {
          pageFps.push({ ...s, _pageUrl: pageUrl });
        }
      } catch {
        /* cross-origin iframe or detached */
      }
    }
  }

  for (const p of resourcePages) {
    let pageUrl = "";
    try {
      pageUrl = p.url();
    } catch {
      pageUrl = "";
    }

    try {
      const data =
        (await p.evaluate(() => window.__perftraceResources ?? null)) || {};
      const res = Array.isArray(data) ? data : (data.resources ?? []);
      const nav = Array.isArray(data) ? [] : (data.navigation ?? []);
      const life = Array.isArray(data) ? null : (data.lifecycle ?? null);
      resourceEntries.push(
        ...res.map((r) =>
          typeof r === "object" && r !== null
            ? { ...r, _pageUrl: pageUrl }
            : r
        )
      );
      navigationEntries.push(
        ...nav.map((n) =>
          typeof n === "object" && n !== null
            ? { ...n, _pageUrl: pageUrl }
            : n
        )
      );
      if (life && typeof life === "object" && !lifecycleTimings) {
        lifecycleTimings = life;
      }
    } catch {}

    try {
      const c = await p.evaluate(() => {
        const collector = window.__perftraceCollector ?? null;
        if (!collector) return null;
        try {
          const paint = performance.getEntriesByType?.("paint") ?? [];
          const fcp = paint.find((e) => e.name === "first-contentful-paint");
          if (fcp) collector.fcp = fcp.startTime;
        } catch {}
        try {
          const lcp =
            performance.getEntriesByType?.("largest-contentful-paint") ?? [];
          if (lcp.length) collector.lcp = lcp[lcp.length - 1].startTime;
        } catch {}
        return collector;
      });
      if (c) {
        const lt = Array.isArray(c.longTasks) ? c.longTasks : [];
        const ls = Array.isArray(c.layoutShiftEntries)
          ? c.layoutShiftEntries
          : [];
        if (!clientCollector) {
          clientCollector = {
            ...c,
            longTasks: [...lt],
            layoutShiftEntries: [...ls],
          };
        } else {
          clientCollector.longTasks.push(...lt);
          clientCollector.layoutShiftEntries.push(...ls);
          if (c.fcp != null) {
            if (
              clientCollector.fcp == null ||
              c.fcp < clientCollector.fcp
            ) {
              clientCollector.fcp = c.fcp;
            }
          }
          if (c.lcp != null) {
            if (
              clientCollector.lcp == null ||
              c.lcp > clientCollector.lcp
            ) {
              clientCollector.lcp = c.lcp;
            }
          }
        }
      }
    } catch {}

    try {
      const anim =
        (await p.evaluate(() => window.__perftraceAnimationProps ?? [])) || [];
      if (Array.isArray(anim) && anim.length) {
        clientAnimationProps.push(
          ...anim.map((a) =>
            typeof a === "object" && a !== null
              ? { ...a, _pageUrl: pageUrl }
              : a
          )
        );
      }
    } catch {}
  }

  if (clientCollector?.layoutShiftEntries?.length) {
    try {
      clientCollector.cls = computeClsFromEntries(
        clientCollector.layoutShiftEntries
      );
    } catch {
      /* ignore */
    }
  }

  pageFps.sort((a, b) => (a.timeSec ?? 0) - (b.timeSec ?? 0));

  return {
    pageFps,
    resourceEntries,
    navigationEntries,
    lifecycleTimings,
    clientCollector,
    clientAnimationProps,
  };
}

function attachPopupTracking(session, candidatePage) {
  if (!session || !candidatePage) return;
  if (!session.trackedPages) session.trackedPages = new WeakSet();
  if (session.trackedPages.has(candidatePage)) return;
  session.trackedPages.add(candidatePage);

  candidatePage.on("popup", (popupPage) => {
    attachPopupTracking(session, popupPage);
  });

  candidatePage.on("close", () => {
    if (session.page === candidatePage) {
      const fallbackPage = session.context
        .pages()
        .find((page) => page !== candidatePage && !page.isClosed());
      if (fallbackPage) {
        void session.rebindToActivePage?.(fallbackPage);
      }
    }
  });
}

async function createCaptureSession(
  url,
  cpuThrottle = 1,
  networkThrottle = "none",
  recordVideo = true,
  videoQuality = "high",
  traceDetail = "full",
  assetGameKeys = [],
  automationOpts = null,
  browserLayoutInput = null,
  assetBaselineInput = null
) {
  if (activeSession) {
    throw new Error("A recording session is already running.");
  }

  cachedSessionReport = null;
  lastAutomationError = null;

  const safeUrl = ensureValidUrl(url);
  const implicitAssetBaseline =
    process.env.PERFTRACE_IMPLICIT_AUTH_BASELINE === "1"
      ? tryImplicitAssetBaselineFromAuthEntry(
          safeUrl,
          assetGameKeys,
          assetBaselineInput,
          !!(automationOpts && automationOpts.enabled)
        )
      : null;
  if (implicitAssetBaseline) {
    console.log(
      "[PerfTrace] Implicit preload baseline (PERFTRACE_IMPLICIT_AUTH_BASELINE=1):",
      implicitAssetBaseline.assetBaselineUrlRegex
    );
  }
  const assetBaselineUrlTest =
    normalizeAssetBaselineUrlMatcher(assetBaselineInput) ||
    normalizeAssetBaselineUrlMatcher(implicitAssetBaseline);
  const browserLayout = normalizeBrowserLayout(browserLayoutInput || {});
  const launchOptions = await getLaunchOptions(browserLayout);

  function resolvePlaywrightViewport(headless, layout) {
    if (layout.mode === "portrait") {
      return { width: layout.width, height: layout.height };
    }
    if (headless) {
      return { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT };
    }
    return null;
  }

  const videoDir = path.join(os.tmpdir(), "perftrace-videos");
  await fs.mkdir(videoDir, { recursive: true });
  // Cleanup previous session video + old artifacts.
  if (lastVideo?.path) {
    await fs.unlink(lastVideo.path).catch(() => {});
    lastVideo = null;
  }
  await cleanupOldVideos(videoDir).catch(() => {});

  const browser = await chromium.launch(launchOptions);
  const videoSize =
    browserLayout.mode === "portrait"
      ? { width: browserLayout.width, height: browserLayout.height }
      : videoQuality === "low"
        ? { width: 960, height: 540 }
        : { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT };
  const ctxViewport = resolvePlaywrightViewport(
    launchOptions.headless === true,
    browserLayout
  );
  const context = await browser.newContext({
    viewport: ctxViewport,
    ...(browserLayout.mode === "portrait"
      ? { isMobile: true, hasTouch: true }
      : {}),
    ...(recordVideo
      ? {
          recordVideo: {
            dir: videoDir,
            size: videoSize,
          },
        }
      : {}),
  });
  await ensureClientCollectors(context);
  await ensureMemoryAndDomCollector(context);
  await ensureAnimationPropertyCollector(context);
  await ensureResourceTimingCollector(context);

  const page = await context.newPage();
  const recordingStartMs = Date.now();
  /**
   * Register before first navigation so the main document and all same-origin iframes run the
   * rAF FPS counter (top-level shell pages often have no animation; games live in iframes).
   */
  await registerFpsCollectorInitScript(context, recordingStartMs);
  const captureSessionId = randomUUID();
  const traceCdp = await context.newCDPSession(page);
  const metricsCdp = await context.newCDPSession(page);

  // Do NOT use context.tracing.start() here: Chrome allows one global Tracing session.
  // Playwright's trace would conflict with our CDP Tracing.start below and yield empty
  // or wrong GPU/layout/paint data.

  await metricsCdp.send("Performance.enable");
  const networkThrottlePreset =
    networkThrottle && NETWORK_PRESETS[networkThrottle]
      ? networkThrottle
      : "none";
  await applyPageEmulation(metricsCdp, {
    cpuThrottle,
    networkThrottle: networkThrottlePreset,
  });
  await applySessionWindowChromeLayout(metricsCdp, browserLayout);
  /** Set after `activeSession` exists so liftCurtain can update curtain lift time. */
  const curtainLiftSessionRef = { current: null };
  const collectedAnimations = [];
  await attachAnimationListenersOnMetricsCdp(
    metricsCdp,
    collectedAnimations,
    recordingStartMs,
    curtainLiftSessionRef
  );
  const traceCategories =
    traceDetail === "light"
      ? [
          // Enough for CPU/layout/paint-ish signals without deep GPU categories.
          "devtools.timeline",
          "blink.user_timing",
          "blink.resource",
          "v8",
        ]
      : [
          "devtools.timeline",
          "disabled-by-default-devtools.timeline",
          "disabled-by-default-devtools.timeline.frame",
          "disabled-by-default-devtools.timeline.paint",
          "disabled-by-default-devtools.timeline.layers",
          "disabled-by-default-devtools.timeline.stack",
          "blink.user_timing",
          "blink.resource",
          "v8",
          "gpu",
          "cc",
          "latencyInfo",
          "disabled-by-default-gpu.service",
        ];
  await traceCdp.send("Tracing.start", {
    categories: traceCategories.join(","),
    transferMode: "ReturnAsStream",
  });

  await page.goto(safeUrl, { waitUntil: "domcontentloaded" });
  /** Idempotent: covers any frame that was not created via a navigation (rare). */
  await ensureFpsCollector(page, { wallClockStartMs: recordingStartMs });

  const samples = [];
  const fpsSamples = [];
  const networkRequests = [];
  const requestIds = new WeakMap();
  const pendingRequests = new Map();

  context.on("request", (request) => {
    const id = randomUUID();
    requestIds.set(request, id);
    pendingRequests.set(id, {
      url: request.url(),
      method: request.method(),
      startAt: Date.now(),
      startTimeMs: Date.now() - recordingStartMs,
    });
  });
  const onRequestEnd = async (request) => {
    const id = requestIds.get(request);
    if (!id) return;
    const pending = pendingRequests.get(id);
    if (!pending) return;
    pendingRequests.delete(id);
    const response = await request.response();
    networkRequests.push({
      url: pending.url,
      method: pending.method,
      status: response?.status(),
      type: request.resourceType(),
      durationMs: Date.now() - pending.startAt,
      startTimeMs: pending.startTimeMs,
      endTimeMs: Date.now() - recordingStartMs,
      transferSize: response?.headers()["content-length"]
        ? Number(response.headers()["content-length"])
        : undefined,
    });
  };
  context.on("requestfinished", onRequestEnd);
  context.on("requestfailed", onRequestEnd);

  const takePerfSample = async () => {
    try {
      const sess = activeSession;
      /**
       * During casino automation, `findForegroundPage` can pick the lobby tab while the game
       * runs in another tab — rebinding CDP to the lobby breaks sampling and can race with
       * Playwright locators on the game page ("Target page, context or browser has been closed").
       */
      const automationHoldGameTab =
        !!sess?.automationEnabled &&
        sess?.automation?.phase &&
        ["game", "betting"].includes(sess.automation.phase);
      if (sess?.context && !automationHoldGameTab) {
        const fg = await findForegroundPage(sess.context, sess.page ?? page);
        if (fg && sess && fg !== sess._foregroundBindPage) {
          await rebindCaptureSessionToPage(sess, fg);
        }
      }
      const activePage = activeSession?.page ?? page;
      /**
       * URL baseline commits only for manual runs. Casino automation must not commit here —
       * lobby/auth URLs can match implicit/user regex before the game; that pins t=0 too early
       * and blocks anchoring at `markGamePageStart` (game from lobby).
       */
      if (
        sess?.assetBaselineUrlTest &&
        !sess._gameSurfaceBaselineCommitted &&
        !sess.automationEnabled
      ) {
        let u = "";
        try {
          u = activePage.url();
        } catch {
          u = "";
        }
        if (sess.assetBaselineUrlTest(u)) {
          await commitAssetBaseline(sess, activePage);
        }
      }
      await detectCurtainLifecycle(activeSession, activePage);
      let metrics = null;
      try {
        metrics = await (activeSession?.metricsCdp ?? metricsCdp).send(
          "Performance.getMetrics"
        );
      } catch (e) {
        const s = activeSession;
        if (s && !s._getMetricsErrorLogged) {
          s._getMetricsErrorLogged = true;
          console.warn(
            "[PerfTrace] Performance.getMetrics failed (using deltas=0, keeping last snapshot):",
            e?.message || e
          );
        }
      }
      const lastTotals = sess?.lastPerfTotals;
      const metricMap = new Map(
        (metrics?.metrics ?? []).map((m) => [m.name, m.value])
      );
      let jsHeapSize =
        metricMap.get("JSHeapUsedSize") ?? metricMap.get("JSHeapSize") ??
        lastTotals?.jsHeapSize ?? 0;
      let nodes =
        metricMap.get("Nodes") ?? metricMap.get("DOMNodeCount") ??
        lastTotals?.nodes ?? 0;
      try {
        const client = await activePage.evaluate(
          () => window.__perftraceMemory ?? null
        );
        if (client) {
          if (client.heapMb > 0) jsHeapSize = client.heapMb * 1024 * 1024;
          if (client.nodes > 0) nodes = client.nodes;
        }
      } catch {}
      const gotCdp = !!(metrics?.metrics && metrics.metrics.length);
      const totals = gotCdp
        ? {
            taskDuration: metricMap.get("TaskDuration") ?? 0,
            scriptDuration: metricMap.get("ScriptDuration") ?? 0,
            layoutDuration: metricMap.get("LayoutDuration") ?? 0,
            paintDuration: metricMap.get("PaintDuration") ?? 0,
            jsHeapSize,
            nodes,
          }
        : lastTotals
          ? {
              taskDuration: lastTotals.taskDuration,
              scriptDuration: lastTotals.scriptDuration,
              layoutDuration: lastTotals.layoutDuration,
              paintDuration: lastTotals.paintDuration,
              jsHeapSize,
              nodes,
            }
          : {
              taskDuration: 0,
              scriptDuration: 0,
              layoutDuration: 0,
              paintDuration: 0,
              jsHeapSize,
              nodes,
            };
      if (gotCdp && sess) sess.lastPerfTotals = totals;
      const deltaTask = lastTotals
        ? Math.max(0, (totals.taskDuration - lastTotals.taskDuration) * 1000)
        : 0;
      const deltaScript = lastTotals
        ? Math.max(
            0,
            (totals.scriptDuration - lastTotals.scriptDuration) * 1000
          )
        : 0;
      const deltaLayout = lastTotals
        ? Math.max(
            0,
            (totals.layoutDuration - lastTotals.layoutDuration) * 1000
          )
        : 0;
      const deltaPaint = lastTotals
        ? Math.max(0, (totals.paintDuration - lastTotals.paintDuration) * 1000)
        : 0;
      const SAMPLE_WINDOW_MS = 1000;
      const cpuPercent = Math.min(
        100,
        Math.max(0, (deltaTask / SAMPLE_WINDOW_MS) * 100)
      );
      let activeUrl = "";
      try {
        activeUrl = activePage.url();
      } catch {
        activeUrl = "";
      }
      samples.push({
        timeSec: Math.max(0, (Date.now() - recordingStartMs) / 1000),
        cpuBusyMs: deltaTask,
        cpuPercent,
        scriptMs: deltaScript,
        layoutMs: deltaLayout,
        paintMs: deltaPaint,
        jsHeapMb: totals.jsHeapSize
          ? totals.jsHeapSize / (1024 * 1024)
          : undefined,
        nodes: totals.nodes || undefined,
        activePageUrl: activeUrl || undefined,
      });
    } catch (e) {
      const s = activeSession;
      if (s && !s._takePerfSampleErrorLogged) {
        s._takePerfSampleErrorLogged = true;
        console.warn(
          "[PerfTrace] takePerfSample failed (metrics may be empty):",
          e?.message || e
        );
      }
    }
  };
  const sampleInterval = setInterval(() => {
    void takePerfSample();
  }, 1000);

  const automationEnabled = !!(automationOpts && automationOpts.enabled);
  activeSession = {
    browser,
    context,
    page,
    traceCdp,
    metricsCdp,
    captureSessionId,
    /** When true, skip URL-based baseline in the sampler so game open sets t=0 via automation only. */
    automationEnabled,
    startedAt: recordingStartMs,
    recordedUrl: safeUrl,
    samples,
    fpsSamples,
    networkRequests,
    sampleInterval,
    cpuThrottle,
    networkThrottle: networkThrottlePreset,
    traceDetail,
    assetGameKeys: Array.isArray(assetGameKeys) ? assetGameKeys : [],
    collectedAnimations,
    lastPerfTotals: undefined,
    trackedPages: new WeakSet(),
    assetCaptureStartTimeMs: 0,
    curtainLifecycle: {
      seen: false,
      liftMsDom: undefined,
      liftMsAnimation: undefined,
    },
    curtainLifecycleFrozen: false,
    _gameSurfaceBaselineCommitted: false,
    /** First `commitAssetBaseline` wall time — report + video t=0 when URL baseline / game open. */
    reportTimelineZeroMs: undefined,
    browserLayout,
    _foregroundBindPage: page,
    assetBaselineUrlTest,
    assetBaselinePerfMs: undefined,
    recordVideo: recordVideo !== false,
    videoQuality: videoQuality === "low" ? "low" : "high",
  };

  curtainLiftSessionRef.current = activeSession;

  activeSession.rebindToActivePage = async function rebindPage(newPage) {
    await rebindCaptureSessionToPage(this, newPage);
  };
  activeSession.markGamePageStart = function markGamePageStart(newPage) {
    return commitAssetBaseline(this, newPage);
  };

  attachPopupTracking(activeSession, page);
  void takePerfSample();

  context.on("page", (newPage) => {
    attachPopupTracking(activeSession, newPage);
    void ensureFpsCollector(newPage, {
      wallClockStartMs: activeSession?.startedAt ?? recordingStartMs,
    }).catch(() => {});
    void (async () => {
      const usable = await waitForPageToBecomeUsable(newPage);
      if (!usable) return;
      await activeSession?.rebindToActivePage?.(newPage);
    })();
  });

  if (automationOpts?.enabled) {
    const { runCasinoAutomation } = require("./casinoAutomation");
    const { getAutomationGame } = require("./casinoGames");
    const ac = new AbortController();
    activeSession.automationAbort = ac;
    const rounds = normalizeAutomationRounds(automationOpts.rounds);
    const gameId = automationOpts.gameId || "color-game-bonanza";
    const gameMeta = getAutomationGame(gameId);
    activeSession.automation = {
      gameId,
      rounds,
      phase: "starting",
      skipLobby: !!automationOpts.skipLobby,
    };
    const user =
      automationOpts.casinoUser ||
      process.env.CASINO_USER ||
      gameMeta?.defaultCasinoUser ||
      "abdulg";
    const password =
      automationOpts.casinoPass ||
      process.env.CASINO_PASS ||
      gameMeta?.defaultCasinoPass ||
      "abdulg123";

    void runCasinoAutomation(activeSession, {
      gameId,
      rounds,
      user,
      password,
      skipLobby: !!automationOpts.skipLobby,
      signal: ac.signal,
    })
      .then(async () => {
        if (activeSession) await stopCaptureSession();
      })
      .catch(async (err) => {
        if (err && err.code === "AUTOMATION_CANCELLED") {
          return;
        }
        lastAutomationError = err instanceof Error ? err.message : String(err);
        console.error("[PerfTrace] Automation failed:", err);
        if (activeSession) await stopCaptureSession();
      });
  }

  return {
    status: "recording",
    url: safeUrl,
    browserLayout: activeSession.browserLayout,
    automation: automationOpts?.enabled
      ? {
          enabled: true,
          gameId: activeSession.automation?.gameId ?? "color-game-bonanza",
          rounds: activeSession.automation?.rounds ?? 1,
          skipLobby: !!automationOpts.skipLobby,
        }
      : undefined,
  };
}

async function stopCaptureSession(opts = {}) {
  const userRequested = !!opts.userRequested;

  if (!activeSession) {
    const fallback = buildFallbackReport(Date.now() - 60000, Date.now(), {
      samples: [],
      fpsSamples: [],
      networkRequests: [],
      clientCollector: null,
    });
    fallback.suggestions.push({
      title: "No active session",
      detail: "No recording was in progress. Start a session first.",
      severity: "info",
    });
    return fallback;
  }

  if (userRequested && activeSession.automationAbort) {
    try {
      activeSession.automationAbort.abort();
    } catch {
      /* ignore */
    }
  }

  reportGenerationInProgress = true;
  try {
    const {
      browser,
      context,
      page,
      traceCdp,
      startedAt,
      captureSessionId: sessionCaptureId,
      recordedUrl = null,
      samples,
      fpsSamples,
      networkRequests,
      sampleInterval,
      assetGameKeys = [],
      collectedAnimations = [],
      assetCaptureStartTimeMs = 0,
      assetBaselinePerfMs = undefined,
      reportTimelineZeroMs: sessionReportTimelineZeroMs,
      curtainLifecycle = {
        seen: false,
        liftMsDom: undefined,
        liftMsAnimation: undefined,
      },
      cpuThrottle: sessionCpuThrottle = 1,
      networkThrottle: sessionNetworkThrottle = "none",
      traceDetail: sessionTraceDetail = "full",
      browserLayout: sessionBrowserLayout = { mode: "landscape" },
      recordVideo: sessionRecordVideo = true,
      videoQuality: sessionVideoQuality = "high",
      automation: sessionAutomation = null,
    } = activeSession;
    activeSession = null;

    if (sampleInterval) clearInterval(sampleInterval);

  let mergedArtifacts;
  try {
    mergedArtifacts = await collectMergedClientArtifacts(context, page, {
      assetGameKeys,
      recordedUrl: recordedUrl ?? "",
    });
  } catch (e) {
    console.warn("[PerfTrace] collectMergedClientArtifacts:", e?.message || e);
    mergedArtifacts = {
      pageFps: [],
      resourceEntries: [],
      navigationEntries: [],
      lifecycleTimings: null,
      clientCollector: null,
      clientAnimationProps: [],
    };
  }
  fpsSamples.push(...(mergedArtifacts.pageFps || []));
  const fpsSamplesDeduped = dedupeFpsSamplesBySecondMax(fpsSamples);
  const resourceEntries = mergedArtifacts.resourceEntries;
  const navigationEntries = mergedArtifacts.navigationEntries;
  const lifecycleTimings = mergedArtifacts.lifecycleTimings;
  const clientCollector = mergedArtifacts.clientCollector;
  const clientAnimationProps = mergedArtifacts.clientAnimationProps;

  const stopRequestedAt = Date.now();
  const filteredNetworkRequestsForAssets = (networkRequests || []).filter(
    (r) => (r.endTimeMs ?? 0) >= assetCaptureStartTimeMs
  );

  const timelineZeroMs = sessionReportTimelineZeroMs ?? startedAt;
  const timelineDeltaMs = Math.max(0, timelineZeroMs - startedAt);
  let samplesForReport = samples;
  /**
   * When a game/baseline is set (automation or URL match), rebase FPS the same as CPU/heap so
   * all live charts share one time origin and duration (lobby/redirect seconds omitted).
   */
  let fpsSamplesForReport = fpsSamplesDeduped;
  let networkRequestsForReport = filteredNetworkRequestsForAssets;
  let animForReport = collectedAnimations;
  if (timelineDeltaMs > 0) {
    samplesForReport = rebaseSampleRows(samples, timelineDeltaMs);
    fpsSamplesForReport = rebaseSampleRows(fpsSamplesDeduped, timelineDeltaMs);
    networkRequestsForReport = rebaseNetworkRequestsForReport(
      filteredNetworkRequestsForAssets,
      timelineDeltaMs
    );
    animForReport = rebaseCollectedAnimations(
      collectedAnimations,
      timelineDeltaMs
    );
    console.log(
      "[PerfTrace] Charts + video aligned to baseline at +%ss from session start",
      (timelineDeltaMs / 1000).toFixed(2)
    );
  }

  let cdpTraceText = "";
  try {
    cdpTraceText = await readCdpTracingTrace(traceCdp);
  } catch (e) {
    console.warn("[PerfTrace] CDP trace read:", e?.message || e);
  }

  /**
   * Playwright `Video.path()` waits for the page to close (artifact resolves on close).
   * Awaiting `path()` *before* `context.close()` deadlocks: path never resolves until the
   * context closes, so the browser window stays open forever. Collect handles first,
   * close the context, then read paths.
   */
  const videoHandles = [];
  try {
    for (const p of context.pages()) {
      if (p.isClosed()) continue;
      const v = p.video();
      if (v) videoHandles.push(v);
    }
  } catch {
    /* ignore */
  }

  await context.close().catch((e) =>
    console.warn("[PerfTrace] context.close:", e?.message || e)
  );
  await browser.close().catch((e) =>
    console.warn("[PerfTrace] browser.close:", e?.message || e)
  );

  const candidates = [];
  for (const v of videoHandles) {
    try {
      const fp = await v.path();
      const st = await fs.stat(fp);
      candidates.push({ path: fp, size: st.size });
    } catch {}
  }
  if (candidates.length > 0) {
    candidates.sort((a, b) => b.size - a.size);
    lastVideo = {
      path: candidates[0].path,
      startedAt,
      recordedUrl: recordedUrl ?? null,
    };
  }

  const traceText = "";

  const traceTextForParser = pickTraceTextForParser(traceText, cdpTraceText);
  if (!cdpTraceText || cdpTraceText.length < 100) {
    console.warn(
      "[PerfTrace] CDP trace short or empty (",
      cdpTraceText?.length ?? 0,
      "chars); GPU/layout may be missing"
    );
  }
  if (cdpTraceText && traceTextForParser === cdpTraceText) {
    console.log(
      "[PerfTrace] Using CDP Chrome trace for metrics (",
      parseTraceEvents(cdpTraceText).length,
      "events)"
    );
  }

  let report;
  try {
    report = await parseTraceToReport(
      null,
      traceTextForParser,
      timelineZeroMs,
      stopRequestedAt,
      {
        samples: samplesForReport,
        fpsSamples: fpsSamplesForReport,
        networkRequests: networkRequestsForReport,
        clientCollector,
        forceSampleSeries: timelineDeltaMs > 0,
        sessionRecordingStartedAt: startedAt,
      }
    );
  } catch (err) {
    console.warn("[PerfTrace] parseTrace failed, using fallback:", err.message);
    report = buildFallbackReport(startedAt, stopRequestedAt, {
      samples: samplesForReport,
      fpsSamples: fpsSamplesForReport,
      networkRequests: networkRequestsForReport,
      clientCollector,
      captureSessionId: sessionCaptureId,
    });
  }

  /**
   * Rebasing trims CPU/heap/DOM to the game window (t=0 at baseline). Chart X domain for
   * those series must match this span; full wall-clock session length stays in durationMs.
   */
  if (timelineDeltaMs > 0) {
    report.alignedDurationMs = Math.max(0, stopRequestedAt - timelineZeroMs);
    rebaseLongTaskTimelinesForReport(report, timelineDeltaMs);
  }

  const timelineOffsetSec =
    timelineDeltaMs > 0 ? timelineDeltaMs / 1000 : undefined;
  report.video = lastVideo
    ? {
        url: "/api/video",
        format: "webm",
        ...(timelineOffsetSec != null && timelineOffsetSec > 0
          ? { timelineOffsetSec }
          : {}),
      }
    : null;
  report.recordedUrl = recordedUrl ?? null;
  report.captureSessionId = sessionCaptureId ?? null;

  const netKey =
    sessionNetworkThrottle && NETWORK_PRESETS[sessionNetworkThrottle]
      ? sessionNetworkThrottle
      : "none";
  const netPreset = NETWORK_PRESETS[netKey];
  report.captureSettings = {
    cpuThrottle: sessionCpuThrottle,
    networkThrottle: netKey,
    networkProfile: {
      latencyMs: netPreset.latency,
      downloadBps:
        netPreset.downloadThroughput >= 0 ? netPreset.downloadThroughput : null,
      uploadBps:
        netPreset.uploadThroughput >= 0 ? netPreset.uploadThroughput : null,
    },
    traceDetail: sessionTraceDetail === "light" ? "light" : "full",
    recordVideo: !!sessionRecordVideo,
    videoQuality: sessionVideoQuality === "low" ? "low" : "high",
    browserLayout:
      sessionBrowserLayout?.mode === "portrait"
        ? {
            mode: "portrait",
            width: sessionBrowserLayout.width,
            height: sessionBrowserLayout.height,
          }
        : { mode: "landscape" },
    ...(sessionAutomation &&
    (sessionAutomation.gameId || sessionAutomation.enabled)
      ? {
          automation: {
            enabled: !!sessionAutomation.enabled,
            gameId: sessionAutomation.gameId ?? undefined,
            rounds: sessionAutomation.rounds,
            skipLobby: !!sessionAutomation.skipLobby,
          },
        }
      : {}),
  };

  /** Preload vs curtain: Resource Timing + network ends share one scale (ms since game nav, or wall→perf via baseline). */
  const curtainLiftPerfMs = curtainLiftPerfMsForRollup(
    lifecycleTimings,
    curtainLifecycle,
    assetBaselinePerfMs
  );

  report.downloadedAssets = buildDownloadedAssetsSummary(
    resourceEntries,
    navigationEntries,
    filteredNetworkRequestsForAssets,
    clientCollector?.fcp,
    assetGameKeys,
    curtainLiftPerfMs,
    assetCaptureStartTimeMs,
    assetBaselinePerfMs
  );

  const mainThreadBlockedMs = report.webVitals?.tbtMs ?? 0;
  report.blockingSummary = {
    totalBlockedMs: report.longTasks.totalTimeMs,
    longTaskCount: report.longTasks.count,
    maxBlockingMs:
      report.longTasks.topTasks.length > 0
        ? Math.max(...report.longTasks.topTasks.map((t) => t.durationMs))
        : 0,
    mainThreadBlockedMs,
  };

  const cpuPoints = report.cpuSeries?.points ?? [];
  const fpsPoints = report.fpsSeries?.points ?? [];
  const memPoints = report.memorySeries?.points ?? [];
  const domPoints = report.domNodesSeries?.points ?? [];
  report.summaryStats = {
    avgFps:
      fpsPoints.length > 0
        ? fpsPoints.reduce((s, p) => s + p.value, 0) / fpsPoints.length
        : 0,
    avgCpu:
      cpuPoints.length > 0
        ? cpuPoints.reduce((s, p) => s + p.value, 0) / cpuPoints.length
        : 0,
    peakMemMb:
      memPoints.length > 0 ? Math.max(...memPoints.map((p) => p.value)) : 0,
    peakDomNodes:
      domPoints.length > 0 ? Math.max(...domPoints.map((p) => p.value)) : 0,
  };

  const clientAnims = (clientAnimationProps || []).map((a) => {
    const propName =
      a.properties?.length && a.properties[0]
        ? a.properties[0].charAt(0).toUpperCase() +
          a.properties[0].slice(1).replace(/-./g, (m) => m[1].toUpperCase())
        : "";
    return {
      id: (a.name || propName) + "-" + (a.startTime ?? 0),
      name: a.name || propName || "(unnamed)",
      type: "CSSAnimation",
      startTimeSec: (a.startTime ?? 0) / 1000,
      durationMs: a.duration ?? 0,
      properties: a.properties ?? [],
      bottleneckHint: inferBottleneck(a.properties, a.name || propName),
    };
  });
  const cdpAnims = (animForReport || []).map((a) => {
    const cdpPropName =
      a.properties?.length && a.properties[0]
        ? a.properties[0].charAt(0).toUpperCase() +
          a.properties[0].slice(1).replace(/-./g, (m) => m[1].toUpperCase())
        : "";
    return {
      id: a.id,
      name: a.name || cdpPropName || "(unnamed)",
      type: a.type || "WebAnimation",
      startTimeSec: a.startTimeSec ?? 0,
      durationMs: a.durationMs,
      properties: a.properties ?? [],
      bottleneckHint: inferBottleneck(a.properties, a.name || cdpPropName),
    };
  });
  const allAnims = [...clientAnims];
  for (const c of cdpAnims) {
    const dup = allAnims.some(
      (x) =>
        Math.abs(x.startTimeSec - c.startTimeSec) < 0.5 &&
        (x.name === c.name ||
          (x.properties?.length &&
            c.properties?.length &&
            x.properties[0] === c.properties[0]))
    );
    if (!dup) allAnims.push(c);
  }
  const animationsNormalized = normalizeAnimationEntries(allAnims);
  report.animationMetrics = {
    ...report.animationMetrics,
    animations: animationsNormalized,
    totalAnimations: allAnims.length,
    bottleneckCounts: countAnimationBottlenecks(animationsNormalized),
  };
    cachedSessionReport = report;
    return report;
  } finally {
    reportGenerationInProgress = false;
  }
}

function buildFallbackReport(startedAt, stoppedAt, fallback) {
  const durationMs = Math.max(0, stoppedAt - startedAt);
  const {
    samples,
    fpsSamples,
    networkRequests,
    clientCollector,
    captureSessionId: fallbackSessionId,
  } = fallback;
  const totalScript = samples.reduce((s, x) => s + x.scriptMs, 0);
  const totalLayout = samples.reduce((s, x) => s + x.layoutMs, 0);
  const totalPaint = samples.reduce((s, x) => s + (x.paintMs ?? 0), 0);
  const tbt =
    clientCollector?.longTasks?.reduce(
      (s, t) => s + Math.max(0, t.duration - 50),
      0
    ) ?? 0;
  const avgLatency =
    networkRequests.length === 0
      ? 0
      : networkRequests.reduce((s, r) => s + (r.durationMs ?? 0), 0) /
        networkRequests.length;
  const totalBytes = networkRequests.reduce(
    (s, r) => s + (r.transferSize ?? 0),
    0
  );
  const clientLongTasks = clientCollector?.longTasks ?? [];
  const longTaskTotalMsFb = clientLongTasks.reduce(
    (s, t) => s + (t.duration ?? 0),
    0
  );
  const maxDurFb =
    clientLongTasks.length > 0
      ? Math.max(...clientLongTasks.map((t) => t.duration ?? 0))
      : 0;
  const topTasksFb = [...clientLongTasks]
    .sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0))
    .slice(0, 5)
    .map((t) => ({
      name: "longtask",
      durationMs: t.duration ?? 0,
      startSec: (t.start ?? 0) / 1000,
      attribution: "PerformanceObserver",
    }));
  const tbtTimelineFallback = clientLongTasks.map((t) => {
    const durationMs = t.duration ?? 0;
    const startSec = (t.start ?? 0) / 1000;
    const blockingMs = Math.max(0, durationMs - 50);
    return {
      startSec,
      endSec: startSec + durationMs / 1000,
      durationMs,
      blockingMs,
      attribution: "longtask (PerformanceObserver)",
    };
  });

  return {
    startedAt: new Date(startedAt).toISOString(),
    stoppedAt: new Date(stoppedAt).toISOString(),
    durationMs,
    captureSessionId: fallbackSessionId ?? null,
    fpsSeries: { label: "FPS", unit: "fps", points: fpsSamples },
    cpuSeries: {
      label: "CPU",
      unit: "%",
      points: samples.map((s) => ({
        timeSec: s.timeSec,
        value: Math.min(100, Math.max(0, (s.cpuBusyMs / 1000) * 100)),
      })),
    },
    gpuSeries: { label: "GPU", unit: "%", points: [] },
    memorySeries: {
      label: "JS Heap",
      unit: "MB",
      points: samples
        .filter((s) => typeof s.jsHeapMb === "number")
        .map((s) => ({ timeSec: s.timeSec, value: s.jsHeapMb })),
    },
    domNodesSeries: {
      label: "DOM Nodes",
      unit: "count",
      points: samples
        .filter((s) => typeof s.nodes === "number")
        .map((s) => ({ timeSec: s.timeSec, value: s.nodes })),
    },
    layoutMetrics: {
      layoutCount: 0,
      paintCount: 0,
      layoutTimeMs: totalLayout,
      paintTimeMs: totalPaint,
    },
    longTasks: {
      count: clientLongTasks.length,
      totalTimeMs: longTaskTotalMsFb,
      topTasks: topTasksFb,
      tbtTimeline: tbtTimelineFallback,
    },
    frameTiming: null,
    blockingSummary: {
      totalBlockedMs: longTaskTotalMsFb,
      longTaskCount: clientLongTasks.length,
      maxBlockingMs: maxDurFb,
      mainThreadBlockedMs: tbt,
    },
    networkSummary: {
      requests: networkRequests.length,
      totalBytes,
      averageLatencyMs: avgLatency,
    },
    networkRequests,
    renderBreakdown: {
      scriptMs: totalScript,
      layoutMs: totalLayout,
      rasterMs: 0,
      compositeMs: 0,
    },
    webglMetrics: { drawCalls: 0, shaderCompiles: 0, otherEvents: 0 },
    animationMetrics: {
      animations: [],
      animationFrameEventsPerSec: {
        label: "Animation frames",
        unit: "count",
        points: fpsSamples,
      },
      totalAnimations: 0,
      bottleneckCounts: {
        compositor: 0,
        paint: 0,
        layout: 0,
        unclassified: 0,
      },
    },
    webVitals: {
      fcpMs: clientCollector?.fcp,
      lcpMs: clientCollector?.lcp,
      cls:
        clientCollector?.layoutShiftEntries != null
          ? computeClsFromEntries(clientCollector.layoutShiftEntries)
          : (clientCollector?.cls ?? 0),
      tbtMs: tbt,
      longTaskCount: clientCollector?.longTasks?.length ?? 0,
      longTaskTotalMs:
        clientCollector?.longTasks?.reduce((s, t) => s + t.duration, 0) ?? 0,
    },
    spikeFrames: [],
    video: null,
    suggestions: [],
    gpuEstimated: true,
  };
}

async function getLiveMetrics() {
  const session = activeSession;
  if (!session) return null;
  let evalPage = session.page;
  try {
    if (session.context) {
      const fg = await findForegroundPage(session.context, session.page);
      if (fg) {
        try {
          if (!fg.isClosed()) evalPage = fg;
        } catch {
          evalPage = fg;
        }
      }
    }
  } catch {
    /* keep session.page */
  }
  const elapsedSec = (Date.now() - session.startedAt) / 1000;
  const last = session.samples[session.samples.length - 1];
  let fps = null;
  try {
    const frames = evalPage.frames();
    for (const fr of frames) {
      try {
        const v = await fr.evaluate(() => {
          const p = window.__perftrace;
          if (!p) return null;
          if (p.samples?.length) return p.samples[p.samples.length - 1].value;
          if (
            p.currentSec >= 0 &&
            p.framesThisSec > 0 &&
            typeof p.t0 === "number"
          ) {
            const nowWall = Date.now();
            const secStart = p.t0 + p.currentSec * 1000;
            const partialMs = Math.max(1, nowWall - secStart);
            return Math.min(240, (p.framesThisSec * 1000) / partialMs);
          }
          return null;
        });
        if (typeof v === "number" && Number.isFinite(v)) {
          fps = fps == null ? v : Math.max(fps, v);
        }
      } catch {
        /* cross-origin or detached */
      }
    }
  } catch {}
  const cpuPercent =
    last?.cpuPercent ??
    (last?.cpuBusyMs != null
      ? Math.min(100, Math.max(0, (last.cpuBusyMs / 1000) * 100))
      : null);
  return {
    recording: true,
    elapsedSec,
    fps,
    cpuPercent,
    cpuBusyMs: last ? last.cpuBusyMs : null,
    jsHeapMb: last?.jsHeapMb ?? null,
    domNodes: last?.nodes ?? null,
  };
}

async function getLatestVideo() {
  if (!lastVideo?.path) throw new Error("No video available.");
  return {
    path: lastVideo.path,
    contentType: "video/webm",
    startedAt: lastVideo.startedAt,
    recordedUrl: lastVideo.recordedUrl,
  };
}

async function cleanupOldVideos(videoDir) {
  // Keep the last few artifacts; remove very old files to prevent /tmp bloat.
  const entries = await fs.readdir(videoDir).catch(() => []);
  if (!entries.length) return;
  const now = Date.now();
  const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
  const MAX_KEEP = 12;

  const stats = [];
  for (const name of entries) {
    if (!name.toLowerCase().endsWith(".webm")) continue;
    const full = path.join(videoDir, name);
    try {
      const st = await fs.stat(full);
      stats.push({ path: full, mtimeMs: st.mtimeMs });
    } catch {
      /* ignore */
    }
  }
  stats.sort((a, b) => b.mtimeMs - a.mtimeMs);

  const toDelete = [];
  for (let i = 0; i < stats.length; i++) {
    const f = stats[i];
    const tooOld = now - f.mtimeMs > MAX_AGE_MS;
    const beyondKeep = i >= MAX_KEEP;
    if (tooOld || beyondKeep) toDelete.push(f.path);
  }
  await Promise.all(toDelete.map((p) => fs.unlink(p).catch(() => {})));
}

function getSessionSnapshot() {
  return {
    recording: !!activeSession,
    processing: reportGenerationInProgress,
    report: cachedSessionReport,
    automation: activeSession?.automation ?? null,
    error: lastAutomationError,
  };
}

module.exports = {
  createCaptureSession,
  stopCaptureSession,
  getLiveMetrics,
  getLatestVideo,
  getSessionSnapshot,
};
