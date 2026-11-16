import "server-only";
import { addDays, ISODate, parseISODate, toISODate, zonedMidnightUTC } from "@/domain/dates";
import { readTaxSettings, returnsDue, worksheet, type Form, type Move, type Period, type TaxSettings } from "@/domain/beerTax";
import { kegSizeInfo } from "@/domain/kegs";
import { businessDateOf } from "@/lib/format";
import { env } from "../env";
import { db, num } from "../db";
import { businessToday } from "./sales";

/**
 * Beer tax: our own (house) beer packaged and removed in a period, read from
 * the keg history — fills, kegs tapped in the taproom, kegs sent to accounts —
 * plus gallons typed in for anything that never went in a keg. Guest beers
 * are left out: their brewery paid the tax.
 */

export const TAX_SETTINGS_KEY = "beerTax.settings";

export async function taxSettings(): Promise<TaxSettings> {
  const row = await db.setting.findUnique({ where: { key: TAX_SETTINGS_KEY } });
  return readTaxSettings(row?.value ?? null);
}

export interface MoveRow extends Move {
  /** Keg code, or "typed in". */
  ref: string;
  size: string | null;
  adjustmentId: string | null;
  note: string | null;
}

async function movesBetween(from: ISODate, to: ISODate): Promise<{ moves: MoveRow[]; skipped: number }> {
  const tz = env.BUSINESS_TIMEZONE;
  const start = zonedMidnightUTC(from, tz);
  const end = zonedMidnightUTC(addDays(to, 1), tz);
  const keg = { select: { code: true, sizeId: true } };
  const beer = { select: { id: true, name: true, house: true } };
  const [filled, tapped, out, adjustments, beers] = await Promise.all([
    db.kegFill.findMany({ where: { filledOn: { gte: parseISODate(from), lte: parseISODate(to) } }, select: { filledOn: true, keg, beer } }),
    db.kegFill.findMany({ where: { tappedAt: { gte: start, lt: end } }, select: { tappedAt: true, keg, beer } }),
    db.kegEvent.findMany({ where: { action: "OUT", undoneAt: null, at: { gte: start, lt: end } }, select: { at: true, beerId: true, keg: { select: { code: true, sizeId: true, beerId: true } }, account: { select: { name: true } } } }),
    db.beerTaxAdjustment.findMany({ where: { date: { gte: parseISODate(from), lte: parseISODate(to) } }, orderBy: { date: "asc" } }),
    db.beer.findMany({ select: { id: true, name: true, house: true } }),
  ]);
  const beerBy = new Map(beers.map((b) => [b.id, b]));
  const moves: MoveRow[] = [];
  let skipped = 0;
  const kegMove = (date: ISODate, kind: Move["kind"], k: { code: string; sizeId: string }, b: { id: string; name: string; house: boolean } | null | undefined, note: string | null = null) => {
    if (!b) {
      skipped++;
      return;
    }
    if (!b.house) return;
    const size = kegSizeInfo(k.sizeId);
    moves.push({ date, kind, gallons: size.gallons, beerId: b.id, beer: b.name, ref: k.code, size: size.short, adjustmentId: null, note });
  };
  for (const f of filled) kegMove(toISODate(f.filledOn!), "packaged", f.keg, f.beer);
  for (const f of tapped) kegMove(businessDateOf(f.tappedAt!, tz), "taproom", f.keg, f.beer);
  for (const e of out) kegMove(businessDateOf(e.at, tz), "account", e.keg, beerBy.get(e.beerId ?? e.keg.beerId ?? ""), e.account?.name ?? null);
  for (const a of adjustments) {
    const b = a.beerId ? beerBy.get(a.beerId) : null;
    moves.push({ date: toISODate(a.date), kind: a.kind as Move["kind"], gallons: num(a.gallons) ?? 0, beerId: b?.id ?? null, beer: b?.name ?? "Not a specific beer", ref: "typed in", size: null, adjustmentId: a.id, note: a.note });
  }
  moves.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
  return { moves, skipped };
}

/** The worksheet for one period, with the year to date before it (for the NY credit and the 60,000 bbl line). */
export async function beerTaxReport(p: Period) {
  const yearStart = `${p.start.slice(0, 4)}-01-01`;
  const [s, all] = await Promise.all([taxSettings(), movesBetween(yearStart, p.end)]);
  const before = all.moves.filter((m) => m.date < p.start);
  const inPeriod = all.moves.filter((m) => m.date >= p.start);
  const ytdBefore = worksheet(before, s);
  const w = worksheet(inPeriod, s, ytdBefore.taxableGal);
  const ytd = worksheet(all.moves, s);
  return { settings: s, period: p, worksheet: w, moves: inPeriod, ytd, skipped: all.skipped };
}

export async function filingsFor(forms?: Form[]) {
  const rows = await db.beerTaxFiling.findMany({ where: forms ? { form: { in: forms } } : {}, orderBy: { periodStart: "desc" }, take: 60 });
  return rows.map((f) => ({ id: f.id, form: f.form as Form, periodStart: toISODate(f.periodStart), periodEnd: toISODate(f.periodEnd), filedOn: toISODate(f.filedOn), amount: num(f.amount), note: f.note, userName: f.userName }));
}

/**
 * Returns due soon or overdue, for the Overview and the brief. Quiet until
 * there's any keg history or a filing (so an app without kegs never nags).
 */
export async function beerTaxNeedsYou(today: ISODate = businessToday()) {
  const [since, s, filings] = await Promise.all([historySince(), taxSettings(), filingsFor()]);
  if (!since && !filings.length) return [];
  return returnsDue(today, s, filings, 10, since).filter((r) => r.state === "overdue" || r.state === "due-soon");
}

/** The first day there's keg history or a typed-in line: returns for earlier periods aren't chased. */
export async function historySince(): Promise<ISODate | null> {
  const [fill, event, adj] = await Promise.all([
    db.kegFill.findFirst({ where: { filledOn: { not: null } }, orderBy: { filledOn: "asc" }, select: { filledOn: true } }),
    db.kegEvent.findFirst({ orderBy: { at: "asc" }, select: { at: true } }),
    db.beerTaxAdjustment.findFirst({ orderBy: { date: "asc" }, select: { date: true } }),
  ]);
  const dates = [fill?.filledOn ? toISODate(fill.filledOn) : null, event ? businessDateOf(event.at, env.BUSINESS_TIMEZONE) : null, adj ? toISODate(adj.date) : null].filter((d): d is string => !!d);
  return dates.length ? dates.sort()[0] : null;
}
