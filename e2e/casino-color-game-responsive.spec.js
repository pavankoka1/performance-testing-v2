/**
 * Pragmatic certification lobby → Color Game Bonanza (desktop + mobile viewports).
 *
 * Portrait fixes vs older scripts:
 * - Cross-platform modifier for “open in new tab” (Meta on macOS, Control on Windows/Linux).
 * - `.first()` on duplicate test ids (responsive lobby renders nav twice).
 * - `waitForEvent('page')` timeout so Windows doesn’t hang silently if the tab never opens.
 * - Canvas “wake” click uses coordinates relative to the canvas element (not fixed 200×200 on the page).
 * - Stricter locators: `input-field` uses `.first()` when multiple fields exist.
 *
 * @typedef {{ width: number; height: number; name: string }} ViewportSpec
 */

const { test, expect } = require("@playwright/test");

const AUTH_URL =
  "https://certification.pragmaticplaylive.net/authentication/authenticate.jsp";

const GAME_NAME = "Color Game Bonanza";

/** Align with server `casinoAutomation.js` — bonus/jackpot can extend round phases */
const ROUND_PHASE_MS = 300000;

/** Meta on macOS — Ctrl on Windows/Linux (matches PerfTrace casinoAutomation.js). */
const NEW_TAB_MODIFIER =
  process.platform === "darwin" ? "Meta" : "Control";

const games = {
  "Color Game Bonanza": {
    chip: '[data-testid="chip-stack-value-10"]',
    betSpot: '[data-testid="bet-pool-amount-purple"]',
    timer: '[data-testid="round-timer"]',
    result: '[data-testid="win-message-container"]',
  },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForStableGamePage(context) {
  const start = Date.now();

  while (Date.now() - start < 90000) {
    for (const p of context.pages()) {
      try {
        if (p.isClosed()) continue;

        await p.waitForLoadState("domcontentloaded", { timeout: 2000 }).catch(() => {});
        const canvas = p.locator("canvas");

        if ((await canvas.count()) > 0) {
          await canvas.first().waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
          console.log("Game page found:", p.url());
          return p;
        }
      } catch {
        /* next page */
      }
    }
    await sleep(500);
  }

  throw new Error("Game canvas not found");
}

async function getGameFrame(page) {
  for (let i = 0; i < 30; i++) {
    for (const frame of page.frames()) {
      try {
        if ((await frame.locator("canvas").count()) > 0) {
          console.log("Game iframe found");
          return frame;
        }
      } catch {
        /* continue */
      }
    }
    await sleep(500);
  }
  throw new Error("Game iframe not found");
}

async function runBettingRounds(gameFrame, numberOfRounds, config) {
  for (let i = 1; i <= numberOfRounds; i++) {
    console.log(`--- Round ${i} / ${numberOfRounds} ---`);

    let isTimerVisible = false;

    for (let retry = 0; retry < 30; retry++) {
      try {
        const timer = gameFrame.locator(config.timer).first();

        if ((await timer.count()) > 0 && (await timer.isVisible())) {
          isTimerVisible = true;
          console.log("Betting round detected");
          break;
        }
      } catch {
        /* retry */
      }

      console.log("Waiting for next round...");
      await sleep(4000);
    }

    if (!isTimerVisible) {
      throw new Error(`Round ${i}: Timer not visible`);
    }

    const chip = gameFrame.locator(config.chip);
    const betSpot = gameFrame.locator(config.betSpot);

    try {
      if (!(await chip.isVisible())) {
        console.log("Opening chip tray...");

        const chipTrayButton = gameFrame
          .locator('[data-testid*="chip"], [class*="chip"]')
          .first();

        if (await chipTrayButton.isVisible()) {
          await chipTrayButton.click({ force: true });
          await sleep(1000);
        }
      }
    } catch {
      console.log("Chip tray handling skipped");
    }

    await chip.waitFor({ state: "visible", timeout: 15000 });
    await betSpot.waitFor({ state: "visible", timeout: 15000 });

    await chip.scrollIntoViewIfNeeded().catch(() => {});
    await betSpot.scrollIntoViewIfNeeded().catch(() => {});

    await chip.click({ force: true });
    await sleep(500);
    await betSpot.click({ force: true });

    console.log("Bet placed");

    await gameFrame
      .locator(config.timer)
      .waitFor({ state: "hidden", timeout: ROUND_PHASE_MS })
      .catch(() => {});
    await gameFrame
      .locator(config.result)
      .waitFor({ state: "visible", timeout: ROUND_PHASE_MS });

    console.log(`Round ${i} result displayed`);

    await gameFrame
      .locator(config.result)
      .waitFor({ state: "hidden", timeout: ROUND_PHASE_MS });
  }
}

/**
 * Tap center-ish on the first canvas inside the game frame (pointer-unlock / WebGL wake).
 * Fixed page coordinates (e.g. 200×200) miss the canvas in portrait if it’s offset by chrome/iframes.
 */
async function wakeGameCanvas(gameFrame) {
  const canvas = gameFrame.locator("canvas").first();
  await canvas.waitFor({ state: "visible", timeout: 15000 });
  const box = await canvas.boundingBox();
  if (box) {
    await gameFrame.page().mouse.click(
      box.x + Math.min(120, box.width / 2),
      box.y + Math.min(120, box.height / 2)
    );
    return;
  }
  await canvas.click({ position: { x: 80, y: 80 }, force: true });
}

/**
 * @param {import('@playwright/test').Browser} browser
 * @param {{ width: number; height: number }} viewport
 */
async function executeCasinoFlow(browser, viewport) {
  const context = await browser.newContext({
    viewport,
    isMobile: viewport.width <= 812,
    hasTouch: viewport.width <= 812,
  });

  const page = await context.newPage();

  await page.goto(AUTH_URL, { waitUntil: "domcontentloaded" });

  await page.locator('input[name="username"]').fill("hareesh");
  await page.locator('input[name="password"]').fill("hareesh123");
  await page.getByRole("button", { name: "Verify me!" }).click();

  const lobbyPromise = context.waitForEvent("page", { timeout: 90000 });

  const launcher = page
    .locator('div:has(h1:has-text("DESKTOP SOLUTION")) button')
    .nth(0);

  await launcher.waitFor({ state: "visible", timeout: 15000 }).catch(() => {});

  await launcher.click({ modifiers: [NEW_TAB_MODIFIER], timeout: 20000 });

  const lobbyPage = await lobbyPromise;
  await lobbyPage.bringToFront();
  await lobbyPage.waitForLoadState("domcontentloaded");

  await lobbyPage.getByTestId("lobby-category-game-shows").first().click();

  const input = lobbyPage.getByTestId("input-field").first();
  await input.fill(GAME_NAME);
  await input.press("Enter");

  const gameTile = lobbyPage.getByTestId("tile-container").first();
  await expect(gameTile).toBeVisible({ timeout: 600000 });

  await gameTile.click();

  const gamePage = await waitForStableGamePage(context);
  const config = games[GAME_NAME];

  const gameFrame = await getGameFrame(gamePage);

  await sleep(5000);

  await wakeGameCanvas(gameFrame);

  await runBettingRounds(gameFrame, 3, config);

  await context.close();
}

test.describe.configure({ mode: "serial" });

const viewports = /** @type {const} */ ([
  { name: "Desktop", width: 1280, height: 800 },
  { name: "Mobile Portrait", width: 375, height: 667 },
  { name: "Mobile Landscape", width: 667, height: 375 },
]);

for (const vp of viewports) {
  test(`Casino flow — ${vp.name} (${vp.width}×${vp.height})`, async ({ browser }) => {
    test.setTimeout(1200000);
    await executeCasinoFlow(browser, { width: vp.width, height: vp.height });
  });
}
