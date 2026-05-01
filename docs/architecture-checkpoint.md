# Architecture Checkpoint

This checkpoint intentionally moves the project from a flat helper-file layout to a domain-owned architecture.

## Why This Exists

The app is early enough that a larger refactor is still affordable. The goal is to make future agent-driven development safer by making ownership explicit:

- API routes are indexed in `lib/api/routes.ts`.
- Behavior modules are indexed in `lib/domain-modules.ts`.
- Human-readable rules live in `AGENTS.md`.
- Repeatable feature recipes live in `docs/development-playbook.md`.
- File purpose and architecture guidance live in `docs/file-index.md` and `docs/development-architecture.md`.

## Canonical Module Layout

Business behavior belongs in:

- `lib/domains/auth`
- `lib/domains/billing`
- `lib/domains/catalog`
- `lib/domains/cash`
- `lib/domains/attendance`
- `lib/domains/inventory`
- `lib/domains/indents`

Shared infrastructure belongs in:

- `lib/platform`

Root `lib/*.ts` files are compatibility facades only. They exist so older imports keep working while new work uses the canonical domain paths.

## Development Contract

When future agents add or move behavior:

1. Put behavior in the correct `lib/domains/*` or `lib/platform/*` folder.
2. Keep routes thin and traceable through `lib/api/routes.ts`.
3. Update `lib/domain-modules.ts` and `docs/file-index.md`.
4. Run `npm test`, `npm run lint`, and `npx tsc --noEmit` before handing off.

## Current Baseline

At this checkpoint:

- TypeScript passes.
- ESLint passes.
- Vitest passes, except intentionally skipped DB integration tests.
