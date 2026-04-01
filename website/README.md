# PerfTrace marketing site

React + Vite single-page landing (WebGL hero, Framer Motion sections). **Download URLs** live in `public/config.js` (`window.PERFTRACE_DOWNLOADS`).

## Develop

```bash
cd website
npm install
npm run dev
```

Open the printed local URL (usually http://localhost:5173).

## Production build

```bash
npm run build
```

Output: `dist/` — static HTML + hashed JS/CSS. `public/config.js` is copied to `dist/config.js` unchanged.

## Deploy

From repo root (after `npm install` in `website/` if needed):

```bash
npm run deploy:website
npm run deploy:website:perftrace   # legacy Vercel project
```

`prepare-vercel-output.cjs` runs `vite build` and stages `dist/` for Vercel prebuilt deploy.
