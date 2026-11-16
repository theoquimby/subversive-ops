import "server-only";
import { byStanding, kegsBySize, showCoreHelper, standingOf, suggestStanding, type SizeCount, type Standing, type Suggestion } from "@/domain/beerStanding";
import { addDays, businessDate, daysBetween, type ISODate } from "@/domain/dates";
import { placeLabel, type KegStatus } from "@/domain/kegs";
import { db, num } from "../db";
import { env } from "../env";
import { beerFills, fillDaysByBeer, type BeerFills } from "./kegFleet";
import { beerDemand, beerOz, type BeerDemandRow } from "./kegs";
import { businessToday } from "./sales";

/**
 * A beer's own page ("where does this brand stand") and the first-time
 * "Pick your core beers" helper. Pure rules live in domain/beerStanding.
 */

const day = (at: Date) => businessDate(at, env.BUSINESS_TIMEZONE);

export interface BeerPage {
  beer: { id: string; name: string; style: string | null; abv: number | null; color: string; house: boolean; minFull: number; standing: Standing };
  today: ISODate;
  /** Kegs holding this beer right now, by size, with a total. */
  bySize: { rows: SizeCount[]; total: { full: number; onTap: number; out: number; total: number } };
  /** Full kegs, oldest fill first, with where each one is. */
  full: { id: string; code: string; sizeId: string; status: KegStatus; place: string; filledOn: ISODate | null; days: number }[];
  /** On tap now. */
  onTap: { id: string; code: string; sizeId: string; line: number | null }[];
  /** Accounts holding kegs of it, the longest out first. */
  out: { accountId: string | null; account: string; kegs: { id: string; code: string; sizeId: string; since: ISODate; days: number }[]; longest: number }[];
  fills: BeerFills;
  /** Pints a week and the next four weeks; null when it can't be worked out. */
  demand: BeerDemandRow | null;
}

export async function beerPage(id: string): Promise<BeerPage | null> {
  const beer = await db.beer.findUnique({ where: { id }, select: { id: true, name: true, style: true, abv: true, color: true, house: true, minFull: true, active: true, core: true } });
  if (!beer) return null;
  const today = businessToday();
  const [kegs, fills, demand] = await Promise.all([
    db.keg.findMany({
      where: { beerId: id, active: true, status: { in: ["FILLED", "COLD", "ON_TAP", "OUT"] } },
      select: { id: true, code: true, sizeId: true, status: true, statusAt: true, area: true, spotNote: true, tapLine: true, accountId: true, spot: { select: { name: true } }, account: { select: { name: true } }, fill: { select: { filledOn: true } } },
    }),
    beerFills(id),
    // Demand reads every Square sale; a problem there leaves that block out, never the page.
    beerDemand()
      .then((d) => d.rows.find((r) => r.beerId === id) ?? null)
      .catch((e) => {
        console.error("beer page: demand skipped", (e as Error).message);
        return null;
      }),
  ]);
  const status = (k: (typeof kegs)[number]) => k.status as KegStatus;
  const full = kegs
    .filter((k) => status(k) === "FILLED" || status(k) === "COLD")
    .map((k) => {
      const filledOn = k.fill?.filledOn?.toISOString().slice(0, 10) ?? null;
      return { id: k.id, code: k.code, sizeId: k.sizeId, status: status(k), place: placeLabel({ area: k.area, spot: k.spot?.name, spotNote: k.spotNote }), filledOn, days: daysBetween(filledOn ?? day(k.statusAt), today) };
    })
    .sort((a, b) => b.days - a.days || a.code.localeCompare(b.code));
  const groups = new Map<string, BeerPage["out"][number]>();
  for (const k of kegs.filter((x) => status(x) === "OUT")) {
    const key = k.accountId ?? "-";
    const since = day(k.statusAt);
    const g = groups.get(key) ?? { accountId: k.accountId, account: k.account?.name ?? "No account recorded", kegs: [], longest: 0 };
    const days = daysBetween(since, today);
    g.kegs.push({ id: k.id, code: k.code, sizeId: k.sizeId, since, days });
    g.longest = Math.max(g.longest, days);
    groups.set(key, g);
  }
  for (const g of groups.values()) g.kegs.sort((a, b) => b.days - a.days);
  return {
    beer: { id: beer.id, name: beer.name, style: beer.style, abv: num(beer.abv), color: beer.color, house: beer.house, minFull: beer.minFull, standing: standingOf(beer) },
    today,
    bySize: kegsBySize(kegs.map((k) => ({ sizeId: k.sizeId, status: status(k) }))),
    full,
    onTap: kegs.filter((k) => status(k) === "ON_TAP").map((k) => ({ id: k.id, code: k.code, sizeId: k.sizeId, line: k.tapLine })).sort((a, b) => (a.line ?? 99) - (b.line ?? 99)),
    out: [...groups.values()].sort((a, b) => b.longest - a.longest || a.account.localeCompare(b.account)),
    fills,
    demand,
  };
}

// ---- Pick your core beers ------------------------------------------------------------------------

export const CORE_HELPER_KEY = "kegs.coreHelper.dismissed";

export interface CoreHelperRow {
  id: string;
  name: string;
  color: string;
  suggestion: Suggestion;
}

/**
 * The first-time helper: every beer still on the list with a suggested
 * standing from its keg history and the last 90 days of Square sales. Null
 * once a beer is core or a manager has put the helper away.
 */
export async function coreHelper(): Promise<CoreHelperRow[] | null> {
  const [beers, dismissed] = await Promise.all([
    db.beer.findMany({ select: { id: true, name: true, color: true, active: true, core: true, createdAt: true } }),
    db.setting.findUnique({ where: { key: CORE_HELPER_KEY }, select: { value: true } }),
  ]);
  const active = beers.filter((b) => b.active);
  if (!showCoreHelper({ anyCore: active.some((b) => b.core), dismissed: !!dismissed, activeBeers: active.length })) return null;
  const today = businessToday();
  const [fills, sales] = await Promise.all([
    fillDaysByBeer(),
    beerOz(addDays(today, -90)).catch((e) => {
      console.error("core helper: sales skipped", (e as Error).message);
      return null;
    }),
  ]);
  const pints = (id: string) => {
    let oz = 0;
    for (const v of sales?.oz.get(id)?.values() ?? []) oz += v;
    return oz / 16;
  };
  return active
    .map((b) => ({ id: b.id, name: b.name, color: b.color, active: b.active, core: b.core, suggestion: suggestStanding({ fills: fills.get(b.id) ?? [], pints90: pints(b.id), today, addedOn: day(b.createdAt) }) }))
    .sort((a, b) => ["core", "rotation", "retired"].indexOf(a.suggestion.standing) - ["core", "rotation", "retired"].indexOf(b.suggestion.standing) || byStanding(a, b))
    .map(({ id, name, color, suggestion }) => ({ id, name, color, suggestion }));
}
