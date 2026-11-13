/**
 * Pure logic behind the DataTable: search, filters, sort, grouping, selection
 * ranges, saved views (localStorage + URL) and CSV. No React, no DOM.
 */

// ---- Search -------------------------------------------------------------------

/** Lowercase, strip accents and collapse spaces so "Jalapeño" finds "jalapeno". */
export function normalize(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

const WORD = /[a-z0-9]+/g;

/** Every character of `needle` appears in order in `word`, starting at its first letter ("chkn" → "chicken"). */
function subsequenceOf(needle: string, word: string): boolean {
  if (!word.startsWith(needle[0])) return false;
  let i = 0;
  for (const ch of word) if (ch === needle[i] && ++i === needle.length) return true;
  return false;
}

/**
 * Score a query against a row's search text (already `normalize`d), or null for no match.
 * Each space-separated token must match: as a substring (best at a word start), or for
 * tokens of 3+ letters as an in-order abbreviation of one word. Higher is better.
 */
export function matchScore(query: string, haystack: string): number | null {
  const tokens = normalize(query).split(" ").filter(Boolean);
  if (!tokens.length) return 0;
  let score = 0;
  let words: string[] | null = null;
  for (const t of tokens) {
    const at = haystack.indexOf(t);
    if (at >= 0) {
      const wordStart = at === 0 || !/[a-z0-9]/.test(haystack[at - 1]);
      score += 10 + t.length + (wordStart ? 8 : 0) - Math.min(5, at / 20);
      continue;
    }
    if (t.length < 3) return null;
    words ??= haystack.match(WORD) ?? [];
    if (!words.some((w) => subsequenceOf(t, w))) return null;
    score += 3 + t.length * 0.5;
  }
  return score - haystack.length * 0.01;
}

// ---- Filters ------------------------------------------------------------------

/** Facet: values a row has (one or several). Toggle: a yes/no test. */
export type FilterSpec<T> =
  | { id: string; kind: "facet"; values: (row: T) => string | string[] | null | undefined }
  | { id: string; kind: "toggle"; test: (row: T) => boolean };

/** Active filters: facet id → chosen values (any of them matches); toggle id → [ "1" ]. */
export type FilterState = Record<string, string[]>;

const asArray = (v: string | string[] | null | undefined) => (v == null ? [] : Array.isArray(v) ? v : [v]);

export function passesFilters<T>(row: T, specs: FilterSpec<T>[], state: FilterState, skip?: string): boolean {
  for (const s of specs) {
    if (s.id === skip) continue;
    const chosen = state[s.id];
    if (!chosen?.length) continue;
    if (s.kind === "toggle") {
      if (!s.test(row)) return false;
    } else {
      const has = asArray(s.values(row));
      if (!chosen.some((c) => has.includes(c))) return false;
    }
  }
  return true;
}

export interface Searchable<T> {
  row: T;
  text: string;
}

/** Filter rows by query and filters. With a query, also returns each row's score (for relevance order). */
export function filterRows<T>(items: Searchable<T>[], query: string, specs: FilterSpec<T>[], state: FilterState): { row: T; score: number }[] {
  const q = query.trim();
  const out: { row: T; score: number }[] = [];
  for (const it of items) {
    if (!passesFilters(it.row, specs, state)) continue;
    const score = q ? matchScore(q, it.text) : 0;
    if (score == null) continue;
    out.push({ row: it.row, score });
  }
  return out;
}

/**
 * How many rows each facet value would show, given every *other* active filter and the
 * query (the usual faceted-search count, so picking a second value never shows 0 by surprise).
 */
export function facetCounts<T>(items: Searchable<T>[], query: string, specs: FilterSpec<T>[], state: FilterState, facetId: string): Map<string, number> {
  const spec = specs.find((s) => s.id === facetId);
  const counts = new Map<string, number>();
  if (!spec) return counts;
  const q = query.trim();
  for (const it of items) {
    if (!passesFilters(it.row, specs, state, facetId)) continue;
    if (q && matchScore(q, it.text) == null) continue;
    if (spec.kind === "toggle") {
      if (spec.test(it.row)) counts.set("1", (counts.get("1") ?? 0) + 1);
    } else for (const v of new Set(asArray(spec.values(it.row)))) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return counts;
}

export function toggleFilterValue(state: FilterState, id: string, value: string, single = false): FilterState {
  const cur = state[id] ?? [];
  const next = cur.includes(value) ? cur.filter((v) => v !== value) : single ? [value] : [...cur, value];
  const out = { ...state };
  if (next.length) out[id] = next;
  else delete out[id];
  return out;
}

export const activeFilterCount = (state: FilterState) => Object.values(state).filter((v) => v.length).length;

// ---- Sort ---------------------------------------------------------------------

export type SortDir = "asc" | "desc";
export interface SortSpec {
  id: string;
  dir: SortDir;
}
export type SortValue = string | number | boolean | null | undefined;

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/** Compare two sort values; empty values (null, undefined, "", NaN) always go last whatever the direction. */
export function compareValues(a: SortValue, b: SortValue, dir: SortDir): number {
  const ea = a == null || a === "" || (typeof a === "number" && Number.isNaN(a));
  const eb = b == null || b === "" || (typeof b === "number" && Number.isNaN(b));
  if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1;
  let c: number;
  if (typeof a === "number" && typeof b === "number") c = a - b;
  else if (typeof a === "boolean" && typeof b === "boolean") c = Number(a) - Number(b);
  else c = collator.compare(String(a), String(b));
  return dir === "asc" ? c : -c;
}

/** Stable multi-column sort. Unknown column ids are ignored. */
export function sortRows<T>(rows: T[], sorts: SortSpec[], valueOf: (row: T, columnId: string) => SortValue | undefined, known?: (id: string) => boolean): T[] {
  const active = sorts.filter((s) => !known || known(s.id));
  if (!active.length) return rows;
  const idx = rows.map((r, i) => ({ r, i, v: active.map((s) => valueOf(r, s.id)) }));
  idx.sort((x, y) => {
    for (let k = 0; k < active.length; k++) {
      const c = compareValues(x.v[k], y.v[k], active[k].dir);
      if (c) return c;
    }
    return x.i - y.i;
  });
  return idx.map((x) => x.r);
}

/**
 * Header click. Plain click: this column only, asc → desc → off. Shift-click: add it as
 * the next sort key, or flip/remove it if it's already in the list.
 */
export function toggleSort(sorts: SortSpec[], id: string, additive: boolean, firstDir: SortDir = "asc"): SortSpec[] {
  const cur = sorts.find((s) => s.id === id);
  const other: SortDir = firstDir === "asc" ? "desc" : "asc";
  if (!additive) {
    if (!cur || sorts.length > 1) return [{ id, dir: firstDir }];
    return cur.dir === firstDir ? [{ id, dir: other }] : [];
  }
  if (!cur) return [...sorts, { id, dir: firstDir }];
  if (cur.dir === firstDir) return sorts.map((s) => (s.id === id ? { id, dir: other } : s));
  return sorts.filter((s) => s.id !== id);
}

// ---- Groups -------------------------------------------------------------------

export interface Group<T> {
  key: string;
  rows: T[];
}

/** Group rows, keeping row order inside each group. Groups sort by key (empty key "" last) unless `order` says otherwise. */
export function groupRows<T>(rows: T[], keyOf: (row: T) => string | null | undefined, order?: (a: string, b: string) => number): Group<T>[] {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const k = keyOf(r) ?? "";
    const list = map.get(k);
    if (list) list.push(r);
    else map.set(k, [r]);
  }
  const keys = [...map.keys()].sort(order ?? ((a, b) => (a === "" ? 1 : b === "" ? -1 : collator.compare(a, b))));
  return keys.map((key) => ({ key, rows: map.get(key)! }));
}

// ---- Selection ----------------------------------------------------------------

/**
 * Shift-click from `anchor` to `target` over the rows in view: every row between them takes
 * the target's new state (selected unless it was already selected).
 */
export function selectRange(selected: ReadonlySet<string>, ordered: string[], anchor: string | null, target: string): Set<string> {
  const next = new Set(selected);
  const on = !selected.has(target);
  const a = anchor == null ? -1 : ordered.indexOf(anchor);
  const b = ordered.indexOf(target);
  if (a < 0 || b < 0) {
    if (on) next.add(target);
    else next.delete(target);
    return next;
  }
  const [from, to] = a < b ? [a, b] : [b, a];
  for (let i = from; i <= to; i++) {
    if (on) next.add(ordered[i]);
    else next.delete(ordered[i]);
  }
  return next;
}

// ---- Saved views --------------------------------------------------------------

export type Density = "compact" | "comfortable";

export interface ViewState {
  q: string;
  filters: FilterState;
  sort: SortSpec[];
  group: string | null;
  hidden: string[];
  density: Density;
  widths: Record<string, number>;
  collapsed: string[];
}

export const emptyView = (over: Partial<ViewState> = {}): ViewState => ({ q: "", filters: {}, sort: [], group: null, hidden: [], density: "comfortable", widths: {}, collapsed: [], ...over });

const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 200) : []);

/** Read a stored view, dropping anything malformed (old versions, hand-edited storage). */
export function parseView(raw: string | null | undefined, defaults: ViewState): ViewState {
  if (!raw) return defaults;
  let v: Record<string, unknown>;
  try {
    v = JSON.parse(raw);
  } catch {
    return defaults;
  }
  if (!v || typeof v !== "object") return defaults;
  const filters: FilterState = {};
  if (v.filters && typeof v.filters === "object") for (const [k, vals] of Object.entries(v.filters as object)) { const a = strArr(vals); if (a.length) filters[k] = a; }
  const sort = Array.isArray(v.sort) ? (v.sort as unknown[]).filter((s): s is SortSpec => !!s && typeof (s as SortSpec).id === "string" && ((s as SortSpec).dir === "asc" || (s as SortSpec).dir === "desc")).slice(0, 4) : defaults.sort;
  const widths: Record<string, number> = {};
  if (v.widths && typeof v.widths === "object") for (const [k, w] of Object.entries(v.widths as object)) if (typeof w === "number" && w >= 40 && w <= 1200) widths[k] = Math.round(w);
  return {
    q: typeof v.q === "string" ? v.q.slice(0, 200) : "",
    filters,
    sort,
    group: typeof v.group === "string" ? v.group : null,
    hidden: Array.isArray(v.hidden) ? strArr(v.hidden) : defaults.hidden,
    density: v.density === "compact" ? "compact" : "comfortable",
    widths,
    collapsed: strArr(v.collapsed),
  };
}

export const serializeView = (v: ViewState) => JSON.stringify(v);

/** Which filter ids live in the URL, and under what parameter name (e.g. prices' supplier → `supplier`). */
export type UrlParams = Record<string, string>;

/** Filters + query → URL params (other params are kept). Toggles are `name=1`; facets `name=a,b`. */
export function viewToParams(view: Pick<ViewState, "q" | "filters">, params: UrlParams, base: URLSearchParams = new URLSearchParams()): URLSearchParams {
  const out = new URLSearchParams(base);
  out.delete("q");
  for (const name of Object.values(params)) out.delete(name);
  if (view.q.trim()) out.set("q", view.q.trim());
  for (const [id, name] of Object.entries(params)) {
    const vals = view.filters[id];
    if (vals?.length) out.set(name, vals.join(","));
  }
  return out;
}

/** URL params → query + filters, or null when the URL says nothing about this table. */
export function paramsToView(search: URLSearchParams, params: UrlParams): Pick<ViewState, "q" | "filters"> | null {
  let any = false;
  const filters: FilterState = {};
  for (const [id, name] of Object.entries(params)) {
    const raw = search.get(name);
    if (raw == null) continue;
    any = true;
    const vals = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (vals.length) filters[id] = vals;
  }
  const q = search.get("q");
  if (q != null) any = true;
  return any ? { q: q ?? "", filters } : null;
}

// ---- CSV ----------------------------------------------------------------------

export type CsvCell = string | number | boolean | null | undefined;

const csvEscape = (v: CsvCell) => {
  if (v == null) return "";
  const s = typeof v === "number" ? (Number.isFinite(v) ? String(Math.round(v * 10000) / 10000) : "") : String(v);
  // Leading = + - @ would run as a formula in Excel; prefix a quote (OWASP CSV injection).
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function toCsv<T>(rows: T[], columns: { header: string; value: (row: T) => CsvCell }[]): string {
  const lines = [columns.map((c) => csvEscape(c.header)).join(",")];
  for (const r of rows) lines.push(columns.map((c) => csvEscape(c.value(r))).join(","));
  return lines.join("\r\n") + "\r\n";
}
