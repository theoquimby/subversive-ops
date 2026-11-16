/**
 * Keg history as a long, server-paged list: what the address says to show,
 * how "who" is keyed, the cursor for "Load older", and the date presets.
 * Pure; the query is built in server/services/kegHistory.
 */

import { addDays, type ISODate } from "./dates";

/** Entries per page: the newest this many, then "Load older" fetches the next. */
export const HISTORY_PAGE = 200;
/** The most one CSV download holds. */
export const HISTORY_CSV_MAX = 20_000;

/** "Who" for entries with no person: brought in by an import, or made by the app itself. */
export const WHO_IMPORTED = "_import";
export const WHO_NOBODY = "_none";
/** Beer filter value for entries with no beer (moves of empty kegs, cleaning). */
export const NO_BEER = "_none";

export interface HistoryParams {
  /** Search: one keg's code or old sticker shows that keg; anything else searches the entries. */
  q: string;
  /** One keg by id (links from a keg carry this). */
  keg: string | null;
  actions: string[];
  beers: string[];
  who: string[];
  accounts: string[];
  /** Business days, both included. */
  from: ISODate | null;
  to: ISODate | null;
}

type Raw = Record<string, string | string[] | undefined> | URLSearchParams;

const get = (sp: Raw, k: string): string => {
  const v = sp instanceof URLSearchParams ? sp.get(k) : sp[k];
  return (Array.isArray(v) ? v[0] : v ?? "").trim();
};
const list = (sp: Raw, k: string, max = 40) =>
  [...new Set(get(sp, k).split(",").map((s) => s.trim()).filter((s) => s && s.length <= 120))].slice(0, max);
const isDay = (s: string): s is ISODate => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const ACTION = /^[A-Z_]{2,20}$/;

/** The address → what to show. Anything malformed is dropped, never trusted. */
export function parseHistoryParams(sp: Raw): HistoryParams {
  let from = get(sp, "from");
  let to = get(sp, "to");
  const f = isDay(from) ? from : null;
  const t = isDay(to) ? to : null;
  [from, to] = f && t && f > t ? [t, f] : [f ?? "", t ?? ""];
  const keg = get(sp, "keg");
  return {
    q: get(sp, "q").slice(0, 120),
    keg: /^[a-z0-9]{6,40}$/i.test(keg) ? keg : null,
    actions: list(sp, "action").map((a) => a.toUpperCase()).filter((a) => ACTION.test(a)),
    beers: list(sp, "beer"),
    who: list(sp, "who"),
    accounts: list(sp, "account"),
    from: (from || null) as ISODate | null,
    to: (to || null) as ISODate | null,
  };
}

/** Is anything narrowing the list (beyond the newest-first default)? */
export const historyFiltered = (p: HistoryParams) => !!(p.q || p.keg || p.actions.length || p.beers.length || p.who.length || p.accounts.length || p.from || p.to);

/** The "who" filter key for an entry. */
export function whoKey(e: { userName: string | null; importKey: string | null }): string {
  if (e.userName?.trim()) return e.userName.trim();
  return e.importKey ? WHO_IMPORTED : WHO_NOBODY;
}

export function whoLabel(key: string): string {
  return key === WHO_IMPORTED ? "Imported" : key === WHO_NOBODY ? "The app" : key;
}

/** Search words, at most a few, each matched somewhere in an entry. */
export function searchTokens(q: string): string[] {
  return q.trim().split(/\s+/).filter((t) => t.length > 0).slice(0, 4).map((t) => t.slice(0, 60));
}

// ---- Paging ---------------------------------------------------------------------------------------

/** Where the loaded page ends: entries strictly older than this come next (newest first, ties by id). */
export interface HistoryCursor {
  at: string;
  id: string;
}

export function encodeCursor(c: HistoryCursor): string {
  return `${c.at}|${c.id}`;
}

export function decodeCursor(raw: unknown): HistoryCursor | null {
  if (typeof raw !== "string") return null;
  const [at, id, extra] = raw.split("|");
  if (extra !== undefined || !at || !id || !/^[a-z0-9]{6,40}$/i.test(id) || Number.isNaN(Date.parse(at))) return null;
  return { at: new Date(at).toISOString(), id };
}

/** One page from `size + 1` fetched rows: the page, and the cursor for the next one when there is more. */
export function pageOf<T extends { id: string; at: Date | string }>(fetched: T[], size: number): { rows: T[]; next: string | null } {
  const rows = fetched.slice(0, size);
  const last = rows[rows.length - 1];
  return { rows, next: fetched.length > size && last ? encodeCursor({ at: new Date(last.at).toISOString(), id: last.id }) : null };
}

// ---- Dates ----------------------------------------------------------------------------------------

export interface DatePreset {
  id: string;
  label: string;
  from: ISODate;
  to: ISODate;
}

/** Quick ranges for the date filter, ending today. */
export function historyDatePresets(today: ISODate): DatePreset[] {
  return [
    { id: "today", label: "Today", from: today, to: today },
    { id: "7", label: "Last 7 days", from: addDays(today, -6), to: today },
    { id: "30", label: "Last 30 days", from: addDays(today, -29), to: today },
    { id: "year", label: "This year", from: `${today.slice(0, 4)}-01-01`, to: today },
  ];
}
