/**
 * The tap list: what goes on the TV board, the website feed and the staff
 * view. Board prices per beer, "new" / "last pours" badges, coming soon, the
 * board's order and layout, a slow burn-in shift, and the Square check. Pure:
 * no I/O. The server (services/taps.ts) loads kegs, beers and Square items and
 * calls these.
 */

// ---- Beer details ------------------------------------------------------------------------

export const DIET_TAGS = ["Gluten-reduced", "Gluten-free", "Contains lactose", "Vegan"] as const;

/** "6.5", "6.5%", "6,5 %" → 6.5. Blank → null. Out of range → { error }. */
export function parseAbv(raw: string): number | null | { error: string } {
  const s = String(raw ?? "").trim().replace(",", ".").replace(/%|abv/gi, "").trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 25) return { error: "ABV is a percentage, 0–25" };
  return Math.round(n * 10) / 10;
}

/** "45", "45 IBU" → 45. Blank → null. */
export function parseIbu(raw: string): number | null | { error: string } {
  const s = String(raw ?? "").trim().replace(/ibus?/gi, "").trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 200) return { error: "IBU is a whole number, 0–200" };
  return Math.round(n);
}

/** "6.5% ABV" */
export const abvText = (abv: number | null | undefined) => (abv == null ? null : `${abv.toFixed(1).replace(/\.0$/, "")}%`);

// ---- Pours and prices ---------------------------------------------------------------------

export interface BoardPour {
  /** "16 oz", "Taster", "Flight" */
  label: string;
  oz: number | null;
  price: number;
}

export interface PourCandidate {
  /** Square variation or pour recipe name ("Full Pour", "16 oz"). */
  variation: string;
  oz: number;
  price: number | null;
}

/** "16 oz", or the pour's own name when ounces don't describe it (flights, growlers). */
export function pourLabel(variation: string, oz: number | null): string {
  const v = String(variation ?? "").trim();
  if (/flight|growler|crowler|pitcher/i.test(v) || oz == null || !(oz > 0)) return v || "Pour";
  return `${Math.round(oz * 10) / 10} oz`;
}

/**
 * The pours to show for a beer: priced, poured from a keg (not cans), one per
 * size, smallest first, at most `max`. When two sources disagree on a size the
 * first one given wins (callers pass Square before recipes).
 */
export function pickBoardPours(cands: PourCandidate[], max = 3): BoardPour[] {
  const seen = new Set<string>();
  const out: BoardPour[] = [];
  for (const c of cands) {
    if (c.price == null || !(c.price > 0) || !(c.oz > 0)) continue;
    const label = pourLabel(c.variation, c.oz);
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label, oz: c.oz, price: Math.round(c.price * 100) / 100 });
  }
  return out.sort((a, b) => (a.oz ?? 999) - (b.oz ?? 999)).slice(0, max);
}

/**
 * Prices typed by hand: "16 oz $8, 10 oz $6, Flight $12" (commas, semicolons
 * or new lines between pours; the $ is optional). Blank → [].
 */
export function parseBoardPours(raw: string): BoardPour[] | { error: string } {
  const parts = String(raw ?? "").split(/\s*[,;\n]\s*/).map((p) => p.trim()).filter(Boolean);
  const out: BoardPour[] = [];
  for (const p of parts) {
    const m = p.match(/^(.*?)\s*[:=-]?\s*\$\s*(\d+(?:\.\d{1,2})?)\s*$/) ?? p.match(/^(.*\D)\s+(\d+(?:\.\d{1,2})?)\s*$/);
    if (!m || !m[1].trim()) return { error: `Write each pour as size and price, like “16 oz $8” (“${p.slice(0, 30)}”)` };
    const name = m[1].trim();
    const price = Number(m[2]);
    if (!(price > 0) || price > 500) return { error: `Check the price in “${p.slice(0, 30)}”` };
    const ozM = name.match(/^(\d+(?:\.\d+)?)\s*(?:fl\.?\s*)?(?:oz|ounces?)$/i);
    const oz = ozM ? Number(ozM[1]) : null;
    out.push({ label: oz ? `${oz} oz` : name.slice(0, 24), oz, price });
  }
  if (out.length > 4) return { error: "Four pours at most fit on the board" };
  return out;
}

/** Pours as the board shows them: smallest to biggest (named pours like flights last), keeping the biggest `max`. */
export function boardPoursShown(pours: BoardPour[], max = 3): BoardPour[] {
  const sorted = [...pours].sort((a, b) => (a.oz ?? 1000) - (b.oz ?? 1000));
  return sorted.slice(Math.max(0, sorted.length - max));
}

export const formatBoardPours = (p: BoardPour[]) => p.map((x) => `${x.label} ${priceText(x.price)}`).join(", ");

/** "$8", "$7.50" */
export const priceText = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;

// ---- Badges ----------------------------------------------------------------------------------

/** Below this share left, the board says "Almost gone". */
export const ALMOST_GONE = 0.15;
/** A keg tapped within this many hours is "New". */
export const NEW_HOURS = 72;

export type TapBadge = "new" | "almost" | null;

/** One badge per tap: running low beats new (a new keg can't be nearly empty unless it's a sixtel on a busy night). */
export function tapBadge(pctLeft: number | null | undefined, tappedAt: Date | string | null | undefined, now: Date = new Date()): TapBadge {
  if (pctLeft != null && pctLeft < ALMOST_GONE) return "almost";
  if (tappedAt) {
    const t = new Date(tappedAt).getTime();
    if (Number.isFinite(t) && now.getTime() - t < NEW_HOURS * 3_600_000 && now.getTime() >= t) return "new";
  }
  return null;
}

export const BADGE_LABEL: Record<"new" | "almost", string> = { new: "New", almost: "Almost gone" };

export interface TapLevel {
  text: string;
  tone: "warn" | "neutral" | "unknown";
  /** Running low (or should already be empty): the row's one warning. */
  almost: boolean;
}

/**
 * How much is left on a tap, as one signal: "Should have kicked", "Nearly out",
 * "Almost gone: ~10% left, ~2 days" or "~60% left, ~6 days". Never two of those
 * on one row.
 */
export function tapLevel(e: { pctLeft: number | null | undefined; daysLeft: number | null | undefined; overdue: boolean | null | undefined }): TapLevel {
  if (e.overdue) return { text: "Should have kicked by now: check it", tone: "warn", almost: true };
  if (e.pctLeft == null) return { text: "Level not known yet", tone: "unknown", almost: false };
  if (e.pctLeft <= 0.02 || (e.daysLeft != null && e.daysLeft < 1)) return { text: "Nearly out", tone: "warn", almost: true };
  const share = `~${Math.round(e.pctLeft * 20) * 5}% left`;
  const n = e.daysLeft == null ? null : Math.round(e.daysLeft);
  const left = n == null ? share : `${share}, ~${n} day${n === 1 ? "" : "s"}`;
  return e.pctLeft < ALMOST_GONE ? { text: `Almost gone: ${left}`, tone: "warn", almost: true } : { text: left, tone: "neutral", almost: false };
}

// ---- Order and coming soon --------------------------------------------------------------------

/**
 * Board order: lines in the saved order first (skipping ones that no longer
 * exist), then the rest by line number.
 */
export function orderLines(lines: number[], saved: number[] | null | undefined): number[] {
  const have = new Set(lines);
  const first = [...new Set((saved ?? []).filter((l) => have.has(l)))];
  const rest = lines.filter((l) => !first.includes(l)).sort((a, b) => a - b);
  return [...first, ...rest];
}

/** Move one line up (-1) or down (+1) in the board order. Returns the new full order. */
export function moveLine(order: number[], line: number, dir: -1 | 1): number[] {
  const i = order.indexOf(line);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return order;
  const out = [...order];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

export interface ComingSoonBeer {
  id: string;
  name: string;
  /** null = automatic, true = always, false = never */
  comingSoon: boolean | null;
  active: boolean;
  /** Full kegs (filled or cold) on hand. */
  fullKegs: number;
}

/**
 * Coming soon: beers not on tap now that a manager pinned, plus (when `auto`)
 * beers with a full keg ready. Pinned first, then by name. At most `max`.
 */
export function comingSoon(beers: ComingSoonBeer[], onTapIds: Set<string> | string[], opts: { auto: boolean; max?: number }): ComingSoonBeer[] {
  const on = onTapIds instanceof Set ? onTapIds : new Set(onTapIds);
  return beers
    .filter((b) => b.active && !on.has(b.id) && b.comingSoon !== false && (b.comingSoon === true || (opts.auto && b.fullKegs > 0)))
    .sort((a, b) => Number(b.comingSoon === true) - Number(a.comingSoon === true) || a.name.localeCompare(b.name))
    .slice(0, opts.max ?? 4);
}

// ---- Layout ----------------------------------------------------------------------------------

export interface BoardLayout {
  cols: 1 | 2;
  rows: number;
  /** Relative type size, 1 = a board of 6 rows. */
  scale: number;
}

/**
 * One column up to 8 taps on a landscape screen (7 on portrait-ish ones are
 * still fine), two columns beyond that; rows split evenly. Type scales with
 * the row height so 6 taps are huge and 16 still read across the room.
 */
export function boardLayout(count: number, aspect = 16 / 9): BoardLayout {
  const n = Math.max(1, Math.round(count));
  const oneColMax = aspect >= 1.2 ? 8 : 10;
  const cols: 1 | 2 = n <= oneColMax || aspect < 0.9 ? 1 : 2;
  const rows = Math.ceil(n / cols);
  // Height per row relative to 6 rows, capped so few taps don't get absurdly big.
  const scale = Math.min(1.15, Math.max(0.55, 6 / Math.max(rows, 4.5))) * (cols === 2 ? 0.92 : 1);
  return { cols, rows, scale: Math.round(scale * 100) / 100 };
}

/**
 * Burn-in friendly: the whole board drifts a few pixels around a small loop,
 * one step every `stepMinutes`. Returns the offset in px for this moment.
 */
export function burnInOffset(now: Date | number, stepMinutes = 3, amp = 6): { x: number; y: number } {
  const t = typeof now === "number" ? now : now.getTime();
  const step = Math.floor(t / (stepMinutes * 60_000));
  // 8 points around a loop (dx, dy in units of amp/2), never the same twice in a row.
  const loop: [number, number][] = [[0, 0], [1, 1], [2, 0], [1, -1], [0, -2], [-1, -1], [-2, 0], [-1, 1]];
  const [x, y] = loop[((step % loop.length) + loop.length) % loop.length];
  return { x: (x * amp) / 2, y: (y * amp) / 2 };
}

// ---- Square check -----------------------------------------------------------------------------

export interface SquarePourLink {
  variation: string;
  /** Price in Square's catalog (synced), null when variable or not synced. */
  squarePrice: number | null;
  archived: boolean;
  deleted: boolean;
  /** The linked pour recipe's menu price (Menu costs → Draft beer), if any. */
  menuPrice: number | null;
}

export type SquareCheck =
  | { tone: "good"; text: string }
  | { tone: "warn" | "bad" | "neutral"; text: string };

/**
 * Does the beer's Square item exist and match what we say it costs? Read-only:
 * built from the catalog the nightly sync already pulled. Typed board prices
 * are compared against Square too, by pour size.
 */
export function squareCheck(links: SquarePourLink[], typed: BoardPour[] | null, synced: boolean): SquareCheck {
  if (!synced) return { tone: "neutral", text: "Square catalog not synced yet" };
  const live = links.filter((l) => !l.deleted);
  if (!live.length) return { tone: "warn", text: links.length ? "Square item was deleted" : "No Square item found" };
  if (live.every((l) => l.archived)) return { tone: "warn", text: "Archived in Square" };
  const off: string[] = [];
  for (const l of live.filter((x) => !x.archived)) {
    if (l.squarePrice == null) continue;
    if (l.menuPrice != null && Math.abs(l.menuPrice - l.squarePrice) >= 0.01) off.push(`${l.variation}: Square ${priceText(l.squarePrice)}, recipe ${priceText(l.menuPrice)}`);
  }
  if (typed?.length) {
    const byLabel = new Map(live.filter((x) => !x.archived && x.squarePrice != null).map((l) => [l.variation.toLowerCase(), l.squarePrice!]));
    for (const p of typed) {
      const sq = byLabel.get(p.label.toLowerCase());
      if (sq != null && Math.abs(sq - p.price) >= 0.01) off.push(`${p.label}: board ${priceText(p.price)}, Square ${priceText(sq)}`);
    }
  }
  if (off.length) return { tone: "bad", text: off.slice(0, 2).join(" · ") };
  return { tone: "good", text: `In Square · ${live.filter((x) => !x.archived).length} pour${live.length === 1 ? "" : "s"}` };
}

// ---- Public shape -------------------------------------------------------------------------------

export interface PublicTap {
  tap: number;
  beer: string;
  style: string | null;
  abv: number | null;
  ibu: number | null;
  description: string | null;
  diet: string | null;
  /** Board color as hex, and the text color to use on it. */
  color: string;
  colorText: string;
  label: string | null;
  pours: BoardPour[];
  badge: TapBadge;
  house: boolean;
}

export interface PublicComingSoon {
  beer: string;
  style: string | null;
  abv: number | null;
  color: string;
}

export interface PublicTapList {
  name: string;
  updatedAt: string;
  taps: PublicTap[];
  comingSoon: PublicComingSoon[];
}

/** Token shape for the TV link: 22-char nonce, a dot, 43-char signature (both base64url). */
export const DISPLAY_TOKEN_RE = /^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/;
