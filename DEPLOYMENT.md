# Mahavishnu Wines — Deployment & Setup Guide

## Architecture Overview

```
┌────────────────────────────────────────────────────────┐
│              Windows POS Machine (Shop)                │
│                                                        │
│  ┌─────────────────────────────────────────────────┐  │
│  │        Electron Desktop App                     │  │
│  │  POS  │  Attendance  │  Cash Register           │  │
│  └────────────────┬────────────────────────────────┘  │
│                   │ SQLite (local, WAL mode)           │
│  ┌────────────────▼────────────────────────────────┐  │
│  │        Sync Engine (background)                 │  │
│  │  Push every 30s │ Pull every 5min               │  │
│  │  Queue-based, idempotent, auto-retry             │  │
│  └────────────────┬────────────────────────────────┘  │
│                   │ HTTPS (token auth)                 │
│  ┌────────────────▼────────────────────────────────┐  │
│  │   Vendor RD Service (for fingerprint scanner)   │  │
│  │   Port 11100 (install from scanner CD/website)  │  │
│  └─────────────────────────────────────────────────┘  │
└──────────────────────┬─────────────────────────────────┘
                       │ Internet
┌──────────────────────▼─────────────────────────────────┐
│           Vercel (Free Hobby Plan)                      │
│           Next.js Web App                               │
│                                                        │
│   Admin Web UI  │  Sync API  │  Auth                  │
└──────────────────────┬─────────────────────────────────┘
                       │
┌──────────────────────▼─────────────────────────────────┐
│           Neon PostgreSQL (Free Tier)                   │
│           0.5GB — plenty for one outlet                 │
└─────────────────────────────────────────────────────────┘
```

---

## Step 1 — Free Cloud Hosting Setup

### 1a. Create Neon PostgreSQL Database (Free)

1. Go to https://neon.tech and create a free account
2. Create a new project: "mahavishnu-wines"
3. Create a database: "pos"
4. Copy the connection string — it looks like:
   ```
   postgresql://user:password@ep-xxx.us-east-1.aws.neon.tech/pos?sslmode=require
   ```

### 1b. Deploy Next.js App to Vercel (Free)

1. Go to https://vercel.com, sign in with GitHub
2. Click "Add New Project" → Import your repo
3. **Root Directory:** `liquor-management` (not the electron-app folder)
4. Add environment variables:
   ```
   DATABASE_URL=postgresql://... (from Neon above)
   NEXTAUTH_SECRET=generate-a-random-64-char-string-here
   NEXTAUTH_URL=https://your-app-name.vercel.app
   SYNC_TOKEN=generate-a-random-32-char-string-here
   ```
5. Deploy. Your app is live at `https://your-app-name.vercel.app`

**Generate secure tokens:**
```bash
# Run this to generate NEXTAUTH_SECRET (Mac/Linux)
openssl rand -base64 64

# Run this to generate SYNC_TOKEN
openssl rand -base64 32
```

### 1c. Run Prisma Migration

After first deployment, run the database migration:
```bash
cd liquor-management
DATABASE_URL="your-neon-url" npx prisma migrate deploy
DATABASE_URL="your-neon-url" npm run seed
```

### 1d. Deploy to Render.com (alternative to Vercel)

If you're deploying to Render, make sure the service is configured to *build* the Next.js app before starting the production server. Common misconfiguration causes the error:

> Could not find a production build in the '.next' directory. Try building your app with 'next build' before starting the production server.

Recommended Render settings for this repository:

- **Build Command:** `npm run build`
- **Start Command:** `npm start`

Notes:
- The repository already defines a `build` script (`prisma generate && NODE_OPTIONS=--max-old-space-size=400 next build`) and a `start` script (`next start`). Render must run the build step first so `next start` can serve the compiled `.next` directory.
- If you cannot change the Render settings, an alternative (less preferred) is to modify `package.json` so `start` runs a build first, e.g. `"start": "next build && next start"`. This will make `npm start` succeed when Render uses it as the build command, but adjusting Render's Build Command is the cleaner fix.


---

## Step 2 — Windows POS Setup

### 2a. Install the fingerprint scanner RD Service

For **Cogent CSD200i** on Windows:
1. Insert the device CD or download from Cogent/Thales website
2. Install the **RD Service** (runs as a Windows service on port 11100)
3. After installation, verify: open browser → http://127.0.0.1:11100/rd/info → should return XML

For **Mantra MFS100**:
- Download from https://www.mantrafintech.com/mfs100_rd_service.html

### 2b. Install the POS App

#### Option A — Download from GitHub Releases (recommended)
1. Go to your GitHub repo → Releases
2. Download the latest `Mahavishnu-Wines-POS-Setup-x.x.x.exe`
3. Run the installer (it installs to Program Files and creates desktop shortcut)
4. The app automatically starts on Windows login

#### Option B — Build from source
```powershell
cd electron-app
npm install
npm run dist:win
# Installer is in electron-app/release/
```

### 2c. First-run configuration

1. Launch "Mahavishnu Wines POS"
2. Settings screen opens automatically
3. Enter:
   - **Cloud URL:** `https://your-app-name.vercel.app`
   - **Sync Token:** (same as SYNC_TOKEN in Vercel env vars)
4. Click "Test connection" — should show "Connected!"
5. Click "Save & Connect"
6. App pulls products and staff from cloud automatically

---

## Step 3 — Pushing Updates Remotely

### Automatic update pipeline

Every time you push a new version tag to GitHub, the app builds automatically and updates on all Windows machines.

```bash
# Make your code changes, then:
git add .
git commit -m "fix: correct price calculation"
git tag pos-v1.0.1
git push && git push --tags
```

GitHub Actions will:
1. Build the Windows installer on `windows-latest`
2. Create a GitHub Release with the installer
3. The Windows app checks for updates every 2 hours
4. When update is downloaded, a notification appears in the app
5. App installs on next quit/restart

### Manual update trigger

In GitHub → Actions → "Build & Release Windows POS" → Run workflow

---

## Step 4 — Data Integrity Safeguards

### What's protected

| Scenario | Protection |
|---|---|
| Internet goes down mid-sale | Sale written to SQLite atomically before UI confirms |
| Power cut during sync | SQLite WAL — partially written data is rolled back on next start |
| Duplicate sync (network retry) | `local_id` (nanoid UUID) prevents duplicates on server |
| App crash during checkout | SQLite transaction — either fully written or not at all |
| Server rejects a sale (out of stock) | Marked as `synced=2` (failed), visible in admin web UI |
| Clock skew | `sale_time` is stored in ISO 8601, server uses its own timestamp for audit |

### Monitoring sync health

In the Windows app:
- Green WiFi icon = connected and synced
- Amber number badge = records waiting to sync
- Grey WiFi icon = offline, all data saved locally

In the web admin:
- Sales page shows all bills including POS-synced ones
- Any sync failures appear in the admin dashboard

### Database backup (Neon free tier)

Neon provides automatic backups in their free tier. For additional safety:
```bash
# Run weekly on any machine with network access
pg_dump "your-neon-url" > backup-$(date +%Y%m%d).sql
```

---

## Step 5 — Scaling Beyond One Outlet

When you're ready to add more outlets or upgrade:

1. **Multiple outlets:** Each outlet has its own Windows app instance. The sync API already handles multiple devices pushing to the same database (idempotency ensures no duplicates).

2. **Railway.app** (when Neon free tier is outgrown): `$5/month` for PostgreSQL — same Prisma schema works.

3. **Vercel Pro**: `$20/month` — needed if traffic exceeds free tier limits (100GB bandwidth).

4. **Code signing for Windows**: Prevents "Unknown Publisher" warning. Costs ~$500/year for an EV certificate but optional for internal use.

---

## Environment Variables Reference

### Vercel (Next.js web app)
```env
DATABASE_URL=           # Neon PostgreSQL connection string
NEXTAUTH_SECRET=        # Random 64-char string for auth encryption
NEXTAUTH_URL=           # Your Vercel deployment URL
SYNC_TOKEN=             # Shared secret between app and Windows POS
```

### Windows POS app (stored in app settings, not env file)
Set via the Settings screen in the app:
- **Cloud URL** → `https://your-app-name.vercel.app`
- **Sync Token** → same as `SYNC_TOKEN` above

---

## Troubleshooting

### "Cloud URL not configured" on app start
→ Open Settings tab, enter URL and token, click Save.

### Sales not syncing (amber badge keeps growing)
1. Check internet connection
2. Click the sync icon in the sidebar
3. If still failing, check Vercel logs for errors

### Fingerprint scanner not detected
1. Confirm the vendor RD Service is installed and running
2. Open Services (services.msc) and verify the service is "Running"
3. Test: open browser → http://127.0.0.1:11100/rd/info

### After update, app shows blank screen
→ `Ctrl+Shift+I` → Console tab — check for errors
→ Try: Settings → clear app data (or reinstall)

### Stock numbers look wrong in POS app
→ Trigger a manual sync (click sync icon) to pull latest stock from cloud
→ Stock is refreshed every 5 minutes automatically when online
