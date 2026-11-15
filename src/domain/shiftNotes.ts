/**
 * Shift notes (the end-of-shift handoff): quick chips, which shift a note is
 * for, parsing what people type, the one-line summary the brief and the
 * Overview show, and what still needs a manager. Pure.
 */

import { addDays, ISODate } from "./dates";

export const SHIFTS = [
  { value: "open", label: "Open" },
  { value: "mid", label: "Mid" },
  { value: "close", label: "Close" },
] as const;
export type ShiftKind = (typeof SHIFTS)[number]["value"];
export const isShiftKind = (s: string): s is ShiftKind => SHIFTS.some((x) => x.value === s);
export const shiftLabel = (s: string) => SHIFTS.find((x) => x.value === s)?.label ?? "Shift";

export type ChipKind = "pace" | "team" | "guest" | "maintenance";

/** One-tap chips for the things that come up most nights. Maintenance chips also count as a follow-up. */
export const CHIPS: { label: string; kind: ChipKind }[] = [
  { label: "Slammed", kind: "pace" },
  { label: "Steady", kind: "pace" },
  { label: "Quiet", kind: "pace" },
  { label: "Big party", kind: "guest" },
  { label: "Guest complaint", kind: "guest" },
  { label: "Short-staffed", kind: "team" },
  { label: "Call-out", kind: "team" },
  { label: "Walk-in warm", kind: "maintenance" },
  { label: "Ice machine", kind: "maintenance" },
  { label: "Dish machine", kind: "maintenance" },
  { label: "Draft lines", kind: "maintenance" },
  { label: "Square / POS", kind: "maintenance" },
  { label: "Plumbing", kind: "maintenance" },
];

const CHIP_KIND = new Map(CHIPS.map((c) => [c.label.toLowerCase(), c.kind]));
export const chipKind = (tag: string): ChipKind | null => CHIP_KIND.get(tag.trim().toLowerCase()) ?? null;

/**
 * The business date a note covers. A closer writing after midnight (before
 * `rollHour`, default 5am) is still writing about the night before.
 */
export function shiftDateFor(localDate: ISODate, localHour: number, rollHour = 5): ISODate {
  return localHour < rollHour ? addDays(localDate, -1) : localDate;
}

/** The shift people are most likely writing about at this hour. */
export function defaultShift(localHour: number): ShiftKind {
  if (localHour >= 5 && localHour < 14) return "open";
  if (localHour >= 14 && localHour < 18) return "mid";
  return "close";
}

/** "wings, IPA\nfries" → ["Wings", "IPA", "Fries"]: trimmed, de-duplicated (case-insensitive), first letter up. */
export function parseItems(text: string | readonly string[]): string[] {
  const raw = typeof text === "string" ? text.split(/[,;\n]+/) : text;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    const t = r.replace(/\s+/g, " ").trim().slice(0, 80);
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t[0].toUpperCase() + t.slice(1));
  }
  return out.slice(0, 30);
}

/**
 * Over/short as people type it: "5", "+5", "-5", "$5 short", "short 5", "over 3.50",
 * "even" → 0. Positive is over, negative short. Null for empty, "invalid" when unreadable.
 */
export function parseOverShort(raw: string | null | undefined): number | null | "invalid" {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return null;
  if (/^(even|balanced|0|\$?0(\.0+)?)$/.test(s)) return 0;
  const m = s.replace(/[$,\s]/g, "").match(/^(short|over|-|\+|−)?(\d+(?:\.\d{1,2})?)(short|over)?$/);
  if (!m) return "invalid";
  const n = Number(m[2]);
  const neg = m[1] === "short" || m[1] === "-" || m[1] === "−" || m[3] === "short";
  return neg ? -n : n;
}

/** "$24", "24.50" → 24.5; null when empty; "invalid" when unreadable or negative. */
export function parseAmount(raw: string | null | undefined): number | null | "invalid" {
  const s = (raw ?? "").replace(/[$,\s]/g, "");
  if (!s) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return "invalid";
  return Number(s);
}

export interface NoteLike {
  date: ISODate;
  shift: string;
  authorName: string;
  eightySixed: string[];
  issues: string | null;
  comps: string | null;
  compsAmount: number | null;
  cash: string | null;
  cashOverShort: number | null;
  maintenance: string | null;
  notes: string | null;
  tags: string[];
  handledAt: Date | string | null;
}

const has = (s: string | null | undefined) => !!s && s.trim().length > 0;
const money = (n: number) => `$${(Math.round(Math.abs(n) * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

/** Maintenance chips picked on the note. */
export const maintenanceTags = (n: Pick<NoteLike, "tags">) => n.tags.filter((t) => chipKind(t) === "maintenance");

/** Something a manager should follow up on: an issue, maintenance (typed or a chip), or a drawer short. */
export function needsFollowUp(n: NoteLike, cashShortAt = 5): boolean {
  if (n.handledAt) return false;
  return has(n.issues) || has(n.maintenance) || maintenanceTags(n).length > 0 || (n.cashOverShort != null && n.cashOverShort <= -cashShortAt);
}

/** "Drawer even", "Drawer $5 short", "Drawer $2 over" (null when not counted and no note). */
export function drawerLabel(n: Pick<NoteLike, "cashOverShort" | "cash">): string | null {
  if (n.cashOverShort == null) return has(n.cash) ? "Drawer note" : null;
  if (Math.abs(n.cashOverShort) < 0.005) return "Drawer even";
  return `Drawer ${money(n.cashOverShort)} ${n.cashOverShort < 0 ? "short" : "over"}`;
}

/** The pieces of a note worth a glance, in reading order, for the brief and the Overview. */
export function noteHighlights(n: NoteLike): { key: string; text: string; tone: "bad" | "warn" | "neutral" }[] {
  const out: { key: string; text: string; tone: "bad" | "warn" | "neutral" }[] = [];
  if (n.eightySixed.length) out.push({ key: "86", text: `86'd ${n.eightySixed.slice(0, 4).join(", ")}${n.eightySixed.length > 4 ? ` +${n.eightySixed.length - 4}` : ""}`, tone: "warn" });
  const fix = [...maintenanceTags(n), ...(has(n.maintenance) ? [n.maintenance!.trim()] : [])];
  if (fix.length) out.push({ key: "maintenance", text: `Fix: ${fix.join(" · ")}`, tone: n.handledAt ? "neutral" : "warn" });
  if (has(n.issues)) out.push({ key: "issues", text: n.issues!.trim(), tone: n.handledAt ? "neutral" : "warn" });
  if (n.compsAmount != null && n.compsAmount > 0) out.push({ key: "comps", text: `${money(n.compsAmount)} comps${has(n.comps) ? `: ${n.comps!.trim()}` : ""}`, tone: "neutral" });
  else if (has(n.comps)) out.push({ key: "comps", text: `Comps: ${n.comps!.trim()}`, tone: "neutral" });
  const d = drawerLabel(n);
  if (d && d !== "Drawer even") out.push({ key: "cash", text: `${d}${has(n.cash) && d !== "Drawer note" ? ` (${n.cash!.trim()})` : has(n.cash) ? `: ${n.cash!.trim()}` : ""}`, tone: n.cashOverShort != null && n.cashOverShort < -0.005 ? "bad" : "neutral" });
  if (has(n.notes)) out.push({ key: "notes", text: n.notes!.trim(), tone: "neutral" });
  return out;
}

/** One line: "Slammed · 86'd wings, IPA · $24 comps · drawer $5 short". */
export function noteSummary(n: NoteLike, max = 160): string {
  const pace = n.tags.filter((t) => chipKind(t) !== "maintenance");
  const parts = [...pace, ...noteHighlights(n).map((h) => h.text)];
  const s = parts.join(" · ") || "No problems";
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** Totals across a night's notes, for the "Yesterday" line. */
export function nightTotals(notes: readonly NoteLike[]) {
  const items = new Set<string>();
  for (const n of notes) for (const i of n.eightySixed) items.add(i.toLowerCase());
  const counted = notes.filter((n) => n.cashOverShort != null);
  return {
    eightySixed: items.size,
    compsAmount: notes.reduce((s, n) => s + (n.compsAmount ?? 0), 0),
    cashOverShort: counted.length ? counted.reduce((s, n) => s + n.cashOverShort!, 0) : null,
    issues: notes.filter((n) => has(n.issues)).length,
    maintenance: notes.filter((n) => has(n.maintenance) || maintenanceTags(n).length > 0).length,
  };
}

/**
 * Which notes the morning brief shows as "last night": the most recent
 * business date before today that has any (up to `lookback` days back), plus
 * any already written today.
 */
export function lastNightNotes<T extends Pick<NoteLike, "date">>(notes: readonly T[], today: ISODate, lookback = 3): T[] {
  const earliest = addDays(today, -lookback);
  const past = notes.filter((n) => n.date < today && n.date >= earliest).map((n) => n.date).sort();
  const latest = past.at(-1);
  return notes.filter((n) => n.date === today || (latest != null && n.date === latest));
}

/** Words to search a note by (all its text fields and chips), lower-case. */
export function noteText(n: NoteLike): string {
  return [n.authorName, ...n.eightySixed, n.issues, n.comps, n.cash, n.maintenance, n.notes, ...n.tags].filter(Boolean).join(" ").toLowerCase();
}

/** Every word of the query appears somewhere in the note. */
export function matchesQuery(n: NoteLike, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const t = noteText(n);
  return words.every((w) => t.includes(w));
}

/** Most-used 86'd items lately, for one-tap suggestions. */
export function frequentItems(notes: readonly Pick<NoteLike, "eightySixed">[], limit = 8): string[] {
  const count = new Map<string, { label: string; n: number }>();
  for (const note of notes) for (const i of note.eightySixed) {
    const k = i.toLowerCase();
    const c = count.get(k);
    if (c) c.n++;
    else count.set(k, { label: i, n: 1 });
  }
  return [...count.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label)).slice(0, limit).map((c) => c.label);
}
