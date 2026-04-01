const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const {
  createCaptureSession,
  stopCaptureSession,
  getLiveMetrics,
  getLatestVideo,
} = require("./lib/capture");
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

// Serve built client (production) - only if dist exists
const clientDist = path.join(__dirname, "../client/dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
}

// API: Start recording session
app.post("/api/start", async (req, res) => {
  try {
    const {
      url,
      cpuThrottle = 1,
      trackReactRerenders = false,
      recordVideo = true,
    } = req.body || {};
    if (!url || typeof url !== "string") {
      return res
        .status(400)
        .json({ error: "Missing or invalid 'url' in request body." });
    }
    const result = await createCaptureSession(
      url,
      cpuThrottle,
      !!trackReactRerenders,
      recordVideo !== false
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
    const report = await stopCaptureSession();
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
    return res
      .set("Content-Type", videoData.contentType)
      .set("Cache-Control", "no-store")
      .send(videoData.data);
  } catch {
    return res.status(404).json({ error: "Video not available." });
  }
});

// SPA fallback (production only)
app.get("*", (req, res, next) => {
  if (fs.existsSync(path.join(clientDist, "index.html"))) {
    res.sendFile(path.join(clientDist, "index.html"));
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
        "API: POST /api/start, POST /api/stop, GET /api/metrics, GET /api/video"
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
