/**
 * Game definitions for automated casino flows (lobby search text + round UI selectors).
 * Pragmatic Live roulette variants share one table pattern; Color Game Bonanza uses broader bet-spot selectors (no roulette data-bet-code).
 * Roulette overrides: PP_RR_TIMER, PP_RR_TIMER_OPEN, PP_RR_CHIP, PP_RR_BET_SPOT, PP_RR_RESULT, PP_RR_WAIT
 * Color Game Bonanza overrides: PP_CGB_TIMER, PP_CGB_CHIP, PP_CGB_BET_SPOT, PP_CGB_RESULT, PP_CGB_WAIT
 */

function envOrUnion(envKey, fallbacks) {
  const fromEnv = process.env[envKey];
  if (fromEnv && String(fromEnv).trim()) {
    return String(fromEnv)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .join(", ");
  }
  return fallbacks.filter(Boolean).join(", ");
}

/**
 * @param {{ fortuneTimerBettingOpen?: boolean }} opts — Fortune/Russian Roulette use #roundTimerContainer.showTimerCountdown; Stake Roulette UI differs, so omit and use broad `timer` + observe flow (timer → result → timer again).
 */
function pragmaticRouletteBettingSelectors(opts = {}) {
  const { fortuneTimerBettingOpen = false } = opts;
  return {
    timer: envOrUnion("PP_RR_TIMER", [
      '[data-testid="base-timer"]',
      '[data-testid="betting-timer"]',
      '[data-testid*="betting-timer" i]',
      '[data-testid*="round-timer" i]',
      '[data-testid*="roundTimer" i]',
      '[data-testid*="Timer" i]',
      '[data-testid*="timer" i]',
      '[class*="BettingTimer" i]',
      '[class*="RoundTimer" i]',
      '[class*="betting-timer" i]',
      '[class*="Timer"]',
      '[class*="timer"]',
      '[class*="countdown" i]',
      '[class*="Clock" i]',
    ]),
    ...(fortuneTimerBettingOpen
      ? {
          /**
           * Fortune Roulette: container stays in DOM; only this class marks “countdown running”.
           * Stake Roulette: leave unset — use `timer` union only (override via PP_RR_TIMER_OPEN if needed).
           */
          timerBettingOpen: envOrUnion("PP_RR_TIMER_OPEN", [
            "#roundTimerContainer.showTimerCountdown",
          ]),
        }
      : {}),
    chip: envOrUnion("PP_RR_CHIP", [
      '[data-testid="chip-stack"] button',
      '[data-testid="chip-stack"] [role="button"]',
      '[data-testid*="chip-stack" i] button',
      '[data-testid*="chip-stack" i] [role="button"]',
      '[data-testid="chip-selector"] button',
      '[data-testid*="chip-selector" i] button',
      '[class*="ChipStack"] button',
      '[class*="ChipStack"] [role="button"]',
      '[class*="ChipSelector"] button',
      '[class*="ChipsRail" i] button',
      '[class*="ChipsRail" i] [role="button"]',
      'div[role="button"][class*="Chip" i]',
      'button[class*="chip" i]',
      '[class*="chip"] button',
      'button[aria-label*="$" i]',
      'button[aria-label*="€" i]',
      'button[aria-label*="£" i]',
    ]),
    betSpot: envOrUnion("PP_RR_BET_SPOT", [
      '[data-testid="straight-up"] [data-testid="bet-spot"]',
      '[data-testid="bet-spot"]',
      '[data-testid*="bet-spot" i]',
      '[class*="BetSpot"]',
      '[class*="bet-spot" i]',
      "canvas",
    ]),
    waitForHidden: process.env.PP_RR_WAIT || undefined,
    result: envOrUnion("PP_RR_RESULT", [
      '[data-testid="winning-number"]',
      '[data-testid*="result" i]',
      '[class*="Winning"]',
      '[class*="winning-number" i]',
      '[class*="result" i]',
    ]),
  };
}

/** Color Game Bonanza — show game; not a roulette layout (generic bet-spot / chip-stack). */
function colorGameBonanzaBettingSelectors() {
  return {
    timer: envOrUnion("PP_CGB_TIMER", [
      '[data-testid="round-timer"]',
      '[data-testid="base-timer"]',
      '[data-testid*="timer"]',
    ]),
    result: envOrUnion("PP_CGB_RESULT", [
      '[data-testid="win-message-container"]',
      '[data-testid="win-result"]',
      '[data-testid*="win-message"]',
    ]),
    chip: envOrUnion("PP_CGB_CHIP", [
      '[data-testid="chip-stack-value-5"]',
      '[data-testid="chip-stack"] button',
      '[data-testid*="chip-stack"] button',
      '[data-testid*="ChipStack"] button',
    ]),
    betSpot: envOrUnion("PP_CGB_BET_SPOT", [
      '[data-testid="bet-spot"]',
      '[data-testid*="bet-spot"]',
      '[data-testid*="BetSpot"]',
    ]),
    waitForHidden: process.env.PP_CGB_WAIT || undefined,
  };
}

/** Pragmatic Live auth entry (games lobby). */
const DEFAULT_AUTH_URL_GAMES =
  process.env.AUTH_URL ||
  "https://games.pragmaticplaylive.net/authentication/authenticate.jsp";

/** Certification / Color Game Bonanza (see Performance_Automation/casinoBettingFlow.js). */
const DEFAULT_AUTH_URL_CERTIFICATION =
  process.env.AUTH_URL_CERT ||
  "https://certification.pragmaticplaylive.net/authentication/authenticate.jsp";

/** Lobby chrome can expose either control; casinoBettingFlow checks both for every flow. */
const PRAGMATIC_LOBBY_READY_TESTIDS = [
  "lobby-category-search",
  "lobby-category-game-shows",
];

/**
 * @type {Record<string, {
 *   lobbySearchText: string,
 *   getBettingConfig: () => object,
 *   defaultAuthUrl: string,
 *   defaultCasinoUser: string,
 *   defaultCasinoPass: string,
 *   lobbyReadyTestIds: string[],
 *   lobbySearchTriggerTestId: string,
 *   automationMode: "betting" | "observe",
 * }>}
 */
const GAMES = {
  "russian-roulette": {
    lobbySearchText: "Russian Roulette",
    getBettingConfig: () => pragmaticRouletteBettingSelectors({ fortuneTimerBettingOpen: true }),
    defaultAuthUrl: DEFAULT_AUTH_URL_GAMES,
    defaultCasinoUser: "abdulg",
    defaultCasinoPass: "abdulg123",
    lobbyReadyTestIds: [...PRAGMATIC_LOBBY_READY_TESTIDS],
    lobbySearchTriggerTestId: "lobby-category-search",
    /** Timer → result only (no chip clicks). */
    automationMode: "observe",
  },
  "stake-roulette": {
    lobbySearchText: "Stake Roulette",
    getBettingConfig: () => pragmaticRouletteBettingSelectors({ fortuneTimerBettingOpen: false }),
    defaultAuthUrl: DEFAULT_AUTH_URL_GAMES,
    defaultCasinoUser: "abdulg",
    defaultCasinoPass: "abdulg123",
    lobbyReadyTestIds: [...PRAGMATIC_LOBBY_READY_TESTIDS],
    lobbySearchTriggerTestId: "lobby-category-search",
    automationMode: "observe",
  },
  "color-game-bonanza": {
    lobbySearchText: "Color Game Bonanza",
    getBettingConfig: colorGameBonanzaBettingSelectors,
    defaultAuthUrl: DEFAULT_AUTH_URL_CERTIFICATION,
    defaultCasinoUser: "hareesh",
    defaultCasinoPass: "hareesh123",
    lobbyReadyTestIds: [...PRAGMATIC_LOBBY_READY_TESTIDS],
    lobbySearchTriggerTestId:
      process.env.LOBBY_SEARCH_TRIGGER_TESTID || "lobby-category-game-shows",
    /** Matches Performance_Automation/casinoBettingFlow.js: chip + bet spot each round. */
    automationMode: "betting",
  },
};

function getAutomationGame(gameId) {
  if (!gameId || typeof gameId !== "string") return null;
  return GAMES[gameId] ?? null;
}

module.exports = {
  GAMES,
  getAutomationGame,
  listGameIds: () => Object.keys(GAMES),
};
