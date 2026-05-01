# Development Playbook

Use this playbook when adding features so the project stays easy for multiple agents to develop safely.

## Add A Domain Behavior

1. Pick the owner in `lib/domain-modules.ts`.
2. Add the behavior to the matching `lib/domains/*` file or create a focused new file in that folder.
3. Add named input/output types in that domain's `types.ts` when UI or API code will consume the shape.
4. Add focused tests next to the domain file for money, stock, attendance, or audit behavior.
5. Update `lib/domain-modules.ts` and `docs/file-index.md`.
6. Run `npm run check`.

## Add An API Route

1. Create the route in `app/api/**/route.ts`.
2. Keep the handler thin: authenticate, validate, call one domain function, return a response.
3. Use helpers from `lib/api/handler.ts` for auth, JSON parsing, query parsing, and error boundaries.
4. Add the route to `lib/api/routes.ts`.
5. Update `docs/api-routes.md` and `docs/file-index.md`.
6. Run `npm test -- lib/api/routes.test.ts`.

## Add A Page Or Workflow

1. Keep UI state and rendering in `app/(app)/**/page.tsx`.
2. Put calculations and writes in `lib/domains/*`.
3. Keep server actions in `app/(app)/**/actions.ts` only when the action is page-specific.
4. Create or reuse domain response types instead of inventing anonymous UI-only shapes.
5. Run the page manually after `npm run check` when the workflow is user-facing.

## Add A Prisma Change

1. Read the domain files that write the affected model.
2. Update `prisma/schema.prisma`.
3. Add a migration.
4. Update seed data if required.
5. Add or update tests for affected writes.
6. Update `docs/file-index.md` if new migration/script files are added.
7. Run `npm run check`.

## Change A High-Risk Area

High-risk areas include billing, stock, galla, reconciliation, physical count, EOD, rollover, cron, face descriptors, and Prisma schema.

Before finishing:

1. Add a focused regression test.
2. Verify API route metadata if a route is touched.
3. Run `npm run check`.
4. Mention any skipped DB integration tests in the handoff.

## Commit Hygiene

- Keep architecture changes separate from feature changes when practical.
- Do not commit local spreadsheets or uploaded business workbooks unless explicitly requested.
- Prefer small commits with clear intent.
- Follow `docs/collaboration-protocol.md` and keep `COLLAB_TASKS.md` current for multi-person development.
