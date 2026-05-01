import type {
  AutomationGameId,
  NetworkThrottlePreset,
  RecordingStartOptions,
} from "@/hooks/useRecording";
import SelectField, { NICE_SELECT_CLASS } from "@/components/SelectField";
import { defaultTraceDetail, isElectronRenderer } from "@/lib/perftraceEnv";
import {
  Activity,
  Bot,
  ChevronDown,
  Cpu,
  Gamepad2,
  Hash,
  KeyRound,
  Monitor,
  Network,
  RectangleHorizontal,
  Settings2,
  Smartphone,
  User,
  Video,
} from "lucide-react";
import { memo, useCallback, useEffect, useState } from "react";
import { toast } from "react-hot-toast";
import LiveMetricsPanel from "./LiveMetricsPanel";
import RecordButtons from "./RecordButtons";
import SystemStatusBanner from "./SystemStatusBanner";
import URLInput from "./URLInput";

type CpuThrottle = 1 | 4 | 6 | 20;

const DEFAULT_MANUAL_URL = "https://gpu-vs-cpu-animations.vercel.app/";
/** Certification lobby — Color Game Bonanza (matches Performance_Automation/casinoBettingFlow.js). */
const AUTOMATION_URL_CERTIFICATION =
  "https://certification.pragmaticplaylive.net/authentication/authenticate.jsp";

const ROUND_OPTIONS = [1, 3, 5, 10] as const;

type AutomationGameOption = {
  id: AutomationGameId;
  label: string;
  defaultAuthUrl?: string;
  defaultCasinoUser?: string;
  defaultCasinoPass?: string;
  assetGameKeys?: string[];
};

const DEFAULT_AUTOMATION_GAMES: AutomationGameOption[] = [
  {
    id: "color-game-bonanza",
    label: "Color Game Bonanza",
    defaultAuthUrl: AUTOMATION_URL_CERTIFICATION,
    defaultCasinoUser: "hareesh",
    defaultCasinoPass: "hareesh123",
    assetGameKeys: ["colorgame", "color-game"],
  },
];

const isValidUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return ["http:", "https:"].includes(parsed.protocol);
  } catch {
    return false;
  }
};

const LAST_MANUAL_URL_STORAGE_KEY = "perftrace:lastManualUrl";

function readStoredManualUrl(): string {
  if (typeof window === "undefined") return DEFAULT_MANUAL_URL;
  try {
    const v = localStorage.getItem(LAST_MANUAL_URL_STORAGE_KEY)?.trim();
    if (v && isValidUrl(v)) return v;
  } catch {
    /* ignore */
  }
  return DEFAULT_MANUAL_URL;
}

type RecordFormSectionProps = {
  isRecording: boolean;
  isProcessing: boolean;
  onStart: (
    url: string,
    cpuThrottle: CpuThrottle,
    networkThrottle: NetworkThrottlePreset,
    options?: RecordingStartOptions
  ) => void;
  onStop: () => void;
  /** Pulse the Start button when idle and no report yet */
  encourageStart?: boolean;
};

type BrowserLayoutOption = "desktop" | "portrait" | "mobileLandscape";

function RecordFormSectionInner({
  isRecording,
  isProcessing,
  onStart,
  onStop,
  encourageStart = false,
}: RecordFormSectionProps) {
  const [url, setUrl] = useState(() => readStoredManualUrl());
  const [cpuThrottle, setCpuThrottle] = useState<CpuThrottle>(1);
  const [networkThrottle, setNetworkThrottle] =
    useState<NetworkThrottlePreset>("none");
  const [recordVideo, setRecordVideo] = useState(() => !isElectronRenderer());
  const [videoQuality, setVideoQuality] = useState<"low" | "high">("low");
  const [assetGameKeysText, setAssetGameKeysText] = useState(
    "colorgame,color-game"
  );
  const [traceDetail, setTraceDetail] = useState<"light" | "full">(
    defaultTraceDetail()
  );
  const [scriptMode, setScriptMode] = useState<"manual" | "automation">(
    "manual"
  );
  const [automationGames, setAutomationGames] = useState<AutomationGameOption[]>(
    DEFAULT_AUTOMATION_GAMES
  );
  const [automationGame, setAutomationGame] =
    useState<AutomationGameId>("color-game-bonanza");
  const [automationRounds, setAutomationRounds] =
    useState<(typeof ROUND_OPTIONS)[number]>(3);
  const [casinoUser, setCasinoUser] = useState(
    () => DEFAULT_AUTOMATION_GAMES[0].defaultCasinoUser ?? ""
  );
  const [casinoPass, setCasinoPass] = useState(
    () => DEFAULT_AUTOMATION_GAMES[0].defaultCasinoPass ?? ""
  );
  const [skipLobby, setSkipLobby] = useState(false);

  const [assetBaselineUrlContains, setAssetBaselineUrlContains] = useState("");
  const [assetBaselineUrlRegex, setAssetBaselineUrlRegex] = useState("");
  const [assetBaselineUrlRegexFlags, setAssetBaselineUrlRegexFlags] =
    useState("i");

  const [layoutMode, setLayoutMode] = useState<BrowserLayoutOption>("desktop");
  const [advancedSessionOpen, setAdvancedSessionOpen] = useState(false);

  const selectedAutomationGame =
    automationGames.find((game) => game.id === automationGame) ??
    automationGames[0] ??
    DEFAULT_AUTOMATION_GAMES[0];

  useEffect(() => {
    let cancelled = false;
    const loadAutomationGames = async () => {
      try {
        const res = await fetch("/api/automation/games");
        const data = (await res.json()) as { games?: AutomationGameOption[] };
        if (!res.ok || !Array.isArray(data.games) || data.games.length === 0) {
          return;
        }
        if (cancelled) return;
        setAutomationGames(data.games);
        setAutomationGame((current) =>
          data.games!.some((game) => game.id === current)
            ? current
            : data.games![0].id
        );
      } catch {
        /* keep fallback config */
      }
    };
    void loadAutomationGames();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (scriptMode === "manual") setSkipLobby(false);
  }, [scriptMode]);

  /** Persist last valid manual URL for the next visit */
  useEffect(() => {
    if (scriptMode !== "manual") return;
    if (!isValidUrl(url)) return;
    try {
      localStorage.setItem(LAST_MANUAL_URL_STORAGE_KEY, url.trim());
    } catch {
      /* ignore quota / private mode */
    }
  }, [url, scriptMode]);

  /** Manual: restore last manual URL when leaving automation. Automation: URL follows game unless “skip lobby” (direct game URL). */
  useEffect(() => {
    if (scriptMode === "manual") {
      setUrl((u) =>
        u === AUTOMATION_URL_CERTIFICATION || u.trim() === ""
          ? readStoredManualUrl()
          : u
      );
      return;
    }
    if (!skipLobby) {
      setUrl(selectedAutomationGame?.defaultAuthUrl || AUTOMATION_URL_CERTIFICATION);
    }
  }, [scriptMode, selectedAutomationGame, skipLobby]);

  /** When the automated game changes, reset login fields to that game’s config defaults. */
  useEffect(() => {
    setCasinoUser(selectedAutomationGame?.defaultCasinoUser ?? "");
    setCasinoPass(selectedAutomationGame?.defaultCasinoPass ?? "");
    if ((selectedAutomationGame?.assetGameKeys?.length ?? 0) > 0) {
      setAssetGameKeysText(selectedAutomationGame!.assetGameKeys!.join(","));
    }
  }, [selectedAutomationGame]);

  const handleStart = useCallback(() => {
    if (!isValidUrl(url)) {
      toast.error("Enter a valid URL starting with http:// or https://");
      return;
    }
    const base: RecordingStartOptions = {
      recordVideo,
      videoQuality,
      traceDetail,
      assetGameKeys: assetGameKeysText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      layoutMode,
    };
    if (scriptMode === "automation") {
      onStart(url, cpuThrottle, networkThrottle, {
        ...base,
        automation: {
          enabled: true,
          gameId: automationGame,
          rounds: automationRounds,
          casinoUser,
          casinoPass,
          skipLobby: skipLobby || undefined,
        },
      });
      return;
    }
    const baselineOpts =
      assetBaselineUrlRegex.trim().length > 0
        ? {
            assetBaselineUrlRegex: assetBaselineUrlRegex.trim(),
            assetBaselineUrlRegexFlags:
              assetBaselineUrlRegexFlags.trim() || "i",
          }
        : assetBaselineUrlContains.trim().length > 0
          ? { assetBaselineUrlContains: assetBaselineUrlContains.trim() }
          : {};
    onStart(url, cpuThrottle, networkThrottle, { ...base, ...baselineOpts });
  }, [
    url,
    cpuThrottle,
    networkThrottle,
    onStart,
    recordVideo,
    videoQuality,
    assetGameKeysText,
    traceDetail,
    scriptMode,
    automationGame,
    automationRounds,
    casinoUser,
    casinoPass,
    skipLobby,
    layoutMode,
    assetBaselineUrlContains,
    assetBaselineUrlRegex,
    assetBaselineUrlRegexFlags,
  ]);

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6 shadow-[var(--glow)]">
      <div className="flex flex-col gap-6">
        <SystemStatusBanner />
        <URLInput
          value={url}
          onChange={setUrl}
          emphasize
          label={
            scriptMode === "automation"
              ? skipLobby
                ? "Game URL (direct — same page the lobby tile opens)"
                : "Entry URL (Pragmatic auth / lobby entry)"
              : "Target URL — page to measure"
          }
        />

        <div className="rounded-2xl border border-[var(--accent)]/40 bg-gradient-to-br from-[var(--accent)]/18 via-[var(--bg-card)] to-[var(--bg-card)] p-5 shadow-[0_8px_40px_-12px_rgba(139,92,246,0.45)]">
          <p className="mb-4 text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--accent)]">
            Session mode
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <label
              className={`flex min-w-[220px] flex-1 cursor-pointer flex-col gap-1 rounded-xl border px-4 py-3.5 text-sm transition ${
                scriptMode === "manual"
                  ? "border-[var(--accent)] bg-[var(--accent)]/20 text-[var(--fg)] shadow-[0_0_24px_-8px_rgba(139,92,246,0.55)]"
                  : "border-white/20 bg-white/[0.07] text-[var(--fg)] hover:border-[var(--accent)]/50 hover:bg-white/[0.1]"
              } ${isRecording || isProcessing ? "pointer-events-none opacity-60" : ""}`}
            >
              <span className="flex items-center gap-2 font-semibold">
                <input
                  type="radio"
                  name="script-mode"
                  className="sr-only"
                  checked={scriptMode === "manual"}
                  onChange={() => setScriptMode("manual")}
                  disabled={isRecording || isProcessing}
                />
                Manual URL
              </span>
              <span className="text-xs font-normal leading-snug text-[var(--fg-muted)]">
                Open any site — you drive the tab; stop when finished.
              </span>
            </label>
            <label
              className={`flex min-w-[220px] flex-1 cursor-pointer flex-col gap-1 rounded-xl border px-4 py-3.5 text-sm transition ${
                scriptMode === "automation"
                  ? "border-[var(--accent)] bg-[var(--accent)]/20 text-[var(--fg)] shadow-[0_0_24px_-8px_rgba(139,92,246,0.55)]"
                  : "border-white/20 bg-white/[0.07] text-[var(--fg)] hover:border-[var(--accent)]/50 hover:bg-white/[0.1]"
              } ${isRecording || isProcessing ? "pointer-events-none opacity-60" : ""}`}
            >
              <span className="flex items-center gap-2 font-semibold">
                <input
                  type="radio"
                  name="script-mode"
                  className="sr-only"
                  checked={scriptMode === "automation"}
                  onChange={() => setScriptMode("automation")}
                  disabled={isRecording || isProcessing}
                />
                <Bot className="h-4 w-4 text-[var(--accent)]" aria-hidden />
                Automated script
              </span>
              <span className="text-xs font-normal leading-snug text-[var(--fg-muted)]">
                Login → lobby → game → rounds; report when the run completes.
              </span>
            </label>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setAdvancedSessionOpen((o) => !o)}
          disabled={isRecording || isProcessing}
          className="flex w-full items-center justify-between gap-3 rounded-xl border border-[var(--accent)]/30 bg-[var(--bg-elevated)]/90 px-4 py-3.5 text-left text-sm font-semibold text-[var(--fg)] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition hover:border-[var(--accent)]/55 hover:bg-[var(--bg-elevated)] disabled:opacity-60"
          aria-expanded={advancedSessionOpen}
        >
          <span className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)]/20 text-[var(--accent)] ring-1 ring-[var(--accent)]/35">
              <Settings2 className="h-4 w-4" aria-hidden />
            </span>
            <span>
              <span className="block text-[var(--fg)]">
                Session &amp; browser options
              </span>
              <span className="mt-0.5 block text-xs font-normal text-[var(--fg-muted)]">
                Layout, asset keys, login, skip lobby, preload baseline…
              </span>
            </span>
          </span>
          <ChevronDown
            className={`h-5 w-5 shrink-0 text-[var(--accent)] transition-transform duration-200 ${
              advancedSessionOpen ? "rotate-180" : ""
            }`}
            aria-hidden
          />
        </button>

        {advancedSessionOpen && (
          <div className="flex animate-fade-in flex-col gap-6 rounded-xl border border-[var(--accent)]/25 bg-[var(--bg)]/35 p-4 sm:p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
              Browser layout
            </p>
            <div className="flex flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <label
                  className={`flex min-h-[120px] cursor-pointer flex-col gap-2 rounded-xl border-2 px-4 py-3 text-sm transition ${
                    layoutMode === "desktop"
                      ? "border-[var(--accent)] bg-[var(--accent)]/20 text-[var(--fg)] ring-1 ring-[var(--accent)]/35"
                      : "border-white/15 bg-white/[0.05] text-[var(--fg)] hover:border-[var(--accent)]/40"
                  } ${isRecording || isProcessing ? "pointer-events-none opacity-60" : ""}`}
                >
                  <input
                    type="radio"
                    name="layout-mode"
                    className="sr-only"
                    checked={layoutMode === "desktop"}
                    onChange={() => setLayoutMode("desktop")}
                    disabled={isRecording || isProcessing}
                  />
                  <span className="flex items-center gap-2 font-semibold">
                    <Monitor className="h-4 w-4 text-violet-400" aria-hidden />
                    Desktop
                  </span>
                  <span className="text-xs leading-snug text-[var(--fg-muted)]">
                    Chromium opens maximized — normal resizable desktop window and
                    viewport controls (same as before).
                  </span>
                </label>
                <label
                  className={`flex min-h-[120px] cursor-pointer flex-col gap-2 rounded-xl border-2 px-4 py-3 text-sm transition ${
                    layoutMode === "portrait"
                      ? "border-[var(--accent)] bg-[var(--accent)]/20 text-[var(--fg)] ring-1 ring-[var(--accent)]/35"
                      : "border-white/15 bg-white/[0.05] text-[var(--fg)] hover:border-[var(--accent)]/40"
                  } ${isRecording || isProcessing ? "pointer-events-none opacity-60" : ""}`}
                >
                  <input
                    type="radio"
                    name="layout-mode"
                    className="sr-only"
                    checked={layoutMode === "portrait"}
                    onChange={() => setLayoutMode("portrait")}
                    disabled={isRecording || isProcessing}
                  />
                  <span className="flex items-center gap-2 font-semibold">
                    <Smartphone className="h-4 w-4 text-violet-400" aria-hidden />
                    Portrait (mobile)
                  </span>
                  <span className="text-xs leading-snug text-[var(--fg-muted)]">
                    <span className="font-mono text-[var(--fg)]">375×667</span>{" "}
                    responsive preset — fixed CSS width × height like DevTools
                    responsive mode (desktop Chrome, not a phone simulator).
                  </span>
                </label>
                <label
                  className={`flex min-h-[120px] cursor-pointer flex-col gap-2 rounded-xl border-2 px-4 py-3 text-sm transition ${
                    layoutMode === "mobileLandscape"
                      ? "border-[var(--accent)] bg-[var(--accent)]/20 text-[var(--fg)] ring-1 ring-[var(--accent)]/35"
                      : "border-white/15 bg-white/[0.05] text-[var(--fg)] hover:border-[var(--accent)]/40"
                  } ${isRecording || isProcessing ? "pointer-events-none opacity-60" : ""}`}
                >
                  <input
                    type="radio"
                    name="layout-mode"
                    className="sr-only"
                    checked={layoutMode === "mobileLandscape"}
                    onChange={() => setLayoutMode("mobileLandscape")}
                    disabled={isRecording || isProcessing}
                  />
                  <span className="flex items-center gap-2 font-semibold">
                    <RectangleHorizontal
                      className="h-4 w-4 text-violet-400"
                      aria-hidden
                    />
                    Landscape (mobile)
                  </span>
                  <span className="text-xs leading-snug text-[var(--fg-muted)]">
                    <span className="font-mono text-[var(--fg)]">667×375</span>{" "}
                    responsive preset — fixed CSS width × height (desktop Chrome,
                    not a phone simulator).
                  </span>
                </label>
              </div>
            </div>
        {scriptMode === "automation" && (
          <div className="flex flex-col gap-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
              Automation
            </p>
            <label
              className={`flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg)]/40 px-4 py-3 text-sm ${
                isRecording || isProcessing
                  ? "pointer-events-none opacity-60"
                  : ""
              }`}
            >
              <input
                type="checkbox"
                checked={skipLobby}
                onChange={(e) => setSkipLobby(e.target.checked)}
                disabled={isRecording || isProcessing}
                className="mt-0.5 h-4 w-4 rounded border-[var(--border)] text-[var(--accent)] focus:ring-[var(--accent)]"
              />
              <span className="text-[var(--fg)]">
                Skip login &amp; lobby
                <span className="mt-1 block text-xs font-normal text-[var(--fg-muted)]">
                  Use when the URL above is already the game (timer/table). The
                  script waits for the game UI, then runs the selected rounds.
                </span>
              </span>
            </label>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <SelectField
                label="Game"
                icon={Gamepad2}
                hint="Lobby search target"
                value={automationGame}
                onChange={(e) =>
                  setAutomationGame(e.target.value as AutomationGameId)
                }
                disabled={isRecording || isProcessing}
              >
                {automationGames.map((game) => (
                  <option key={game.id} value={game.id}>
                    {game.label}
                  </option>
                ))}
              </SelectField>
              <SelectField
                label="Rounds"
                icon={Hash}
                hint="Exact run length"
                value={automationRounds}
                onChange={(e) =>
                  setAutomationRounds(
                    Number(e.target.value) as (typeof ROUND_OPTIONS)[number]
                  )
                }
                disabled={isRecording || isProcessing}
              >
                {ROUND_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n} round{n !== 1 ? "s" : ""}
                  </option>
                ))}
              </SelectField>
            </div>
            <div
              className={`rounded-xl border border-[var(--border)]/80 bg-[var(--bg)]/40 p-4 ${
                skipLobby ? "opacity-50" : ""
              }`}
            >
              <p className="mb-3 text-xs font-medium uppercase tracking-wider text-[var(--fg-muted)]">
                Pragmatic login
              </p>
              {skipLobby && (
                <p className="mb-3 text-xs text-[var(--fg-muted)]">
                  Not used when “Skip login &amp; lobby” is on.
                </p>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <label
                    htmlFor="casino-user"
                    className="flex items-center gap-2 text-sm font-medium text-[var(--fg)]"
                  >
                    <User className="h-4 w-4 text-[var(--accent)]" />
                    Username
                  </label>
                  <input
                    id="casino-user"
                    type="text"
                    autoComplete="username"
                    value={casinoUser}
                    onChange={(e) => setCasinoUser(e.target.value)}
                    disabled={isRecording || isProcessing || skipLobby}
                    placeholder={selectedAutomationGame?.defaultCasinoUser ?? ""}
                    className={`${NICE_SELECT_CLASS} font-mono text-[13px]`}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label
                    htmlFor="casino-pass"
                    className="flex items-center gap-2 text-sm font-medium text-[var(--fg)]"
                  >
                    <KeyRound className="h-4 w-4 text-[var(--accent)]" />
                    Password
                  </label>
                  <input
                    id="casino-pass"
                    type="password"
                    autoComplete="current-password"
                    value={casinoPass}
                    onChange={(e) => setCasinoPass(e.target.value)}
                    disabled={isRecording || isProcessing || skipLobby}
                    placeholder="••••••••"
                    className={`${NICE_SELECT_CLASS} font-mono text-[13px]`}
                  />
                </div>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-[var(--fg-muted)]">
                Defaults match each game’s server config. Clear a field to omit
                it: the server then uses{" "}
                <code className="rounded bg-[var(--border)]/50 px-1 py-0.5 text-[11px]">
                  CASINO_USER
                </code>{" "}
                /{" "}
                <code className="rounded bg-[var(--border)]/50 px-1 py-0.5 text-[11px]">
                  CASINO_PASS
                </code>{" "}
                if set, otherwise the selected game’s built-in defaults.
              </p>
            </div>
          </div>
        )}

        {scriptMode === "manual" && (
          <div className="flex flex-col gap-2 rounded-xl border border-[var(--border)]/90 bg-[var(--bg)]/30 px-4 py-3">
            <p className="text-sm font-medium text-[var(--fg)]">
              Preload baseline (optional)
            </p>
            <p className="text-xs leading-relaxed text-[var(--fg-muted)]">
              If you want to capture game level assets, please enter your game
              loader key or URL (e.g. dragontriger2, colorgame, sweetboananza2).
              Leave empty to measure the full session from load. Regex wins over
              “contains” if both are set.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <label
                  htmlFor="abl-contains"
                  className="text-xs font-medium text-[var(--fg-muted)]"
                >
                  URL contains
                </label>
                <input
                  id="abl-contains"
                  type="text"
                  value={assetBaselineUrlContains}
                  onChange={(e) => setAssetBaselineUrlContains(e.target.value)}
                  disabled={isRecording || isProcessing}
                  placeholder="e.g. /game/ or ?table="
                  className={NICE_SELECT_CLASS}
                />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <label
                  htmlFor="abl-regex"
                  className="text-xs font-medium text-[var(--fg-muted)]"
                >
                  Or regex
                </label>
                <input
                  id="abl-regex"
                  type="text"
                  value={assetBaselineUrlRegex}
                  onChange={(e) => setAssetBaselineUrlRegex(e.target.value)}
                  disabled={isRecording || isProcessing}
                  placeholder="e.g. /table/\\d+"
                  className={`${NICE_SELECT_CLASS} font-mono text-[13px]`}
                />
              </div>
              <div className="flex w-20 flex-col gap-1">
                <label
                  htmlFor="abl-flags"
                  className="text-xs font-medium text-[var(--fg-muted)]"
                >
                  Flags
                </label>
                <input
                  id="abl-flags"
                  type="text"
                  value={assetBaselineUrlRegexFlags}
                  onChange={(e) => setAssetBaselineUrlRegexFlags(e.target.value)}
                  disabled={isRecording || isProcessing}
                  placeholder="i"
                  className={`${NICE_SELECT_CLASS} font-mono text-[13px]`}
                />
              </div>
            </div>
          </div>
        )}

        <div className="rounded-xl border border-[var(--border)]/90 bg-[var(--bg)]/25 p-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
            Asset grouping
          </p>
          <label className="flex flex-col gap-2 text-sm text-[var(--fg)]">
            <span className="text-[var(--fg-muted)]">
              Game asset keys (comma-separated)
            </span>
            <input
              type="text"
              value={assetGameKeysText}
              onChange={(e) => setAssetGameKeysText(e.target.value)}
              disabled={isRecording || isProcessing}
              className={`${NICE_SELECT_CLASS} font-mono text-[13px]`}
              placeholder="colorgame,color-game"
            />
            <span className="text-xs text-[var(--fg-muted)]">
              URLs containing a key count toward{" "}
              <span className="font-medium text-[var(--accent)]">game</span> vs
              common asset buckets in the report.
            </span>
          </label>
        </div>
          </div>
        )}

        <div className="relative pt-2" aria-labelledby="capture-pipeline-heading">
          <div className="mb-6 flex items-center gap-4" role="presentation">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-[var(--border)] to-[var(--border)]" />
            <h2
              id="capture-pipeline-heading"
              className="shrink-0 text-center text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--fg-muted)]"
            >
              Capture pipeline
            </h2>
            <div className="h-px flex-1 bg-gradient-to-l from-transparent via-[var(--border)] to-[var(--border)]" />
          </div>
          <p className="-mt-4 mb-5 text-xs leading-relaxed text-[var(--fg-muted)]">
            Chromium tuning for this run — applied when you launch. Use{" "}
            <span className="font-medium text-[var(--fg)]">
              Session &amp; browser options
            </span>{" "}
            above for layout, asset keys, login, and optional preload URL match.
          </p>
          <div className="rounded-2xl border border-[color-mix(in_oklab,var(--accent)_28%,var(--border))] bg-[color-mix(in_oklab,var(--accent)_4%,var(--bg-elevated))]/90 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] sm:p-5">
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              <SelectField
                label="Network"
                icon={Network}
                hint="CDP link shaping"
                value={networkThrottle}
                onChange={(e) =>
                  setNetworkThrottle(e.target.value as NetworkThrottlePreset)
                }
                disabled={isRecording || isProcessing}
              >
                <option value="none">No throttling</option>
                <option value="slow-3g">Slow 3G — high latency, ~400 Kbps</option>
                <option value="fast-3g">Fast 3G</option>
                <option value="4g">4G — moderate mobile</option>
              </SelectField>
              <SelectField
                label="CPU"
                icon={Cpu}
                hint="Main-thread slowdown"
                value={cpuThrottle}
                onChange={(e) =>
                  setCpuThrottle(Number(e.target.value) as CpuThrottle)
                }
                disabled={isRecording || isProcessing}
              >
                <option value={1}>1× — No throttling</option>
                <option value={4}>4× — Slower CPU (e.g. low-end mobile)</option>
                <option value={6}>6× — Heavier throttle</option>
                <option value={20}>20× — Stress test (very slow CPU)</option>
              </SelectField>
              <SelectField
                label="Trace"
                icon={Activity}
                hint="Trace detail (overhead)"
                value={traceDetail}
                onChange={(e) =>
                  setTraceDetail(e.target.value as "light" | "full")
                }
                disabled={isRecording || isProcessing}
              >
                <option value="full">
                  Full — deeper layout / paint detail (default)
                </option>
                <option value="light">Light — lower overhead</option>
              </SelectField>
            </div>
            <div className="mt-6 border-t border-[var(--border)]/80 pt-5">
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-muted)]">
                Session video
              </p>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:gap-6">
                <label
                  className={`flex cursor-pointer items-center gap-2 text-sm text-[var(--fg)] ${
                    isRecording || isProcessing
                      ? "cursor-not-allowed opacity-60"
                      : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={recordVideo}
                    onChange={(e) => setRecordVideo(e.target.checked)}
                    disabled={isRecording || isProcessing}
                    className="h-4 w-4 shrink-0 rounded border-[var(--border)] text-[var(--accent)] focus:ring-[var(--accent)]"
                  />
                  <Video className="h-4 w-4 shrink-0 text-[var(--accent)]" />
                  <span>Record session video</span>
                  <span className="text-xs text-[var(--fg-muted)]">
                    (off for long runs)
                  </span>
                </label>
                <div className="min-w-0 flex-1 sm:max-w-xs">
                  <SelectField
                    label="Video quality"
                    icon={Video}
                    hint="Recording resolution"
                    value={videoQuality}
                    onChange={(e) =>
                      setVideoQuality(e.target.value as "low" | "high")
                    }
                    disabled={isRecording || isProcessing || !recordVideo}
                  >
                    <option value="low">Low (960×540) — lighter</option>
                    <option value="high">High (1366×768) — sharper</option>
                  </SelectField>
                </div>
              </div>
            </div>
          </div>
        </div>

        <RecordButtons
          isRecording={isRecording}
          isProcessing={isProcessing}
          onStart={handleStart}
          onStop={onStop}
          pulseIdle={encourageStart}
          startLabel={
            scriptMode === "automation"
              ? "Start automated run"
              : "Launch & Start Recording"
          }
        />
        <div className="flex items-center gap-3 text-sm text-[var(--fg-muted)]">
          <span
            className={`h-2.5 w-2.5 rounded-full shadow-sm ${
              isRecording
                ? "bg-emerald-400 shadow-emerald-400/50"
                : "bg-[var(--fg-muted)]/40"
            }`}
          />
          {isRecording ? (
            <span className="flex items-center gap-2 font-medium text-emerald-400">
              <Activity className="h-4 w-4 animate-pulse" />
              {scriptMode === "automation"
                ? skipLobby
                  ? "Automated script running (direct game → rounds)…"
                  : "Automated script running (login → lobby → rounds)…"
                : "Recording in progress…"}
            </span>
          ) : isProcessing ? (
            "Processing trace and generating report…"
          ) : scriptMode === "automation" ? (
            skipLobby
              ? "Idle — paste the direct game URL, pick game + rounds, then start."
              : "Idle — set game, rounds, and login above, then start."
          ) : (
            "Idle — paste a URL and launch to begin."
          )}
        </div>
        {isRecording && <LiveMetricsPanel isRecording={isRecording} />}
      </div>
    </section>
  );
}

export default memo(RecordFormSectionInner);
