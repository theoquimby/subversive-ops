import "server-only";
import { beerColor } from "@/domain/kegs";
import { matchBeer, matchSquareItem, pourOz, splitItemName } from "@/domain/kegPours";
import { abvView } from "@/domain/beerLinks";
import { measuredAbvByBeer } from "./beerLinks";
import {
  boardPoursShown,
  comingSoon,
  orderLines,
  parseBoardPours,
  pickBoardPours,
  squareCheck,
  tapBadge,
  type BoardPour,
  type PourCandidate,
  type PublicTapList,
  type SquareCheck,
  type SquarePourLink,
  type TapBadge,
} from "@/domain/taps";
import { db, num } from "../db";
import { newDisplayNonce, signDisplayToken } from "../display-token";
import { env } from "../env";
import { kegConfig, tapBoard } from "./kegs";
import { squareCatalogMeta } from "./sales";

/**
 * The tap list: what's pouring with board details and prices, for the staff
 * view, the TV board (/display/taps/<token>) and the website feed
 * (/api/public/taps). Reads kegs (services/kegs), beers, Square items and
 * draft beer pour recipes. Never writes to Square.
 */

// ---- Settings ---------------------------------------------------------------------------------

export interface BoardConfig {
  /** Current TV link nonce; "New link" replaces it, so old links stop working. */
  nonce: string | null;
  /** Tap lines in board order (lines not listed follow by number). */
  order: number[];
  /** Show beers with a full keg in cold storage as coming soon. */
  autoComingSoon: boolean;
  /** Shown at the top of the board. */
  title: string;
}

const KEY = "taps.board";
const DEFAULTS: BoardConfig = { nonce: null, order: [], autoComingSoon: true, title: "Subversive" };

export async function boardConfig(): Promise<BoardConfig> {
  const row = await db.setting.findUnique({ where: { key: KEY } });
  try {
    const v = row ? (JSON.parse(row.value) as Partial<BoardConfig>) : {};
    return {
      nonce: typeof v.nonce === "string" && /^[A-Za-z0-9_-]{22}$/.test(v.nonce) ? v.nonce : null,
      order: Array.isArray(v.order) ? v.order.filter((n) => Number.isInteger(n) && n > 0 && n < 100) : [],
      autoComingSoon: typeof v.autoComingSoon === "boolean" ? v.autoComingSoon : DEFAULTS.autoComingSoon,
      title: typeof v.title === "string" && v.title.trim() ? v.title.trim().slice(0, 40) : DEFAULTS.title,
    };
  } catch {
    return DEFAULTS;
  }
}

export async function saveBoardConfig(patch: Partial<BoardConfig>) {
  const value = JSON.stringify({ ...(await boardConfig()), ...patch });
  await db.setting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
}

const secret = () => process.env.SESSION_SECRET ?? "";

/** The TV link's token, made on first use. */
export async function displayToken(): Promise<string> {
  let { nonce } = await boardConfig();
  if (!nonce) {
    nonce = newDisplayNonce();
    await saveBoardConfig({ nonce });
  }
  return signDisplayToken(nonce, secret());
}

/** A new TV link; every old one stops working. */
export async function regenerateDisplayToken(): Promise<string> {
  const nonce = newDisplayNonce();
  await saveBoardConfig({ nonce });
  return signDisplayToken(nonce, secret());
}

/** True when this (already signature-checked) nonce is the current one. */
export async function isCurrentNonce(nonce: string | null): Promise<boolean> {
  if (!nonce) return false;
  const cur = (await boardConfig()).nonce;
  if (!cur || cur.length !== nonce.length) return false;
  let diff = 0;
  for (let i = 0; i < cur.length; i++) diff |= cur.charCodeAt(i) ^ nonce.charCodeAt(i);
  return diff === 0;
}

// ---- Prices -------------------------------------------------------------------------------------

export interface BeerPricing {
  pours: BoardPour[];
  /** Where the prices came from. */
  source: "typed" | "square" | "recipes" | "none";
  square: SquareCheck;
  /** Square pours found for the beer (for the Beers page). */
  squarePours: { variation: string; price: number | null; oz: number }[];
}

/** Pours and prices per beer: typed on the Beers page, else Square's catalog, else draft beer pour recipes. */
export async function beerPricing(beers: { id: string; name: string; squareNames: string[]; boardPours: string | null; ingredientId?: string | null }[]): Promise<Map<string, BeerPricing>> {
  const [maps, meta, recipes, cfg] = await Promise.all([
    db.squareMapping.findMany({ where: { squareType: "ITEM_VARIATION", ignored: false }, select: { squareId: true, squareName: true, beerId: true, recipe: { select: { menuPrice: true, lines: { select: { qty: true, unit: true } } } } } }),
    squareCatalogMeta(),
    db.recipe.findMany({ where: { kind: "MENU", active: true, category: "Beer", menuPrice: { not: null } }, select: { name: true, menuPrice: true, lines: { select: { qty: true, unit: true, ingredientId: true } } } }),
    kegConfig(),
  ]);
  const ozOf = (lines: { qty: { toNumber(): number }; unit: string }[]) => lines.filter((l) => /^(fl ?oz|oz)$/i.test(l.unit.trim())).reduce((s, l) => s + l.qty.toNumber(), 0);
  const synced = Object.keys(meta).length > 0;
  // Square items linked to a beer match it by id; the rest by name.
  const matchers = beers.map((b) => ({ id: b.id, name: b.name, squareNames: b.squareNames, squareIds: maps.filter((m) => m.beerId === b.id).map((m) => m.squareId) }));
  const byKeg = new Map(beers.filter((b) => b.ingredientId).map((b) => [b.ingredientId!, b.id]));
  const sq = new Map<string, (SquarePourLink & { oz: number })[]>();
  for (const m of maps) {
    const { variation } = splitItemName(m.squareName);
    const id = matchSquareItem(m.squareId, m.squareName, matchers);
    if (!id) continue;
    const x = meta[m.squareId];
    const rOz = m.recipe ? ozOf(m.recipe.lines) : 0;
    const v = (variation ?? "Regular").trim();
    const oz = pourOz(variation, { overrides: cfg.pours, recipeOz: rOz || null });
    const list = sq.get(id) ?? [];
    list.push({ variation: v, oz, squarePrice: x?.price ?? null, archived: x?.archived ?? false, deleted: x?.deleted ?? false, menuPrice: num(m.recipe?.menuPrice ?? null) });
    sq.set(id, list);
  }
  const rec = new Map<string, PourCandidate[]>();
  for (const r of recipes) {
    const { base, variation } = splitItemName(r.name);
    // A pour recipe belongs to the beer whose keg ingredient it uses; by name only when it uses none.
    const keg = r.lines.map((l) => (l.ingredientId ? byKeg.get(l.ingredientId) : undefined)).find(Boolean);
    const id = keg ?? matchBeer(base, matchers);
    if (!id || !variation) continue;
    const list = rec.get(id) ?? [];
    list.push({ variation, oz: ozOf(r.lines) || pourOz(variation, { overrides: cfg.pours }), price: num(r.menuPrice) });
    rec.set(id, list);
  }
  const out = new Map<string, BeerPricing>();
  for (const b of beers) {
    const links = sq.get(b.id) ?? [];
    const typedRaw = b.boardPours?.trim() ? parseBoardPours(b.boardPours) : null;
    const typed = typedRaw && !("error" in typedRaw) ? typedRaw : null;
    const fromSquare = pickBoardPours(links.filter((l) => !l.deleted && !l.archived).map((l) => ({ variation: l.variation, oz: l.oz, price: l.squarePrice })));
    const fromRecipes = pickBoardPours(rec.get(b.id) ?? []);
    const pours = typed?.length ? typed : fromSquare.length ? fromSquare : fromRecipes;
    out.set(b.id, {
      pours,
      source: typed?.length ? "typed" : fromSquare.length ? "square" : fromRecipes.length ? "recipes" : "none",
      square: squareCheck(links, typed, synced),
      squarePours: links.filter((l) => !l.deleted).map((l) => ({ variation: l.variation, price: l.squarePrice, oz: l.oz })),
    });
  }
  return out;
}

// ---- The list -------------------------------------------------------------------------------------

export interface TapListRow {
  line: number;
  kegId: string;
  kegCode: string;
  sizeId: string;
  beerId: string | null;
  beer: string;
  style: string | null;
  abv: number | null;
  ibu: number | null;
  description: string | null;
  diet: string | null;
  color: string;
  house: boolean;
  labelUrl: string | null;
  pours: BoardPour[];
  priceSource: BeerPricing["source"];
  square: SquareCheck | null;
  pctLeft: number | null;
  daysLeft: number | null;
  overdue: boolean;
  tappedAt: string | null;
  backups: number;
  badge: TapBadge;
}

export interface TapList {
  title: string;
  rows: TapListRow[];
  /** Lines with nothing on them, in board order. */
  free: number[];
  /** Every line in board order (for reordering). */
  order: number[];
  comingSoon: { beerId: string; beer: string; style: string | null; abv: number | null; color: string; fullKegs: number; pinned: boolean }[];
  autoComingSoon: boolean;
  updatedAt: string;
}

export const labelUrl = (beerId: string, at: Date | null) => (at ? `/api/public/taps/label/${beerId}?v=${at.getTime().toString(36)}` : null);

/** What's pouring now, in board order, with details, prices, badges and coming soon. */
export async function tapList(): Promise<TapList> {
  const [{ taps }, cfg, beers, full, measured] = await Promise.all([
    tapBoard(),
    boardConfig(),
    db.beer.findMany({ select: { id: true, name: true, style: true, color: true, house: true, active: true, squareNames: true, abv: true, ibu: true, description: true, diet: true, boardPours: true, comingSoon: true, labelAt: true, ingredientId: true } }),
    db.keg.groupBy({ by: ["beerId"], where: { active: true, status: { in: ["FILLED", "COLD"] }, beerId: { not: null } }, _count: { _all: true } }),
    // ABV measured by the brewery (latest packaged brew): shown when none is typed.
    measuredAbvByBeer().catch(() => new Map<string, { abv: number }>()),
  ]);
  const pricing = await beerPricing(beers);
  const abvOf = (b: { id: string; abv: { toNumber(): number } | null } | undefined) => (b ? abvView(b.abv ? b.abv.toNumber() : null, measured.get(b.id)?.abv ?? null).shown : null);
  const byId = new Map(beers.map((b) => [b.id, b]));
  const now = new Date();
  const lines = taps.filter((t) => t.line > 0).map((t) => t.line);
  const order = orderLines(lines, cfg.order);
  const rank = new Map(order.map((l, i) => [l, i]));
  const rows: TapListRow[] = [];
  for (const t of taps) {
    if (!t.keg || t.line <= 0) continue;
    const b = t.keg.beerId ? byId.get(t.keg.beerId) : undefined;
    const p = b ? pricing.get(b.id) : undefined;
    const pctLeft = t.estimate?.pctLeft ?? null;
    rows.push({
      line: t.line,
      kegId: t.keg.id,
      kegCode: t.keg.code,
      sizeId: t.keg.sizeId,
      beerId: t.keg.beerId,
      beer: t.keg.beer ?? "Unknown beer",
      style: b?.style ?? null,
      abv: abvOf(b),
      ibu: b?.ibu ?? null,
      description: b?.description ?? null,
      diet: b?.diet ?? null,
      color: t.keg.color,
      house: b?.house ?? true,
      labelUrl: b ? labelUrl(b.id, b.labelAt) : null,
      pours: boardPoursShown(p?.pours ?? [], 4),
      priceSource: p?.source ?? "none",
      square: p?.square ?? null,
      pctLeft,
      daysLeft: t.estimate?.daysLeft ?? null,
      overdue: !!t.estimate?.overdue,
      tappedAt: t.keg.tappedAt ? new Date(t.keg.tappedAt).toISOString() : null,
      backups: t.backups,
      badge: tapBadge(t.estimate?.overdue ? 0 : pctLeft, t.keg.tappedAt, now),
    });
  }
  rows.sort((a, z) => (rank.get(a.line) ?? 999) - (rank.get(z.line) ?? 999));
  const busy = new Set(rows.map((r) => r.line));
  const fullBy = new Map(full.map((f) => [f.beerId!, f._count._all]));
  const soon = comingSoon(
    beers.map((b) => ({ id: b.id, name: b.name, comingSoon: b.comingSoon, active: b.active, fullKegs: fullBy.get(b.id) ?? 0 })),
    new Set(rows.map((r) => r.beerId).filter((x): x is string => !!x)),
    { auto: cfg.autoComingSoon },
  ).map((s) => {
    const b = byId.get(s.id)!;
    return { beerId: b.id, beer: b.name, style: b.style, abv: abvOf(b), color: b.color, fullKegs: s.fullKegs, pinned: b.comingSoon === true };
  });
  return { title: cfg.title, rows, free: order.filter((l) => !busy.has(l)), order, comingSoon: soon, autoComingSoon: cfg.autoComingSoon, updatedAt: now.toISOString() };
}

// ---- Public -----------------------------------------------------------------------------------------

/** Guest-facing fields only: no keg codes, exact % left, sales or Square ids. */
export async function publicTapList(origin?: string): Promise<PublicTapList> {
  const t = await tapList();
  const value: PublicTapList = {
    name: t.title,
    updatedAt: t.updatedAt,
    taps: t.rows.map((r) => {
      const c = beerColor(r.color);
      return { tap: r.line, beer: r.beer, style: r.style, abv: r.abv, ibu: r.ibu, description: r.description, diet: r.diet, color: c.bg, colorText: c.fg, label: r.labelUrl, pours: r.pours, badge: r.badge, house: r.house };
    }),
    comingSoon: t.comingSoon.map((s) => ({ beer: s.beer, style: s.style, abv: s.abv, color: beerColor(s.color).bg })),
  };
  return withOrigin(value, origin);
}

/** Label URLs absolute for the website (relative ones only work on our own pages). */
function withOrigin(v: PublicTapList, origin?: string): PublicTapList {
  if (!origin) return v;
  return { ...v, taps: v.taps.map((t) => ({ ...t, label: t.label ? `${origin}${t.label}` : null })) };
}

export const businessTz = () => env.BUSINESS_TIMEZONE;
