import "server-only";
import { addDays, ISODate, parseISODate, toISODate, zonedMidnightUTC } from "@/domain/dates";
import { brewMoves, dumpedOnOf, kegCountCheck, readTaxSettings, returnsDue, worksheet, type FiledPeriod, type Form, type Move, type Period, type TaxSettings } from "@/domain/beerTax";
import { kegSizeInfo } from "@/domain/kegs";
import { businessDateOf } from "@/lib/format";
import { env } from "../env";
import { db, num } from "../db";
import { businessToday } from "./sales";

/**
 * Beer tax: our own (house) beer packaged and removed in a period, read from
 * the keg history — fills, kegs tapped in the taproom, kegs sent to accounts —
 * the brewery (cases packaged, brews dumped), plus gallons typed in for
 * anything else. Guest beers are left out: their brewery paid the tax. Brewery
 * lines dated in a period already marked filed are held back, so a filed
 * return's numbers never change.
 */

export const TAX_SETTINGS_KEY = "beerTax.settings";

export async function taxSettings(): Promise<TaxSettings> {
  const row = await db.setting.findUnique({ where: { key: TAX_SETTINGS_KEY } });
  return readTaxSettings(row?.value ?? null);
}

export interface MoveRow extends Move {
  /** Where it comes from: a scanned keg, a typed-in line, or a brew. */
  source: "keg" | "typed" | "brew";
  /** Keg code, brew code, or "typed in". */
  ref: string;
  size: string | null;
  adjustmentId: string | null;
  brewId: string | null;
  note: string | null;
}

async function filedPeriods(): Promise<FiledPeriod[]> {
  const rows = await db.beerTaxFiling.findMany({ select: { periodStart: true, periodEnd: true } });
  return rows.map((f) => ({ start: toISODate(f.periodStart), end: toISODate(f.periodEnd) }));
}

/** Brews packaged with cases, or dumped, that could fall between two days. */
async function brewsBetween(from: ISODate, to: ISODate) {
  const rows = await db.brewBatch.findMany({
    where: { OR: [{ packagedOn: { gte: parseISODate(from), lte: parseISODate(to) }, cases: { gt: 0 } }, { status: "DUMPED" }] },
    select: { id: true, code: true, status: true, packagedOn: true, brewedOn: true, plannedOn: true, cases: true, bbl: true, extra: true, beer: { select: { id: true, name: true } } },
  });
  return rows.map((b) => ({
    id: b.id,
    code: b.code,
    beerId: b.beer?.id ?? null,
    beer: b.beer?.name ?? null,
    status: b.status,
    packagedOn: b.packagedOn ? toISODate(b.packagedOn) : null,
    cases: b.cases,
    bbl: num(b.bbl),
    // The day on the dump note; an imported dumped brew with no note counts on its brew day.
    dumpedOn: b.status === "DUMPED" ? (dumpedOnOf(b.extra) ?? (b.brewedOn ? toISODate(b.brewedOn) : b.plannedOn ? toISODate(b.plannedOn) : null)) : null,
  }));
}

async function movesBetween(from: ISODate, to: ISODate): Promise<{ moves: MoveRow[]; skipped: number; heldBack: MoveRow[] }> {
  const tz = env.BUSINESS_TIMEZONE;
  const start = zonedMidnightUTC(from, tz);
  const end = zonedMidnightUTC(addDays(to, 1), tz);
  const keg = { select: { code: true, sizeId: true } };
  const beer = { select: { id: true, name: true, house: true } };
  const [filled, tapped, out, adjustments, beers, brews, filed] = await Promise.all([
    db.kegFill.findMany({ where: { filledOn: { gte: parseISODate(from), lte: parseISODate(to) } }, select: { filledOn: true, keg, beer } }),
    db.kegFill.findMany({ where: { tappedAt: { gte: start, lt: end } }, select: { tappedAt: true, keg, beer } }),
    db.kegEvent.findMany({ where: { action: "OUT", undoneAt: null, at: { gte: start, lt: end } }, select: { at: true, beerId: true, keg: { select: { code: true, sizeId: true, beerId: true } }, account: { select: { name: true } } } }),
    db.beerTaxAdjustment.findMany({ where: { date: { gte: parseISODate(from), lte: parseISODate(to) } }, orderBy: { date: "asc" } }),
    db.beer.findMany({ select: { id: true, name: true, house: true } }),
    brewsBetween(from, to),
    filedPeriods(),
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
    moves.push({ date, kind, gallons: size.gallons, beerId: b.id, beer: b.name, source: "keg", ref: k.code, size: size.short, adjustmentId: null, brewId: null, note });
  };
  for (const f of filled) kegMove(toISODate(f.filledOn!), "packaged", f.keg, f.beer);
  for (const f of tapped) kegMove(businessDateOf(f.tappedAt!, tz), "taproom", f.keg, f.beer);
  for (const e of out) kegMove(businessDateOf(e.at, tz), "account", e.keg, beerBy.get(e.beerId ?? e.keg.beerId ?? ""), e.account?.name ?? null);
  for (const a of adjustments) {
    const b = a.beerId ? beerBy.get(a.beerId) : null;
    moves.push({ date: toISODate(a.date), kind: a.kind as Move["kind"], gallons: num(a.gallons) ?? 0, beerId: b?.id ?? null, beer: b?.name ?? "Not a specific beer", source: "typed", ref: "typed in", size: null, adjustmentId: a.id, brewId: null, note: a.note });
  }
  const fromBrewery = brewMoves(brews, from, to, filed);
  const brewRow = (m: (typeof fromBrewery.moves)[number]): MoveRow => ({ date: m.date, kind: m.kind, gallons: m.gallons, beerId: m.beerId, beer: m.beer, source: "brew", ref: m.code, size: null, adjustmentId: null, brewId: m.brewId, note: m.kind === "loss" ? "dumped" : "cases" });
  moves.push(...fromBrewery.moves.map(brewRow));
  moves.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
  return { moves, skipped, heldBack: fromBrewery.heldBack.map(brewRow) };
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
  return { settings: s, period: p, worksheet: w, moves: inPeriod, ytd, skipped: all.skipped, heldBack: all.heldBack.filter((m) => m.date >= p.start) };
}

/**
 * For brews packaged in a period: the keg counts written at packaging next to
 * the kegs scanned as filled from each brew's keg batch.
 */
export async function brewKegCheck(p: Period) {
  const brews = await db.brewBatch.findMany({
    where: { packagedOn: { gte: parseISODate(p.start), lte: parseISODate(p.end) }, status: { not: "DUMPED" } },
    select: { id: true, code: true, packagedOn: true, halfKegs: true, sixthKegs: true, kegBatchId: true, beer: { select: { name: true } }, recipe: { select: { name: true } } },
  });
  const batchIds = brews.map((b) => b.kegBatchId).filter((x): x is string => !!x);
  const fills = batchIds.length ? await db.kegFill.findMany({ where: { batchId: { in: batchIds } }, select: { batchId: true, keg: { select: { sizeId: true } } } }) : [];
  return kegCountCheck(
    brews.map((b) => ({ id: b.id, code: b.code, name: b.beer?.name ?? b.recipe?.name ?? `Brew ${b.code}`, packagedOn: b.packagedOn ? toISODate(b.packagedOn) : null, halfKegs: b.halfKegs, sixthKegs: b.sixthKegs, kegBatchId: b.kegBatchId })),
    fills.map((f) => ({ batchId: f.batchId, sizeId: f.keg.sizeId })),
  );
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
