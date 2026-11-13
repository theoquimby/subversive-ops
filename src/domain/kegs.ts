/**
 * Kegs: sizes, statuses, codes printed on QR stickers, what a scan can do
 * next, and the state change each action makes. Pure: no I/O. The server
 * (services/kegs.ts) loads a keg, calls `applyKegAction` and writes the
 * result plus one KegEvent.
 */

import { KEG_SIZES, ML_PER_FL_OZ, ML_PER_GAL } from "./draftBeer";

// ---- Sizes ---------------------------------------------------------------------------

export interface KegSizeInfo {
  id: string;
  /** Short name for cards and boards ("1/2 bbl"). */
  short: string;
  label: string;
  gallons: number;
}

const SHORT: Record<string, string> = { half: "1/2 bbl", quarter: "1/4 bbl", sixtel: "1/6 bbl", bbl: "1 bbl", euro50: "50 L" };

/** Every size a keg can be, the draft-beer costing sizes first. */
export const KEG_SIZE_LIST: KegSizeInfo[] = [
  ...KEG_SIZES.map((k) => ({ id: k.id, label: k.label, gallons: k.gallons, short: SHORT[k.id] ?? k.label })),
  { id: "euro30", short: "30 L", label: "30 L euro keg (7.9 gal)", gallons: 30_000 / ML_PER_GAL },
  { id: "euro20", short: "20 L", label: "20 L euro keg (5.3 gal)", gallons: 20_000 / ML_PER_GAL },
  { id: "corny", short: "Corny 5 gal", label: "Corny keg (5 gal)", gallons: 5 },
];

export const kegSizeInfo = (id: string | null | undefined): KegSizeInfo => KEG_SIZE_LIST.find((k) => k.id === id) ?? KEG_SIZE_LIST[0];

/** Fluid ounces a keg of this size holds when full. */
export const kegOz = (sizeId: string | null | undefined) => (kegSizeInfo(sizeId).gallons * ML_PER_GAL) / ML_PER_FL_OZ;
export const HALF_BBL_OZ = kegOz("half");

/**
 * Read a size from free text ("1/2 bbl", "Half", "15.5 gal", "50L", "sixtel",
 * "1/6") — used by the importer. Null when it can't tell.
 */
export function parseKegSize(raw: unknown): string | null {
  const s = String(raw ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (KEG_SIZE_LIST.some((k) => k.id === s)) return s;
  if (/corn(y|ie)/.test(s)) return "corny";
  if (/sixtel|1\/6|\bsixth\b|5\.1[67]/.test(s)) return "sixtel";
  if (/pony|1\/4|quarter|7\.75/.test(s)) return "quarter";
  if (/1\/2|half|15\.5|\bhbl\b|full ?size/.test(s)) return "half";
  const litres = s.match(/(\d+(?:\.\d+)?)\s*(l|lt|ltr|liters?|litres?)\b/);
  if (litres) {
    const n = Number(litres[1]);
    if (Math.abs(n - 50) < 1) return "euro50";
    if (Math.abs(n - 30) < 1) return "euro30";
    if (Math.abs(n - 20) < 1) return "euro20";
    if (Math.abs(n - 58.7) < 1.5) return "half";
    if (Math.abs(n - 19.5) < 0.6) return "sixtel";
  }
  const gal = s.match(/(\d+(?:\.\d+)?)\s*(g|gal|gallons?)\b/);
  if (gal) {
    const n = Number(gal[1]);
    const near = KEG_SIZE_LIST.map((k) => ({ k, d: Math.abs(k.gallons - n) })).sort((a, b) => a.d - b.d)[0];
    if (near && near.d < 0.4) return near.k.id;
  }
  if (/\b1 ?bbl\b|^bbl$|barrel/.test(s)) return "bbl";
  return null;
}

// ---- Status ----------------------------------------------------------------------------

export type KegStatus = "EMPTY" | "FILLED" | "COLD" | "ON_TAP" | "KICKED" | "OUT" | "CLEANING";
export type KegOwner = "OURS" | "DEPOSIT" | "BORROWED";

export const STATUS_META: Record<KegStatus, { label: string; short: string; tone: "good" | "warn" | "bad" | "neutral"; full: boolean }> = {
  EMPTY: { label: "Empty, clean", short: "Empty", tone: "neutral", full: false },
  FILLED: { label: "Filled", short: "Filled", tone: "good", full: true },
  COLD: { label: "Full, in cold storage", short: "Full", tone: "good", full: true },
  ON_TAP: { label: "On tap", short: "On tap", tone: "good", full: false },
  KICKED: { label: "Kicked", short: "Kicked", tone: "warn", full: false },
  OUT: { label: "Out to an account", short: "Out", tone: "neutral", full: false },
  CLEANING: { label: "Back, needs cleaning", short: "To clean", tone: "warn", full: false },
};
export const KEG_STATUSES = Object.keys(STATUS_META) as KegStatus[];

export const OWNER_LABEL: Record<KegOwner, string> = { OURS: "Ours", DEPOSIT: "On deposit", BORROWED: "Borrowed" };

/** Full kegs ready to go on (filled or cold). */
export const isFull = (s: KegStatus) => STATUS_META[s].full;

// ---- Codes ---------------------------------------------------------------------------------

/** No 0/O, 1/I/L, so a code can be read out loud or typed from a worn sticker. */
export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LEN = 4;

/** Check character: weighted sum mod the alphabet, catches a single typo or swapped pair. */
export function checkChar(body: string): string {
  let sum = 0;
  for (let i = 0; i < body.length; i++) sum += (CODE_ALPHABET.indexOf(body[i]) + 1) * (i + 2);
  return CODE_ALPHABET[sum % CODE_ALPHABET.length];
}

/** A new code: 4 random characters + 1 check character, e.g. "7Q3MX". `rand` returns [0, 1). */
export function newKegCode(rand: () => number = Math.random): string {
  let body = "";
  for (let i = 0; i < CODE_LEN; i++) body += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length) % CODE_ALPHABET.length];
  return body + checkChar(body);
}

/** Uppercase and drop spaces, dashes and dots, so "7q3-mx" finds 7Q3MX. */
export function normalizeCode(raw: string): string {
  return String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function isOurCode(code: string): boolean {
  const c = normalizeCode(code);
  return c.length === CODE_LEN + 1 && [...c].every((ch) => CODE_ALPHABET.includes(ch)) && checkChar(c.slice(0, CODE_LEN)) === c[CODE_LEN];
}

/** "7Q3MX" → "7Q3-MX" for stickers and cards (the dash is decoration; typing it is optional). */
export const displayCode = (code: string) => (code.length === 5 ? `${code.slice(0, 3)}-${code.slice(3)}` : code);

/** The URL a sticker's QR holds, so a phone's own camera opens the keg too. */
export const kegUrl = (base: string, code: string) => `${base.replace(/\/+$/, "")}/kegs/k/${code}`;

/**
 * What a scan or typed text points at: our sticker URL or code, or anything
 * else (an old sticker from another app — matched against legacy codes).
 */
export function parseScan(text: string): { code: string; legacy: string } | null {
  const t = String(text ?? "").trim();
  if (!t) return null;
  const url = t.match(/\/kegs\/k\/([A-Za-z0-9-]+)/);
  if (url) return { code: normalizeCode(url[1]), legacy: t };
  // Another app's QR is often a URL with the keg id at the end; keep both the whole text and its last part.
  const tail = t.match(/^https?:\/\/[^\s]+\/([^/?#\s]+)\/?(?:[?#].*)?$/);
  const raw = tail ? tail[1] : t;
  return { code: normalizeCode(raw), legacy: t };
}

/** Candidates to look a legacy sticker up by (the full text, its normalized form, a URL's last part). */
export function legacyCandidates(text: string): string[] {
  const p = parseScan(text);
  if (!p) return [];
  const out = new Set([text.trim(), normalizeCode(text), p.code]);
  return [...out].filter(Boolean);
}

// ---- Beer colors ------------------------------------------------------------------------------

/** Board colors, roughly by beer color. `fg` is text drawn on `bg`. */
export const BEER_COLORS: { id: string; label: string; bg: string; fg: string }[] = [
  { id: "straw", label: "Straw", bg: "#f2d675", fg: "#3b2f07" },
  { id: "gold", label: "Gold", bg: "#e8b23a", fg: "#3a2603" },
  { id: "amber", label: "Amber", bg: "#cf7f2a", fg: "#ffffff" },
  { id: "copper", label: "Copper", bg: "#a8521f", fg: "#ffffff" },
  { id: "brown", label: "Brown", bg: "#6b3a1e", fg: "#ffffff" },
  { id: "black", label: "Stout black", bg: "#2a1a12", fg: "#f6e7d8" },
  { id: "haze", label: "Hazy orange", bg: "#f0a64a", fg: "#3a2104" },
  { id: "red", label: "Red", bg: "#9e2b25", fg: "#ffffff" },
  { id: "pink", label: "Fruit / sour", bg: "#d9467a", fg: "#ffffff" },
  { id: "green", label: "Hop green", bg: "#7a9a2e", fg: "#ffffff" },
  { id: "blue", label: "Cider / other", bg: "#3d6fb6", fg: "#ffffff" },
  { id: "grey", label: "Grey", bg: "#85837c", fg: "#ffffff" },
];
export const beerColor = (id: string | null | undefined) => BEER_COLORS.find((c) => c.id === id) ?? BEER_COLORS[2];

/** A first guess at a beer's board color from its name or style. */
export function guessBeerColor(name: string): string {
  const s = name.toLowerCase();
  if (/stout|porter|schwarz|black/.test(s)) return "black";
  if (/brown|dunkel|bock|nut/.test(s)) return "brown";
  if (/red|irish|amber ale/.test(s)) return "red";
  if (/hazy|neipa|juicy|nectar/.test(s)) return "haze";
  if (/sour|gose|fruit|berry|cherry|raspberry|peach/.test(s)) return "pink";
  if (/cider|seltzer|mead/.test(s)) return "blue";
  if (/amber|marzen|märzen|oktober|vienna/.test(s)) return "amber";
  if (/ipa|pale|apa/.test(s)) return "gold";
  if (/pils|lager|helles|kolsch|kölsch|wheat|wit|blonde|golden|light/.test(s)) return "straw";
  return "amber";
}

// ---- Actions ---------------------------------------------------------------------------------

export type KegActionId = "KICK" | "TAP" | "MOVE" | "STORE" | "UNTAP" | "OUT" | "RETURN" | "CLEANED" | "FILL" | "EMPTY";

export const ACTION_LABEL: Record<KegActionId, string> = {
  KICK: "Kicked",
  TAP: "Tapped on line…",
  MOVE: "Moved to…",
  STORE: "Into the walk-in",
  UNTAP: "Off tap, not empty",
  OUT: "Out to an account",
  RETURN: "Came back",
  CLEANED: "Cleaned, ready to fill",
  FILL: "Filled with…",
  EMPTY: "Mark empty",
};

/** Past tense for history and the undo bar. */
export const ACTION_DONE: Record<string, string> = {
  KICK: "Kicked",
  KICKED: "Kicked",
  TAP: "Tapped",
  TAPPED: "Tapped",
  MOVE: "Moved",
  MOVED: "Moved",
  STORE: "Into cold storage",
  STORED: "Into cold storage",
  UNTAP: "Taken off tap",
  OUT: "Sent out",
  RETURN: "Came back",
  RETURNED: "Came back",
  CLEANED: "Cleaned",
  FILL: "Filled",
  FILLED: "Filled",
  EMPTY: "Marked empty",
  EMPTIED: "Marked empty",
  CREATED: "Added",
  EDITED: "Edited",
  NOTE: "Note",
  IMPORTED: "Imported",
};

/** The 2–4 big buttons a scan shows, most likely first. */
export function nextActions(status: KegStatus): KegActionId[] {
  switch (status) {
    case "ON_TAP": return ["KICK", "UNTAP"];
    case "COLD": return ["TAP", "MOVE", "OUT"];
    case "FILLED": return ["STORE", "TAP", "OUT"];
    case "KICKED": return ["MOVE", "CLEANED"];
    case "OUT": return ["RETURN"];
    case "CLEANING": return ["CLEANED", "MOVE"];
    case "EMPTY": return ["FILL", "MOVE"];
  }
}

/** The keg fields an action reads and changes. */
export interface KegState {
  status: KegStatus;
  beerId: string | null;
  area: string | null;
  spotId: string | null;
  spotNote: string | null;
  tapLine: number | null;
  accountId: string | null;
}

export interface ActionInput {
  action: KegActionId;
  tapLine?: number | null;
  area?: string | null;
  spotId?: string | null;
  spotNote?: string | null;
  accountId?: string | null;
  beerId?: string | null;
  /** Where kicked kegs go by default (the area the tap lines are in, e.g. "Bar"). */
  tapArea?: string | null;
}

export interface ActionResult {
  next: KegState;
  /** KegEvent.action */
  event: string;
  /** The fill starts (FILL), gets tapped (TAP) or ends (KICK) — the service updates KegFill. */
  fill: "start" | "tap" | "kick" | "untap" | "end" | null;
}

/** What an action does to a keg. Returns { error } in plain English when it doesn't make sense. */
export function applyKegAction(k: KegState, a: ActionInput): ActionResult | { error: string } {
  const spotId = a.area !== undefined && a.area !== k.area ? (a.spotId ?? null) : a.spotId !== undefined ? a.spotId : k.spotId;
  // A note like "stack 2" belongs to the old spot; it goes when the keg moves unless a new one is given.
  const place = { area: a.area ?? k.area, spotId, spotNote: a.spotNote !== undefined ? a.spotNote : spotId === k.spotId && (a.area ?? k.area) === k.area ? k.spotNote : null };
  switch (a.action) {
    case "KICK":
      if (k.status !== "ON_TAP") return { error: "Only a keg on tap can kick." };
      return { next: { ...k, status: "KICKED", tapLine: null, area: a.tapArea ?? k.area, spotId: null, spotNote: null }, event: "KICKED", fill: "kick" };
    case "TAP": {
      if (!isFull(k.status) && k.status !== "COLD") return { error: k.status === "ON_TAP" ? "This keg is already on tap." : "Only a full keg can go on tap." };
      if (!a.tapLine || a.tapLine < 1 || a.tapLine > 99) return { error: "Pick a tap line." };
      if (!k.beerId) return { error: "Say what's in it first (Fill)." };
      return { next: { ...k, status: "ON_TAP", tapLine: a.tapLine, area: a.tapArea ?? k.area, spotId: null, spotNote: null, accountId: null }, event: "TAPPED", fill: "tap" };
    }
    case "UNTAP":
      if (k.status !== "ON_TAP") return { error: "This keg isn't on tap." };
      return { next: { ...k, status: "COLD", tapLine: null, ...place }, event: "MOVED", fill: "untap" };
    case "MOVE":
      if (!a.area) return { error: "Pick where it went." };
      if (k.status === "ON_TAP") return { error: "Take it off tap first (Kicked or Off tap)." };
      if (k.status === "OUT") return { error: "This keg is out at an account. Mark it as come back first." };
      return { next: { ...k, ...place, status: k.status === "FILLED" ? "COLD" : k.status }, event: "MOVED", fill: null };
    case "STORE":
      if (!isFull(k.status)) return { error: "Only a full keg goes into cold storage." };
      if (!a.area) return { error: "Pick where it went." };
      return { next: { ...k, ...place, status: "COLD" }, event: "STORED", fill: null };
    case "OUT":
      if (!isFull(k.status)) return { error: "Only a full keg goes out to an account." };
      if (!a.accountId) return { error: "Pick the account." };
      return { next: { ...k, status: "OUT", accountId: a.accountId, area: null, spotId: null, spotNote: null, tapLine: null }, event: "OUT", fill: "end" };
    case "RETURN":
      if (k.status !== "OUT") return { error: "This keg isn't out at an account." };
      return { next: { ...k, status: "CLEANING", accountId: null, beerId: null, ...place }, event: "RETURNED", fill: null };
    case "CLEANED":
      if (k.status === "ON_TAP" || k.status === "OUT") return { error: "Take it off tap or get it back first." };
      if (isFull(k.status)) return { error: "This keg is full." };
      return { next: { ...k, status: "EMPTY", beerId: null, ...place }, event: "CLEANED", fill: null };
    case "FILL":
      if (k.status !== "EMPTY" && k.status !== "CLEANING") return { error: k.status === "KICKED" ? "Clean it first." : "Only an empty keg can be filled." };
      if (!a.beerId) return { error: "Pick the beer." };
      return { next: { ...k, status: "FILLED", beerId: a.beerId, ...place }, event: "FILLED", fill: "start" };
    case "EMPTY":
      return { next: { ...k, status: "EMPTY", beerId: null, tapLine: null, accountId: null }, event: "EMPTIED", fill: k.status === "ON_TAP" ? "kick" : isFull(k.status) ? "end" : null };
  }
}

/** "Walk-in · back left · stack 2" */
export function placeLabel(p: { area: string | null; spot?: string | null; spotNote?: string | null; tapLine?: number | null; account?: string | null; status?: KegStatus }): string {
  if (p.status === "ON_TAP" && p.tapLine) return `Tap ${p.tapLine}`;
  if (p.status === "OUT") return p.account ? `Out at ${p.account}` : "Out at an account";
  return [p.area, p.spot, p.spotNote].map((x) => x?.trim()).filter(Boolean).join(" · ") || "Somewhere — no spot yet";
}

/** "3 days", "5 hours", "20 min" */
export function sinceLabel(from: Date, now: Date = new Date()): string {
  const mins = Math.max(0, Math.round((now.getTime() - from.getTime()) / 60000));
  if (mins < 60) return `${mins} min`;
  const hrs = Math.round(mins / 60);
  if (hrs < 36) return `${hrs} hour${hrs === 1 ? "" : "s"}`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

/** How long an undo stays available on the phone, and on the server (a bit longer for slow networks). */
export const UNDO_SECONDS = 10;
export const UNDO_SERVER_SECONDS = 120;
