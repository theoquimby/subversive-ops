/**
 * Brew day: the five stages Brew Manager walks through (mash, lauter/sparge,
 * boil, fermentation, packaging), what is written down at each, stage timers,
 * the hop additions checklist, timing profiles (hazy, sour, lager, pale) and
 * what a beer in development still needs. Pure: the phone and the server read
 * a brew-day log the same way.
 *
 * The log lives in BrewBatch.brewLog as JSON. Gravities in it are specific
 * gravity; temperatures °F; volumes barrels. Timers keep when they were started
 * (not a tick count), so a reload or a locked phone doesn't lose time.
 */

import { BREW_PROFILES as TIMING_PROFILES, DEFAULT_SNAP, isProfileKey, PROFILE_KEYS, type ProfileKey, type SnapRules } from "./brewProfiles";
import { addDays, weekday, type ISODate } from "./dates";
import { formatGravity, type GravityUnit } from "./gravity";

// ---- Timing profiles ------------------------------------------------------------------
// One set of profiles, in brewProfiles.ts. Here they carry the weekdays
// transfers and packaging land on, the way Brew Manager's forecast reads them.

export { isProfileKey, PROFILE_KEYS, type ProfileKey };

export interface BrewProfile {
  label: string;
  /** Days from brew day to the dry hop */
  dryHop?: number;
  /** Days to a fermenter-to-fermenter transfer (lagers) */
  fvTransfer?: number;
  /** Days to the move into a brite tank */
  brite: number;
  /** Days to packaging */
  pkg: number;
  /** Days to tap / release */
  tap: number;
  /** Weekdays transfers land on (0 = Sunday) and packaging lands on */
  briteDay: number[];
  pkgDay: number[];
}

/** A profile from brewProfiles.ts with the brewery's transfer and packaging weekdays (Brewery setup). */
export function profileWithDays(key: ProfileKey, rules: SnapRules = DEFAULT_SNAP): BrewProfile {
  const p = TIMING_PROFILES[key];
  return {
    label: p.label,
    ...(p.dryHop != null ? { dryHop: p.dryHop } : {}),
    ...(p.fvTransfer != null ? { fvTransfer: p.fvTransfer } : {}),
    brite: p.brite,
    pkg: p.pkg,
    tap: p.tap,
    briteDay: [...rules.transferDays],
    pkgDay: [...rules.packageDays],
  };
}

/** Every profile with the brewery's weekdays. Pass `brewerySnap()` from the brewery service to honour Brewery setup. */
export function brewDayProfiles(rules: SnapRules = DEFAULT_SNAP): Record<ProfileKey, BrewProfile> {
  return Object.fromEntries(PROFILE_KEYS.map((k) => [k, profileWithDays(k, rules)])) as Record<ProfileKey, BrewProfile>;
}

/** The profiles with the default weekdays (transfers Monday or Tuesday, packaging Wednesday). */
export const BREW_PROFILES: Record<ProfileKey, BrewProfile> = brewDayProfiles();

export const PROFILE_OPTIONS: { value: string; label: string }[] = [
  ...PROFILE_KEYS.map((k) => ({ value: k, label: BREW_PROFILES[k].label })),
  { value: "custom", label: "Custom" },
];

export interface ProfileDays {
  dryHopDay: number | null;
  /** Days in fermenters, brew day to the brite */
  fermentDays: number;
  /** Days in the brite, to packaging */
  conditionDays: number;
  tapDay: number;
}

/** A profile as recipe fields: fermenting runs to the brite transfer, conditioning to packaging. */
export function profileDays(p: BrewProfile): ProfileDays {
  return { dryHopDay: p.dryHop ?? null, fermentDays: p.brite, conditionDays: Math.max(0, p.pkg - p.brite), tapDay: p.tap };
}

/** Profiles from a stored JSON block (Brew Manager's own, which may differ from the defaults). Unknown or broken ones are left out. */
export function readProfiles(json: unknown): Partial<Record<ProfileKey, BrewProfile>> {
  const out: Partial<Record<ProfileKey, BrewProfile>> = {};
  if (!json || typeof json !== "object" || Array.isArray(json)) return out;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 400 ? Math.round(v) : undefined);
  const days = (v: unknown, d: number[]) => (Array.isArray(v) && v.length && v.every((x) => Number.isInteger(x) && x >= 0 && x <= 6) ? (v as number[]) : d);
  for (const [k, raw] of Object.entries(json as Record<string, unknown>)) {
    if (!isProfileKey(k) || !raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const brite = n(r.brite), pkg = n(r.pkg), tap = n(r.tap);
    if (brite == null || pkg == null || tap == null) continue;
    out[k] = {
      label: typeof r.label === "string" && r.label.trim() ? r.label.trim().slice(0, 40) : BREW_PROFILES[k].label,
      ...(n(r.dryHop) != null ? { dryHop: n(r.dryHop) } : {}),
      ...(n(r.fvTransfer) != null ? { fvTransfer: n(r.fvTransfer) } : {}),
      brite,
      pkg,
      tap,
      briteDay: days(r.briteDay, [1, 2]),
      pkgDay: days(r.pkgDay, [3]),
    };
  }
  return out;
}

/**
 * `offset` days after `date`, moved to the nearest of the preferred weekdays
 * within three days either side (four after), the earlier one on a tie. As
 * Brew Manager does it: transfers land on a Monday or Tuesday, packaging on a Wednesday.
 */
export function snapToWeekday(date: ISODate, offset: number, preferred: number[]): ISODate {
  const target = addDays(date, offset);
  let best: ISODate | null = null;
  let bestDiff = 99;
  for (let i = -3; i <= 4; i++) {
    const d = addDays(target, i);
    if (preferred.includes(weekday(d)) && Math.abs(i) < bestDiff) {
      bestDiff = Math.abs(i);
      best = d;
    }
  }
  return best ?? target;
}

export interface Forecast {
  brewDay: ISODate;
  dryHop: ISODate | null;
  fvTransfer: ISODate | null;
  brite: ISODate;
  pkg: ISODate;
  tap: ISODate;
}

/** The dates a brew on `brewDay` follows under a profile (Brew Manager's generateForecast). */
export function forecastDates(brewDay: ISODate, p: BrewProfile): Forecast {
  return {
    brewDay,
    dryHop: p.dryHop ? addDays(brewDay, p.dryHop) : null,
    fvTransfer: p.fvTransfer ? snapToWeekday(brewDay, p.fvTransfer, p.briteDay) : null,
    brite: snapToWeekday(brewDay, p.brite, p.briteDay),
    pkg: snapToWeekday(brewDay, p.pkg, p.pkgDay),
    tap: addDays(brewDay, p.tap),
  };
}

// ---- Suppliers' lead times ------------------------------------------------------------
// One definition, in brewOrdering.ts.

export { isLeadRef, LEAD_REF_LABEL, LEAD_REFS_KEY, type LeadRef } from "./brewOrdering";

// ---- What a beer in development still needs --------------------------------------------

export interface CheckLine {
  name: string;
  kind: string;
  /** Matched to an ingredient that is bought from a supplier */
  hasSupplier: boolean;
}

export interface CheckItem {
  id: "suppliers" | "gravity" | "batch" | "artwork";
  label: string;
  done: boolean;
  detail?: string;
}

/** Brew Manager's dev notes say "Needs suppliers + gravity targets": the same list, plus a batch size and artwork. */
export function whatsMissing(r: { lines: CheckLine[]; targetOg: number | null; targetFg: number | null; batchBbl: number | null; artworkDone: boolean }): CheckItem[] {
  const lines = r.lines.filter((l) => l.name.trim());
  const noSupplier = lines.filter((l) => !l.hasSupplier);
  const gravity = [r.targetOg == null ? "OG" : null, r.targetFg == null ? "FG" : null].filter(Boolean);
  return [
    {
      id: "suppliers",
      label: "A supplier for every ingredient",
      done: lines.length > 0 && noSupplier.length === 0,
      detail: !lines.length ? "No ingredients yet." : noSupplier.length ? `No supplier yet: ${noSupplier.map((l) => l.name.trim()).join(", ")}.` : undefined,
    },
    { id: "gravity", label: "Gravity targets", done: gravity.length === 0, detail: gravity.length ? `No target ${gravity.join(" or ")} yet.` : undefined },
    { id: "batch", label: "A batch size", done: r.batchBbl != null && r.batchBbl > 0 },
    { id: "artwork", label: "Label artwork done", done: r.artworkDone },
  ];
}

// ---- The brew-day log -----------------------------------------------------------------

export type StageId = "mash" | "lauter" | "boil" | "ferment" | "package";
export const STAGES: { id: StageId; label: string; short: string }[] = [
  { id: "mash", label: "Mash", short: "Mash" },
  { id: "lauter", label: "Lauter / sparge", short: "Lauter" },
  { id: "boil", label: "Boil", short: "Boil" },
  { id: "ferment", label: "Fermentation", short: "Ferment" },
  { id: "package", label: "Packaging", short: "Package" },
];
export const isStageId = (s: unknown): s is StageId => typeof s === "string" && STAGES.some((x) => x.id === s);

export type FieldKind = "temp" | "gravity" | "ph" | "time" | "bbl" | "minutes" | "count" | "co2";
/** Recipe targets a reading is checked against */
export type TargetKey = "strikeF" | "mashF" | "targetMt" | "targetBk" | "targetKo" | "targetOg" | "targetFg" | "batchBbl";

export interface StageField {
  key: string;
  label: string;
  kind: FieldKind;
  target?: TargetKey;
}

export const STAGE_FIELDS: Record<StageId, StageField[]> = {
  mash: [
    { key: "strikeF", label: "Strike temp", kind: "temp", target: "strikeF" },
    { key: "mashF", label: "Mash temp", kind: "temp", target: "mashF" },
    { key: "mtSg", label: "MT gravity", kind: "gravity", target: "targetMt" },
    { key: "ph", label: "Mash pH", kind: "ph" },
    { key: "startTime", label: "Mash start", kind: "time" },
    { key: "strikeBbl", label: "Strike volume", kind: "bbl" },
  ],
  lauter: [
    { key: "bkSg", label: "BK gravity", kind: "gravity", target: "targetBk" },
    { key: "spargeF", label: "Sparge temp", kind: "temp" },
    { key: "preboilBbl", label: "Pre-boil volume", kind: "bbl" },
    { key: "runoffMin", label: "Runoff time", kind: "minutes" },
  ],
  boil: [
    { key: "boilStart", label: "Boil start", kind: "time" },
    { key: "koSg", label: "KO gravity", kind: "gravity", target: "targetKo" },
    { key: "ogSg", label: "OG", kind: "gravity", target: "targetOg" },
    { key: "postboilBbl", label: "Post-boil volume", kind: "bbl", target: "batchBbl" },
  ],
  ferment: [
    { key: "pitchF", label: "Pitch temp", kind: "temp" },
    { key: "fermF", label: "Ferment temp", kind: "temp" },
  ],
  package: [
    { key: "fgSg", label: "Final gravity", kind: "gravity", target: "targetFg" },
    { key: "halfKegs", label: "½ bbl kegs", kind: "count" },
    { key: "sixthKegs", label: "⅙ bbl kegs", kind: "count" },
    { key: "cases", label: "Cases", kind: "count" },
    { key: "co2Vols", label: "CO₂ volumes", kind: "co2" },
  ],
};

const RANGE: Record<FieldKind, [number, number]> = {
  temp: [32, 215],
  gravity: [0.98, 1.2],
  ph: [2, 9],
  time: [0, 0],
  bbl: [0, 1000],
  minutes: [0, 1440],
  count: [0, 10000],
  co2: [0, 5],
};

export type FieldValue = number | string | null;

/** A stored value for a field, or null when it isn't one (wrong type, out of range). Times are "HH:MM". */
export function cleanFieldValue(kind: FieldKind, v: unknown): FieldValue {
  if (kind === "time") {
    if (typeof v !== "string") return null;
    const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
    return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
  }
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  const [lo, hi] = RANGE[kind];
  if (n < lo || n > hi) return null;
  return kind === "count" ? Math.round(n) : n;
}

export interface TimerState {
  /** When it was last started (ms since epoch), or null while stopped */
  startedAt: number | null;
  /** Time run before that start */
  elapsedMs: number;
  /** Count down from this many minutes; null counts up */
  targetMin: number | null;
}

export interface BrewLog {
  v: 1;
  /** The tab open last */
  stage: StageId;
  startedAt: string;
  /** Last change, from the device that made it (newer wins when two disagree) */
  savedAt: string;
  finishedAt: string | null;
  values: Record<StageId, Record<string, FieldValue>>;
  notes: Record<StageId, string>;
  timers: Partial<Record<StageId, TimerState>>;
  /** Hop additions ticked off: hop key → when */
  hops: Record<string, string>;
}

const emptyStages = <T>(make: () => T) => Object.fromEntries(STAGES.map((s) => [s.id, make()])) as Record<StageId, T>;

export function newBrewLog(now: Date): BrewLog {
  const at = now.toISOString();
  return { v: 1, stage: "mash", startedAt: at, savedAt: at, finishedAt: null, values: emptyStages(() => ({})), notes: emptyStages(() => ""), timers: {}, hops: {} };
}

const isoOr = (v: unknown, d: string) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : d);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** A stored or sent log, with anything missing filled in and anything malformed dropped. Null when there is no log. */
export function readBrewLog(json: unknown): BrewLog | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const j = json as Record<string, unknown>;
  const startedAt = isoOr(j.startedAt, new Date(0).toISOString());
  const log = newBrewLog(new Date(startedAt));
  log.startedAt = startedAt;
  log.savedAt = isoOr(j.savedAt, startedAt);
  log.finishedAt = typeof j.finishedAt === "string" && !Number.isNaN(Date.parse(j.finishedAt)) ? j.finishedAt : null;
  log.stage = isStageId(j.stage) ? j.stage : "mash";
  const values = obj(j.values);
  const notes = obj(j.notes);
  const timers = obj(j.timers);
  for (const s of STAGES) {
    const sv = obj(values[s.id]);
    for (const f of STAGE_FIELDS[s.id]) {
      const v = cleanFieldValue(f.kind, sv[f.key]);
      if (v != null) log.values[s.id][f.key] = v;
    }
    if (typeof notes[s.id] === "string") log.notes[s.id] = (notes[s.id] as string).slice(0, 4000);
    const t = obj(timers[s.id]);
    if (Object.keys(t).length) {
      const startedAtMs = typeof t.startedAt === "number" && Number.isFinite(t.startedAt) && t.startedAt > 0 ? t.startedAt : null;
      const elapsedMs = typeof t.elapsedMs === "number" && Number.isFinite(t.elapsedMs) && t.elapsedMs >= 0 ? t.elapsedMs : 0;
      const targetMin = typeof t.targetMin === "number" && Number.isFinite(t.targetMin) && t.targetMin > 0 && t.targetMin <= 1440 ? t.targetMin : null;
      log.timers[s.id] = { startedAt: startedAtMs, elapsedMs, targetMin };
    }
  }
  for (const [k, v] of Object.entries(obj(j.hops))) if (typeof v === "string" && k.length <= 200) log.hops[k] = v;
  return log;
}

/** Of two copies of a log (this phone's unsent one and the saved one), the one changed last. */
export function newerLog(a: BrewLog | null, b: BrewLog | null): BrewLog | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(b.savedAt) > Date.parse(a.savedAt) ? b : a;
}

/** How many readings each stage has, for the dots on its tab. */
export function stageProgress(log: BrewLog): Record<StageId, number> {
  return Object.fromEntries(STAGES.map((s) => [s.id, Object.values(log.values[s.id]).filter((v) => v != null && v !== "").length + (log.notes[s.id].trim() ? 1 : 0)])) as Record<StageId, number>;
}

/** A reading as text for the log and the printed sheet. */
export function formatFieldValue(kind: FieldKind, v: FieldValue | undefined, unit: GravityUnit): string {
  if (v == null || v === "") return "";
  if (kind === "time") return String(v);
  const n = Number(v);
  switch (kind) {
    case "temp":
      return `${Number(n.toFixed(1))} °F`;
    case "gravity":
      return formatGravity(n, unit);
    case "ph":
      return n.toFixed(2);
    case "bbl":
      return `${Number(n.toFixed(2))} bbl`;
    case "minutes":
      return `${Math.round(n)} min`;
    case "co2":
      return `${n.toFixed(2)} vols`;
    case "count":
      return String(Math.round(n));
  }
}

/** Every reading written down so far, stage by stage, as label and text. */
export function logRows(log: BrewLog, unit: GravityUnit): { stage: StageId; label: string; rows: [string, string][]; notes: string }[] {
  return STAGES.map((s) => ({
    stage: s.id,
    label: s.label,
    rows: STAGE_FIELDS[s.id].flatMap((f): [string, string][] => {
      const t = formatFieldValue(f.kind, log.values[s.id][f.key], unit);
      return t ? [[f.label, t]] : [];
    }),
    notes: log.notes[s.id].trim(),
  }));
}

/** What finishing the brew day fills in: the OG (or KO gravity) read in the boil, and the volume after it. */
export function finishDefaults(log: BrewLog | null, fallback: { bbl: number | null }): { og: number | null; bbl: number | null } {
  const boil = log?.values.boil ?? {};
  const og = typeof boil.ogSg === "number" ? boil.ogSg : typeof boil.koSg === "number" ? boil.koSg : null;
  const bbl = typeof boil.postboilBbl === "number" && boil.postboilBbl > 0 ? boil.postboilBbl : fallback.bbl;
  return { og, bbl };
}

// ---- Timers ---------------------------------------------------------------------------

export const timerElapsed = (t: TimerState | undefined, now: number) => (t ? t.elapsedMs + (t.startedAt != null ? Math.max(0, now - t.startedAt) : 0) : 0);
export const timerRunning = (t: TimerState | undefined) => t?.startedAt != null;

export function startTimer(t: TimerState | undefined, now: number, targetMin: number | null): TimerState {
  if (t?.startedAt != null) return t;
  return { startedAt: now, elapsedMs: t?.elapsedMs ?? 0, targetMin: t ? t.targetMin : targetMin };
}

export function pauseTimer(t: TimerState | undefined, now: number): TimerState | undefined {
  if (!t || t.startedAt == null) return t;
  return { startedAt: null, elapsedMs: timerElapsed(t, now), targetMin: t.targetMin };
}

export function resetTimer(t: TimerState | undefined, targetMin: number | null): TimerState {
  return { startedAt: null, elapsedMs: 0, targetMin: t ? t.targetMin ?? targetMin : targetMin };
}

/** "1:02:03" or "45:07". */
export function clock(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0"), ss = String(s).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** What a timer shows: time left when it counts down (then time over), else time run. */
export function timerView(t: TimerState | undefined, now: number): { text: string; over: boolean; countdown: boolean; elapsedMin: number } {
  const elapsed = timerElapsed(t, now);
  const elapsedMin = elapsed / 60000;
  if (t?.targetMin) {
    const left = t.targetMin * 60000 - elapsed;
    return left >= 0 ? { text: clock(left), over: false, countdown: true, elapsedMin } : { text: `+${clock(-left)}`, over: true, countdown: true, elapsedMin };
  }
  return { text: clock(elapsed), over: false, countdown: false, elapsedMin };
}

// ---- Hop additions --------------------------------------------------------------------

export type HopUseName = "boil" | "firstwort" | "whirlpool" | "dryhop" | "mash";

export interface HopLineInput {
  kind: string;
  name: string;
  qty: number;
  unit: string;
  use: string | null;
  minutes: number | null;
}

export interface HopAddition {
  key: string;
  name: string;
  qty: number;
  unit: string;
  use: HopUseName;
  minutes: number | null;
  /** "60 min", "Whirlpool, 20 min", "Dry hop, day 7" */
  when: string;
  /** Minutes after the boil starts that it goes in (boil and first-wort hops) */
  atBoilMinute: number | null;
}

const USE_ORDER: Record<HopUseName, number> = { mash: 0, firstwort: 1, boil: 2, whirlpool: 3, dryhop: 4 };

/** A hop line's key in the checklist: stays the same while the recipe's hops do. */
export const hopKey = (i: number, l: Pick<HopLineInput, "name" | "use" | "minutes">) => `${i}|${l.name.trim().toLowerCase()}|${l.use ?? "boil"}|${l.minutes ?? ""}`;

/** The recipe's hops in the order they go in: mash, first wort, boil (longest first), whirlpool, dry hop. */
export function hopAdditions(lines: HopLineInput[], boilMinutes: number, dryHopDay: number | null = null): HopAddition[] {
  const hops = lines.filter((l) => l.kind === "hop");
  return hops
    .map((l, i): HopAddition => {
      const use = (["boil", "firstwort", "whirlpool", "dryhop", "mash"].includes(l.use ?? "") ? l.use : "boil") as HopUseName;
      const min = l.minutes;
      const when =
        use === "boil" ? (min == null ? "Boil" : min === 0 ? "Flameout" : `${min} min`)
          : use === "firstwort" ? "First wort"
            : use === "whirlpool" ? (min == null ? "Whirlpool" : `Whirlpool, ${min} min`)
              : use === "mash" ? "Mash"
                : min != null ? `Dry hop, ${min} day${min === 1 ? "" : "s"}` : dryHopDay != null ? `Dry hop, day ${dryHopDay}` : "Dry hop";
      const atBoilMinute = use === "firstwort" ? 0 : use === "boil" ? Math.max(0, boilMinutes - (min ?? boilMinutes)) : null;
      return { key: hopKey(i, l), name: l.name, qty: l.qty, unit: l.unit, use, minutes: min, when, atBoilMinute };
    })
    .sort((a, b) => USE_ORDER[a.use] - USE_ORDER[b.use] || (b.minutes ?? 0) - (a.minutes ?? 0));
}

/** Boil hops that should be in by now (`boilMin` minutes since the boil started) and aren't ticked. */
export function hopsDue(additions: HopAddition[], ticked: Record<string, string>, boilMin: number): HopAddition[] {
  return additions.filter((h) => h.atBoilMinute != null && h.atBoilMinute <= boilMin && !ticked[h.key]);
}
