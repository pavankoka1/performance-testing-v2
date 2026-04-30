const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const {
  createCaptureSession,
  stopCaptureSession,
  getLiveMetrics,
  getLatestVideo,
  getSessionSnapshot,
} = require("./lib/capture");
const { listAutomationGames } = require("./lib/casinoGames");
const { getSystemStatus } = require("./lib/systemStatus");
const { CONTENT_SECURITY_POLICY } = require("../csp.js");

const app = express();
const PORT = process.env.PORT || 3000;

app.use((req, res, next) => {
  res.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  next();
});

app.use(cors());
app.use(express.json());

/**
 * Packaged app: Vite build may live in `app.asar.unpacked/client/dist` (see forge asar unpack).
 * Prefer that path on disk so Windows does not hit odd asar read/sendFile issues.
 */
function resolveClientDist() {
  const fromServer = path.join(__dirname, "../client/dist");
  try {
    const { app: electronApp } = require("electron");
    if (electronApp?.isPackaged && process.resourcesPath) {
      const unpacked = path.join(
        process.resourcesPath,
        "app.asar.unpacked",
        "client",
        "dist"
      );
      if (fs.existsSync(path.join(unpacked, "index.html"))) return unpacked;
    }
  } catch {
    /* not running under Electron (e.g. node server/index.js) */
  }
  return fromServer;
}

// Serve built client (production) - only if dist exists
const clientDist = resolveClientDist();
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
}

// API: Start recording session
app.post("/api/start", async (req, res) => {
  try {
    const {
      url,
      cpuThrottle = 1,
      networkThrottle = "none",
      recordVideo = true,
      videoQuality = "high",
      traceDetail = "full",
      assetGameKeys = [],
      automation,
      layoutMode,
      viewportWidth,
      viewportHeight,
      assetBaselineUrlContains,
      assetBaselineUrlRegex,
      assetBaselineUrlRegexFlags,
    } = req.body || {};
    if (!url || typeof url !== "string") {
      return res
        .status(400)
        .json({ error: "Missing or invalid 'url' in request body." });
    }
    const netAllowed = new Set(["none", "slow-3g", "fast-3g", "4g"]);
    const netPreset =
      typeof networkThrottle === "string" && netAllowed.has(networkThrottle)
        ? networkThrottle
        : "none";

    const automationOpts =
      automation && typeof automation === "object" && automation.enabled
        ? {
            enabled: true,
            gameId:
              typeof automation.gameId === "string"
                ? automation.gameId
                : "russian-roulette",
            rounds:
              automation.rounds !== undefined && automation.rounds !== null
                ? Number(automation.rounds)
                : undefined,
            casinoUser:
              typeof automation.casinoUser === "string"
                ? automation.casinoUser.trim() || undefined
                : undefined,
            casinoPass:
              typeof automation.casinoPass === "string"
                ? automation.casinoPass.trim() || undefined
                : undefined,
            skipLobby: automation.skipLobby === true,
          }
        : null;
    const browserLayout =
      typeof layoutMode === "string" ||
      viewportWidth != null ||
      viewportHeight != null
        ? {
            layoutMode:
              typeof layoutMode === "string" ? layoutMode : undefined,
            viewportWidth:
              viewportWidth !== undefined && viewportWidth !== null
                ? Number(viewportWidth)
                : undefined,
            viewportHeight:
              viewportHeight !== undefined && viewportHeight !== null
                ? Number(viewportHeight)
                : undefined,
          }
        : null;

    const assetBaseline =
      typeof assetBaselineUrlRegex === "string" && assetBaselineUrlRegex.trim()
        ? {
            assetBaselineUrlRegex: assetBaselineUrlRegex.trim(),
            assetBaselineUrlRegexFlags:
              typeof assetBaselineUrlRegexFlags === "string"
                ? assetBaselineUrlRegexFlags
                : "i",
          }
        : typeof assetBaselineUrlContains === "string" &&
            assetBaselineUrlContains.trim()
          ? { assetBaselineUrlContains: assetBaselineUrlContains.trim() }
          : null;

    const result = await createCaptureSession(
      url,
      cpuThrottle,
      netPreset,
      recordVideo !== false,
      videoQuality,
      traceDetail,
      assetGameKeys,
      automationOpts,
      browserLayout,
      assetBaseline
    );
    return res.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to start recording.";
    return res.status(500).json({ error: message });
  }
});

// API: Stop recording and get report
app.post("/api/stop", async (req, res) => {
  try {
    const report = await stopCaptureSession({ userRequested: true });
    return res.json({ report });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to stop recording.";
    return res.status(500).json({ error: message });
  }
});

// API: System status (machine CPU, memory) — high load affects metrics accuracy
app.get("/api/system-status", async (req, res) => {
  try {
    const status = await getSystemStatus();
    return res.json(status);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to get system status.";
    return res.status(500).json({ error: message });
  }
});

// API: Session state (automation polling: recording / processing / report)
app.get("/api/session", (req, res) => {
  try {
    return res.json(getSessionSnapshot());
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to get session state.";
    return res.status(500).json({ error: message });
  }
});

app.get("/api/automation/games", (req, res) => {
  try {
    return res.json({ games: listAutomationGames() });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to get automation game configuration.";
    return res.status(500).json({ error: message });
  }
});

// API: Live metrics during recording
app.get("/api/metrics", async (req, res) => {
  try {
    const metrics = await getLiveMetrics();
    return res.json(metrics ?? { recording: false });
  } catch {
    return res.json({ recording: false });
  }
});

// API: Video (if available)
app.get("/api/video", async (req, res) => {
  try {
    const videoData = await getLatestVideo();
    res.set("Content-Type", videoData.contentType);
    res.set("Cache-Control", "no-store");
    fs.createReadStream(videoData.path).pipe(res);
  } catch {
    return res.status(404).json({ error: "Video not available." });
  }
});

// API: Video download (forces "Save as...")
app.get("/api/video/download", async (req, res) => {
  try {
    const videoData = await getLatestVideo();
    res.set("Content-Type", videoData.contentType);
    res.set("Cache-Control", "no-store");
    const ts = (() => {
      try {
        return new Date(videoData.startedAt).toISOString().slice(0, 19).replace(/[:-]/g, "");
      } catch {
        return new Date().toISOString().slice(0, 19).replace(/[:-]/g, "");
      }
    })();
    res.set(
      "Content-Disposition",
      `attachment; filename="perftrace-session-${ts}.webm"`
    );
    fs.createReadStream(videoData.path).pipe(res);
  } catch {
    return res.status(404).json({ error: "Video not available." });
  }
});

// SPA fallback (production only)
app.get("*", (req, res, next) => {
  const indexHtml = path.resolve(clientDist, "index.html");
  if (fs.existsSync(indexHtml)) {
    res.sendFile(indexHtml);
  } else {
    res.status(404).json({
      error:
        "Not found. Run npm run build first, or use the dev client at http://localhost:5173",
    });
  }
});

function startServer(port = PORT) {
  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      console.log(`PerfTrace server running at http://localhost:${port}`);
      console.log(
        "API: POST /api/start, POST /api/stop, GET /api/session, GET /api/metrics, GET /api/video, GET /api/video/download"
      );
      resolve(server);
    });
  });
}

// Auto-start when run directly (npm run server or node server/index.js)
if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };
