# CI/CD & Remote Update Guide
## Mahavishnu Wines POS — For Future Reference

This document explains how the build pipeline, auto-update system, and deployment workflow
connect together. Read this before touching any CI config, updater code, or release flow.

---

## Architecture at a Glance

```
Developer's Mac
   │
   ├── git tag pos-v1.2.3
   └── git push --tags
            │
            ▼
   GitHub Actions (.github/workflows/build-electron.yml)
            │
            ├── Job: build-windows (windows-latest)
            │     npm ci → electron-rebuild → npm run build → electron-builder --win --publish always
            │     → Uploads .exe installer to GitHub Releases
            │
            └── Job: verify-web (ubuntu-latest)
                  npm ci → prisma generate → tsc --noEmit → next build
                  → Ensures Next.js web app still compiles

   GitHub Releases
            │  (electron-updater polls this via GitHub provider)
            ▼
   Windows POS App (running in shop)
            │  background: checks every 2 hours
            │  downloads silently → shows "Restart to update" button
            ▼
   User clicks button → quitAndInstall() → new version running
```

---

## How to Push a Release

### 1. Bump the version

Edit `electron-app/package.json`:
```json
{ "version": "1.0.1" }
```

The version **must** match the tag you push (without the `pos-v` prefix).

### 2. Commit, tag, push

```bash
git add electron-app/package.json
git commit -m "chore: bump POS to 1.0.1"
git tag pos-v1.0.1
git push && git push --tags
```

### 3. Watch the build

Go to GitHub → Actions → "Build & Release Windows POS"

Build takes ~5-8 minutes. When done:
- A GitHub Release is created automatically
- The `.exe` installer is attached to the release
- Running apps pick it up within 2 hours (or on next restart)

### 4. Manual trigger (without a tag)

GitHub → Actions → "Build & Release Windows POS" → "Run workflow"

This builds but creates a draft release unless `draft` input is set to `false`.

---

## GitHub Repository Setup (One-time)

The `publish` section in `electron-app/package.json` must match your repo:
```json
"publish": [{
  "provider": "github",
  "owner": "YOUR_GITHUB_USERNAME",
  "repo": "YOUR_REPO_NAME",
  "private": true
}]
```

For private repos, create a GitHub Personal Access Token with `repo` scope and
add it as a repo secret named `GH_TOKEN` (GitHub Actions provides `GITHUB_TOKEN`
automatically for public repos, but private repos need an explicit PAT).

---

## Auto-Update System — How It Works

### Files involved

| File | Role |
|---|---|
| `electron-app/electron/main.ts` | Configures `electron-updater`, starts checks, sends IPC events |
| `electron-app/electron/preload.ts` | Bridges updater events to the renderer via `contextBridge` |
| `electron-app/src/App.tsx` | Listens for events, shows "Restart to update" banner |
| `electron-app/src/types.ts` | TypeScript interface for `window.posAPI` including updater methods |

### Event flow

```
main.ts: autoUpdater.checkForUpdates()  (on startup + every 2 hours)
   │
   ├── update found → autoUpdater.on('update-available')
   │      └── mainWindow.webContents.send('updater:available', info)
   │              └── preload: onUpdaterEvent callback('available', info)
   │                     └── App.tsx: (currently no UI for this — just logs)
   │
   └── download complete → autoUpdater.on('update-downloaded')
          └── mainWindow.webContents.send('updater:downloaded', info)
                  └── preload: onUpdaterEvent callback('downloaded', info)
                         └── App.tsx: setUpdateReady(true)
                                └── Shows blue "Restart to update" banner above footer
                                       └── User clicks → posAPI.installUpdate()
                                              └── ipcMain: 'updater:install'
                                                     └── autoUpdater.quitAndInstall()
```

### Key settings in `configureAutoUpdater()` (main.ts)

| Setting | Value | Reason |
|---|---|---|
| `autoDownload` | `true` | Download silently without asking — staff shouldn't be prompted |
| `autoInstallOnAppQuit` | `true` | If user quits normally, update installs automatically |
| Check interval | 2 hours | Background poll — doesn't interrupt POS operation |

### What `quitAndInstall()` does

Closes the app, runs the NSIS installer silently (no UI), restarts the app.
The whole process takes about 30-60 seconds. Warn staff not to start a sale
during this time (the banner already disappears once the installer launches).

---

## Build Pipeline Details

### `build-electron.yml` jobs

**`build-windows`** (runs on `windows-latest`):
```
npm ci                                  ← install deps from package-lock.json
npx electron-rebuild -f -w better-sqlite3  ← recompile native module for Electron's Node ABI
npm run build                           ← tsc (electron) + vite build (renderer)
electron-builder --win --publish always ← package NSIS installer + upload to GitHub Release
```

The `--publish always` flag tells electron-builder to always publish to GitHub Releases,
even if the release already exists (it updates it). This requires `GH_TOKEN`.

Output: `electron-app/release/Mahavishnu-Wines-POS-Setup-x.x.x.exe`

**`verify-web`** (runs on `ubuntu-latest`):
```
npm ci
npx prisma generate                     ← needed for TypeScript types
npx tsc --noEmit                        ← type-check only
npm run build                           ← full Next.js build
```

This job uses dummy env vars (`DATABASE_URL`, `NEXTAUTH_SECRET`, etc.) and
`SKIP_ENV_VALIDATION=1` so the build completes without a real database.

### Why `electron-rebuild`?

`better-sqlite3` is a native Node addon (`.node` binary). It must be compiled
against Electron's specific Node ABI version, not the system Node version.
`electron-rebuild` does this automatically. Without it, the app crashes on launch
with "was compiled against a different Node.js version".

---

## Version Number Rules

- Tag format: `pos-v{semver}` — e.g. `pos-v1.0.0`, `pos-v1.2.3`
- The semver part **must exactly match** `version` in `electron-app/package.json`
- electron-updater compares semver to decide if an update is available
- If the tag and package.json version don't match, `electron-builder` will use
  the package.json version in the installer filename, causing confusion

---

## Local Development

```bash
cd electron-app
npm install
npm run dev          # starts Vite dev server + Electron together
```

Auto-updater is **disabled in dev mode** (`isDev` check in main.ts). To test
the updater flow without a real GitHub Release:

```bash
# In main.ts temporarily, inside configureAutoUpdater():
autoUpdater.forceDevUpdateConfig = true
# Then create electron-app/dev-app-update.yml pointing to a test repo
```

---

## Rollback

If a bad version was released:
1. Go to GitHub → Releases → mark the bad release as a pre-release (or delete it)
2. electron-updater will no longer offer it to running apps
3. Already-updated machines: push a new fixed version as `pos-v{next}`
   — there is no downgrade mechanism, only forward

---

## Env Vars Reference

### GitHub Actions secrets needed

| Secret | Purpose |
|---|---|
| `GITHUB_TOKEN` | Auto-provided by Actions — used for uploading release artifacts |
| `GH_TOKEN` | Only needed for private repos — PAT with `repo` scope |

### Vercel environment variables (for the web app / sync API)

| Variable | Where set | Purpose |
|---|---|---|
| `DATABASE_URL` | Vercel dashboard | Neon PostgreSQL connection string |
| `NEXTAUTH_SECRET` | Vercel dashboard | Auth encryption key (64-char random string) |
| `NEXTAUTH_URL` | Vercel dashboard | Full URL of Vercel deployment |
| `SYNC_TOKEN` | Vercel dashboard | Shared secret for POS ↔ API authentication |

### Windows POS app settings (stored in SQLite, set via Settings screen)

| Setting | Purpose |
|---|---|
| `cloud_url` | Base URL of Vercel deployment (e.g. `https://your-app.vercel.app`) |
| `sync_token` | Must match `SYNC_TOKEN` in Vercel |
| `outlet_name` | Display name shown in the app |

---

## Web App Updates (Vercel)

The Next.js web app deploys **automatically on every `git push`** to the default branch.
No tag required. Vercel detects the push, runs `npm run build`, and deploys in ~2 minutes.

```bash
# Change anything in liquor-management/ and push
git add .
git commit -m "fix: whatever you changed"
git push
```

### Prisma schema changes (manual step required)

If you modify `prisma/schema.prisma`, you must run the migration manually **once** after merging:

```bash
DATABASE_URL="your-neon-url" npx prisma migrate deploy
```

Vercel cannot run DB migrations automatically on the free tier. Run this from your Mac
after the deployment has completed. The app will work on the old schema until you run it.

---

## Free Tier Limitations

### Vercel Hobby (free)

| Limit | Value | Risk |
|---|---|---|
| Serverless function max duration | **10 seconds** | `/api/sync/pull` runs 4 DB queries per product — will timeout with 50+ products as history grows |
| Bandwidth | 100 GB/month | Safe for one outlet |
| Cron jobs | Not available | Can't schedule background tasks (e.g. daily reports) |
| Cold starts | ~500ms–2s | First request after inactivity is slow |

**Most likely issue:** `/api/sync/pull` timeout. It queries `opening + receipts + sales + adjustments`
per product in parallel but still does N products sequentially. Fix: add a `?since=` param so
only changed products are recalculated. Not urgent until you have 50+ products with years of history.

### Neon PostgreSQL (free tier)

| Limit | Value | Risk |
|---|---|---|
| Storage | **0.5 GB** | ~2-3 years at one outlet (sale row ≈ 200 bytes; 500k sales ≈ 100 MB) |
| Compute | 0.25 vCPU / 512 MB | Fine |
| **Auto-suspend after 5 min idle** | — | First query after overnight idle takes 1–3s to wake — causes slow startup sync every morning |

**You will notice:** The morning cold-start. When the shop opens and POS does its startup pull,
Neon wakes from sleep → 1–3 second delay on first sync. Data is never lost, just slow. Cosmetic.

### GitHub (free)

| Limit | Value | Risk |
|---|---|---|
| Actions minutes (private repo) | 500 min/month | Each build ≈ 8 min → ~62 releases/month max. Fine. |
| Release storage | 2 GB total | Installer is ~80–100 MB. After 20+ releases you'll hit the cap. **Delete old releases periodically.** |
| Update download bandwidth | 100 GB/month | 80 MB × 1 machine × 1 update/month = negligible |

**You will notice:** GitHub Release storage fills up after many releases. Check and delete old
releases from the GitHub UI every few months. The app only needs the latest release to update.

### When to upgrade

| Symptom | Fix | Cost |
|---|---|---|
| Sync pull timeouts (>10s) | Vercel Pro — 60s function limit | $20/month |
| DB storage > 0.4 GB | Neon Launch — 10 GB | $19/month |
| Morning cold-start is unacceptable | Neon Launch — dedicated compute (no auto-suspend) | $19/month |
| Need scheduled reports / alerts | Vercel Pro cron or Railway cron job | $5–20/month |
| Adding more outlets | No infrastructure change needed — already multi-device | — |

**Realistic runway on free tier: 2+ years** for one outlet at 100–200 sales/day.

---

## Key Source Files Quick Reference

| What you want to change | File |
|---|---|
| Auto-update timing / behaviour | `electron-app/electron/main.ts` → `configureAutoUpdater()` |
| "Restart to update" UI | `electron-app/src/App.tsx` → `updateReady` state + banner |
| IPC bridge for updater | `electron-app/electron/preload.ts` → `onUpdaterEvent`, `installUpdate` |
| GitHub Actions pipeline | `.github/workflows/build-electron.yml` |
| electron-builder config (targets, NSIS, publish) | `electron-app/package.json` → `build` section |
| Sync push logic (server) | `liquor-management/app/api/sync/push/route.ts` |
| Sync pull logic (server) | `liquor-management/app/api/sync/pull/route.ts` |
| Local SQLite schema + CRUD | `electron-app/electron/db.ts` |
| Sync engine (timers, online check) | `electron-app/electron/sync.ts` |
