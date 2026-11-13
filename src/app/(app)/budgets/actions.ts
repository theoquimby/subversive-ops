"use server";

import { copyTargets, parseMoney, parsePct, weekStartOf, weekStarts } from "@/domain/budgets";
import { addDays } from "@/domain/dates";
import { requireUser } from "@/server/auth";
import { loadTargets, saveTarget, saveTargets } from "@/server/services/budgets";
import { businessToday } from "@/server/services/sales";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const refresh = () => {
  revalidatePath("/budgets");
  revalidatePath("/brief");
};

const week = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function setTarget(weekStart: string, field: "sales" | "foodCostPct" | "laborPct", raw: string) {
  await requireUser("MANAGER");
  const w = week.parse(weekStart);
  const f = z.enum(["sales", "foodCostPct", "laborPct"]).parse(field);
  const v = f === "sales" ? parseMoney(raw) : parsePct(raw);
  if (v === "invalid") return { error: f === "sales" ? "Enter an amount, like 14000 or 14k" : "Enter a percentage, like 28" };
  await saveTarget(w, f, v);
  refresh();
}

/** Copy last week's targets into this week (fills blanks only). */
export async function copyLastWeek() {
  await requireUser("MANAGER");
  const thisWeek = weekStartOf(businessToday());
  const last = addDays(thisWeek, -7);
  const existing = await loadTargets(last, addDays(thisWeek, 7));
  const src = existing.get(last);
  if (!src) return { error: "Last week has no targets to copy." };
  const rows = copyTargets(src, [thisWeek], existing);
  if (rows.length) await saveTargets(rows);
  refresh();
  return { changed: rows.length };
}

/** Fill the next 8 weeks from this week's targets (or the latest week that has some). Weeks already set keep their numbers. */
export async function fillNextWeeks() {
  await requireUser("MANAGER");
  const thisWeek = weekStartOf(businessToday());
  const weeks = weekStarts(addDays(thisWeek, 7), 8);
  const existing = await loadTargets(addDays(thisWeek, -7 * 12), addDays(weeks[weeks.length - 1], 7));
  const src = existing.get(thisWeek) ?? [...existing.values()].filter((t) => t.weekStart <= thisWeek).sort((a, b) => b.weekStart.localeCompare(a.weekStart))[0];
  if (!src) return { error: "Set this week's targets first." };
  const rows = copyTargets(src, weeks, existing);
  if (rows.length) await saveTargets(rows);
  refresh();
  return { changed: rows.length };
}
