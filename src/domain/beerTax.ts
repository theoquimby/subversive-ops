/**
 * Beer tax worksheet: how much of our own beer left the brewery in a period
 * (kegs tapped in the taproom, kegs sent out, plus cans/growlers typed in),
 * what that comes to in barrels and gallons, the federal excise and New York
 * beer tax on it, and when each return is due. Pure: no I/O.
 *
 * The rates and due dates are the usual ones for a small domestic brewery and
 * are editable in the app. They're a worksheet, not tax advice.
 */

import { addDays, ISODate } from "./dates";

export const GAL_PER_BBL = 31;

export type Freq = "month" | "quarter" | "year";
export const FREQS: { value: Freq; label: string }[] = [
  { value: "month", label: "Monthly" },
  { value: "quarter", label: "Quarterly" },
  { value: "year", label: "Yearly" },
];

export type Form = "federal" | "brop" | "ny";

export interface TaxSettings {
  /** Federal excise, $ per barrel (reduced rate, first 60,000 bbl a year). */
  federalRate: number;
  /** New York beer excise, $ per gallon. */
  nyRate: number;
  /** NY small brewer credit on the first 500,000 gallons a year. */
  nyCredit: boolean;
  freq: Record<Form, Freq>;
  /** Days after the period ends that the return is due. */
  dueDays: Record<Form, number>;
}

export const DEFAULT_TAX_SETTINGS: TaxSettings = {
  federalRate: 3.5,
  nyRate: 0.14,
  nyCredit: true,
  freq: { federal: "quarter", brop: "quarter", ny: "month" },
  dueDays: { federal: 14, brop: 15, ny: 20 },
};

export const FORM_INFO: Record<Form, { name: string; short: string; who: string }> = {
  federal: { name: "Federal excise tax return (TTB F 5000.24)", short: "Federal excise", who: "TTB, through Pay.gov" },
  brop: { name: "Brewer's report of operations (TTB F 5130.9 / 5130.26)", short: "Brewer's report", who: "TTB, through Pay.gov" },
  ny: { name: "New York beer tax return (MT-40)", short: "NY beer tax", who: "NYS Tax Department, Online Services" },
};

/** The NY credit covers this many gallons a calendar year. */
export const NY_CREDIT_GALLONS = 500_000;
/** The federal reduced rate covers this many barrels a calendar year. */
export const FEDERAL_REDUCED_BBL = 60_000;

export interface Period { start: ISODate; end: ISODate; label: string; freq: Freq }

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-based

/** The period of a frequency that contains a date. */
export function periodOf(date: ISODate, freq: Freq): Period {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  if (freq === "year") return { start: `${y}-01-01`, end: `${y}-12-31`, label: String(y), freq };
  if (freq === "quarter") {
    const q = Math.floor((m - 1) / 3);
    const sm = q * 3 + 1;
    return { start: `${y}-${pad(sm)}-01`, end: `${y}-${pad(sm + 2)}-${lastDay(y, sm + 2)}`, label: `Q${q + 1} ${y}`, freq };
  }
  return { start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-${lastDay(y, m)}`, label: `${MONTHS[m - 1]} ${y}`, freq };
}

/** The period just before this one. */
export const previousPeriod = (p: Period): Period => periodOf(addDays(p.start, -1), p.freq);
export const nextPeriod = (p: Period): Period => periodOf(addDays(p.end, 1), p.freq);

/** Read "2026-Q3", "2026-10", "2026" back into a period. */
export function parsePeriod(key: string | undefined | null): Period | null {
  if (!key) return null;
  let m = key.match(/^(\d{4})-Q([1-4])$/);
  if (m) return periodOf(`${m[1]}-${pad((Number(m[2]) - 1) * 3 + 1)}-01`, "quarter");
  m = key.match(/^(\d{4})-(\d{2})$/);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return periodOf(`${m[1]}-${m[2]}-01`, "month");
  m = key.match(/^(\d{4})$/);
  if (m) return periodOf(`${m[1]}-01-01`, "year");
  return null;
}

export function periodKey(p: Period): string {
  if (p.freq === "year") return p.start.slice(0, 4);
  if (p.freq === "quarter") return `${p.start.slice(0, 4)}-Q${Math.floor((Number(p.start.slice(5, 7)) - 1) / 3) + 1}`;
  return p.start.slice(0, 7);
}

export const dueOn = (p: Period, days: number): ISODate => addDays(p.end, days);

// ---- Movements -----------------------------------------------------------------------

/**
 * One movement of our own beer: a keg filled (packaged), tapped in the taproom
 * or sent to an account (removals), or a typed-in adjustment.
 */
export type MoveKind = "packaged" | "taproom" | "account" | "removed" | "returned" | "loss";

export interface Move {
  date: ISODate;
  kind: MoveKind;
  gallons: number;
  beerId: string | null;
  beer: string;
}

export interface BeerLine { beerId: string | null; beer: string; packaged: number; taproom: number; account: number; other: number; returned: number; taxable: number }

export interface Worksheet {
  packagedGal: number;
  taproomGal: number;
  accountGal: number;
  otherGal: number;
  returnedGal: number;
  lossGal: number;
  /** Taproom + accounts + other removals − returned to the brewery (never below 0). */
  taxableGal: number;
  taxableBbl: number;
  federalTax: number;
  nyGross: number;
  nyCredit: number;
  nyTax: number;
  byBeer: BeerLine[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Totals for one period. `ytdBeforeGal` is the taxable gallons earlier in the
 * same calendar year, so the NY credit only covers what's left of its
 * 500,000 gallons.
 */
export function worksheet(moves: Move[], s: TaxSettings, ytdBeforeGal = 0): Worksheet {
  const lines = new Map<string, BeerLine>();
  const t = { packaged: 0, taproom: 0, account: 0, removed: 0, returned: 0, loss: 0 };
  for (const m of moves) {
    t[m.kind] += m.gallons;
    const k = m.beerId ?? `name:${m.beer}`;
    const l = lines.get(k) ?? { beerId: m.beerId, beer: m.beer, packaged: 0, taproom: 0, account: 0, other: 0, returned: 0, taxable: 0 };
    if (m.kind === "packaged") l.packaged += m.gallons;
    else if (m.kind === "taproom") l.taproom += m.gallons;
    else if (m.kind === "account") l.account += m.gallons;
    else if (m.kind === "removed") l.other += m.gallons;
    else if (m.kind === "returned") l.returned += m.gallons;
    l.taxable = Math.max(0, l.taproom + l.account + l.other - l.returned);
    lines.set(k, l);
  }
  const taxableGal = Math.max(0, t.taproom + t.account + t.removed - t.returned);
  const taxableBbl = taxableGal / GAL_PER_BBL;
  const nyGross = taxableGal * s.nyRate;
  const creditGal = s.nyCredit ? Math.max(0, Math.min(taxableGal, NY_CREDIT_GALLONS - ytdBeforeGal)) : 0;
  const nyCredit = creditGal * s.nyRate;
  return {
    packagedGal: r2(t.packaged),
    taproomGal: r2(t.taproom),
    accountGal: r2(t.account),
    otherGal: r2(t.removed),
    returnedGal: r2(t.returned),
    lossGal: r2(t.loss),
    taxableGal: r2(taxableGal),
    taxableBbl: Math.round(taxableBbl * 1000) / 1000,
    federalTax: r2(taxableBbl * s.federalRate),
    nyGross: r2(nyGross),
    nyCredit: r2(nyCredit),
    nyTax: r2(Math.max(0, nyGross - nyCredit)),
    byBeer: [...lines.values()].map((l) => ({ ...l, packaged: r2(l.packaged), taproom: r2(l.taproom), account: r2(l.account), other: r2(l.other), returned: r2(l.returned), taxable: r2(l.taxable) })).sort((a, b) => b.taxable - a.taxable || b.packaged - a.packaged || a.beer.localeCompare(b.beer)),
  };
}

// ---- Returns due ---------------------------------------------------------------------

export interface Filing { form: Form; periodStart: ISODate }

export interface DueReturn { form: Form; period: Period; due: ISODate; filed: boolean; state: "filed" | "overdue" | "due-soon" | "upcoming" | "open" }

/**
 * Each return's latest finished period (and the one before, if it's still
 * not filed and this return has been marked filed here before), with its due date
 * and whether it's been marked filed. Periods that ended before `since` (the
 * first keg history) are left out. and whether it's been marked filed. "open" =
 * the current period, not finished yet.
 */
export function returnsDue(today: ISODate, s: TaxSettings, filings: Filing[], soonDays = 10, since: ISODate | null = null): DueReturn[] {
  const filed = new Set(filings.map((f) => `${f.form}|${f.periodStart}`));
  const out: DueReturn[] = [];
  for (const form of ["federal", "brop", "ny"] as Form[]) {
    const current = periodOf(today, s.freq[form]);
    const last = previousPeriod(current);
    const before = previousPeriod(last);
    const mk = (p: Period): DueReturn => {
      const due = dueOn(p, s.dueDays[form]);
      const isFiled = filed.has(`${form}|${p.start}`);
      const state = isFiled ? "filed" : due < today ? "overdue" : addDays(today, soonDays) >= due ? "due-soon" : "upcoming";
      return { form, period: p, due, filed: isFiled, state };
    };
    // The period before only once filings are tracked here, so a new install doesn't
    // nag about returns filed before the app was in use.
    const b = mk(before);
    if (b.state === "overdue" && filings.some((f) => f.form === form) && (!since || before.end >= since)) out.push(b);
    // A period that ended before there was any history here has nothing to show.
    if (!since || last.end >= since || filings.some((f) => f.form === form && f.periodStart === last.start)) out.push(mk(last));
  }
  return out;
}

/** Read stored settings (JSON) over the defaults, keeping only sane values. */
export function readTaxSettings(raw: string | null): TaxSettings {
  const d = DEFAULT_TAX_SETTINGS;
  if (!raw) return { ...d, freq: { ...d.freq }, dueDays: { ...d.dueDays } };
  let j: Partial<TaxSettings> = {};
  try {
    j = JSON.parse(raw) as Partial<TaxSettings>;
  } catch {
    /* fall back to defaults */
  }
  const num = (v: unknown, fb: number, max: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max ? v : fb);
  const freq = (v: unknown, fb: Freq): Freq => (v === "month" || v === "quarter" || v === "year" ? v : fb);
  return {
    federalRate: num(j.federalRate, d.federalRate, 100),
    nyRate: num(j.nyRate, d.nyRate, 10),
    nyCredit: typeof j.nyCredit === "boolean" ? j.nyCredit : d.nyCredit,
    freq: { federal: freq(j.freq?.federal, d.freq.federal), brop: freq(j.freq?.brop, d.freq.brop), ny: freq(j.freq?.ny, d.freq.ny) },
    dueDays: { federal: num(j.dueDays?.federal, d.dueDays.federal, 120), brop: num(j.dueDays?.brop, d.dueDays.brop, 120), ny: num(j.dueDays?.ny, d.dueDays.ny, 120) },
  };
}
