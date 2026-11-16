# Keg fleet and trends (part 1 of 5)

Approved by Theo on 2026-11-15. Part 1 of bringing the keg area to full parity
with Distribrewtion and past it. Later parts, each with its own design: buyer
pages and reports with export; scan-many mode; wholesale orders; maintenance
schedules.

## Why

The full Distribrewtion history is now in Ops (204 kegs, 6,840 scans since
Aug 2022). Distribrewtion showed it only as lists and three plain tables. Theo
wants the keg area to show trends and graphs, and to have every Distribrewtion
feature. Part 1 covers what needs no new staff habits: everything here is
worked out from history already loaded.

## Goals

- A manager page, **Kegs → Fleet & trends**, with headline numbers and three
  charts over 12 months or all time.
- Distribrewtion's Cooperage report: fleet by status and size, with CSV export.
- Replace Distribrewtion's Keg Limbo and "flag kegs older than 14 days":
  two "Needs a look" lists, also shown to managers on the main Kegs page.
- Imported kegs show a true "Since" instead of the import time.

## Non-goals

- No orders, buyer pages, maintenance or scan-many mode (parts 2 to 5).
- No schema change. No new statuses.
- No alerts by email or push for these lists yet; the lists are on-page only.

## Anti-goals

- Numbers that look precise but aren't. About two thirds of fills in the
  imported history have no scan saying where the beer went. The page says so
  ("no scan") rather than guessing.
- Kegs flagged as lost because of the import itself. "Not seen lately" is
  measured from each keg's last real scan, not the import-time "Added" entry.

## Approaches

1. **Worked out on request from KegEvent and KegFill (chosen).** One pure
   module turns the event list into weekly status counts, fills per month,
   where-it-went per month, cycle times and the two lists. ~7,000 events is
   small enough to load per page view. No schema change, always consistent
   with history, works for undo.
2. Nightly snapshot table of fleet counts. Faster at large scale, but needs a
   migration and a cron, can't show history before the first snapshot without
   a backfill, and drifts after an undo. Not worth it at this size.
3. Reuse the Insights Lab. It is built for sales findings, not keg state over
   time; the fleet charts would not fit its shapes.

## Design

### What a manager sees

`/kegs/fleet`, linked from the Manage grid on `/kegs` ("Fleet & trends").
Range toggle: 12 months (default) or all time, as `?range=12m|all`.

- **Stats:** kegs in service; turns per keg per year (fills in the last 12
  months ÷ kegs in service); median days per cycle (a fill to the next time the
  keg is marked dirty or cleaned); idle kegs (the "not seen lately" count).
- **Where the fleet was:** weekly stacked areas of how many kegs were full
  (FILLED, COLD), pouring or out (ON_TAP, OUT), dirty (KICKED, CLEANING) and
  clean (EMPTY). State is replayed from each event's `toStatus`.
- **Kegs filled per month:** bars for this year against last, in barrels on
  hover, with a beer picker (`?beer=`).
- **Where the beer went:** per month, fills that were later tapped here, sent
  out, or neither ("no scan").
- **Fleet by status and size:** the Cooperage grid, with CSV export.
- **Needs a look:**
  - *Out too long* — active kegs with status OUT whose last OUT event is more
    than `overdueDays` ago (default 14), grouped by account, longest first.
  - *Not seen lately* — active kegs, not OUT, whose last real scan is more than
    `idleDays` ago (default 90). Each row links to the keg; "Retire" uses the
    existing keg field action.

On `/kegs`, managers get a compact card above Manage when either list is
non-empty, linking to the page.

Both thresholds are edited in Setup → Taps and storage and stored in the
existing `kegs.config` setting.

### Since dates

- The importer sets `statusAt` to the keg's latest imported event that carried
  a status, when that is earlier than now.
- One-off fix for the 204 kegs already imported: a manager-only action on the
  import page, "Fix Since dates", that sets `statusAt` from each imported keg's
  latest non-import event. Idempotent.

### Where the code goes

- `src/domain/kegFleet.ts` — pure: replay, weekly series, monthly fills and
  destinations, cycle stats, status × size grid, the two lists. Tests in
  `src/domain/__tests__/kegFleet.test.ts`.
- `src/server/services/kegFleet.ts` — loads events, fills and kegs; calls the
  domain.
- `src/app/(app)/kegs/fleet/page.tsx`, `charts.tsx` (hand-built SVG in the
  house style), and a small client piece for the CSV export.
- Edits: `kegs/page.tsx` (link + card), `setup` (two thresholds),
  `services/kegs.ts` (config fields), `services/kegImport.ts` (`statusAt`),
  `help/areas/kegs.ts` (help text).

### Left to the builder

Exact chart dimensions and colours within the house style; wording of help
text; whether the beer picker is chips or a select.

## Checks

`npx tsc --noEmit`, `npx vitest run`, `npx eslint src`. There is no local
database on the build machine, so pages are checked on the live site after
release; the calculations are covered by unit tests against event fixtures.
