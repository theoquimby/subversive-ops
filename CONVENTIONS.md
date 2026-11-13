# Subversive Ops — conventions (read before writing code)

## Architecture
- `src/domain/*` — pure TypeScript business logic. No DB, no React, no I/O. Every non-trivial function has a vitest test in `src/domain/__tests__/`.
- `src/server/services/*` — server-only use-cases (`import "server-only"`), compose domain + Prisma (`import { db, num } from "../db"`).
- `src/server/integrations/*` — external APIs (Square etc.). Plain `fetch`, no SDKs unless needed.
- `src/app/(app)/<feature>/` — pages are async server components; `actions.ts` ("use server") per feature; client components in the same folder.
- Every page/action starts with `await requireUser("MANAGER")` (or `requireUser()` for staff-accessible pages). Staff may only reach paths listed in `src/middleware.ts` STAFF_PATHS.
- Business dates are `YYYY-MM-DD` strings in the business timezone (`businessToday()` from `@/server/services/sales`, helpers in `@/domain/dates`).
- Money and quantities: Prisma Decimal → `num()`/`.toNumber()`; never float-format in the domain, format in UI with `@/lib/format` (money, pct, qty, dayDate, shortDate).
- Validate action inputs with zod. Return `{ error }` objects for user-facing failures rather than throwing.

## UI (non-negotiable)
- Use only our components: `@/components/ui` (PageHeader, Section, Card, Stat, Badge, Button, LinkButton, Input, Select, DatePicker, Combobox, Textarea, Field, Table/Th/Td/Tr, EmptyState), `@/components/grid` (GridCell, GridSelect — spreadsheet-style inline editing that autosaves), `@/components/dialog` (useConfirm), `@/components/file-drop` (FileDrop), `@/components/line-chart`.
- NO native browser UI: no `<select>`, no `type="date"`, no `confirm()/alert()`, no visible `<input type="file">`, no `<datalist>`.
- Minimal clicks: prefer inline-editable tables (GridCell/GridSelect) over forms; autosave; keyboard friendly.
- Phone-first: everything must work at 390px wide. Tables hide secondary columns with `hidden sm:table-cell`; touch targets ≥ 40px on mobile; inputs 16px on mobile (already in components).
- Visual language: neutral warm greys, ink-black primary, status colors only for meaning (`text-good/warn/bad`, `Badge tone`). Tabular numbers (`num` class). Sentence case. Calm, plain-English copy, no AI fluff.
- Charts: single series via `LineChart` or hand-built SVG following the same style (2px lines, recessive grid, hover tooltip).

## Running things
- Postgres is local (`DATABASE_URL` in `.env`). Schema already contains every model you need — do NOT edit `prisma/schema.prisma` or run migrations. If you truly need a schema change, stop and report it.
- Run your own dev server with a private build dir: `NEXT_DIST_DIR=.next-<you> npx next dev -p <your port>`. Login: Max / 1234 (manager), Line / 0000 (staff).
- Do NOT run `npm run db:seed` (it wipes the shared DB other agents are using). Put demo data in `src/server/demo/<feature>.ts` (see README there) and run it once with a tiny tsx script.
- Checks: `npx tsc --noEmit`, `npx vitest run`, `npx eslint src`. Ignore errors in files you don't own (others are editing concurrently).
- Do NOT git commit. Do NOT edit files you don't own — especially `src/components/nav.tsx`, `src/app/(app)/layout.tsx`, `prisma/*`, `src/server/demo-data.ts`, `src/app/(app)/settings/*`, `src/middleware.ts`. Report what you need there instead.
