/**
 * "Ask" — plain-English questions about the business, answered from a fixed
 * set of read-only data tools. Claude picks tools when a key is configured;
 * without one, these pure helpers route a question (or a suggested-question
 * button) to the same tools deterministically.
 */

import { addDays, ISODate } from "./dates";
import { weekStartOf } from "./schedule";

export type AskToolName = "period_kpis" | "menu_margins" | "price_moves" | "margin_gap" | "schedule_week" | "order_plans" | "waste_summary" | "cert_status";

export interface Period {
  from: ISODate;
  /** Exclusive. */
  to: ISODate;
  label: string;
}

const monthStart = (d: ISODate) => `${d.slice(0, 7)}-01`;
function addMonths(first: ISODate, n: number): ISODate {
  const y = Number(first.slice(0, 4));
  const m = Number(first.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, "0")}-01`;
}

/** Named periods, all ending before today unless they're "today"/"this …" (which include finished days only). */
export function namedPeriod(name: string, today: ISODate): Period | null {
  const n = name.trim().toLowerCase();
  const mon = weekStartOf(today);
  const m = /^last (\d{1,3}) days$/.exec(n);
  if (m) {
    const k = Math.min(366, Math.max(1, Number(m[1])));
    return { from: addDays(today, -k), to: today, label: `Last ${k} days` };
  }
  switch (n) {
    case "today":
      return { from: today, to: addDays(today, 1), label: "Today" };
    case "yesterday":
      return { from: addDays(today, -1), to: today, label: "Yesterday" };
    case "this week":
      return { from: mon, to: addDays(mon, 7), label: "This week" };
    case "last week":
      return { from: addDays(mon, -7), to: mon, label: "Last week" };
    case "this month":
      return { from: monthStart(today), to: addMonths(monthStart(today), 1), label: "This month" };
    case "last month":
      return { from: addMonths(monthStart(today), -1), to: monthStart(today), label: "Last month" };
    case "next week":
      return { from: addDays(mon, 7), to: addDays(mon, 14), label: "Next week" };
    default:
      return null;
  }
}

/** First period phrase found in free text ("…food cost last week?"), or null. */
export function findPeriod(text: string, today: ISODate): Period | null {
  const t = text.toLowerCase();
  const days = /(?:last|past) (\d{1,3}) days/.exec(t);
  if (days) return namedPeriod(`last ${days[1]} days`, today);
  for (const p of ["yesterday", "today", "last week", "this week", "next week", "last month", "this month"]) if (t.includes(p)) return namedPeriod(p, today);
  return null;
}

export interface RoutedQuestion {
  tool: AskToolName;
  args: Record<string, string | number>;
}

/**
 * Keyword routing for the no-key path. Returns null when it can't tell, so the
 * page can show the suggested questions instead of guessing.
 */
export function routeQuestion(text: string, today: ISODate): RoutedQuestion | null {
  const t = text.toLowerCase();
  const period = findPeriod(t, today);
  const has = (...w: string[]) => w.some((x) => t.includes(x));
  // Certificates first: "who's missing harassment training" isn't a margin gap.
  const cert = certQuestion(t);
  if (cert) return { tool: "cert_status", args: cert };
  if (has("hours", "overtime", "schedule", "who's working", "who is working", "shifts")) {
    const wk = period ? weekStartOf(period.from) : weekStartOf(today);
    const over = /over (\d{1,2}) ?(?:h|hours)/.exec(t);
    return { tool: "schedule_week", args: { week_start: wk, ...(over ? { over_hours: Number(over[1]) } : {}) } };
  }
  if (has("order", "deliver", "supplier", "truck")) return { tool: "order_plans", args: {} };
  if (has("price", "went up", "increase", "cost more", "spike")) return { tool: "price_moves", args: { days: period ? Math.max(1, Math.round((Date.parse(period.to) - Date.parse(period.from)) / 864e5)) : 30 } };
  if (has("margin", "plate cost", "menu item", "items lost", "which items", "dish")) return { tool: "menu_margins", args: {} };
  if (has("variance", "gap", "missing", "shrink", "theft", "usage")) return { tool: "margin_gap", args: {} };
  if (has("waste", "thrown", "tossed", "spoil")) return { tool: "waste_summary", args: { days: period ? Math.max(1, Math.round((Date.parse(period.to) - Date.parse(period.from)) / 864e5)) : 30 } };
  if (has("food cost", "sales", "labor", "prime", "profit", "revenue", "beverage cost", "how did we do", "cogs")) {
    const p = period ?? namedPeriod("last week", today)!;
    return { tool: "period_kpis", args: { from: p.from, to: p.to } };
  }
  return null;
}

/** Certificate words that make a question about training, with the type and status it names (if any). */
const CERT_WORDS: [RegExp, string][] = [
  [/\batap\b|alcohol training/, "ATAP"],
  [/food handler/, "Food Handler"],
  [/food protection|food manager/, "Food Protection"],
  [/servsafe/, "ServSafe"],
  [/allergen (awareness|training|cert)/, "Allergen"],
  [/\bcpr\b|first aid/, "First aid"],
  [/harass/, "harassment"],
  [/working papers|employment certificate/, "Working papers"],
];

export function certQuestion(text: string): { cert?: string; status?: string } | null {
  const t = text.toLowerCase();
  const hit = CERT_WORDS.find(([re]) => re.test(t));
  const generic = /\bcert(ificat(e|es|ion|ions))?s?\b|\btraining\b|\bcompliant\b|\bcompliance\b/.test(t) && !/food cost|labor|sales/.test(t);
  if (!hit && !generic) return null;
  const status = /expired|lapsed|out of date/.test(t) ? "expired" : /expir|renew|soon|coming up/.test(t) ? "expiring" : /missing|doesn'?t have|don'?t have|without|hasn'?t|haven'?t|need/.test(t) ? "missing" : /who('s| is)? (not|out)|problem|attention|behind/.test(t) ? "attention" : undefined;
  return { ...(hit ? { cert: hit[1] } : {}), ...(status ? { status } : {}) };
}

export interface SuggestedQuestion {
  label: string;
  route: (today: ISODate) => RoutedQuestion;
}

const kp = (name: string) => (today: ISODate): RoutedQuestion => {
  const p = namedPeriod(name, today)!;
  return { tool: "period_kpis", args: { from: p.from, to: p.to } };
};

export const SUGGESTED_QUESTIONS: SuggestedQuestion[] = [
  { label: "What was food cost last week?", route: kp("last week") },
  { label: "How are we doing this month?", route: kp("this month") },
  { label: "Which items lost margin this month?", route: () => ({ tool: "menu_margins", args: {} }) },
  { label: "What went up in price lately?", route: () => ({ tool: "price_moves", args: { days: 30 } }) },
  { label: "Who's over 35 hours this week?", route: (today) => ({ tool: "schedule_week", args: { week_start: weekStartOf(today), over_hours: 35 } }) },
  { label: "Where's the margin gap since the last count?", route: () => ({ tool: "margin_gap", args: {} }) },
  { label: "What do I need to order next?", route: () => ({ tool: "order_plans", args: {} }) },
  { label: "What did we throw out in the last 30 days?", route: () => ({ tool: "waste_summary", args: { days: 30 } }) },
  { label: "Whose certificates are expiring or expired?", route: () => ({ tool: "cert_status", args: { status: "attention" } }) },
];

/** Validate and clamp dates the model or a link passes in: YYYY-MM-DD, from < to, at most a year. */
export function clampPeriod(from: unknown, to: unknown, today: ISODate): Period {
  const ok = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
  let f = ok(from) ? from : addDays(weekStartOf(today), -7);
  let t = ok(to) ? to : addDays(f, 7);
  if (t <= f) t = addDays(f, 1);
  if (Date.parse(t) - Date.parse(f) > 366 * 864e5) f = addDays(t, -366);
  return { from: f, to: t, label: `${f} to ${addDays(t, -1)}` };
}
