import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { EyeWidget } from "./components/EyeWidget";
import { ShaderCanvas } from "./components/ShaderCanvas";

const METRICS = [
  "FPS (live + series)",
  "CPU pressure",
  "GPU / compositor",
  "JS heap",
  "DOM node count",
  "Layout & paint",
  "Long tasks",
  "Blocking threads",
  "FCP · LCP · CLS · TBT",
  "Network waterfall",
  "Downloaded assets",
  "Bundle / script size",
  "Stylesheet weight",
  "Animation timeline",
  "Session video (WebM)",
  "CDP trace export",
];

const BENTO = [
  {
    span: "span-3",
    icon: "🎬",
    title: "Real Chromium, not a synthetic lab",
    body: "PerfTrace drives Playwright with a full Chromium build (bundled in the desktop app). Your page runs in a real browser with tracing, CDP metrics, and optional CPU throttling — 1× through 20× — to simulate low-end hardware.",
  },
  {
    span: "span-3",
    icon: "📡",
    title: "Live dashboard while you record",
    body: "Watch FPS, CPU, and heap update while you record. Stop the session and you get a dense report plus an optional downloadable session video (WebM) for playback and sharing.",
  },
  {
    span: "span-2",
    icon: "📦",
    title: "Asset intelligence",
    body: "See what shipped: scripts, styles, fonts, images, JSON/API payloads, and a clear “build” document size — not guesswork from DevTools alone.",
  },
  {
    span: "span-2",
    icon: "⚡",
    title: "Long tasks & main-thread story",
    body: "Long-task breakdown, layout/paint cost signals, and blocking-thread hints so you know what hurt interactivity during the capture window.",
  },
  {
    span: "span-2",
    icon: "🖥️",
    title: "Desktop app, zero cloud rent",
    body: "Electron wrapper with Express inside: offline-friendly, your URLs and traces stay on your machine. Builds for macOS (universal), Windows, and Linux.",
  },
  {
    span: "span-6",
    icon: "📑",
    title: "One report after you hit stop",
    body: "A single view stitches trace-derived data, Web Vitals, live metric series, optional animation timeline, and downloaded-bytes summaries — export-friendly for sharing with your team.",
  },
];

const PIPELINE = [
  {
    title: "Paste a URL & tune CPU",
    desc: "Optional 4× / 6× / 20× throttling before launch to stress layout, hydration, and main-thread work under pressure.",
  },
  {
    title: "Start recording",
    desc: "Chromium boots with CDP tracing and client-side collectors; the UI polls live metrics so you see regressions as they happen.",
  },
  {
    title: "Interact",
    desc: "Exercise flows — scrolls, route changes, animations — while data streams in.",
  },
  {
    title: "Stop → report",
    desc: "The server parses the Chrome trace, merges client metrics, and returns a structured report: charts, tables, and narrative sections you can skim in minutes.",
  },
];

const STACK = [
  "Electron 33",
  "Node + Express",
  "Playwright",
  "Chromium + CDP",
  "React 18 (UI)",
  "Vite",
  "Docker-ready",
];

function useDownloads() {
  const [urls, setUrls] = useState({
    mac: "#",
    win: "#",
    linux: "#",
  });

  useEffect(() => {
    const d = window.PERFTRACE_DOWNLOADS;
    if (!d) return;
    setUrls({
      mac: d.mac || "#",
      win: d.win || "#",
      linux: d.linux || "#",
    });
  }, []);

  return urls;
}

function useNavScrolled() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return scrolled;
}

export default function App() {
  const downloads = useDownloads();
  const navScrolled = useNavScrolled();

  return (
    <>
      <div className="shader-wrap">
        <ShaderCanvas />
      </div>
      <div className="shader-vignette" aria-hidden />
      <div className="grid-overlay" aria-hidden />

      <div className="page">
        <header className={`nav ${navScrolled ? "scrolled" : ""}`}>
          <span className="nav-brand">PerfTrace</span>
          <nav className="nav-links" aria-label="Page">
            <a href="#metrics">Metrics</a>
            <a href="#features">Product</a>
            <a href="#flow">Flow</a>
            <a href="#download">Download</a>
          </nav>
          <a className="nav-cta" href="#download">
            Get the app
          </a>
        </header>

        <section className="hero">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <p className="hero-badge">
              <span>●</span> Self-hosted performance lab
            </p>
            <h1>
              <span className="hero-gradient">Ship faster UI.</span>
              <br />
              Prove it with traces.
            </h1>
            <p className="hero-sub">
              PerfTrace is a desktop performance studio: launch any URL in real
              Chromium, throttle the CPU, record CDP traces, stream optional
              video, and walk away with a dense report — FPS, Web Vitals, assets,
              long tasks, and more — without sending your product traffic to a
              SaaS black box.
            </p>
            <div className="hero-actions">
              <a className="btn btn-primary" href="#download">
                Download PerfTrace
              </a>
              <a className="btn" href="#features">
                Explore capabilities
              </a>
            </div>
            <p className="hero-note">
              macOS · Windows · Linux · Chromium included in the app bundle
            </p>
          </motion.div>
          <EyeWidget />
        </section>

        <section className="section" id="metrics">
          <div className="section-head">
            <p className="section-kicker">Signal density</p>
            <h2 className="section-title">What the app actually measures</h2>
            <p className="section-desc">
              Everything below shows up across the live session and/or the
              post-run report — pulled from Chrome DevTools Protocol, trace
              events, Performance APIs, and network timing where applicable.
            </p>
          </div>
          <motion.div
            className="metrics-wall"
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-40px" }}
            variants={{
              hidden: {},
              show: {
                transition: { staggerChildren: 0.02 },
              },
            }}
          >
            {METRICS.map((label) => (
              <motion.div
                key={label}
                className="metric-chip"
                variants={{
                  hidden: { opacity: 0, y: 8 },
                  show: { opacity: 1, y: 0 },
                }}
              >
                {label}
              </motion.div>
            ))}
          </motion.div>
        </section>

        <section className="section" id="features">
          <div className="section-head">
            <p className="section-kicker">Product depth</p>
            <h2 className="section-title">
              Built for serious front-end review
            </h2>
            <p className="section-desc">
              Whether you are hardening a SPA before release or comparing GPU vs
              CPU animation strategies, PerfTrace is the control room: one
              session, many lenses on the same capture.
            </p>
          </div>
          <div className="bento">
            {BENTO.map((card) => (
              <motion.article
                key={card.title}
                className={`bento-card ${card.span}`}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.4 }}
              >
                <span className="bento-icon">{card.icon}</span>
                <h3>{card.title}</h3>
                <p>{card.body}</p>
              </motion.article>
            ))}
          </div>
        </section>

        <section className="section" id="flow">
          <div className="section-head">
            <p className="section-kicker">Operator flow</p>
            <h2 className="section-title">From URL to report in four beats</h2>
          </div>
          <div className="pipeline">
            {PIPELINE.map((step, i) => (
              <motion.div
                key={step.title}
                className="pipeline-step"
                initial={{ opacity: 0, x: -12 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08 }}
              >
                <span className="step-num">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h4>{step.title}</h4>
                <p>{step.desc}</p>
              </motion.div>
            ))}
          </div>
        </section>

        <section className="section">
          <div className="section-head">
            <p className="section-kicker">Under the hood</p>
            <h2 className="section-title">Stack you can reason about</h2>
            <p className="section-desc">
              Open source friendly pieces — no proprietary browser, no mystery
              containers. Run the desktop binary locally or deploy the server
              side to a VPS when you want a shared capture endpoint.
            </p>
          </div>
          <div className="stack-row">
            {STACK.map((s) => (
              <span key={s} className="stack-pill">
                {s}
              </span>
            ))}
          </div>
        </section>

        <section className="section" id="download">
          <div className="section-head">
            <p className="section-kicker">Install</p>
            <h2 className="section-title">Pick your platform</h2>
            <p className="section-desc">
              The installers bundle Chromium for Playwright — recipients do not
              need a separate browser install. macOS builds are universal (Apple
              Silicon + Intel) when packaged from our standard Forge pipeline.
            </p>
          </div>
          <div className="download-grid">
            <div className="download-card">
              <span className="platform">🍎 macOS</span>
              <span className="hint">.dmg or universal .zip</span>
              <a href={downloads.mac} target="_blank" rel="noopener noreferrer">
                Download for Mac →
              </a>
            </div>
            <div className="download-card">
              <span className="platform">🪟 Windows</span>
              <span className="hint">x64 portable .zip</span>
              <a href={downloads.win} target="_blank" rel="noopener noreferrer">
                Download for Windows →
              </a>
            </div>
            <div className="download-card">
              <span className="platform">🐧 Linux</span>
              <span className="hint">x64 .zip</span>
              <a
                href={downloads.linux}
                target="_blank"
                rel="noopener noreferrer"
              >
                Download for Linux →
              </a>
            </div>
          </div>
          <p className="hero-note" style={{ marginTop: "1.5rem" }}>
            Gatekeeper / SmartScreen: you may need to “Open anyway” the first
            launch — or code-sign builds for your org.
          </p>
        </section>

        <footer className="footer">
          <p>
            <strong>PerfTrace</strong> · Self-hosted · No mandatory cloud · Your
            sessions stay on your hardware (or your VPS).
          </p>
          <p style={{ marginTop: "0.5rem", fontSize: "0.8rem" }}>
            Marketing site · App repo & docs live alongside the Electron +
            server codebase.
          </p>
        </footer>
      </div>
    </>
  );
}
