# Collaboration Protocol

This protocol is for side-by-side development by multiple contributors and agents.
Its purpose is to prevent merge clashes, spaghetti growth, and hidden cross-feature regressions.

## Core Collaboration Rules

1. One branch per task. No shared coding on the same branch.
2. One owner per task. Pairing is fine, but one person owns merge readiness.
3. One bounded scope per PR. Do not mix feature work, refactor work, and styling churn.
4. One domain-focused change at a time. Avoid touching many domains in one patch.
5. No direct commits to `main`.

## Branch Strategy

Use this naming:

- `feat/<initials>/<domain>-<task>`
- `fix/<initials>/<domain>-<task>`
- `refactor/<initials>/<domain>-<task>`

Examples:

- `feat/np/pos-category-filters`
- `fix/ar/billing-tab-settlement`
- `refactor/np/pos-component-split`

## Task Claim Workflow

1. Add a claim in `COLLAB_TASKS.md`.
2. Include:
   - owner
   - branch name
   - writable paths
   - expected files
   - risk level
3. Do not start coding until the claim exists.
4. If writable paths overlap with another active claim, coordinate first.

## Path Ownership And Write Boundaries

Use narrow write scopes to avoid conflict:

- POS UI task: `app/(app)/pos/**`, `app/api/pos/**`, related domain files only.
- Inventory task: `app/api/clearance/**`, `app/api/physical-count/**`, `lib/domains/inventory/**`.
- Billing task: `app/(app)/pos/actions.ts`, `lib/domains/billing/**`.
- Platform task: `lib/platform/**`, and only direct consumers needed for migration.

Avoid editing root compatibility facade files under `lib/*.ts` unless intentionally changing re-export mapping.

## Merge Gates

Every PR must pass:

1. `npm run collab:check`
2. `npm run check`
3. Updated docs/indexes when ownership, routes, or files changed

Required metadata in PR:

- writable paths
- domains touched
- risk level
- rollback plan

## Conflict Avoidance Patterns

- Split huge pages before adding major features.
- Prefer adding new files over stuffing existing large files.
- Extract domain behavior first, then wire UI/routes.
- Keep API handlers thin and behavior in `lib/domains/*`.
- Add focused tests in the same PR as behavior changes.

## High-Risk Coordination

Changes touching the following require explicit coordination with other active tasks:

- `lib/domains/billing/**`
- `lib/domains/inventory/**`
- `lib/platform/**`
- `prisma/schema.prisma`
- `app/api/cron/**`
- `app/api/face/**`

## Handoff Standard

Before handing off:

1. Post the exact changed file list.
2. Post the domain impact summary.
3. Post which claims in `COLLAB_TASKS.md` are completed.
4. Post known follow-up tasks if decomposition is still needed.
