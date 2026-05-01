import { motion } from "framer-motion";

/** Screenshot from `public/screens/` (served as `/screens/...`). */
function DocFigure({ src, alt }: { src: string; alt: string }) {
  return (
    <figure className="doc-screenshot-slot doc-screenshot-real">
      <img
        className="doc-screenshot-img"
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
      />
    </figure>
  );
}

/** Marketing-site documentation — mirrors PerfTrace desktop UI labels. */
export function Documentation() {
  return (
    <>
      <section className="section doc-section" id="guide">
        <div className="section-head">
          <p className="section-kicker">Operator guide</p>
          <h2 className="section-title">How to use PerfTrace</h2>
          <p className="section-desc">
            Install the desktop app, open the Session view. Step 01 shows the full
            session panel: URL, session mode, collapsed advanced options, capture
            pipeline (network / CPU / trace), and session video — then Start.
          </p>
        </div>

        <nav className="doc-toc" aria-label="Documentation sections">
          <a href="#field-reference">Every field explained</a>
          <a href="#check-metrics">Reading metrics</a>
          <a href="#metric-reference">Metric reference</a>
          <a href="#whats-new">What&apos;s new</a>
        </nav>

        <div className="doc-steps">
          <motion.article
            className="doc-step"
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <span className="doc-step-num">01</span>
            <h3>URL, session mode, layout options &amp; capture tuning</h3>
            <p>
              <strong>Entry URL</strong> — Starting address; automation often uses the
              Pragmatic auth URL. <strong>Session mode</strong> —{" "}
              <em>Manual URL</em> (you drive the tab) vs <em>Automated script</em>{" "}
              (login → lobby → game → rounds). Expand{" "}
              <strong>Session &amp; browser options</strong> for browser layout (desktop
              / portrait / landscape), asset keys, login, skip lobby, and preload
              baseline. <strong>Capture pipeline</strong> — network throttling, CPU
              slowdown, and trace detail. <strong>Session video</strong> — optional WebM
              and quality preset.
            </p>
            <DocFigure
              src="/screens/guide-step-01-session-panel.png"
              alt="PerfTrace session form: Entry URL, Session mode Manual or Automated script, Session and browser options, Capture pipeline Network CPU Trace, Session video, Start automated run"
            />
          </motion.article>

          <motion.article
            className="doc-step"
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <span className="doc-step-num">02</span>
            <h3>Start recording</h3>
            <p>
              When settings look right, click{" "}
              <strong>Launch &amp; Start Recording</strong> (manual) or{" "}
              <strong>Start automated run</strong> (automation). Watch live metrics;
              use <strong>Stop</strong> when finished (manual) or wait for the script
              to complete.
            </p>
            <DocFigure
              src="/screens/field-start-button.png"
              alt="PerfTrace Start automated run button, Stop Recording control, and idle status line"
            />
          </motion.article>

          <motion.article
            className="doc-step"
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <span className="doc-step-num">03</span>
            <h3>Read the Session Report</h3>
            <p>
              Charts, assets, Web Vitals, and optional video align to{" "}
              <strong>t = 0</strong> when a baseline is set (preload URL, asset
              keys at game URL, or automation). Summary chips show requests,
              latency, transfer, game vs common bytes. Use{" "}
              <strong>Browse all files</strong> for every captured URL; tiles below
              break down preload size until curtain lift, curtain lift time, and
              assets by type.
            </p>
            <p className="doc-step-shot-label">Files, preload &amp; categories</p>
            <DocFigure
              src="/screens/guide-session-report-files-preload.png"
              alt="PerfTrace Session Report: KPIs, Browse all files, preload size until curtain lift, curtain lift time, asset categories"
            />
            <p className="doc-step-shot-label">Report header &amp; sections</p>
            <DocFigure
              src="/screens/guide-session-report-overview.png"
              alt="PerfTrace Session Report overview with summary pills, AVG FPS CPU heap DOM TBT cards, and collapsible sections for charts and video"
            />
          </motion.article>
        </div>
      </section>

      {/* ——— Full field reference ——— */}
      <section className="section doc-section" id="field-reference">
        <div className="section-head">
          <p className="section-kicker">UI reference</p>
          <h2 className="section-title">Every field explained</h2>
          <p className="section-desc">
            Labels match the PerfTrace app — each section includes a capture where it
            helps.
          </p>
        </div>

        <nav className="doc-field-nav" aria-label="Field reference index">
          <a href="#field-url">URL</a>
          <a href="#field-session-mode">Session mode</a>
          <a href="#field-advanced-panel">Advanced panel</a>
          <a href="#field-layout">Layout</a>
          <a href="#field-automation">Automation</a>
          <a href="#field-preload-baseline">Preload baseline</a>
          <a href="#field-asset-grouping">Asset grouping</a>
          <a href="#field-capture-pipeline-detail">Capture pipeline</a>
          <a href="#field-live-status">Status &amp; live metrics</a>
          <a href="#field-report-files">Report: files &amp; preload</a>
        </nav>

        <article className="field-doc" id="field-url">
          <h3>Target URL</h3>
          <p>
            The page Chromium opens first. Must be a valid{" "}
            <code>http://</code> or <code>https://</code> address; Start stays
            disabled until the URL parses.
          </p>
          <ul className="field-doc-list">
            <li>
              <strong>Manual URL</strong> — Label:{" "}
              <em>Target URL — page to measure</em>. Use any site you want to
              profile; you control navigation and when to stop.
            </li>
            <li>
              <strong>Automated script</strong> (lobby path) — Label:{" "}
              <em>Entry URL (Pragmatic auth / lobby entry)</em>. Typically the
              Pragmatic certification authenticate URL; the script logs in, opens
              the lobby, searches for the game, and launches it.
            </li>
            <li>
              <strong>Automated script + Skip login &amp; lobby</strong> — Label:{" "}
              <em>Game URL (direct — same page the lobby tile opens)</em>. Paste
              the final game URL so automation only waits for game UI and runs
              rounds—no login or lobby steps.
            </li>
          </ul>
          <p className="field-ifomit">
            <strong>If you skip it:</strong> You cannot start. Last manual URL may
            be restored from browser storage when switching back from automation.
          </p>
          <DocFigure
            src="/screens/field-url.png"
            alt="PerfTrace Entry URL field with Pragmatic authentication URL"
          />
        </article>

        <article className="field-doc" id="field-session-mode">
          <h3>Session mode</h3>
          <p>
            Radio cards under the heading <strong>Session mode</strong> — only
            one can be active.
          </p>
          <ul className="field-doc-list">
            <li>
              <strong>Manual URL</strong> — &quot;Open any site — you drive the
              tab; stop when finished.&quot; Unlocks <strong>Preload baseline</strong>{" "}
              fields (automation uses asset keys + server defaults instead).
            </li>
            <li>
              <strong>Automated script</strong> — &quot;Login → lobby → game →
              rounds; report when the run completes.&quot; Shows Automation
              (game, rounds, Pragmatic login) and optional Skip lobby. Start label
              becomes <strong>Start automated run</strong>.
            </li>
          </ul>
          <p className="field-ifomit">
            <strong>Default:</strong> Manual. Switching modes adjusts the URL field
            hint and may reset URL (e.g. to stored manual URL or game default auth
            URL).
          </p>
          <DocFigure
            src="/screens/field-session-mode.png"
            alt="PerfTrace Session mode Manual URL versus Automated script"
          />
        </article>

        <article className="field-doc" id="field-advanced-panel">
          <h3>Session &amp; browser options</h3>
          <p>
            Collapsible panel (gear icon) titled{" "}
            <strong>Session &amp; browser options</strong>. Subtitle:{" "}
            <em>Layout, asset keys, login, skip lobby, preload baseline…</em> When
            expanded, it contains <strong>Browser layout</strong>, automation-only
            blocks, <strong>Preload baseline</strong> (manual only), and{" "}
            <strong>Asset grouping</strong> — in that vertical order in the app.
          </p>
          <p className="field-ifomit">
            <strong>If you never open it:</strong> Defaults apply — Desktop layout,
            default asset keys text, no manual preload regex/contains.
          </p>
          <p className="doc-step-shot-label">Collapsed</p>
          <DocFigure
            src="/screens/field-session-options-collapsed.png"
            alt="PerfTrace Session and browser options accordion closed"
          />
          <p className="doc-step-shot-label">Expanded</p>
          <DocFigure
            src="/screens/field-session-options-expanded.png"
            alt="PerfTrace Session and browser options expanded: Browser layout, Automation, Pragmatic login, Asset grouping"
          />
        </article>

        <article className="field-doc" id="field-layout">
          <h3>Browser layout</h3>
          <p>
            Three radio cards. All use real desktop Chromium with a fixed or
            maximized window — not an iOS/Android device simulator.
          </p>
          <ul className="field-doc-list">
            <li>
              <strong>Desktop</strong> — Chromium opens <strong>maximized</strong>;
              normal resizable desktop experience and default viewport behavior.
            </li>
            <li>
              <strong>Portrait (mobile)</strong> — Fixed viewport{" "}
              <code className="field-mono">375×667</code> (DevTools-style responsive
              frame).
            </li>
            <li>
              <strong>Landscape (mobile)</strong> — Fixed viewport{" "}
              <code className="field-mono">667×375</code>.
            </li>
          </ul>
          <p className="field-ifomit">
            <strong>If unchanged:</strong> Desktop. Pick portrait/landscape to match
            how your players hold the device or to stress responsive CSS/JS.
          </p>
          <DocFigure
            src="/screens/field-browser-layout.png"
            alt="PerfTrace Browser layout Desktop Portrait and Landscape mobile presets"
          />
        </article>

        <article className="field-doc" id="field-automation">
          <h3>Automation (visible when Automated script is selected)</h3>

          <h4 className="field-doc-sub">Skip login &amp; lobby</h4>
          <p>
            Checkbox. When on, the URL must already be the game; automation waits
            for game UI (canvas/timer per script), then runs rounds. Username /
            password fields are disabled and show &quot;Not used when Skip login
            &amp; lobby is on.&quot;
          </p>
          <p className="field-ifomit">
            <strong>If off:</strong> Full flow from Entry URL — login, lobby search,
            tile click, game load, then rounds.
          </p>
          <p className="field-doc-note">
            <strong>Skip login &amp; lobby</strong> is visible in the{" "}
            <a href="#field-advanced-panel">expanded Session &amp; browser options</a>{" "}
            screenshot above.
          </p>

          <h4 className="field-doc-sub">Game</h4>
          <p>
            Dropdown (<strong>Game</strong>, hint: <em>Lobby search target</em>).
            Selects which automated game profile to use (search text in lobby,
            selectors for timer/chips/bets, default URLs and credentials). Options
            load from <code>/api/automation/games</code> when available, with a
            built-in fallback list.
          </p>
          <p className="field-ifomit">
            <strong>Changing game</strong> updates default auth URL, login
            placeholders, and can refresh <strong>Game asset keys</strong> when the
            game defines them.
          </p>
          <DocFigure
            src="/screens/field-automation-game.png"
            alt="PerfTrace automation Game dropdown lobby search target Color Game Bonanza"
          />

          <h4 className="field-doc-sub">Rounds</h4>
          <p>
            Dropdown — <strong>1, 3, 5, or 10 rounds</strong> (hint:{" "}
            <em>Exact run length</em>). Each &quot;round&quot; follows the scripted
            betting or observe loop for that game; the session ends after the
            selected count (automation then triggers Stop/report).
          </p>
          <p className="field-ifomit">
            <strong>Shorter runs</strong> finish faster; higher counts give more
            statistical coverage but longer traces and larger downloads.
          </p>
          <DocFigure
            src="/screens/field-rounds.png"
            alt="PerfTrace Rounds dropdown 1 3 5 or 10 rounds"
          />

          <h4 className="field-doc-sub" id="field-pragmatic-login">
            Pragmatic login
          </h4>
          <p>
            Section with <strong>Username</strong> and <strong>Password</strong>{" "}
            fields (icons User / Key). Used only when Skip lobby is <strong>off</strong>{" "}
            so the script can sign in at the Pragmatic auth page.
          </p>
          <p>
            Placeholders show each game&apos;s default certification credentials.
            Help text: clearing a field omits it so the server can use{" "}
            <code>CASINO_USER</code> / <code>CASINO_PASS</code> environment
            variables if set, otherwise the game&apos;s built-in defaults.
          </p>
          <p className="field-ifomit">
            <strong>Wrong or missing credentials:</strong> Login fails and automation
            errors; use valid certification users for your environment.
          </p>
          <DocFigure
            src="/screens/field-pragmatic-login.png"
            alt="PerfTrace Pragmatic login username and password fields"
          />
        </article>

        <article className="field-doc" id="field-preload-baseline">
          <h3>Preload baseline (optional) — Manual URL only</h3>
          <p>
            This block is hidden in automation mode. It tells the server <strong>when</strong>{" "}
            your SPA has reached the &quot;game&quot; surface so charts and optional
            video can use <strong>t = 0</strong> at that navigation — trimming lobby
            and auth time from the time axis.
          </p>
          <ul className="field-doc-list">
            <li>
              <strong>URL contains</strong> — Substring match on the full address
              bar (e.g. <code>/game/</code>, <code>?table=</code>). Case-sensitive
              unless you rely on regex instead.
            </li>
            <li>
              <strong>Or regex</strong> — JavaScript regular expression tested against
              the URL (e.g. path with digits). More precise than contains.
            </li>
            <li>
              <strong>Flags</strong> — Regex flags (default <code>i</code> for
              case-insensitive). Only applies to the regex field.
            </li>
          </ul>
          <p className="doc-note field-note">
            If both <strong>contains</strong> and <strong>regex</strong> are filled,{" "}
            <strong>regex wins</strong> (per in-app copy). Leave both empty to keep
            the full session on the chart axis (no trim).
          </p>
          <p className="field-ifomit">
            <strong>Without baseline:</strong> Metrics use wall time from record start;
            lobby appears on the left of charts.
          </p>
          <DocFigure
            src="/screens/field-preload-baseline.png"
            alt="PerfTrace Preload baseline optional URL contains regex and flags"
          />
        </article>

        <article className="field-doc" id="field-asset-grouping">
          <h3>Asset grouping — Game asset keys</h3>
          <p>
            Section title: <strong>Asset grouping</strong>. Single text field:{" "}
            <strong>Game asset keys (comma-separated)</strong>, placeholder{" "}
            <code>colorgame,color-game</code>.
          </p>
          <p>
            Each key is a substring matched against request URLs (case-insensitive).
            Requests whose URL contains any key are classified as{" "}
            <strong>game</strong> scope in the report; others fall into{" "}
            <strong>common</strong> (shared/vendor/CDN) buckets. That powers the Game
            vs Common preload/post-load breakdown and duplicate detection.
          </p>
          <p>
            For <strong>automation</strong>, the server can also use these keys (or
            registry defaults from the selected game) to detect when navigation has
            left the generic lobby and reached a URL that looks like the game —
            aligning charts with manual portrait/desktop behavior.
          </p>
          <p className="field-ifomit">
            <strong>Empty keys:</strong> Less accurate game vs common split; for
            automation, keys may still be filled from the game definition if the
            server supplies defaults.
          </p>
          <DocFigure
            src="/screens/field-asset-keys.png"
            alt="PerfTrace Asset grouping game asset keys comma-separated"
          />
        </article>

        <article className="field-doc" id="field-capture-pipeline-detail">
          <h3>Capture pipeline</h3>
          <p>
            Intro copy: tuning applies when you launch. Below the divider, three
            selects and a video block.
          </p>

          <h4 className="field-doc-sub">Network</h4>
          <p>
            CDP link shaping: <strong>No throttling</strong>,{" "}
            <strong>Slow 3G</strong>, <strong>Fast 3G</strong>, <strong>4G</strong>.
            Simulates latency and bandwidth so API and asset loading match constrained
            networks.
          </p>
          <p className="field-ifomit">
            <strong>Default:</strong> No throttling — fastest path your machine allows.
          </p>

          <h4 className="field-doc-sub">CPU</h4>
          <p>
            Main-thread slowdown: <strong>1×</strong> (none), <strong>4×</strong>,{" "}
            <strong>6×</strong>, <strong>20×</strong>. Higher values exaggerate
            long-task and layout pressure like a low-end device.
          </p>
          <p className="field-ifomit">
            <strong>Default:</strong> 1×.
          </p>

          <h4 className="field-doc-sub">Trace</h4>
          <p>
            <strong>Full</strong> — deeper layout/paint categories (default).{" "}
            <strong>Light</strong> — lower tracing overhead, less detail in trace-derived
            breakdowns.
          </p>

          <h4 className="field-doc-sub" id="field-session-video">
            Session video
          </h4>
          <p>
            <strong>Record session video</strong> — checkbox; help text suggests
            turning off for long runs. When on, <strong>Video quality</strong> is{" "}
            <strong>Low (960×540)</strong> or <strong>High (1366×768)</strong> — file
            size vs clarity. Quality control is disabled while recording is off.
          </p>
          <p>
            In the <strong>session video player</strong> inside the report,{" "}
            <code>preload</code> on the HTML video element may be <code>auto</code>{" "}
            for high quality so large WebMs decode smoothly — that &quot;preload&quot;
            is <strong>browser video loading</strong>, not the same as &quot;preload
            baseline&quot; or asset lifecycle <strong>preload</strong> bytes.
          </p>
          <p className="field-ifomit">
            <strong>Video off:</strong> No WebM file; smaller disk use. Charts and
            metrics are unchanged.
          </p>
          <DocFigure
            src="/screens/field-capture-pipeline.png"
            alt="PerfTrace Capture pipeline Network CPU Trace and Session video recording quality"
          />
        </article>

        <article className="field-doc" id="field-live-status">
          <h3>Start button &amp; status line</h3>
          <p>
            <strong>Launch &amp; Start Recording</strong> (manual) or{" "}
            <strong>Start automated run</strong> (automation). Below, a status line
            with a colored dot: idle hints (e.g. &quot;Idle — paste a URL…&quot;),
            recording pulse, or &quot;Processing trace…&quot;.
          </p>
          <p>
            While recording, <strong>Live metrics</strong> panels stream FPS, CPU,
            heap, etc., so you can abort early if something looks wrong.
          </p>
          <DocFigure
            src="/screens/field-start-button.png"
            alt="PerfTrace Start automated run and idle status line"
          />
        </article>

        <article className="field-doc" id="field-report-files">
          <h3>Session Report — Browse all files &amp; preload scopes</h3>
          <p>
            After Stop, the report includes downloaded asset stats.{" "}
            <strong>Browse all files</strong> opens a modal to search and sort every
            captured URL — useful for audits.
          </p>
          <p>
            Summary tiles often split <strong>Game preload</strong> vs{" "}
            <strong>Common preload</strong> (and post-load totals when lifecycle data
            exists). Here <strong>preload</strong> means bytes attributed to the
            loading phase before/around curtain lift — not the Session form&apos;s
            &quot;Preload baseline&quot; URL field (that only sets chart time zero).
          </p>
          <p className="field-ifomit">
            <strong>No game keys:</strong> Game vs common split is less meaningful;
            totals still show full session bytes.
          </p>
          <DocFigure
            src="/screens/guide-session-report-files-preload.png"
            alt="PerfTrace Session Report files loaded Browse all files preload and asset breakdown"
          />
        </article>
      </section>

      <section className="section doc-section" id="check-metrics">
        <div className="section-head">
          <p className="section-kicker">Interpretation</p>
          <h2 className="section-title">How to check the metrics</h2>
          <p className="section-desc">
            Use the live dashboard during capture for quick signal; use the Session
            Report for merged trace + CDP + in-page data. When a baseline exists, the
            chart axis shows the <strong>aligned</strong> window; the header may still
            show full session duration for context.
          </p>
        </div>

        <div className="doc-prose">
          <h3>During recording</h3>
          <ul>
            <li>
              Watch FPS and CPU for spikes during interactions; heap trending up may
              indicate leaks.
            </li>
            <li>
              Stop when you have covered the flows you care about; longer runs increase
              trace size.
            </li>
          </ul>

          <h3>After Stop</h3>
          <ul>
            <li>
              Summary cards encode health (green/amber/red) using built-in thresholds.
            </li>
            <li>
              Open <strong>Detailed chart view</strong> or metric help (
              <strong>?</strong>) in the app for thresholds and definitions.
            </li>
            <li>
              Align session video with charts when baseline trim is applied (offset
              matches removed lobby time).
            </li>
          </ul>

          <h3>Charts look like &quot;full session&quot; but you wanted game-only</h3>
          <p>
            Set <strong>Preload baseline</strong> (manual) and/or{" "}
            <strong>Game asset keys</strong> so the server can detect the game URL.
            Automation also benefits from keys (including server-side defaults from the
            game registry).
          </p>
        </div>
      </section>

      <section className="section doc-section" id="metric-reference">
        <div className="section-head">
          <p className="section-kicker">Deep dive</p>
          <h2 className="section-title">Metric reference</h2>
          <p className="section-desc">
            Short definitions for each major series in the report. In-app tooltips
            include thresholds and longer copy.
          </p>
        </div>

        <div className="metric-ref-grid">
          <article className="metric-def">
            <h3>FPS</h3>
            <p>
              Frames per wall-clock second; merges in-page rAF buckets with Chrome
              trace DrawFrame where available. After baseline trim, uses the same time
              origin as CPU.
            </p>
          </article>
          <article className="metric-def">
            <h3>CPU utilisation</h3>
            <p>
              Main-thread busy time from CDP samples, as % of a one-second window.
            </p>
          </article>
          <article className="metric-def">
            <h3>Frame pacing &amp; stagger</h3>
            <p>
              Detects uneven delivery vs steady cadence — useful when average FPS
              looks fine but motion feels rough.
            </p>
          </article>
          <article className="metric-def">
            <h3>TBT &amp; long tasks</h3>
            <p>
              Blocking work over 50&nbsp;ms; timeline and top tasks show where time
              went.
            </p>
          </article>
          <article className="metric-def">
            <h3>JS heap</h3>
            <p>
              Live heap size from Chrome APIs; watch growth across long sessions.
            </p>
          </article>
          <article className="metric-def">
            <h3>DOM nodes</h3>
            <p>
              Element count — proxy for layout/style cost; virtualization reduces
              live nodes.
            </p>
          </article>
          <article className="metric-def">
            <h3>Layout vs paint</h3>
            <p>
              Trace-summed layout and paint cost over the capture window (not a single
              frame).
            </p>
          </article>
          <article className="metric-def">
            <h3>Render breakdown</h3>
            <p>
              Script, layout, raster-style splits from trace or aggregates.
            </p>
          </article>
          <article className="metric-def">
            <h3>FCP · LCP · CLS</h3>
            <p>
              Web Vitals from paint and layout-shift observers in the page.
            </p>
          </article>
          <article className="metric-def">
            <h3>Network</h3>
            <p>
              Request durations and counts; pairs with network throttle presets.
            </p>
          </article>
          <article className="metric-def">
            <h3>Downloaded assets</h3>
            <p>
              Bytes by type; game vs common when URLs match asset keys; lifecycle
              phases when available.
            </p>
          </article>
          <article className="metric-def">
            <h3>Animation timeline</h3>
            <p>
              CDP animation events and metadata for animated layers.
            </p>
          </article>
          <article className="metric-def">
            <h3>Session video</h3>
            <p>
              WebM replay; optional timeline offset to match chart baseline.
            </p>
          </article>
        </div>
      </section>

      <section className="section doc-section" id="whats-new">
        <div className="section-head">
          <p className="section-kicker">Release notes</p>
          <h2 className="section-title">What&apos;s new</h2>
          <p className="section-desc">
            Recent desktop/server improvements for baseline alignment and mobile
            layouts.
          </p>
        </div>
        <ul className="changelog-list">
          <li>
            <strong>Portrait &amp; mobile landscape</strong> — Fixed viewports with the
            same reporting pipeline as desktop.
          </li>
          <li>
            <strong>Automation + asset keys</strong> — URL baseline detection matches
            manual behavior (lobby paths excluded); registry defaults when keys are
            empty.
          </li>
          <li>
            <strong>FPS / CPU timeline</strong> — Per-frame clocks normalized to
            session time; FPS rebased like CDP rows after baseline.
          </li>
          <li>
            <strong>Aligned duration</strong> — Charts use the post-baseline window
            when a baseline is committed.
          </li>
        </ul>
      </section>
    </>
  );
}
