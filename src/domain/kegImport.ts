/**
 * Bringing in everything from another keg app. The core is a pure mapper from
 * "raw records" — one array of flat or nested objects per entity — into our
 * kegs, beers, batches, accounts, spots and history. It doesn't care where
 * the records came from: a CSV/XLSX report (one row = one record) or, later,
 * JSON pulled from the old app's API (same shape, nested keys read as
 * "customer.name"). Pure: no I/O; services/kegImport.ts saves the plan.
 *
 *   sources ──detectEntity / guessMapping──▶ specs (a manager confirms)
 *           ──planKegImport──▶ ImportPlan (dedupe on keg code, review summary)
 *
 * Re-importing is safe: kegs match on their old code, history rows carry a
 * stable importKey, and everything else matches on name or code. Columns we
 * don't map are kept as-is in each record's `extra` so nothing is lost.
 */

import { ISODate } from "./dates";
import { type KegOwner, type KegStatus, normalizeCode, parseKegSize } from "./kegs";

export type KegEntity = "kegs" | "beers" | "batches" | "accounts" | "deliveries" | "returns" | "events" | "locations";
export type EntityOrSkip = KegEntity | "skip";

export type RawRecord = Record<string, unknown>;

export interface RawSource {
  /** File + tab ("Kegs.csv", "Export.xlsx · Customers") or an API entity name. */
  name: string;
  records: RawRecord[];
}

export const ENTITY_LABEL: Record<EntityOrSkip, string> = {
  kegs: "Kegs",
  beers: "Beers / products",
  batches: "Batches",
  accounts: "Accounts / customers",
  deliveries: "Deliveries / orders",
  returns: "Returns / pickups",
  events: "History / activity log",
  locations: "Locations",
  skip: "Skip this one",
};

export type Field =
  | "code" | "size" | "owner" | "status" | "area" | "spot" | "tapLine" | "beer" | "batch" | "filledOn" | "bestBy" | "account" | "notes" | "active"
  | "name" | "style" | "squareName" | "abv"
  | "brewedOn" | "packagedOn"
  | "kind" | "contact" | "email" | "phone" | "address"
  | "date" | "action" | "user" | "orderRef";

export type Mapping = Partial<Record<Field, string>>;

export const FIELD_LABEL: Record<Field, string> = {
  code: "Keg code / ID", size: "Size", owner: "Owner", status: "Status", area: "Location", spot: "Spot / position", tapLine: "Tap line",
  beer: "Beer", batch: "Batch", filledOn: "Fill date", bestBy: "Best by", account: "Account / customer", notes: "Notes", active: "Active",
  name: "Name", style: "Style", squareName: "Square item name", abv: "ABV",
  brewedOn: "Brew date", packagedOn: "Packaged date",
  kind: "Type", contact: "Contact person", email: "Email", phone: "Phone", address: "Address",
  date: "Date / time", action: "What happened", user: "Who", orderRef: "Order / invoice #",
};

export const FIELDS: Record<KegEntity, Field[]> = {
  kegs: ["code", "size", "status", "beer", "batch", "filledOn", "bestBy", "area", "spot", "tapLine", "account", "owner", "notes", "active"],
  beers: ["name", "style", "abv", "squareName", "notes"],
  batches: ["code", "beer", "brewedOn", "packagedOn", "notes"],
  accounts: ["name", "kind", "contact", "email", "phone", "address", "notes"],
  deliveries: ["code", "account", "date", "beer", "batch", "orderRef", "notes"],
  returns: ["code", "account", "date", "notes"],
  events: ["code", "date", "action", "status", "beer", "batch", "account", "area", "user", "orderRef", "notes"],
  locations: ["area", "spot"],
};

export const REQUIRED: Record<KegEntity, Field[]> = {
  kegs: ["code"],
  beers: ["name"],
  batches: ["code"],
  accounts: ["name"],
  deliveries: ["code", "date"],
  returns: ["code", "date"],
  events: ["code", "date"],
  locations: ["area"],
};

// Column-name patterns per field, most specific first. Keys are compared lowercased with "_" and "." as spaces.
const PATTERNS: Record<Field, RegExp[]> = {
  code: [/^(keg )?(code|id|number|no|#|serial|barcode|qr|tag|label)$/, /^keg$/, /keg (code|id|number|no|serial|barcode|tag|label|name)/, /serial|barcode|qr ?code/, /^keg\b/],
  size: [/^(keg )?(size|type|format|volume|capacity)$/, /size|capacity|volume|format/],
  owner: [/^own(er|ership)$/, /owner|ownership|deposit|borrowed/],
  status: [/^(keg )?(status|state|condition)$/, /status|state/],
  area: [/^(location|area|place|where|storage|warehouse|current location)$/, /location|area|storage|warehouse|cooler/],
  spot: [/^(spot|position|slot|shelf|rack|stack|bay|bin)$/, /position|slot|shelf|rack|stack|bay\b|bin\b/],
  tapLine: [/^(tap|tap line|line|tap number|tap #|faucet)$/, /tap ?(line|number|#|no)|faucet/],
  beer: [/^(beer|product|brand|contents|liquid|beverage|sku|item|beer name|product name)$/, /beer|product|brand|contents|liquid|beverage/],
  batch: [/^(batch|batch (code|no|number|#|id)|lot|lot (no|number|#))$/, /batch|\blot\b|brew ?(no|number|#|id)/],
  filledOn: [/^(fill(ed)?( on| date)?|date filled|kegged( on| date)?|racked( on)?)$/, /fill(ed)? ?(date|on)|kegged|racked|packag/],
  bestBy: [/best ?by|expir|use by|bbd/],
  account: [/^(account|customer|client|buyer|venue|bar|retailer|distributor|sold to|ship to|delivered to)( name)?$/, /account|customer|client|buyer|venue|retailer|ship ?to|sold ?to|delivered ?to/],
  notes: [/^(notes?|comments?|memo|remarks?|description)$/, /note|comment|memo|remark/],
  active: [/^(active|enabled|in service|retired|archived)$/],
  name: [/^(name|beer|product|brand|account|customer|company|business)( name)?$/, /name$/],
  style: [/^(style|beer style|type|category)$/, /style/],
  abv: [/abv|alcohol/],
  squareName: [/square|pos ?(name|item)/],
  brewedOn: [/brew(ed)? ?(date|on)?$|^brew day$/],
  packagedOn: [/packag|kegged|canned|fill(ed)? ?date/],
  kind: [/^(type|kind|category|account type|customer type|segment)$/],
  contact: [/^(contact|contact name|contact person|buyer name|manager|attn|attention)$/, /contact (name|person)/],
  email: [/e-?mail/],
  phone: [/phone|mobile|cell|tel\b/],
  address: [/address|street|city|location address/],
  date: [/^(date|date ?time|timestamp|time|when|created( at| on)?|event date|scanned( at)?|delivered( on| at| date)?|returned( on| at| date)?|delivery date|return date|ship date|order date)$/, /date|time|when|timestamp/],
  action: [/^(action|event|activity|type|event type|what|description|operation|scan type)$/, /action|event|activity|operation/],
  user: [/^(user|who|by|staff|employee|scanned by|driver|performed by|created by)$/, /user|scanned by|driver|employee|staff|performed by/],
  orderRef: [/order|invoice|manifest|reference|ref ?(no|#)?$|^po\b/],
};

/** Flatten nested objects to dotted keys ("customer.name"); arrays and deeper levels become JSON text. */
export function flattenRecord(r: RawRecord, prefix = "", depth = 0, out: RawRecord = {}): RawRecord {
  for (const [k, v] of Object.entries(r ?? {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date) && depth < 2) flattenRecord(v as RawRecord, key, depth + 1, out);
    else out[key] = Array.isArray(v) || (v && typeof v === "object" && !(v instanceof Date)) ? JSON.stringify(v) : v;
  }
  return out;
}

/** Every key seen in the first 300 records, in first-seen order. */
export function headersOf(records: RawRecord[]): string[] {
  const seen = new Set<string>();
  for (const r of records.slice(0, 300)) for (const k of Object.keys(flattenRecord(r))) seen.add(k);
  return [...seen];
}

const norm = (h: string) => h.toLowerCase().replace(/[_.\-/]+/g, " ").replace(/\s+/g, " ").trim();

/** Best column per field for this entity: exact patterns before loose ones, each column used once. */
export function guessMapping(entity: KegEntity, headers: string[]): Mapping {
  const m: Mapping = {};
  const used = new Set<string>();
  const fields = FIELDS[entity];
  // Pass by pattern rank so a strong match on a later field isn't stolen by a weak one on an earlier field.
  const maxRank = Math.max(...fields.map((f) => PATTERNS[f].length));
  for (let rank = 0; rank < maxRank; rank++) {
    for (const f of fields) {
      if (m[f]) continue;
      const re = PATTERNS[f][rank];
      if (!re) continue;
      // Prefer top-level keys over nested ones ("name" over "customer.name") unless only nested matches.
      const hits = headers.filter((h) => !used.has(h) && (re.test(norm(h)) || re.test(norm(h.split(".").at(-1) ?? h))));
      const top = hits.find((h) => !h.includes(".")) ?? hits[0];
      if (top) { m[f] = top; used.add(top); }
    }
  }
  // An entity's name field is the plain "name" column when nothing better matched.
  return m;
}

const NAME_HINTS: [RegExp, KegEntity][] = [
  [/locat|area|warehouse|cooler/, "locations"],
  [/batch|brew ?log|lots?\b/, "batches"],
  [/return|pick ?up|collect/, "returns"],
  [/deliver|order|shipment|invoice|sales/, "deliveries"],
  [/history|activity|event|log|scan|movement|track/, "events"],
  [/customer|account|client|buyer|venue/, "accounts"],
  [/beer|product|brand|recipe|catalog/, "beers"],
  [/keg|asset|container|inventory/, "kegs"],
];

/** What a file/tab/API array most likely holds: its name first, then which entity's columns fit best. */
export function detectEntity(source: RawSource): { entity: EntityOrSkip; mapping: Mapping } {
  const headers = headersOf(source.records);
  const n = norm(source.name);
  const byName = NAME_HINTS.find(([re]) => re.test(n))?.[1];
  const score = (e: KegEntity) => {
    const m = guessMapping(e, headers);
    const req = REQUIRED[e].every((f) => m[f]);
    return { e, m, s: (req ? 10 : 0) + Object.keys(m).length };
  };
  if (byName) {
    const sc = score(byName);
    if (REQUIRED[byName].every((f) => sc.m[f])) return { entity: byName, mapping: sc.m };
  }
  const ranked = (Object.keys(FIELDS) as KegEntity[]).map(score).sort((a, b) => b.s - a.s);
  const best = ranked[0];
  if (!best || best.s < 10) return { entity: "skip", mapping: best?.m ?? {} };
  // History has a date and an action; a keg list rarely has both.
  const ev = ranked.find((r) => r.e === "events")!;
  if (ev.m.action && ev.m.date && ev.m.code) return { entity: "events", mapping: ev.m };
  return { entity: best.e, mapping: best.m };
}

// ---- Value parsers ---------------------------------------------------------------------------

const text = (v: unknown): string => (v == null ? "" : v instanceof Date ? v.toISOString() : String(v)).trim();

/** A date or date-time as an ISO string. Reads ISO, US m/d/y (with time), Excel serials and epoch ms/s. */
export function parseWhen(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (typeof v === "number" || /^\d+(\.\d+)?$/.test(String(v).trim())) {
    const n = Number(v);
    if (n > 1e12) return new Date(n).toISOString();
    if (n > 1e9) return new Date(n * 1000).toISOString();
    if (n > 20000 && n < 80000) return new Date(Math.round((n - 25569) * 86_400_000)).toISOString(); // Excel serial (local time read as UTC)
    return null;
  }
  const s = String(v).trim();
  const us = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?$/i);
  if (us) {
    let y = Number(us[3]);
    if (y < 100) y += 2000;
    let h = us[4] ? Number(us[4]) : 12;
    if (us[7]) h = (h % 12) + (us[7].toLowerCase() === "pm" ? 12 : 0);
    const d = new Date(Date.UTC(y, Number(us[1]) - 1, Number(us[2]), h, us[5] ? Number(us[5]) : 0, us[6] ? Number(us[6]) : 0));
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T12:00:00.000Z`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export const isoDay = (when: string | null): ISODate | null => (when ? when.slice(0, 10) : null);

const STATUS_WORDS: [RegExp, KegStatus][] = [
  [/on ?tap|tapped|pouring|in use|connected/, "ON_TAP"],
  [/kick|blown|ran out/, "KICKED"],
  [/deliver|shipped|at (customer|account)|out\b|sold|in market|in trade|with customer|consigned/, "OUT"],
  [/return|dirty|needs? (clean|wash)|to clean|unclean|picked up/, "CLEANING"],
  [/cold|cooler|walk.?in|stored|in stock|ready|warehouse/, "COLD"],
  [/full|filled|kegged|racked|packaged/, "FILLED"],
  [/clean|empty|available|idle|washed/, "EMPTY"],
];

/** A status from the old app's words. "Lost" / "retired" come back as inactive. */
export function parseStatus(v: unknown): { status: KegStatus | null; inactive: boolean } {
  const s = norm(text(v));
  if (!s) return { status: null, inactive: false };
  if (/lost|retired|scrap|stolen|missing|damaged|disposed|archiv|inactive/.test(s)) return { status: null, inactive: true };
  return { status: STATUS_WORDS.find(([re]) => re.test(s))?.[1] ?? null, inactive: false };
}

export type ImportAction = "FILLED" | "STORED" | "MOVED" | "TAPPED" | "KICKED" | "OUT" | "RETURNED" | "CLEANED" | "CREATED" | "NOTE";

const ACTION_WORDS: [RegExp, ImportAction][] = [
  [/maint|repair|inspect|valve|spear|pressure test|service|seal/, "NOTE"],
  [/kick|blown|emptied|ran out|empty/, "KICKED"],
  [/tap/, "TAPPED"],
  [/return|pick(ed)? ?up|collect|received back|check ?in/, "RETURNED"],
  [/deliver|ship|dispatch|sold|out\b|check ?out|sent|consign|order/, "OUT"],
  [/clean|wash|sanit/, "CLEANED"],
  [/fill|kegg|rack|packag/, "FILLED"],
  [/cold|cooler|walk.?in|stor/, "STORED"],
  [/move|transfer|locat|relocat|scan/, "MOVED"],
  [/creat|regist|add|new keg|purchas/, "CREATED"],
];

export function parseAction(v: unknown): ImportAction | null {
  const s = norm(text(v));
  if (!s) return null;
  return ACTION_WORDS.find(([re]) => re.test(s))?.[1] ?? null;
}

/** Where an action leaves the keg. */
export const ACTION_STATUS: Record<ImportAction, KegStatus | null> = {
  FILLED: "FILLED", STORED: "COLD", MOVED: null, TAPPED: "ON_TAP", KICKED: "KICKED", OUT: "OUT", RETURNED: "CLEANING", CLEANED: "EMPTY", CREATED: "EMPTY", NOTE: null,
};

export function parseOwner(v: unknown): KegOwner | null {
  const s = norm(text(v));
  if (!s) return null;
  if (/deposit/.test(s)) return "DEPOSIT";
  if (/borrow|loan|rent|lease|other|3rd|third|partner/.test(s)) return "BORROWED";
  if (/ours|own|house|company|us\b|yes/.test(s)) return "OURS";
  return null;
}

export function parseBool(v: unknown): boolean | null {
  const s = norm(text(v));
  if (!s) return null;
  if (/^(y|yes|true|1|active|enabled|in service)$/.test(s)) return true;
  if (/^(n|no|false|0|inactive|disabled|retired|archived)$/.test(s)) return false;
  return null;
}

export function parseAccountKind(v: unknown): string {
  const s = norm(text(v));
  if (/distrib|wholesal/.test(s)) return "distributor";
  if (/restaur|kitchen|cafe|diner/.test(s)) return "restaurant";
  if (/consumer|retail customer|individual|person|private|home|event|party|wedding/.test(s)) return "consumer";
  if (/bar|pub|tavern|tap ?room|brewery|bottle shop|store|shop|venue/.test(s)) return "bar";
  return s ? "other" : "bar";
}

/** Small stable hash (FNV-1a) for import keys. */
export function stableHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

// ---- Plan --------------------------------------------------------------------------------------

export interface SourceSpec {
  source: RawSource;
  entity: EntityOrSkip;
  mapping: Mapping;
}

export interface PlanBeer { name: string; style: string | null; squareName: string | null; notes: string | null; extra: RawRecord | null }
export interface PlanBatch { code: string; beer: string | null; brewedOn: ISODate | null; packagedOn: ISODate | null; notes: string | null; extra: RawRecord | null }
export interface PlanAccount { name: string; kind: string; contact: string | null; email: string | null; phone: string | null; address: string | null; notes: string | null; extra: RawRecord | null }
export interface PlanKeg {
  /** The code on the old sticker, as printed. */
  legacyCode: string;
  sizeId: string | null;
  owner: KegOwner | null;
  status: KegStatus | null;
  active: boolean;
  beer: string | null;
  batch: string | null;
  filledOn: ISODate | null;
  bestBy: ISODate | null;
  area: string | null;
  spot: string | null;
  tapLine: number | null;
  account: string | null;
  notes: string | null;
  extra: RawRecord | null;
  /** Only seen in the history, not in a keg list. */
  fromHistory: boolean;
}
export interface PlanEvent {
  importKey: string;
  legacyCode: string;
  at: string;
  action: ImportAction;
  toStatus: KegStatus | null;
  beer: string | null;
  batch: string | null;
  account: string | null;
  area: string | null;
  user: string | null;
  note: string | null;
  extra: RawRecord | null;
}

export interface PlanIssue { level: "warn" | "note"; message: string }

export interface ImportPlan {
  beers: PlanBeer[];
  batches: PlanBatch[];
  accounts: PlanAccount[];
  spots: { area: string; name: string }[];
  kegs: PlanKeg[];
  events: PlanEvent[];
  issues: PlanIssue[];
  /** Per source: rows read and rows used. */
  sources: { name: string; entity: EntityOrSkip; rows: number; used: number }[];
}

/** Key a legacy code is deduped on. */
export const legacyKey = (code: string) => normalizeCode(code) || code.trim().toLowerCase();
const nameKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

const MAX_ISSUES = 60;

export function planKegImport(specs: SourceSpec[]): ImportPlan {
  const beers = new Map<string, PlanBeer>();
  const batches = new Map<string, PlanBatch>();
  const accounts = new Map<string, PlanAccount>();
  const spots = new Map<string, { area: string; name: string }>();
  const kegs = new Map<string, PlanKeg>();
  const events = new Map<string, PlanEvent>();
  const issues: PlanIssue[] = [];
  const counts = { badDate: 0, badStatus: new Set<string>(), badSize: new Set<string>(), badAction: new Set<string>() };
  const sources: ImportPlan["sources"] = [];

  const addBeer = (name: string | null, patch: Partial<PlanBeer> = {}) => {
    if (!name) return;
    const k = nameKey(name);
    const cur = beers.get(k) ?? { name: name.trim(), style: null, squareName: null, notes: null, extra: null };
    beers.set(k, mergeDefined(cur, patch));
  };
  const addAccount = (name: string | null, patch: Partial<PlanAccount> = {}) => {
    if (!name) return;
    const k = nameKey(name);
    const cur = accounts.get(k) ?? { name: name.trim(), kind: "bar", contact: null, email: null, phone: null, address: null, notes: null, extra: null };
    accounts.set(k, mergeDefined(cur, patch));
  };
  const addKeg = (code: string, patch: Partial<PlanKeg>, fromHistory: boolean) => {
    const k = legacyKey(code);
    const cur = kegs.get(k) ?? { legacyCode: code.trim(), sizeId: null, owner: null, status: null, active: true, beer: null, batch: null, filledOn: null, bestBy: null, area: null, spot: null, tapLine: null, account: null, notes: null, extra: null, fromHistory };
    const next = mergeDefined(cur, patch);
    if (!fromHistory) next.fromHistory = false;
    if (patch.extra && cur.extra) next.extra = { ...cur.extra, ...patch.extra };
    kegs.set(k, next);
  };

  for (const spec of specs) {
    const rows = spec.source.records.map((r) => flattenRecord(r));
    const used = { n: 0 };
    sources.push({ name: spec.source.name, entity: spec.entity, rows: rows.length, used: 0 });
    if (spec.entity === "skip") continue;
    const m = spec.mapping;
    const mapped = new Set(Object.values(m).filter(Boolean) as string[]);
    const get = (r: RawRecord, f: Field) => (m[f] ? text(r[m[f]!]) || null : null);
    const extraOf = (r: RawRecord): RawRecord | null => {
      const e: RawRecord = {};
      for (const [k, v] of Object.entries(r)) if (!mapped.has(k) && v !== "" && v != null) e[k] = v instanceof Date ? v.toISOString() : v;
      return Object.keys(e).length ? { [spec.source.name]: e } : null;
    };
    const missing = REQUIRED[spec.entity].filter((f) => !m[f]);
    if (missing.length) {
      issues.push({ level: "warn", message: `${spec.source.name}: pick the ${missing.map((f) => FIELD_LABEL[f]).join(" and ")} column, or skip it.` });
      continue;
    }

    rows.forEach((r, i) => {
      const row = `${spec.source.name} row ${i + 2}`;
      switch (spec.entity) {
        case "beers": {
          const name = get(r, "name");
          if (!name) return;
          const abv = get(r, "abv");
          addBeer(name, { style: get(r, "style"), squareName: get(r, "squareName"), notes: [get(r, "notes"), abv ? `ABV ${abv}` : null].filter(Boolean).join(" · ") || null, extra: extraOf(r) });
          used.n++;
          return;
        }
        case "batches": {
          const code = get(r, "code");
          if (!code) return;
          const beer = get(r, "beer");
          addBeer(beer);
          const k = nameKey(code);
          batches.set(k, mergeDefined(batches.get(k) ?? { code, beer: null, brewedOn: null, packagedOn: null, notes: null, extra: null }, { beer, brewedOn: isoDay(parseWhen(get(r, "brewedOn"))), packagedOn: isoDay(parseWhen(get(r, "packagedOn"))), notes: get(r, "notes"), extra: extraOf(r) }));
          used.n++;
          return;
        }
        case "accounts": {
          const name = get(r, "name");
          if (!name) return;
          addAccount(name, { kind: m.kind ? parseAccountKind(get(r, "kind")) : undefined, contact: get(r, "contact"), email: get(r, "email"), phone: get(r, "phone"), address: get(r, "address"), notes: get(r, "notes"), extra: extraOf(r) });
          used.n++;
          return;
        }
        case "locations": {
          const area = get(r, "area");
          if (!area) return;
          const spot = get(r, "spot");
          if (spot) spots.set(`${nameKey(area)}|${nameKey(spot)}`, { area, name: spot });
          else spots.set(`${nameKey(area)}|`, { area, name: "" });
          used.n++;
          return;
        }
        case "kegs": {
          const code = get(r, "code");
          if (!code) return;
          const st = parseStatus(get(r, "status"));
          const rawStatus = get(r, "status");
          if (rawStatus && !st.status && !st.inactive) counts.badStatus.add(rawStatus);
          const rawSize = get(r, "size");
          const sizeId = parseKegSize(rawSize);
          if (rawSize && !sizeId) counts.badSize.add(rawSize);
          const beer = get(r, "beer"), account = get(r, "account"), batch = get(r, "batch");
          addBeer(beer);
          addAccount(account);
          const tap = Number((get(r, "tapLine") ?? "").replace(/\D+/g, ""));
          const active = st.inactive ? false : parseBool(get(r, "active"));
          addKeg(code, {
            sizeId, owner: parseOwner(get(r, "owner")), status: st.status, active: active ?? undefined, beer, batch,
            filledOn: isoDay(parseWhen(get(r, "filledOn"))), bestBy: isoDay(parseWhen(get(r, "bestBy"))),
            area: get(r, "area"), spot: get(r, "spot"), tapLine: Number.isFinite(tap) && tap > 0 && tap < 100 ? tap : null, account, notes: get(r, "notes"), extra: extraOf(r),
          }, false);
          const area = get(r, "area"), spot = get(r, "spot");
          if (area && spot) spots.set(`${nameKey(area)}|${nameKey(spot)}`, { area, name: spot });
          used.n++;
          return;
        }
        case "deliveries":
        case "returns":
        case "events": {
          const code = get(r, "code");
          const at = parseWhen(get(r, "date"));
          if (!code) return;
          if (!at) {
            counts.badDate++;
            if (counts.badDate <= 3) issues.push({ level: "warn", message: `${row}: couldn't read the date "${get(r, "date") ?? ""}", so it's left out.` });
            return;
          }
          const rawAction = spec.entity === "events" ? get(r, "action") : null;
          let action: ImportAction | null = spec.entity === "deliveries" ? "OUT" : spec.entity === "returns" ? "RETURNED" : parseAction(rawAction);
          const st = parseStatus(get(r, "status"));
          if (!action && st.status) action = st.status === "ON_TAP" ? "TAPPED" : st.status === "OUT" ? "OUT" : st.status === "CLEANING" ? "RETURNED" : st.status === "EMPTY" ? "CLEANED" : st.status === "KICKED" ? "KICKED" : st.status === "COLD" ? "STORED" : "FILLED";
          if (!action) {
            if (rawAction) counts.badAction.add(rawAction);
            action = "NOTE";
          }
          const beer = get(r, "beer"), account = get(r, "account"), batch = get(r, "batch"), area = get(r, "area");
          addBeer(beer);
          addAccount(account);
          addKeg(code, {}, true);
          const note = [action === "NOTE" && rawAction ? rawAction : null, get(r, "orderRef") ? `Order ${get(r, "orderRef")}` : null, get(r, "notes")].filter(Boolean).join(" · ") || null;
          const importKey = `imp:${stableHash([spec.entity, legacyKey(code), at, action, account ?? "", rawAction ?? "", get(r, "orderRef") ?? ""].join("|"))}`;
          events.set(importKey, { importKey, legacyCode: code, at, action, toStatus: ACTION_STATUS[action], beer, batch, account, area, user: get(r, "user"), note, extra: extraOf(r) });
          used.n++;
          return;
        }
      }
    });
    sources[sources.length - 1].used = used.n;
  }

  // Batches name a beer: a keg with a batch but no beer gets the batch's beer.
  for (const k of kegs.values()) if (!k.beer && k.batch) k.beer = batches.get(nameKey(k.batch))?.beer ?? null;
  for (const e of events.values()) if (!e.beer && e.batch) e.beer = batches.get(nameKey(e.batch))?.beer ?? null;

  // A keg only seen in the history takes its state from its latest event.
  const byKeg = new Map<string, PlanEvent[]>();
  for (const e of events.values()) byKeg.set(legacyKey(e.legacyCode), [...(byKeg.get(legacyKey(e.legacyCode)) ?? []), e]);
  for (const [key, evs] of byKeg) {
    const k = kegs.get(key);
    if (!k) continue;
    evs.sort((a, b) => a.at.localeCompare(b.at));
    if (!k.status) {
      const last = [...evs].reverse().find((e) => e.toStatus);
      if (last) {
        k.status = last.toStatus;
        if (!k.account && last.toStatus === "OUT") k.account = last.account;
        if (!k.beer && (last.toStatus === "FILLED" || last.toStatus === "ON_TAP" || last.toStatus === "OUT" || last.toStatus === "COLD")) k.beer = [...evs].reverse().find((e) => e.beer)?.beer ?? null;
      }
    }
  }

  if (counts.badDate > 3) issues.push({ level: "warn", message: `${counts.badDate} history rows had a date we couldn't read and are left out.` });
  if (counts.badStatus.size) issues.push({ level: "note", message: `Statuses we didn't recognise (kept in the keg's notes, status left as is): ${[...counts.badStatus].slice(0, 8).join(", ")}.` });
  if (counts.badSize.size) issues.push({ level: "note", message: `Sizes we didn't recognise (set to 1/2 bbl, fix on the keg): ${[...counts.badSize].slice(0, 8).join(", ")}.` });
  if (counts.badAction.size) issues.push({ level: "note", message: `History entries we kept as notes: ${[...counts.badAction].slice(0, 8).join(", ")}.` });
  const histOnly = [...kegs.values()].filter((k) => k.fromHistory).length;
  if (histOnly) issues.push({ level: "note", message: `${histOnly} keg${histOnly === 1 ? " is" : "s are"} only in the history, not a keg list. ${histOnly === 1 ? "It's" : "They're"} added with the size set to 1/2 bbl.` });

  return {
    beers: [...beers.values()],
    batches: [...batches.values()],
    accounts: [...accounts.values()],
    spots: [...spots.values()],
    kegs: [...kegs.values()],
    events: [...events.values()].sort((a, b) => a.at.localeCompare(b.at)),
    issues: issues.slice(0, MAX_ISSUES),
    sources,
  };
}

/** Copy only the fields that have a value, so a later, sparser row doesn't blank an earlier one. */
function mergeDefined<T extends object>(base: T, patch: Partial<T>): T {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch) as [keyof T, T[keyof T]][]) if (v !== undefined && v !== null && v !== "") out[k] = v;
  return out;
}

// ---- Fills from history ----------------------------------------------------------------------------

export interface HistoryFill {
  beer: string | null;
  batch: string | null;
  filledOn: string | null;
  tappedAt: string | null;
  kickedAt: string | null;
}

/**
 * Rebuild one keg's fills from its history (oldest first): a fill starts at
 * FILLED (or a TAPPED with no fill open) and ends at KICKED, OUT or CLEANED.
 * Kicked fills with a tap time calibrate the yield estimate.
 */
export function fillsFromHistory(events: Pick<PlanEvent, "at" | "action" | "beer" | "batch">[]): HistoryFill[] {
  const out: HistoryFill[] = [];
  let open: HistoryFill | null = null;
  const close = () => { if (open) out.push(open); open = null; };
  for (const e of [...events].sort((a, b) => a.at.localeCompare(b.at))) {
    if (e.action === "FILLED") {
      close();
      open = { beer: e.beer, batch: e.batch, filledOn: e.at, tappedAt: null, kickedAt: null };
    } else if (e.action === "TAPPED") {
      if (!open || open.tappedAt) { close(); open = { beer: e.beer, batch: e.batch, filledOn: null, tappedAt: e.at, kickedAt: null }; }
      else { open.tappedAt = e.at; open.beer ??= e.beer; }
    } else if (e.action === "KICKED") {
      if (open) { open.kickedAt = e.at; close(); }
    } else if (e.action === "OUT" || e.action === "CLEANED" || e.action === "RETURNED") {
      if (open && e.action === "OUT") open.beer ??= e.beer;
      close();
    }
  }
  close();
  return out;
}
