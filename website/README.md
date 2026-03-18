# PerfTrace Landing Page

A compositor-optimized landing page with WebGL raymarched metaballs and an "I'm watching you" eye animation.

## Setup

1. Serve the `website` folder with any static server, e.g.:

   ```bash
   cd website && npx serve .
   ```

   Or open `index.html` directly (some features may be limited without a server).

2. After uploading builds to Google Drive, edit `config.js` and replace the placeholder URLs:
   ```js
   window.PERFTRACE_DOWNLOADS = {
     mac: "https://drive.google.com/...",
     win: "https://drive.google.com/...",
     linux: "https://drive.google.com/...",
   };
   ```

## Files

- `index.html` — Main page
- `styles.css` — Styles (transform/opacity only for animations)
- `main.js` — WebGL background + eye tracking
- `config.js` — Download URLs (edit after upload)
