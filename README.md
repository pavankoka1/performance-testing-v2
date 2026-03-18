# PerfTrace v2 — Self-Hosted Performance Testing

A self-hosted performance testing tool with **Playwright**, **Xvfb**, and **noVNC** streaming. Enter a URL, interact with the browser via VNC (when enabled), stop the session, and get a comprehensive performance report.

## Architecture

- **Backend**: Node.js + Express
- **Browser automation**: Playwright (Chromium + CDP tracing)
- **Virtual display** (Linux): Xvfb for headless graphics
- **Streaming** (Linux): x11vnc + websockify + noVNC for remote interaction
- **Metrics**: CDP tracing, Performance.getMetrics, client-side collectors (FPS, Web Vitals)

## Project Structure

```
performance-testing-v2/
├── server/                 # Express backend
│   ├── index.js            # API server
│   └── lib/
│       ├── capture.js      # Playwright + Xvfb + VNC session logic
│       └── traceParser.js  # Chrome trace → report parsing
├── client/                 # Vite + React frontend
│   ├── src/
│   │   ├── components/     # Dashboard, ReportViewer, etc.
│   │   └── lib/
│   └── ...
└── package.json
```

## Quick Start

### Development (macOS / Linux)

```bash
npm install
npm run dev
```

- **Client**: http://localhost:5173
- **API**: http://localhost:3000 (proxied from client)

On macOS, VNC streaming is not available (Xvfb is Linux-only). The app runs in headless mode—metrics are captured but you cannot interact with the browser. For full VNC support, use a Linux VPS or Docker.

### Production (Linux with VNC)

1. **Install system dependencies** (Ubuntu/Debian):

   ```bash
   sudo apt update
   sudo apt install -y xvfb x11vnc
   pip install websockify   # or: sudo apt install websockify
   ```

2. **Enable VNC and run**:

   ```bash
   export VNC_ENABLED=true
   npm run build
   npm start
   ```

3. Open the app. When you start a recording, a **VNC stream URL** appears—open it in a new tab to interact with the browser.

### Production (headless only)

```bash
npm run build
PORT=3000 npm start
```

## API Endpoints

| Method | Path         | Description                                                           |
| ------ | ------------ | --------------------------------------------------------------------- |
| POST   | /api/start   | Start recording (body: `{ url, cpuThrottle?, trackReactRerenders? }`) |
| POST   | /api/stop    | Stop recording, return report                                         |
| GET    | /api/metrics | Live metrics during recording                                         |
| GET    | /api/video   | Session video (WebM)                                                  |

## Environment Variables

| Variable       | Default | Description                                              |
| -------------- | ------- | -------------------------------------------------------- |
| `PORT`         | 3000    | Server port                                              |
| `VNC_ENABLED`  | false   | Enable Xvfb + VNC (Linux only)                           |
| `XVFB_DISPLAY` | 99      | Xvfb display number when VNC_ENABLED=true                |
| `PUBLIC_URL`   | -       | Base URL for VNC stream link (e.g. https://your-vps.com) |

## Deployment (VPS)

Example deployment on a $6/month DigitalOcean droplet:

1. Clone the repo, run `npm install`, `npm run build`
2. Use PM2: `pm2 start server/index.js --name perftrace`
3. Add HTTPS with Certbot
4. Set `VNC_ENABLED=true` and `PUBLIC_URL=https://your-domain.com`
5. Install xvfb, x11vnc, websockify

## Design

Colors and layout match the original **performance-testing-app** (PerfTrace):

- Dark theme: `--bg`, `--bg-card`, `--accent` (violet/purple)
- Cards: `rounded-2xl`, `border-[var(--border)]`, `shadow-[var(--glow)]`
- Primary actions: gradient `from-violet-600 to-purple-600`

## Desktop App (Electron)

Run PerfTrace as a native desktop app on **Windows**, **macOS**, and **Linux**—no cloud, no Docker, fully offline.

### Run locally

```bash
npm install
npm run electron
```

This builds the client, starts the Express server, and opens the app in an Electron window.

### Package for distribution

```bash
# Default: current platform (on M4 Mac → darwin/arm64)
npm run electron:make

# macOS universal (Intel + Apple Silicon in one .dmg)
npm run electron:make:mac

# Windows x64
npm run electron:make:win

# Linux x64
npm run electron:make:linux

# All platforms (macOS universal + Windows + Linux)
npm run electron:make:all
```

Output in `out/make/`:

- **macOS**: `PerfTrace-x.x.x-universal.dmg` + `.zip` (works on Intel & M1/M2/M3/M4)
- **Windows**: `PerfTrace-x.x.x-win32-x64.zip` (extract and run `PerfTrace.exe`)
- **Linux**: `PerfTrace-x.x.x-linux-x64.zip` (extract and run `PerfTrace`)

All builds work from macOS without Mono, Wine, or Linux packaging tools.

### Sharing the app with other laptops

**Chromium is bundled** — The packaged app includes Playwright Chromium (~250MB). Recipients do not need to install anything. Share the `.dmg` (macOS) or `.zip` (Windows/Linux) via USB, email, or file share.

**macOS Gatekeeper** — If recipients see "PerfTrace cannot be opened because it is from an unidentified developer":

1. Right-click (or Control+click) the app
2. Choose **Open**
3. Click **Open** in the dialog

Alternatively: System Settings → Privacy & Security → scroll to the app → click **Open Anyway**.

**Architecture note** — Universal macOS builds include Chromium for your Mac's architecture. Built on Apple Silicon → works on M1/M2/M3/M4. Built on Intel → works on Intel Macs. For best compatibility, build on the target architecture or use `npm run electron:make` (single-arch) instead of universal.

### Requirements

- **Chromium**: Bundled automatically during packaging. No user install needed.
- **macOS**: Headed mode works; VNC is Linux-only.
- **Windows**: Headed mode works; no VNC.

## Docker

```bash
docker build -t perftrace .
docker run -p 3000:3000 -e VNC_ENABLED=true -e PUBLIC_URL=http://localhost:3000 perftrace
```

## Railway / Cloud Deployment

1. Push to GitHub (public or private).
2. Connect repo to Railway (or similar). Railway auto-detects the Dockerfile.
3. Set env vars: `VNC_ENABLED=true`, `PUBLIC_URL=https://your-app.up.railway.app`
4. Deploy. The app serves on `PORT` (Railway sets this automatically).

**Note:** VNC streaming requires port 6080 for websockify. If your platform only exposes one port, use `HEADLESS=true` instead—metrics still work, but you won't get the remote browser stream.

## License

MIT
