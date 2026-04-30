# Automation Games

PerfTrace now keeps automated casino game setup in one server-side registry:

- `server/lib/casinoGames.js`

Each game is a single entry inside `GAME_DEFINITIONS`. The automation runner in
`server/lib/casinoAutomation.js` stays generic and reads from that registry.

## Add A New Game

1. Open `server/lib/casinoGames.js`.
2. Add a new object inside `GAME_DEFINITIONS`.
3. Fill these fields:

```js
"your-game-id": {
  id: "your-game-id",
  label: "Your Game Name",
  lobbySearchText: "Your Game Name",
  defaultAuthUrl: "https://example.com/authentication/authenticate.jsp",
  defaultCasinoUser: "username",
  defaultCasinoPass: "password",
  lobbyReadyTestIds: ["lobby-category-search", "lobby-category-game-shows"],
  lobbySearchTriggerTestId: "lobby-category-game-shows",
  automationMode: "betting",
  assetGameKeys: ["your-game", "yourgame"],
  selectors: {
    timerEnvKey: "PP_YOUR_TIMER",
    timer: ['[data-testid="round-timer"]'],
    resultEnvKey: "PP_YOUR_RESULT",
    result: ['[data-testid="win-result"]'],
    chipEnvKey: "PP_YOUR_CHIP",
    chip: ['[data-testid="chip-stack"] button'],
    betSpotEnvKey: "PP_YOUR_BET_SPOT",
    betSpot: ['[data-testid="bet-spot"]'],
    waitForHiddenEnvKey: "PP_YOUR_WAIT"
  }
}
```

## Field Meaning

- `id`: API/UI identifier.
- `label`: what the UI dropdown shows.
- `lobbySearchText`: text typed into the Pragmatic lobby search.
- `defaultAuthUrl`: URL used when automation mode is enabled and `Skip login & lobby` is off.
- `defaultCasinoUser` / `defaultCasinoPass`: UI defaults.
- `automationMode`:
  - `"betting"`: picks chip + clicks bet spot every round.
  - `"observe"`: waits for timer/result only.
- `assetGameKeys`: default session asset-grouping keywords for that game.
- `selectors`: CSS selectors used by the generic automation runner.

## Why This Is Configurable Now

Before, the UI and server were effectively hardcoded around Color Game Bonanza.
Now:

- the server exposes available games at `GET /api/automation/games`
- the UI loads that list dynamically
- adding a new game is mainly a config entry, not a runner rewrite

## Lobby readiness (login → lobby)

After login, the runner waits until it believes the Pragmatic lobby is usable.

- **Default (recommended):** **extended** readiness — exact `lobbyReadyTestIds`, loose `[data-testid*="lobby-category-…"]` selectors, and URL fallbacks (`…/desktop/lobby` plus search/tiles). This avoids flaky “Lobby UI never appeared” errors when the SPA is slow or labels differ slightly.
- **`PERFTRACE_LOBBY_STRICT=1`:** For **betting** games only, restores the old **script** check: lobby is ready only when `lobby-category-search` or `lobby-category-game-shows` is visible (mirrors a strict casinoBettingFlow-style probe). Use only if you need parity debugging.
- **`LOBBY_READY_TESTIDS`:** Comma-separated extra `data-testid` values merged into the extended probe.

The betting click sequence (`searchAndClickFirstTileScript`) is unchanged; only the **wait-for-lobby** phase uses extended detection by default.

## Selector Overrides Via Env

Every selector block can still be overridden with env vars. Example:

```bash
PP_CGB_TIMER='[data-testid="round-timer"], [data-testid="base-timer"]'
PP_CGB_RESULT='[data-testid="win-result"]'
```

That lets you patch locator changes without editing the runner.

## When You Need Code Changes

You only need runner changes in `server/lib/casinoAutomation.js` if the new game
has a fundamentally different flow, for example:

- it does not use the same lobby search flow
- it needs a special pre-bet setup
- it uses different round boundaries than timer -> result
- it requires iframe handling beyond the current generic selectors
