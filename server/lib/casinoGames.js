/**
 * Automation game registry.
 *
 * This repo ships with ONE built-in game: Color Game Bonanza.
 * To add another game, copy the `color-game-bonanza` entry and adjust:
 * - lobbySearchText
 * - defaultAuthUrl
 * - getBettingConfig() selectors (timer/result/chip/betSpot)
 *
 * Keep the exported shape stable so capture/automation stays generic.
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
