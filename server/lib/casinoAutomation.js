/**
 * Pragmatic Play Live — login → lobby → game → rounds.
 * - `automationMode: "observe"` (roulette): timer → result only (no chip clicks).
 * - `automationMode: "betting"` (Color Game Bonanza): matches Performance_Automation/casinoBettingFlow.js (chip + bet spot each round).
 * - `skipLobby: true`: start URL is already the game (same URL the lobby tile would open). Skips login + lobby; consent click then wait for canvas/timer → rounds.
 */
const { getAutomationGame } = require("./casinoGames");

/** Bonus / jackpot rounds can stall timer → result for several minutes */
const ROUND_PHASE_TIMEOUT_MS = 300000;

/** Mirrors Performance_Automation/casinoBettingFlow.js TIMING for lobby search + game load. */
const TIMING = {
  loginFormMaxWaitMs: 25000,
  /** Login form poll — tight loop until username field appears */
  loginPollMs: 35,
  /** First wait for lobby after login — short probe before DESKTOP launcher retry; keep generous (SPA + auth redirect). */
  lobbyProbeMs: 12000,
  lobbyAfterDesktopMs: 60000,
  lobbyPollMs: 50,
  /** After typing game name — rely on tile waitFor (casinoBettingFlow). */
  searchDebounceMs: 80,
  /** After Enter — before networkidle (casinoBettingFlow). */
  searchAfterEnterMs: 200,
  /**
   * After networkidle — filtered lobby tiles can repaint; avoids clicking a stale first tile
   * before search results finish rendering.
   */
  searchResultsSettleMs: 500,
  gameTileTimeoutMs: 25000,
  canvasPollMs: 200,
  /** Default Playwright timeout during betting + round waits (aligned with round phases). */
  betUiTimeoutMs: ROUND_PHASE_TIMEOUT_MS,
  /** Post-game load settle before observe loop (chip wait in betting flow is ~400ms). */
  gameUiSettleMs: 3500,
  /** Between rounds only — last round skips this long wait */
  resultHiddenBetweenRoundsMs: ROUND_PHASE_TIMEOUT_MS,
  /** Timer hidden → result shown → result hidden; shared by betting + observe flows */
  roundPhaseTimeoutMs: ROUND_PHASE_TIMEOUT_MS,
  /** After final result visible, brief settle then stop (no 3min hidden wait) */
  lastRoundSettleMs: 1500,
};

const ALLOWED_ROUNDS = new Set([1, 3, 5, 10]);

function resolveRoundsCount(n) {
  const v =
    typeof n === "string" ? parseInt(n.trim(), 10) : parseInt(String(n), 10);
  if (ALLOWED_ROUNDS.has(v)) return v;
  console.warn(
    `[PerfTrace] Unexpected rounds value (${n}) — forcing 1. Expected one of 1, 3, 5, 10.`
  );
  return 1;
}

function checkNotCancelled(session, signal) {
  if (signal?.aborted) {
    const err = new Error("Automation cancelled");
    err.code = "AUTOMATION_CANCELLED";
    throw err;
  }
  if (session?.browser && !session.browser.isConnected()) {
    throw new Error("Browser session ended");
  }
}

function setPhase(session, phase) {
  if (session?.automation) session.automation.phase = phase;
}

/**
 * `commitAssetBaseline` sets `reportTimelineZeroMs`; if it bails (e.g. `isClosed()` race on
 * responsive viewports), charts stay anchored at session start and trace CPU spans the full run.
 * Call after each `markGamePageStart` when the game URL/surface is the intended t=0.
 */
function ensureAutomationTimelineBaseline(session, contextLabel) {
  if (!session?.automationEnabled) return;
  if (session.reportTimelineZeroMs != null) return;
  session.reportTimelineZeroMs = Date.now();
  console.warn(
    `[PerfTrace] Automation t=0 fallback (${contextLabel}): reportTimelineZeroMs was unset — using wall clock now (trim charts/video from here).`
  );
}

/** Page has waitForTimeout; Frame does not — use owning Page for delays. */
function getTimeoutPage(root) {
  if (root && typeof root.waitForTimeout === "function") return root;
  if (root && typeof root.page === "function") {
    const p = root.page();
    if (p && typeof p.waitForTimeout === "function") return p;
  }
  return root;
}

/** Non-empty `timerBettingOpen` from config/env; empty string treated as unset. */
function effectiveTimerBettingOpen(config) {
  const v = config?.timerBettingOpen;
  if (v == null) return undefined;
  const s = String(v).trim();
  return s || undefined;
}

/** Main document + all iframes — timer/result may live only in the game frame. */
function allFrameRoots(page) {
  const frames = page.frames();
  const roots = [];
  const seen = new Set();
  for (const f of frames) {
    if (seen.has(f)) continue;
    seen.add(f);
    roots.push(f);
  }
  return roots.length ? roots : [page.mainFrame()];
}

/**
 * First frame where the betting phase is visible.
 * Prefer `timerBettingOpen` when set (countdown actually running); else fall back to `timer`.
 */
async function waitTimerVisibleReturnRoot(page, config) {
  const openSel = effectiveTimerBettingOpen(config);
  const sel = openSel || config.timer;
  const roots = allFrameRoots(page);
  let lastErr;
  for (const root of roots) {
    try {
      await root.locator(sel).first().waitFor({
        state: "visible",
        timeout: TIMING.roundPhaseTimeoutMs,
      });
      console.log(
        `[PerfTrace] Betting timer visible (${openSel ? "timerBettingOpen" : "timer"} root=${root === page.mainFrame() ? "main" : "child-frame"}).`
      );
      return root;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

/** Prefer session-bound page when still open (automation keeps game tab as session.page). */
function getOpenGamePage(session, fallbackPage) {
  try {
    if (session?.page && !session.page.isClosed()) return session.page;
  } catch {
    /* stale reference */
  }
  try {
    if (fallbackPage && !fallbackPage.isClosed()) return fallbackPage;
  } catch {
    /* ignore */
  }
  return fallbackPage;
}

/**
 * Table UI (chip + bet spots) is inside the same iframe as the canvas; shell `page.locator`
 * can resolve hidden/off-screen duplicates first so the real tile never gets clicked.
 */
async function resolveGameBettingRoot(page, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (page.isClosed()) break;
    } catch {
      break;
    }
    for (const frame of page.frames()) {
      try {
        const cv = frame.locator("canvas").first();
        if ((await cv.count()) === 0) continue;
        if (await cv.isVisible().catch(() => false)) {
          console.log("[PerfTrace] Betting UI: game iframe (visible canvas).");
          return frame;
        }
      } catch {
        /* next frame */
      }
    }
    await getTimeoutPage(page).waitForTimeout(200);
  }
  console.warn("[PerfTrace] No canvas iframe — betting uses full page (may miss tiles).");
  return page;
}

async function ensureChipTrayOpen(root, chipSelector) {
  if (!chipSelector || !String(chipSelector).trim()) return;
  const chip = root.locator(chipSelector).first();
  if (await chip.isVisible().catch(() => false)) return;
  console.log("[PerfTrace] Opening chip tray…");
  const tray = root
    .locator(
      '[data-testid*="chip-stack"], [data-testid*="ChipStack"], [data-testid*="chip-stack"]'
    )
    .first();
  if (await tray.isVisible().catch(() => false)) {
    await tray.click({ force: true }).catch(() => {});
    await getTimeoutPage(root).waitForTimeout(900);
  }
}

async function waitUntilAnyVisible(root, selector, timeoutMs, label) {
  const sel = String(selector).trim();
  if (!sel) return;
  const loc = root.locator(sel);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let n = 0;
    try {
      n = await loc.count();
    } catch {
      n = 0;
    }
    for (let i = 0; i < n; i++) {
      if (await loc.nth(i).isVisible().catch(() => false)) return;
    }
    await getTimeoutPage(root).waitForTimeout(120);
  }
  throw new Error(`[PerfTrace] ${label}: nothing visible within ${timeoutMs}ms`);
}

/**
 * Betting timer may appear on another tab or iframe; polling all pages + frames avoids
 * waiting on a stale Page reference after foreground/rebind races ("browser has been closed").
 */
async function waitForBettingTimerPage(
  context,
  preferredPage,
  config,
  timeoutMs,
  session,
  signal
) {
  const openSel = effectiveTimerBettingOpen(config);
  const sel = openSel || config.timer;
  if (!sel || !String(sel).trim()) {
    throw new Error("Betting config: missing timer selector");
  }
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    checkNotCancelled(session, signal);
    if (session?.browser && !session.browser.isConnected()) {
      throw new Error("Browser session ended");
    }
    const tryPages = [];
    const seen = new Set();
    const add = (p) => {
      if (!p) return;
      try {
        if (p.isClosed()) return;
      } catch {
        return;
      }
      if (seen.has(p)) return;
      seen.add(p);
      tryPages.push(p);
    };
    try {
      if (context?.pages) {
        for (const p of context.pages()) add(p);
      }
    } catch {
      /* context may be closing */
    }
    add(preferredPage);
    add(session?.page);

    for (const page of tryPages) {
      const roots = allFrameRoots(page);
      for (const root of roots) {
        try {
          await root.locator(sel).first().waitFor({
            state: "visible",
            timeout: 900,
          });
          if (session && page) session.page = page;
          console.log(
            `[PerfTrace] Betting timer visible (${openSel ? "timerBettingOpen" : "timer"}) url=${page.url?.().slice(0, 80) || "?"}`
          );
          return page;
        } catch (e) {
          lastErr = e;
        }
      }
    }
    await new Promise((r) => setTimeout(r, 180));
  }
  throw lastErr ?? new Error("Betting timer did not become visible");
}

/** First frame where `result` appears (may differ from timer frame on some builds). */
async function waitResultVisibleReturnRoot(page, config) {
  const sel = config.result;
  const roots = allFrameRoots(page);
  let lastErr;
  for (const root of roots) {
    try {
      await root.locator(sel).first().waitFor({
        state: "visible",
        timeout: TIMING.roundPhaseTimeoutMs,
      });
      return root;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

async function resolveLoginContext(page) {
  const hasVisibleUsername = async (target) => {
    const loc = target.locator('input[name="username"]');
    if ((await loc.count()) === 0) return false;
    return loc
      .first()
      .isVisible()
      .catch(() => false);
  };

  const tryOnce = async () => {
    if (await hasVisibleUsername(page)) return page;
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      if (await hasVisibleUsername(frame)) return frame;
    }
    return null;
  };

  const deadline = Date.now() + TIMING.loginFormMaxWaitMs;
  while (Date.now() < deadline) {
    const ctx = await tryOnce();
    if (ctx) return ctx;
    await page.waitForTimeout(TIMING.loginPollMs);
  }

  throw new Error(
    'No visible input[name="username"] on main page or iframes — page layout may have changed.'
  );
}

async function loginToCasino(page, user, pass, session, signal) {
  checkNotCancelled(session, signal);
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  const ctx = await resolveLoginContext(page);

  const userInput = ctx.locator('input[name="username"]').first();
  const passInput = ctx.locator('input[name="password"]').first();

  await Promise.all([
    userInput.waitFor({ state: "visible", timeout: 12000 }),
    passInput.waitFor({ state: "attached", timeout: 12000 }),
  ]);

  /**
   * Pragmatic auth fields use `readonly` until focus — e.g. onfocus="this.removeAttribute('readonly')".
   * `fill()` alone does not run that handler first, so Playwright sees a non-editable input and times out.
   */
  await userInput.click({ timeout: 8000 });
  await userInput.fill(user, { timeout: 10000 });
  await passInput.click({ timeout: 8000 });
  await passInput.fill(pass, { timeout: 10000 });

  const verifyBtn = ctx.getByRole("button", { name: /verify me/i });
  await verifyBtn.waitFor({ state: "visible", timeout: 8000 });
  await verifyBtn.click({ timeout: 8000 });
}

/**
 * Same intent as casinoBettingFlow.js waitForStableGamePage: poll until the game is up.
 * Important: Playwright `page.$("canvas")` only queries the **main frame**; Pragmatic games usually put the
 * table canvas inside an iframe, so we use `locator("canvas")` which searches all frames.
 * If still nothing (slow/unusual build), optional `timerSelector` from game config means the table UI is ready.
 */
async function waitForStableGamePage(context, timeoutMs = 90000, timerSelector) {
  const start = Date.now();
  let lastLog = 0;
  while (Date.now() - start < timeoutMs) {
    for (const p of context.pages()) {
      if (p.isClosed()) continue;
      const canvasCount = await p.locator("canvas").count();
      if (canvasCount > 0) {
        const visible = await p
          .locator("canvas")
          .first()
          .isVisible()
          .catch(() => false);
        if (visible) {
          return p;
        }
      }
      if (timerSelector && String(timerSelector).trim()) {
        const timerVisible = await p
          .locator(timerSelector)
          .first()
          .isVisible()
          .catch(() => false);
        if (timerVisible) {
          console.log(
            "[PerfTrace] Game ready (timer visible; canvas not required on this build/tab)."
          );
          return p;
        }
      }
    }
    if (Date.now() - lastLog > 10000) {
      console.log("[PerfTrace] …waiting for game canvas (game tab loading)");
      lastLog = Date.now();
    }
    await new Promise((r) => setTimeout(r, TIMING.canvasPollMs));
  }
  throw new Error(
    "Game canvas not found within timeout — check game tile / popup blockers."
  );
}

/** Pragmatic client lobby URL after auth (path varies: lobby2, lobby, etc.). */
function isPragmaticLobbyUrl(url) {
  if (!url || typeof url !== "string") return false;
  return /pragmaticplaylive\.net\/.*\/desktop\/lobby/i.test(url);
}

async function isAuthUsernameFieldVisible(p) {
  return p
    .locator('input[name="username"]')
    .first()
    .isVisible()
    .catch(() => false);
}

/**
 * Certification / Color Game may use game-shows; roulette uses category-search.
 * Builds differ: also match loose [data-testid*="…"] and URL + search input when on client lobby.
 */
async function isLobbyReady(p, testIds) {
  for (const id of testIds) {
    const ok = await p
      .locator(`[data-testid="${id}"]`)
      .first()
      .isVisible()
      .catch(() => false);
    if (ok) return true;
  }
  const loose = await p
    .locator(
      '[data-testid*="lobby-category-search"], [data-testid*="lobby-category-game-shows"], [data-testid*="game-shows"], [data-testid="lobby-search"]'
    )
    .first()
    .isVisible()
    .catch(() => false);
  if (loose) return true;

  const url = p.url();
  if (isPragmaticLobbyUrl(url) && !(await isAuthUsernameFieldVisible(p))) {
    const inputField = await p
      .getByTestId("input-field")
      .first()
      .isVisible()
      .catch(() => false);
    if (inputField) return true;
    const tile = await p
      .getByTestId("tile-container")
      .first()
      .isVisible()
      .catch(() => false);
    if (tile) return true;
  }
  return false;
}

/**
 * Certification / Color Game: exact copy of casinoBettingFlow.js `isLobbyReady` — only
 * `lobby-category-search` and `lobby-category-game-shows` (no URL / loose fallbacks).
 */
async function isLobbyReadyScript(p) {
  for (const id of ["lobby-category-search", "lobby-category-game-shows"]) {
    const ok = await p
      .locator(`[data-testid="${id}"]`)
      .first()
      .isVisible()
      .catch(() => false);
    if (ok) return true;
  }
  return false;
}

/**
 * @param {import("playwright").BrowserContext} context
 * @param {{
 *   timeoutMs: number,
 *   lobbyReadyTestIds: string[],
 *   lobbyStyle?: "script" | "extended",
 * }} opts
 */
async function waitForLobbyPage(context, opts) {
  const { timeoutMs, lobbyReadyTestIds, lobbyStyle = "extended" } = opts;
  const deadline = Date.now() + timeoutMs;
  let lastLog = 0;
  while (Date.now() < deadline) {
    for (const p of context.pages()) {
      if (p.isClosed()) continue;
      const ready =
        lobbyStyle === "script"
          ? await isLobbyReadyScript(p)
          : await isLobbyReady(p, lobbyReadyTestIds);
      if (ready) return p;
    }
    if (Date.now() - lastLog > 15000) {
      console.log("[PerfTrace] …waiting for lobby");
      lastLog = Date.now();
    }
    await new Promise((r) => setTimeout(r, TIMING.lobbyPollMs));
  }
  return null;
}

/**
 * Exact sequence from casinoBettingFlow.js `searchAndClickFirstTile` (first `tile-container`, no text filter).
 */
async function searchAndClickFirstTileScript(lobbyPage, gameSearchText, searchTriggerTestId) {
  await lobbyPage.waitForLoadState("domcontentloaded").catch(() => {});

  // Portrait / responsive builds may render the same nav link twice (e.g. slider + main nav).
  const search = lobbyPage.getByTestId(searchTriggerTestId).first();
  const input = lobbyPage.getByTestId("input-field").first();

  await search.waitFor({ state: "visible", timeout: 15000 });
  await search.click();
  await input.waitFor({ state: "visible", timeout: 15000 });
  await input.fill(gameSearchText, { timeout: 10000 });
  if (TIMING.searchDebounceMs > 0) {
    await lobbyPage.waitForTimeout(TIMING.searchDebounceMs);
  }
  await input.press("Enter").catch(() => {});

  await lobbyPage.waitForTimeout(TIMING.searchAfterEnterMs);
  await lobbyPage
    .waitForLoadState("networkidle", { timeout: 8000 })
    .catch(() => {});

  const firstTile = lobbyPage.getByTestId("tile-container").first();
  console.log("[PerfTrace] Waiting for first table tile after search…");
  await firstTile.waitFor({
    state: "visible",
    timeout: TIMING.gameTileTimeoutMs,
  });
  console.log("[PerfTrace] Clicking first table in search results…");
  await firstTile.scrollIntoViewIfNeeded();
  try {
    await firstTile.click({ timeout: 15000 });
  } catch {
    await firstTile.click({ force: true, timeout: 10000 });
  }
}

/**
 * PerfTrace roulette path: same base as script, then prefer a tile whose text matches the search.
 */
async function searchAndClickFirstTile(lobbyPage, gameSearchText, searchTriggerTestId) {
  await lobbyPage.waitForLoadState("domcontentloaded").catch(() => {});

  const search = lobbyPage.getByTestId(searchTriggerTestId).first();
  const input = lobbyPage.getByTestId("input-field").first();

  await search.waitFor({ state: "visible", timeout: 15000 });
  await search.click();
  await input.waitFor({ state: "visible", timeout: 15000 });
  await input.fill(gameSearchText, { timeout: 10000 });
  if (TIMING.searchDebounceMs > 0) {
    await lobbyPage.waitForTimeout(TIMING.searchDebounceMs);
  }
  await input.press("Enter").catch(() => {});

  await lobbyPage.waitForTimeout(TIMING.searchAfterEnterMs);
  await lobbyPage
    .waitForLoadState("networkidle", { timeout: 8000 })
    .catch(() => {});

  await lobbyPage.waitForTimeout(TIMING.searchResultsSettleMs);

  const byLabel = lobbyPage
    .getByTestId("tile-container")
    .filter({ hasText: gameSearchText })
    .first();
  const fallback = lobbyPage.getByTestId("tile-container").first();

  let tile = byLabel;
  try {
    await byLabel.waitFor({
      state: "visible",
      timeout: Math.min(12000, TIMING.gameTileTimeoutMs),
    });
  } catch {
    console.log(
      "[PerfTrace] No tile matched search text yet — using first visible tile-container."
    );
    tile = fallback;
  }

  await tile.waitFor({
    state: "visible",
    timeout: TIMING.gameTileTimeoutMs,
  });
  await tile.scrollIntoViewIfNeeded();
  try {
    await tile.click({ timeout: 15000 });
  } catch {
    await tile.click({ force: true, timeout: 10000 });
  }
}

async function closeOtherTabs(context, keepPage) {
  const pages = context.pages();
  for (const p of pages) {
    if (p === keepPage) continue;
    if (!p.isClosed()) {
      await p.close().catch(() => {});
    }
  }
}

async function openLobbyAndLaunchGame(
  page,
  context,
  gameSearchText,
  session,
  signal,
  lobbyOptions
) {
  checkNotCancelled(session, signal);
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  const baseLobbyIds = lobbyOptions?.lobbyReadyTestIds ?? ["lobby-category-search"];
  const envExtra =
    typeof process.env.LOBBY_READY_TESTIDS === "string"
      ? process.env.LOBBY_READY_TESTIDS.split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
  const lobbyReadyTestIds = [...new Set([...baseLobbyIds, ...envExtra])];
  const searchTriggerTestId =
    lobbyOptions?.lobbySearchTriggerTestId ?? "lobby-category-search";

  const automationMode = lobbyOptions?.automationMode || "observe";
  /**
   * Always use **extended** lobby readiness (test ids + loose selectors + Pragmatic lobby URL fallbacks).
   * Betting mode used to use `script` (exact test ids only) to mirror casinoBettingFlow.js — that caused
   * flaky failures when the lobby was slow, A/B DOM differed, or readiness matched URL/input before nav
   * labels appeared. The **click path** for betting (`searchAndClickFirstTileScript`) stays strict.
   */
  const lobbyStyle =
    process.env.PERFTRACE_LOBBY_STRICT === "1" && automationMode === "betting"
      ? "script"
      : "extended";

  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForLoadState("load", { timeout: 8000 }).catch(() => {});

  let lobbyPage = await waitForLobbyPage(context, {
    timeoutMs: TIMING.lobbyProbeMs,
    lobbyReadyTestIds,
    lobbyStyle,
  });

  if (!lobbyPage) {
    const launcher = page
      .locator('div:has(h1:has-text("DESKTOP SOLUTION")) button')
      .nth(0);
    await launcher
      .waitFor({ state: "visible", timeout: 8000 })
      .catch(() => {});

    if (await launcher.isVisible().catch(() => false)) {
      await launcher.click({ modifiers: [modifier], timeout: 12000 });
      lobbyPage = await waitForLobbyPage(context, {
        timeoutMs: TIMING.lobbyAfterDesktopMs,
        lobbyReadyTestIds,
        lobbyStyle,
      });
    } else {
      lobbyPage = await waitForLobbyPage(context, {
        timeoutMs: TIMING.lobbyAfterDesktopMs,
        lobbyReadyTestIds,
        lobbyStyle,
      });
    }
  }

  if (!lobbyPage) {
    const openPages = context.pages().filter((x) => !x.isClosed());
    const urls = openPages.map((x) => {
      try {
        return x.url();
      } catch {
        return "(url unreadable)";
      }
    });
    const tabHint =
      urls.length === 0
        ? "No open tabs — browser may have closed the context, crashed, or every tab was torn down before we detected the lobby."
        : `Open tabs (${urls.length}): ${urls.join(" | ")}.`;
    const modeHint =
      lobbyStyle === "script"
        ? "Strict script mode (PERFTRACE_LOBBY_STRICT=1): only data-testid lobby-category-search | lobby-category-game-shows visible."
        : `Extended readiness: test ids ${lobbyReadyTestIds.join(", ")}, loose lobby selectors, Pragmatic lobby URL + input-field / tile-container.`;
    const msg = `Lobby UI never appeared after login (${modeHint}) ${tabHint} Set LOBBY_READY_TESTIDS, verify credentials/URL, or try a longer run / stable network.`;
    throw new Error(msg);
  }

  await lobbyPage.bringToFront();
  await lobbyPage.waitForLoadState("domcontentloaded");
  await lobbyPage.waitForLoadState("load", { timeout: 8000 }).catch(() => {});

  /** PerfTrace CDP is tied to the live page — move to lobby before closing auth tab. */
  session.page = lobbyPage;
  if (typeof session.rebindToActivePage === "function") {
    await session.rebindToActivePage(lobbyPage);
  }

  if (context.pages().length > 1) {
    await closeOtherTabs(context, lobbyPage);
  }

  if (automationMode === "betting") {
    await searchAndClickFirstTileScript(
      lobbyPage,
      gameSearchText,
      searchTriggerTestId
    );
  } else {
    await searchAndClickFirstTile(lobbyPage, gameSearchText, searchTriggerTestId);
  }
  return waitForStableGamePage(
    context,
    90000,
    lobbyOptions?.gameReadyTimerSelector
  );
}

/**
 * Same intent as casinoBettingFlow `waitScrollClick`, but:
 * - `page` may be the game **Frame** (not only Page).
 * - Clicks the first **visible** match for the selector union — `.first()` alone can be a hidden template.
 */
async function waitScrollClick(page, selector, label) {
  if (!selector || String(selector).trim() === "") {
    return;
  }
  const sel = String(selector).trim();
  const all = page.locator(sel);
  const deadline = Date.now() + TIMING.betUiTimeoutMs;
  let loc = null;
  while (Date.now() < deadline) {
    let n = 0;
    try {
      n = await all.count();
    } catch {
      n = 0;
    }
    for (let i = 0; i < n; i++) {
      const cand = all.nth(i);
      if (await cand.isVisible().catch(() => false)) {
        loc = cand;
        break;
      }
    }
    if (loc) break;
    await getTimeoutPage(page).waitForTimeout(100);
  }
  if (!loc) {
    throw new Error(
      `[PerfTrace] ${label}: no visible node for selector (check iframe / PP_CGB_* env)`
    );
  }
  await loc.scrollIntoViewIfNeeded();
  await getTimeoutPage(page).waitForTimeout(120);
  try {
    await loc.click({ timeout: TIMING.betUiTimeoutMs });
  } catch {
    console.log(
      `[PerfTrace] ${label}: standard click failed, retrying with force…`
    );
    await loc.click({ force: true, timeout: 60000 });
  }
}

/**
 * Full CSS union on `selector` — do not split on commas. Chip once, then every **visible** tile.
 */
async function waitScrollClickAll(page, selector, label) {
  if (!selector || String(selector).trim() === "") return;
  const sel = String(selector).trim();
  const spots = page.locator(sel);
  const deadline = Date.now() + TIMING.betUiTimeoutMs;
  let sawVisible = false;
  while (Date.now() < deadline && !sawVisible) {
    let n = 0;
    try {
      n = await spots.count();
    } catch {
      n = 0;
    }
    for (let i = 0; i < n; i++) {
      if (await spots.nth(i).isVisible().catch(() => false)) {
        sawVisible = true;
        break;
      }
    }
    if (!sawVisible) await getTimeoutPage(page).waitForTimeout(100);
  }
  let count = 0;
  try {
    count = await spots.count();
  } catch {
    count = 0;
  }
  if (count === 0 || !sawVisible) {
    console.warn(`[PerfTrace] ${label}: no visible bet tiles — PP_CGB_BET_SPOT / iframe`);
    return;
  }
  if (count === 1) {
    await waitScrollClick(page, sel, label);
    return;
  }
  let clicked = 0;
  for (let i = 0; i < count; i++) {
    const tile = spots.nth(i);
    if (!(await tile.isVisible().catch(() => false))) continue;
    await tile.scrollIntoViewIfNeeded();
    await getTimeoutPage(page).waitForTimeout(120);
    try {
      await tile.click({ timeout: TIMING.betUiTimeoutMs });
      clicked += 1;
    } catch (e) {
      console.log(
        `[PerfTrace] ${label} [${i + 1}/${count}]: ${e?.message || e} — force`
      );
      await tile.click({ force: true, timeout: 60000 });
      clicked += 1;
    }
  }
  console.log(`[PerfTrace] ${label}: placed on ${clicked} visible tile(s) of ${count} match(es)`);
}

/**
 * Matches Performance_Automation/casinoBettingFlow.js `runBettingRounds` (chip + bet spot each round).
 */
async function runBettingRounds(uiPage, numberOfRounds, config, session, signal) {
  uiPage.setDefaultTimeout(TIMING.betUiTimeoutMs);
  const context = session.context;

  const totalRounds = resolveRoundsCount(numberOfRounds);
  if (session?.automation) {
    session.automation.plannedRounds = totalRounds;
    session.automation.currentRound = 0;
  }

  console.log(
    `[PerfTrace] Betting loop: ${totalRounds} round(s) — chip + all visible bet spots; raw rounds=${String(numberOfRounds)}`
  );

  let roundPage = getOpenGamePage(session, uiPage);

  for (let i = 1; i <= totalRounds; i++) {
    checkNotCancelled(session, signal);
    if (session?.automation) session.automation.currentRound = i;

    console.log(`[PerfTrace] Betting round ${i} / ${totalRounds}`);

    roundPage = await waitForBettingTimerPage(
      context,
      roundPage,
      config,
      TIMING.roundPhaseTimeoutMs,
      session,
      signal
    );

    if (typeof session.rebindToActivePage === "function") {
      await session.rebindToActivePage(roundPage);
    }

    if (config.betSpot) {
      const bettingRoot = await resolveGameBettingRoot(roundPage, 15000);
      await ensureChipTrayOpen(bettingRoot, config.chip);
      await waitScrollClick(bettingRoot, config.chip, "chip");
      await waitScrollClickAll(bettingRoot, config.betSpot, "bet spot");
      console.log("[PerfTrace] Bet round chip + tiles done");
      await getTimeoutPage(roundPage).waitForTimeout(500);
    }

    await roundPage
      .locator(config.waitForHidden || config.timer)
      .first()
      .waitFor({ state: "hidden", timeout: TIMING.roundPhaseTimeoutMs });

    await roundPage
      .locator(config.result)
      .first()
      .waitFor({ state: "visible", timeout: TIMING.roundPhaseTimeoutMs });
    console.log(`[PerfTrace] Round ${i} result shown`);

    await roundPage
      .locator(config.result)
      .first()
      .waitFor({ state: "hidden", timeout: TIMING.roundPhaseTimeoutMs });
  }

  console.log(`[PerfTrace] Betting loop finished after ${totalRounds} round(s).`);
}

/**
 * Observe-only (same rhythm as casinoBettingFlow.js, minus chip clicks): betting timer → result.
 * Does not rely on “timer locator hidden” (Fortune keeps a visible container). Between rounds we wait for the
 * next betting timer (“timer again”) like the old script’s next cycle, without needing betting-closed detection.
 */
async function runObserveRounds(uiPage, numberOfRounds, config, session, signal) {
  uiPage.setDefaultTimeout(TIMING.betUiTimeoutMs);
  const context = session.context;

  const totalRounds = resolveRoundsCount(numberOfRounds);
  const tp = getTimeoutPage(uiPage);

  if (session?.automation) {
    session.automation.plannedRounds = totalRounds;
    session.automation.currentRound = 0;
  }
  console.log(
    `[PerfTrace] Observe loop: ${totalRounds} round(s) — timer → result per round; between rounds: next timer (requested raw: ${String(numberOfRounds)})`
  );

  let observePage = getOpenGamePage(session, uiPage);

  for (let roundIndex = 1; roundIndex <= totalRounds; roundIndex++) {
    checkNotCancelled(session, signal);
    if (session?.automation) session.automation.currentRound = roundIndex;

    const isLastRound = roundIndex === totalRounds;
    console.log(
      `[PerfTrace] Observe round ${roundIndex} / ${totalRounds}${isLastRound ? " (final — exit after result)" : ""}`
    );

    // Only wait for the betting timer before round 1. After that, the “next timer” wait at the end of the
    // previous iteration already aligned us with the next betting window (timer again).
    if (roundIndex === 1) {
      observePage = await waitForBettingTimerPage(
        context,
        observePage,
        config,
        TIMING.roundPhaseTimeoutMs,
        session,
        signal
      );
      if (typeof session.rebindToActivePage === "function") {
        await session.rebindToActivePage(observePage);
      }
    }

    // Avoid treating the previous round’s winning number as this round’s result (same node can stay visible).
    if (roundIndex > 1) {
      for (const root of allFrameRoots(observePage)) {
        await root
          .locator(config.result)
          .first()
          .waitFor({ state: "hidden", timeout: TIMING.roundPhaseTimeoutMs })
          .catch(() => {});
      }
    }

    const resultRoot = await waitResultVisibleReturnRoot(observePage, config);
    console.log("[PerfTrace] Round result visible.");

    if (isLastRound) {
      console.log("[PerfTrace] Final round — done (skipping wait for next timer).");
      await tp.waitForTimeout(TIMING.lastRoundSettleMs);
      break;
    }

    await resultRoot
      .locator(config.result)
      .first()
      .waitFor({ state: "hidden", timeout: TIMING.resultHiddenBetweenRoundsMs })
      .catch(() => {
        console.log("[PerfTrace] Result did not report hidden — continuing to next betting timer anyway.");
      });

    console.log("[PerfTrace] Waiting for next betting timer (round boundary)…");
    observePage = await waitForBettingTimerPage(
      context,
      observePage,
      config,
      TIMING.roundPhaseTimeoutMs,
      session,
      signal
    );
    if (typeof session.rebindToActivePage === "function") {
      await session.rebindToActivePage(observePage);
    }
  }

  console.log(`[PerfTrace] Observe loop finished after ${totalRounds} round(s).`);
}

/**
 * @param {object} session - active capture session (mutates session.page to game tab)
 * @param {{ gameId: string, rounds: number, user: string, password: string, skipLobby?: boolean, signal?: AbortSignal }} opts
 */
async function runCasinoAutomation(session, opts) {
  const { gameId, rounds, user, password, signal, skipLobby } = opts;
  const planned = resolveRoundsCount(rounds);
  console.log(
    `[PerfTrace] runCasinoAutomation: gameId=${gameId} rounds=${planned} skipLobby=${!!skipLobby} (raw opts.rounds=${String(rounds)})`
  );
  const game = getAutomationGame(gameId);
  if (!game) {
    throw new Error(`Unknown automated game: ${gameId}`);
  }

  const bettingConfig = game.getBettingConfig();
  const page = session.page;
  const context = session.context;

  setPhase(session, "consent");
  await page
    .getByRole("button", { name: /accept|agree|ok/i })
    .first()
    .click({ timeout: 5000 })
    .catch(() => {});

  const automationMode = game.automationMode || "observe";

  let gamePage;
  if (skipLobby) {
    setPhase(session, "game");
    checkNotCancelled(session, signal);
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await page.waitForLoadState("load", { timeout: 20000 }).catch(() => {});
    /**
     * Chart/video baseline must not wait for canvas/timer — that can be 50–60s after record
     * start while the URL is already the game. Otherwise `reportTimelineZeroMs` lands late and
     * FPS/CPU trim removes the whole early minute as “pre-baseline.”
     */
    if (typeof session.markGamePageStart === "function") {
      await session.markGamePageStart(page);
    }
    ensureAutomationTimelineBaseline(session, "skipLobby after markGamePageStart");
    console.log(
      "[PerfTrace] skipLobby: baseline at direct-URL load — waiting for game UI (canvas or timer)…"
    );
    gamePage = await waitForStableGamePage(
      context,
      90000,
      bettingConfig.timer
    );
  } else {
    setPhase(session, "login");
    checkNotCancelled(session, signal);
    await loginToCasino(page, user, password, session, signal);

    setPhase(session, "lobby");
    checkNotCancelled(session, signal);

    gamePage = await openLobbyAndLaunchGame(
      page,
      context,
      game.lobbySearchText,
      session,
      signal,
      {
        lobbyReadyTestIds: game.lobbyReadyTestIds,
        lobbySearchTriggerTestId: game.lobbySearchTriggerTestId,
        gameReadyTimerSelector: bettingConfig.timer,
        automationMode,
      }
    );
  }

  session.page = gamePage;
  if (typeof session.rebindToActivePage === "function") {
    await session.rebindToActivePage(gamePage);
  }
  if (typeof session.markGamePageStart === "function") {
    await session.markGamePageStart(gamePage);
  }
  ensureAutomationTimelineBaseline(session, "gamePage ready (post lobby or skipLobby)");
  setPhase(session, "game");

  gamePage.setDefaultTimeout(TIMING.betUiTimeoutMs);
  await gamePage.waitForLoadState("load").catch(() => {});
  await gamePage.waitForLoadState("domcontentloaded").catch(() => {});

  if (automationMode === "betting") {
    const bettingRoot = await resolveGameBettingRoot(gamePage, 30000);
    await ensureChipTrayOpen(bettingRoot, bettingConfig.chip);
    if (bettingConfig.chip && String(bettingConfig.chip).trim()) {
      await waitUntilAnyVisible(
        bettingRoot,
        bettingConfig.chip,
        TIMING.betUiTimeoutMs,
        "chip readiness"
      );
    }
    await waitUntilAnyVisible(
      bettingRoot,
      bettingConfig.betSpot,
      TIMING.betUiTimeoutMs,
      "bet spot readiness"
    );
    await getTimeoutPage(gamePage).waitForTimeout(400);
  } else {
    await getTimeoutPage(gamePage).waitForTimeout(TIMING.gameUiSettleMs);
  }

  setPhase(session, "betting");
  checkNotCancelled(session, signal);
  if (automationMode === "betting") {
    await runBettingRounds(gamePage, planned, bettingConfig, session, signal);
  } else {
    await runObserveRounds(gamePage, planned, bettingConfig, session, signal);
  }

  setPhase(session, "done");
  console.log("[PerfTrace] Casino automation finished");
}

module.exports = {
  runCasinoAutomation,
};
