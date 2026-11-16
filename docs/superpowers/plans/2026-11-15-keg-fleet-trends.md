# Keg Fleet & Trends Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A manager page at `/kegs/fleet` with fleet numbers, three trend charts, the status × size grid with CSV export, and two "Needs a look" lists, all computed from keg history already in the database.

**Architecture:** One pure module (`src/domain/kegFleet.ts`) turns a flat list of keg events into every number on the page. A thin service loads events and kegs with Prisma and calls it. The page is an async server component with hand-built SVG charts.

**Tech Stack:** Next.js 15 app router, Prisma 6, vitest, Tailwind 4, no chart library.

**Spec:** `docs/superpowers/specs/2026-11-15-keg-fleet-trends-design.md`

## Global Constraints

- No change to `prisma/schema.prisma`; no migration.
- UI only from `@/components/ui`, `@/components/grid`; no native `<select>`, no `confirm()`.
- Works at 390px wide; tabular numbers (`num` class); sentence case; plain English.
- Charts: hand-built SVG, 2px lines, recessive grid (`var(--border)`), `<title>` tooltips, `role="img"` with an `aria-label`.
- Manager-only: every page and action starts with `await requireUser("MANAGER")`.
- Defaults: `overdueDays` 14, `idleDays` 90. Stored in the existing `kegs.config` setting.
- The import-time "Added" event (`importKey` starting `imp:created:`) and undone events are never counted as scans.
- Checks: `npx tsc --noEmit`, `npx vitest run`, `npx eslint src`.

## Review Focus

1. A keg delivered or tapped with no fill scan before it (211 such deliveries in the real history): it still starts a cycle and counts as a fill of unknown date, not dropped.
2. A fill that is still full today: counted as "in stock", never as "no scan".
3. A retired keg: counted in past weeks up to its last scan, absent afterwards; never in "Not seen lately".
4. A keg with only the import-time Added event and no scans: not flagged as idle for 0 scans; listed as "never scanned" only if active and older than `idleDays`.
5. No history at all (fresh install): the page renders an empty state, no divide-by-zero in turns or medians.

---

### Task 1: Fleet calculations

**Files:**
- Create: `src/domain/kegFleet.ts`
- Test: `src/domain/__tests__/kegFleet.test.ts`

**Interfaces — Produces:**

```ts
export type Bucket = "full" | "out" | "dirty" | "clean";
export const BUCKETS: Bucket[];                       // ["full","out","dirty","clean"]
export const BUCKET_LABEL: Record<Bucket, string>;    // Full / On tap or out / Dirty / Clean
export const bucketOf: (s: KegStatus) => Bucket;      // FILLED,COLD→full; ON_TAP,OUT→out; KICKED,CLEANING→dirty; EMPTY→clean

/** One real scan. `day` is the business date; `at` an ISO instant used only for ordering. */
export interface FleetEvent { kegId: string; at: string; day: ISODate; action: string; toStatus: KegStatus | null; beerId: string | null; accountId: string | null }
export interface FleetKeg { id: string; code: string; sizeId: string; status: KegStatus; active: boolean; beer: string | null; account: string | null; createdDay: ISODate }

export function weekStarts(from: ISODate, to: ISODate): ISODate[];          // Mondays covering [from, to]
export interface WeekPoint { week: ISODate; full: number; out: number; dirty: number; clean: number }
export function weeklyFleet(events: FleetEvent[], kegs: Pick<FleetKeg, "id" | "active">[], weeks: ISODate[]): WeekPoint[];

export type Went = "tapped" | "out" | "none" | "stock";
export interface Cycle { kegId: string; beerId: string | null; start: ISODate; scannedFill: boolean; went: Went; end: ISODate | null; days: number | null }
export function cycles(events: FleetEvent[], kegs: Pick<FleetKeg, "id" | "status">[]): Cycle[];

export interface MonthRow { month: string; kegs: number; gallons: number; tapped: number; out: number; none: number; stock: number }
export function monthsBetween(from: ISODate, to: ISODate): string[];        // "YYYY-MM"
export function fillsByMonth(cs: Cycle[], months: string[], gallonsOf: (kegId: string) => number, beerId?: string | null): MonthRow[];

export interface FleetStats { inService: number; fills12: number; turns: number | null; medianCycleDays: number | null; cyclesMeasured: number }
export function fleetStats(cs: Cycle[], kegs: Pick<FleetKeg, "active">[], today: ISODate): FleetStats;

export interface GridRow { status: KegStatus | "RETIRED"; total: number; bySize: Record<string, number> }
export function statusSizeGrid(kegs: Pick<FleetKeg, "status" | "sizeId" | "active">[]): { sizes: string[]; rows: GridRow[]; all: GridRow };

export interface OutGroup { account: string; kegs: { id: string; code: string; sizeId: string; beer: string | null; days: number }[]; longest: number }
export function outTooLong(kegs: FleetKeg[], events: FleetEvent[], today: ISODate, overdueDays: number): OutGroup[];
export interface IdleKeg { id: string; code: string; sizeId: string; status: KegStatus; beer: string | null; lastSeen: ISODate | null; days: number }
export function notSeenLately(kegs: FleetKeg[], events: FleetEvent[], today: ISODate, idleDays: number): IdleKeg[];
```

Rules the tests pin:
- `weeklyFleet`: a keg's bucket in a week is that of its latest `toStatus` on or before the week's Sunday; a keg with no status yet is not counted; an inactive keg is not counted in weeks after the week of its last event.
- `cycles`: per keg, oldest first. A cycle opens at `FILLED` (`scannedFill: true`), or at the first `STORED`/`TAPPED`/`OUT` with none open (`scannedFill: false`). A `FILLED` while one is open closes it with `end: null`. `KICKED`, `RETURNED`, `CLEANED`, `EMPTIED` close it with `end` = that day and `days` = day difference. `went` = the first of `TAPPED` → "tapped" or `OUT` → "out" seen in the cycle; otherwise "stock" if the cycle is still open, it is the keg's last, and the keg's status is FILLED or COLD; otherwise "none". `beerId` = the first non-null in the cycle.
- `fillsByMonth`: month of `start`; `kegs` = cycles; the four `went` counts sum to `kegs`.
- `fleetStats`: `inService` = active kegs; `fills12` = cycles starting in the 365 days up to `today`; `turns` = `fills12 / inService`, null when `inService` is 0; `medianCycleDays` over closed cycles starting in that window, null when there are none.
- `outTooLong`: active kegs with status OUT; `days` since the keg's latest `OUT` event (falling back to its latest event); only those with `days > overdueDays`; grouped by account ("No account recorded" when null), groups sorted by `longest` descending.
- `notSeenLately`: active kegs not OUT; `lastSeen` = latest event day, or null; `days` from `lastSeen ?? createdDay`; only `days > idleDays`; longest first.

- [ ] **Step 1:** Write `kegFleet.test.ts` with one `describe` per function and the five Review Focus cases as named tests.
- [ ] **Step 2:** Run `npx vitest run src/domain/__tests__/kegFleet.test.ts`; expect failures (module missing).
- [ ] **Step 3:** Implement `kegFleet.ts`.
- [ ] **Step 4:** Run the test file; expect all pass.
- [ ] **Step 5:** Commit `Kegs: fleet calculations from history`.

### Task 2: Thresholds in keg config

**Files:** Modify `src/server/services/kegs.ts` (`KegConfig`, `DEFAULT_CONFIG`, `kegConfig`), `src/app/(app)/kegs/actions.ts` (`configSchema`), `src/app/(app)/kegs/setup/setup-client.tsx` (`TapsConfig`).

**Interfaces — Produces:** `KegConfig.overdueDays: number` (1–365, default 14), `KegConfig.idleDays: number` (7–730, default 90).

- [ ] **Step 1:** Add both fields with the same validate-or-default pattern as `fillDays`; extend `configSchema`.
- [ ] **Step 2:** Add two rows to `TapsConfig`: "Out too long, days" and "Not seen, days".
- [ ] **Step 3:** `npx tsc --noEmit`; commit `Kegs: overdue and idle thresholds in setup`.

### Task 3: Fleet service

**Files:** Create `src/server/services/kegFleet.ts`.

**Interfaces — Consumes:** Task 1 exports; `kegConfig()`. **Produces:**

```ts
export type FleetRange = "12m" | "all";
export async function fleetData(): Promise<{ events: FleetEvent[]; kegs: FleetKeg[]; today: ISODate; first: ISODate | null }>;
export async function fleetReport(range: FleetRange, beerId: string | null): Promise<FleetReport>;   // everything the page renders
export async function fleetNeedsLook(): Promise<{ out: OutGroup[]; idle: IdleKeg[]; overdueDays: number; idleDays: number }>;
```

`fleetData` loads `KegEvent` where `undoneAt` is null and `importKey` does not start with `imp:created:` (null import keys included), ordered by `at`, selecting only the fields in `FleetEvent`; `day` via `businessDate(at, env.BUSINESS_TIMEZONE)`.

- [ ] **Step 1:** Implement; `npx tsc --noEmit`.
- [ ] **Step 2:** Commit `Kegs: fleet report service`.

### Task 4: Page, charts and export

**Files:** Create `src/app/(app)/kegs/fleet/page.tsx`, `charts.tsx`, `export-button.tsx`. Modify `src/app/(app)/kegs/page.tsx` (Manage link + Needs a look card), `src/help/areas/kegs.ts` (entry `kegs.fleet`).

**Interfaces — Consumes:** `fleetReport`, `fleetNeedsLook`. Charts: `FleetArea({ points })`, `FillBars({ thisYear, lastYear })`, `WentBars({ rows })`.

- [ ] **Step 1:** Build charts as server components (no state; `<title>` tooltips; a visually hidden table per chart).
- [ ] **Step 2:** Build the page: range chips, four `Stat`s, three chart cards, grid table + export, two lists, empty state when `first` is null.
- [ ] **Step 3:** Add the Manage link and the manager-only card on `/kegs`.
- [ ] **Step 4:** Help entry.
- [ ] **Step 5:** `npx tsc --noEmit && npx eslint src/app/\(app\)/kegs src/domain/kegFleet.ts src/server/services/kegFleet.ts`; commit `Kegs: Fleet & trends page`.

### Task 5: True "Since" for imported kegs

**Files:** Modify `src/server/services/kegImport.ts` (set `statusAt` in `applyKegImport`; add `fixImportedSince()`), `src/app/(app)/kegs/import/actions.ts` (action), `src/app/(app)/kegs/import/page.tsx` (quiet button below the flow). Test: extend `src/domain/__tests__/kegFleet.test.ts` only if a pure helper is extracted.

**Interfaces — Produces:** `export async function fixImportedSince(): Promise<{ fixed: number }>` — for each keg with a `legacyCode` whose every event has an `importKey`, set `statusAt` to its latest event with a `toStatus`, excluding `imp:created:` rows. Kegs with any non-imported event are left alone.

- [ ] **Step 1:** Implement both; `npx tsc --noEmit`.
- [ ] **Step 2:** Commit `Keg import: imported kegs keep their real "since" date`.

### Task 6: Full checks

- [ ] **Step 1:** `npx tsc --noEmit`, `npx vitest run`, `npx eslint src`; all clean for files this plan touched.
