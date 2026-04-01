# Deploying the PerfTrace Website

## Two Vercel projects

| Command                            | Vercel project                                                                                     | Production URL (typical)                         |
| ---------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `npm run deploy:website`           | `website`                                                                                          | `https://website-pi-weld-…vercel.app`            |
| `npm run deploy:website:perftrace` | [performance-testing-website](https://vercel.com/pavan-kokas-projects/performance-testing-website) | `https://performance-testing-website.vercel.app` |

`deploy:website:perftrace` runs `website/deploy-performance-testing-website.cjs`: prebuilt output, then **`vercel deploy` from a temp folder with no `.git`** (avoids the “Git author must have access” error for local-only emails), then restores `.vercel/project.json` to the `website` project.

### If `performance-testing-website` deploy still fails

1. **Output Directory** must be empty in [project settings](https://vercel.com/pavan-kokas-projects/performance-testing-website/settings/general). A bad value (`website`) made Vercel look for files in the wrong place. It was cleared via API once; don’t set it back unless you know you need it.

2. **Git author** — If you deploy from the repo root with plain `vercel` (not this script), the latest commit author must use an email that is on your Vercel team. Fix: `git config user.email` to your GitHub/Vercel email, or amend the last commit.

3. Avoid **`vercel pull`** for this flow if it re-adds `"outputDirectory": "website"` into `.vercel/project.json`.

## Default deploy (working project)

```bash
npm run deploy:website
```

Uses **prebuilt** output (`prepare-vercel-output.cjs` runs `vite build`, then `vercel deploy --prebuilt --prod`).

## Manual project link

```bash
cd website
npx vercel link
```

Pick **Link to existing project** and the project you want. That overwrites `.vercel/project.json`.

## Other

- **Netlify:** `npm run deploy:website:netlify` (after `npx netlify login`).
- **Project JSON backups** in `website/.vercel/`:
  - `project.website.json` — default target for `deploy:website`
  - `project.performance-testing-website.json` — legacy PerfTrace landing project
