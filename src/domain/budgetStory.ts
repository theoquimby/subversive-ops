/**
 * Budgets in words: one word per week ("Hit", "Missed", "Not all in"), and the
 * verdict at the top of /budgets (how the last few finished weeks did against
 * their sales target). Pure.
 */

import type { Rag } from "./budgets";

export type WordTone = "good" | "warn" | "bad" | "neutral" | "unknown";

export interface WeekForWords {
  weekStart: string;
  when: "past" | "current" | "future";
  sales: number | null;
  sales_actual: number | null;
  status: { sales: Rag; laborPct: Rag; foodCostPct: Rag; overall: Rag };
  /** Finished days whose sales aren't in yet (domain/dayState). */
  notIn: number;
  /** Finished days so far (0 on a Monday for the current week). */
  daysIn: number;
}

/** A finished week hit or missed its targets; a week still running is on track or not; one with days not in can't tell. */
export function weekWord(w: WeekForWords): { word: string; tone: WordTone } {
  if (w.when === "future") return { word: w.sales == null ? "Not set" : "Planned", tone: "neutral" };
  if (w.notIn > 0) return { word: "Not all in", tone: "unknown" };
  const s = w.status.overall;
  if (s === "none") return { word: "No targets", tone: "neutral" };
  if (w.when === "current") {
    if (w.daysIn === 0) return { word: "Just started", tone: "neutral" };
    return { word: { good: "On track", warn: "Watch", bad: "Off track" }[s], tone: s };
  }
  return { word: { good: "Hit", warn: "Just missed", bad: "Missed" }[s], tone: s };
}

const pct0 = (x: number) => `${Math.round(Math.abs(x) * 100)}%`;
const whole = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** How the last `n` finished weeks with a sales target did, as the page's verdict. */
export function budgetVerdict(rows: readonly WeekForWords[], n = 4): { tone: WordTone; title: string; line: string; action: string | null } {
  const finished = rows.filter((r) => r.when === "past" && r.sales != null && r.sales > 0 && r.sales_actual != null && r.notIn === 0).slice(-n);
  const waiting = rows.filter((r) => r.when === "past" && r.notIn > 0).length;
  if (!finished.length) {
    return waiting
      ? { tone: "unknown", title: "Last week's sales aren't all in yet", line: `${waiting === 1 ? "A finished week has" : `${waiting} finished weeks have`} days still to come through from Square, so ${waiting === 1 ? "it isn't" : "they aren't"} judged against target yet.`, action: null }
      : { tone: "neutral", title: "No finished week has a sales target yet", line: "Set a weekly sales target below and each week is marked Hit or Missed once it's over.", action: "Type targets into the table, or fill the blank weeks from the forecast." };
  }
  const hit = finished.filter((r) => r.status.sales === "good").length;
  const sales = finished.reduce((s, r) => s + r.sales_actual!, 0);
  const target = finished.reduce((s, r) => s + r.sales!, 0);
  const off = sales / target - 1;
  const k = finished.length;
  const laborMissed = finished.filter((r) => r.status.laborPct === "bad" || r.status.laborPct === "warn").length;
  const tone: WordTone = hit === k ? "good" : hit * 2 >= k ? "neutral" : "warn";
  const title = hit === k ? `Sales hit the target in all of the last ${k} weeks` : hit === 0 ? `Sales missed the target in each of the last ${k} weeks` : `Sales hit the target in ${hit} of the last ${k} weeks`;
  const line = `Together ${whole(sales)} against ${whole(target)} of targets, ${Math.abs(off) < 0.005 ? "right on" : `${pct0(off)} ${off > 0 ? "over" : "under"}`}.${laborMissed ? ` Labor ran over its target in ${laborMissed} of them.` : ""}${waiting ? ` ${waiting === 1 ? "One more week isn't" : `${waiting} more weeks aren't`} all in yet.` : ""}`;
  const action = hit * 2 < k && off < -0.08 ? "If the targets sit well above what the place does, set the coming weeks from the forecast instead." : laborMissed * 2 > k ? "Labor is the miss to work on: the schedule for next week is where it's set." : null;
  return { tone, title, line, action };
}
