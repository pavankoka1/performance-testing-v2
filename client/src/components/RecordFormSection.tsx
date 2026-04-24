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
  Cpu,
  Gamepad2,
  Hash,
  KeyRound,
  Network,
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

/** Defaults mirror server `casinoGames.js` (overridable per session in the form). */
const GAME_DEFAULT_CREDS: Record<AutomationGameId, { user: string; pass: string }> =
  {
    "color-game-bonanza": { user: "hareesh", pass: "hareesh123" },
  };

function automationDefaultUrlForGame(gameId: AutomationGameId) {
  return AUTOMATION_URL_CERTIFICATION;
}

const isValidUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return ["http:", "https:"].includes(parsed.protocol);
  } catch {
    return false;
  }
};

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
};

function RecordFormSectionInner({
  isRecording,
  isProcessing,
  onStart,
  onStop,
}: RecordFormSectionProps) {
  const [url, setUrl] = useState(DEFAULT_MANUAL_URL);
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
  const [automationGame, setAutomationGame] =
    useState<AutomationGameId>("color-game-bonanza");
  const [automationRounds, setAutomationRounds] =
    useState<(typeof ROUND_OPTIONS)[number]>(3);
  const [casinoUser, setCasinoUser] = useState(
    () => GAME_DEFAULT_CREDS["color-game-bonanza"].user
  );
  const [casinoPass, setCasinoPass] = useState(
    () => GAME_DEFAULT_CREDS["color-game-bonanza"].pass
  );
  const [skipLobby, setSkipLobby] = useState(false);

  useEffect(() => {
    if (scriptMode === "manual") setSkipLobby(false);
  }, [scriptMode]);

  /** Manual: restore demo URL when leaving automation. Automation: URL follows game unless “skip lobby” (direct game URL). */
  useEffect(() => {
    if (scriptMode === "manual") {
      setUrl((u) =>
        u === AUTOMATION_URL_CERTIFICATION ||
        u.trim() === ""
          ? DEFAULT_MANUAL_URL
          : u
      );
      return;
    }
    if (!skipLobby) {
      setUrl(automationDefaultUrlForGame(automationGame));
    }
  }, [scriptMode, automationGame, skipLobby]);

  /** When the automated game changes, reset login fields to that game’s config defaults. */
  useEffect(() => {
    const d = GAME_DEFAULT_CREDS[automationGame];
    setCasinoUser(d.user);
    setCasinoPass(d.pass);
  }, [automationGame]);

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
    onStart(url, cpuThrottle, networkThrottle, base);
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
  ]);

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6 shadow-[var(--glow)]">
      <div className="flex flex-col gap-6">
        <SystemStatusBanner />
        <div className="flex flex-col gap-3">
          <span className="text-sm font-medium text-[var(--fg)]">
            Session mode
          </span>
          <div className="flex flex-wrap gap-3">
            <label
              className={`flex cursor-pointer items-center gap-2 rounded-xl border px-4 py-3 text-sm transition ${
                scriptMode === "manual"
                  ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--fg)]"
                  : "border-[var(--border)] bg-[var(--bg)] text-[var(--fg-muted)] hover:border-[var(--accent)]/30"
              } ${isRecording || isProcessing ? "pointer-events-none opacity-60" : ""}`}
            >
              <input
                type="radio"
                name="script-mode"
                className="sr-only"
                checked={scriptMode === "manual"}
                onChange={() => setScriptMode("manual")}
                disabled={isRecording || isProcessing}
              />
              Manual URL
              <span className="text-xs text-[var(--fg-muted)]">
                — open any page, stop when you are done
              </span>
            </label>
            <label
              className={`flex cursor-pointer items-center gap-2 rounded-xl border px-4 py-3 text-sm transition ${
                scriptMode === "automation"
                  ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--fg)]"
                  : "border-[var(--border)] bg-[var(--bg)] text-[var(--fg-muted)] hover:border-[var(--accent)]/30"
              } ${isRecording || isProcessing ? "pointer-events-none opacity-60" : ""}`}
            >
              <input
                type="radio"
                name="script-mode"
                className="sr-only"
                checked={scriptMode === "automation"}
                onChange={() => setScriptMode("automation")}
                disabled={isRecording || isProcessing}
              />
              <Bot className="h-4 w-4 text-violet-400" aria-hidden />
              Automated script
              <span className="text-xs text-[var(--fg-muted)]">
                — login, lobby, game, rounds; report when finished
              </span>
            </label>
          </div>
        </div>
        <URLInput
          value={url}
          onChange={setUrl}
          label={
            scriptMode === "automation"
              ? skipLobby
                ? "Game URL (direct — same page the lobby tile opens)"
                : "Entry URL (Pragmatic auth / lobby entry)"
              : undefined
          }
        />
        {scriptMode === "automation" && (
          <div className="flex flex-col gap-6">
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
                <option value="color-game-bonanza">Color Game Bonanza</option>
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
                    placeholder={GAME_DEFAULT_CREDS[automationGame].user}
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
                if set, otherwise the game’s built-in defaults.
              </p>
            </div>
          </div>
        )}
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
            onChange={(e) => setTraceDetail(e.target.value as "light" | "full")}
            disabled={isRecording || isProcessing}
          >
            <option value="light">Light — smoother capture</option>
            <option value="full">Full — deeper GPU/layout detail</option>
          </SelectField>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)]/40 p-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--fg-muted)]">
            Asset grouping (optional)
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
              Any downloaded file URL containing one of these keys will be counted
              as <span className="text-[var(--accent)]">game</span> assets.
            </span>
          </label>
        </div>
        <label
          className={`flex items-center gap-2 text-sm text-[var(--fg)] ${
            isRecording || isProcessing
              ? "cursor-not-allowed opacity-60"
              : "cursor-pointer"
          }`}
        >
          <input
            type="checkbox"
            checked={recordVideo}
            onChange={(e) => setRecordVideo(e.target.checked)}
            disabled={isRecording || isProcessing}
            className="h-4 w-4 rounded border-[var(--border)] text-[var(--accent)] focus:ring-[var(--accent)]"
          />
          <Video className="h-4 w-4 text-[var(--accent)]" />
          <span>Record session video</span>
          <span className="text-xs text-[var(--fg-muted)]">
            (off for long runs)
          </span>
        </label>
        <SelectField
          label="Video"
          icon={Video}
          hint="Recording resolution"
          value={videoQuality}
          onChange={(e) => setVideoQuality(e.target.value as "low" | "high")}
          disabled={isRecording || isProcessing || !recordVideo}
        >
          <option value="low">Low (960×540) — lighter</option>
          <option value="high">High (1366×768) — sharper</option>
        </SelectField>
        <RecordButtons
          isRecording={isRecording}
          isProcessing={isProcessing}
          onStart={handleStart}
          onStop={onStop}
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
