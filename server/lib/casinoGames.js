/**
 * Automation game registry.
 *
 * Add new games by inserting one config entry in `GAME_DEFINITIONS`.
 * The runtime shape returned by `getAutomationGame()` stays stable, while the
 * internals stay config-driven.
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
  return (fallbacks || []).filter(Boolean).join(", ");
}

function readOptionalEnv(envKey) {
  const value = process.env[envKey];
  if (!value || !String(value).trim()) return undefined;
  return String(value).trim();
}

function buildSelectorConfig(selectorConfig = {}) {
  return {
    timer: envOrUnion(selectorConfig.timerEnvKey, selectorConfig.timer),
    result: envOrUnion(selectorConfig.resultEnvKey, selectorConfig.result),
    chip: envOrUnion(selectorConfig.chipEnvKey, selectorConfig.chip),
    betSpot: envOrUnion(selectorConfig.betSpotEnvKey, selectorConfig.betSpot),
    timerBettingOpen: envOrUnion(
      selectorConfig.timerBettingOpenEnvKey,
      selectorConfig.timerBettingOpen
    ),
    waitForHidden: readOptionalEnv(selectorConfig.waitForHiddenEnvKey),
  };
}

const DEFAULT_AUTH_URL_CERTIFICATION =
  process.env.AUTH_URL_CERT ||
  "https://certification.pragmaticplaylive.net/authentication/authenticate.jsp";

const PRAGMATIC_LOBBY_READY_TESTIDS = [
  "lobby-category-search",
  "lobby-category-game-shows",
];

const GAME_DEFINITIONS = {
  "color-game-bonanza": {
    id: "color-game-bonanza",
    label: "Color Game Bonanza",
    lobbySearchText: "Color Game Bonanza",
    defaultAuthUrl: DEFAULT_AUTH_URL_CERTIFICATION,
    defaultCasinoUser: "hareesh",
    defaultCasinoPass: "hareesh123",
    lobbyReadyTestIds: [...PRAGMATIC_LOBBY_READY_TESTIDS],
    lobbySearchTriggerTestId:
      process.env.LOBBY_SEARCH_TRIGGER_TESTID || "lobby-category-game-shows",
    automationMode: "betting",
    assetGameKeys: ["colorgame", "color-game"],
    selectors: {
      timerEnvKey: "PP_CGB_TIMER",
      timer: [
        '[data-testid="round-timer"]',
        '[data-testid="base-timer"]',
        '[data-testid*="timer"]',
      ],
      resultEnvKey: "PP_CGB_RESULT",
      result: [
        '[data-testid="win-message-container"]',
        '[data-testid="win-result"]',
        '[data-testid*="win-message"]',
      ],
      chipEnvKey: "PP_CGB_CHIP",
      chip: [
        '[data-testid="chip-stack-value-5"]',
        '[data-testid="chip-stack"] button',
        '[data-testid*="chip-stack"] button',
        '[data-testid*="ChipStack"] button',
      ],
      betSpotEnvKey: "PP_CGB_BET_SPOT",
      betSpot: [
        '[data-testid="bet-spot"]',
        '[data-testid*="bet-spot"]',
        '[data-testid*="BetSpot"]',
      ],
      waitForHiddenEnvKey: "PP_CGB_WAIT",
    },
  },
};

function materializeAutomationGame(definition) {
  if (!definition) return null;
  return {
    ...definition,
    getBettingConfig() {
      return buildSelectorConfig(definition.selectors);
    },
  };
}

function getAutomationGame(gameId) {
  if (!gameId || typeof gameId !== "string") return null;
  return materializeAutomationGame(GAME_DEFINITIONS[gameId]);
}

function listAutomationGames() {
  return Object.values(GAME_DEFINITIONS).map((game) => ({
    id: game.id,
    label: game.label,
    defaultAuthUrl: game.defaultAuthUrl,
    defaultCasinoUser: game.defaultCasinoUser,
    defaultCasinoPass: game.defaultCasinoPass,
    automationMode: game.automationMode,
    assetGameKeys: [...(game.assetGameKeys || [])],
  }));
}

module.exports = {
  GAME_DEFINITIONS,
  getAutomationGame,
  listAutomationGames,
  listGameIds: () => Object.keys(GAME_DEFINITIONS),
};
