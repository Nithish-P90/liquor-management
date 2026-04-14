# Contributing

Thanks for collaborating — a few ground rules to keep things smooth.

- **Branching**: Create branches from `main` named `feature/<short-desc>` or `fix/<short-desc>`.
- **Commits**: Make small, focused commits. Use conventional-style messages (e.g. `feat:`, `fix:`).
- **Pull requests**: Open a PR into `main`. Request a review from at least one collaborator and wait for CI to pass before merging.

Local dev quickstart

1. Install Node (v18 recommended) and npm.
2. Install dependencies:

```bash
npm ci
```

3. Create a local env file (example):

```env
DATABASE_URL="postgresql://localhost:5432/yourdb"
NEXTAUTH_SECRET="change-me-64chars"
NEXTAUTH_URL="http://localhost:3000"
SYNC_TOKEN="change-me"
```

4. Run dev server:

```bash
npm run dev
```

CI & Deploy (Render)

- A GitHub Actions workflow (`.github/workflows/ci-and-deploy.yml`) has been added. It runs on every push and PR and will:
  - install dependencies (`npm ci`) and run `npm run build` and `npm run lint`
  - trigger a Render deploy if the repository secrets are configured (see below)

To enable automatic deployments, add one of the following **repository secrets** in GitHub (Settings → Secrets → Actions):

- `RENDER_DEPLOY_HOOK` — recommended: create a Deploy Hook in your Render service and paste the hook URL as this secret. The workflow will POST to this URL on pushes.
- OR `RENDER_API_KEY` and `RENDER_SERVICE_ID` — alternative: create an API key in Render and put the service ID; the workflow will call Render's Deploys API.

Recommended PR checklist

- Title and description explaining the change
- Run `npm run lint`
- Confirm `npm run build` succeeds locally
- Add/modify tests where appropriate
- Tag a reviewer and wait for approval

Branch protection (recommended)

Protect `main` with rules:

- Require pull requests for merges
- Require at least one approving review
- Require status checks (the `CI & Deploy (Render)` workflow) to pass

If you want, I can also create a PR with these changes and/or wire up the Render deploy hook once you provide the Render hook URL or API key/ID.
