import { addDays } from "@/domain/dates";
import { defaultRange } from "@/server/services/accounting";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Inclusive from/to from search params (defaults to last month); `toExclusive` for queries. */
export function readRange(sp: { from?: string | null; to?: string | null }, today: string) {
  const d = defaultRange(today);
  let from = sp.from && ISO.test(sp.from) ? sp.from : d.from;
  let to = sp.to && ISO.test(sp.to) ? sp.to : d.to;
  if (to < from) [from, to] = [to, from];
  // Cap at a year so a typo can't pull everything.
  if (addDays(from, 366) < to) from = addDays(to, -366);
  return { from, to, toExclusive: addDays(to, 1) };
}
