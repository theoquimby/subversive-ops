/**
 * Overview "Needs you" items from the brewery (and so the morning brief):
 * transfers and packaging due today or overdue, two brews booked into one
 * tank in the next 14 days, and a beer that needs brewing within a week to
 * avoid running dry. Pure; services/brewery.ts feeds it.
 */

import type { AttentionItem } from "./attention";
import { addDays, WEEKDAYS, weekday, type ISODate } from "./dates";
import { monthDay, type BrewSuggestion, type TodoItem } from "./tankPlan";

/** Clashes this close show on the Overview. */
export const CLASH_WINDOW_DAYS = 14;
/** Suggested brews whose brew-by day is this close show on the Overview. */
export const SUGGEST_WINDOW_DAYS = 7;

const worst = (items: { tone: string }[]): AttentionItem["tone"] => (items.some((i) => i.tone === "bad") ? "bad" : "warn");

export function breweryAttentionItems(i: { today: ISODate; todos: TodoItem[]; suggestions: BrewSuggestion[] }): AttentionItem[] {
  const out: AttentionItem[] = [];
  for (const kind of ["transfer", "package"] as const) {
    const due = i.todos.filter((t) => t.kind === kind && t.on <= i.today);
    if (!due.length) continue;
    out.push({
      key: `brewery.${kind}`,
      title: due.length === 1 ? due[0].title : `${due.length} tanks ready to ${kind}`,
      detail: due.length === 1 ? due[0].detail : due.map((t) => t.title.split(":")[0]).slice(0, 4).join(", "),
      href: "/brewery",
      tone: worst(due),
      urgency: worst(due) === "bad" ? 66 : 52,
    });
  }
  const clashes = i.todos.filter((t) => t.kind === "clash" && t.on < addDays(i.today, CLASH_WINDOW_DAYS));
  if (clashes.length) {
    out.push({
      key: "brewery.clash",
      title: clashes.length === 1 ? clashes[0].title : `${clashes.length} tank clashes coming up`,
      detail: clashes.length === 1 ? clashes[0].detail : `First on ${monthDay(clashes[0].on)} · move one on the schedule`,
      href: "/brewery/schedule",
      tone: worst(clashes),
      urgency: 48,
    });
  }
  const brew = i.suggestions.filter((s) => !s.planned && s.daysToBrewBy <= SUGGEST_WINDOW_DAYS);
  if (brew.length) {
    const s = brew[0];
    const when = s.daysToBrewBy < 0 ? "as soon as you can" : s.daysToBrewBy === 0 ? "today" : s.daysToBrewBy === 1 ? "by tomorrow" : `by ${WEEKDAYS[weekday(s.brewBy)]}`;
    out.push({
      key: "brewery.suggest",
      title: `Brew ${s.name} ${when}`,
      detail: `${s.alreadyOut ? "Its full kegs have run out" : `Full kegs run out around ${monthDay(s.runOutOn)}`}${brew.length > 1 ? ` · ${brew.length - 1} more to plan` : ""}`,
      href: "/brewery/schedule",
      tone: s.daysToBrewBy < 0 ? "bad" : "warn",
      urgency: s.daysToBrewBy < 0 ? 54 : 42,
    });
  }
  return out;
}
