"use server";

/**
 * One-tap "Use these" / "Not now" for learned suggestions. The client only
 * says *which* suggestion; the value comes from the server's own snapshot and
 * is saved through the same actions a person would use by hand.
 */

import { saveDeliverySchedule } from "@/app/(app)/ordering/actions";
import { applyHoursChanges, type DayChange } from "@/domain/learned";
import { cutoffRule } from "@/domain/ordering";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { getSeasonalHours, getRegularHours } from "@/server/services/labor-rules";
import { dismissSuggestion, pendingSuggestions, refreshLearned } from "@/server/services/learned";
import { loadCutoffRules, setPar } from "@/server/services/planning";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { saveDeliveryDays, saveHours, saveSeason, saveSupplierField, saveWeatherLocation } from "./setting-actions";

type R = { error?: string; message?: string };
const gone: R = { error: "That suggestion has already been dealt with. Refresh the page." };
const refresh = () => {
  revalidatePath("/settings", "layout");
  revalidatePath("/ordering");
  revalidatePath("/ingredients");
};

const toRecord = (w: Record<number, [number, number]>) => Object.fromEntries(Object.entries(w).map(([k, v]) => [String(k), v]));

export async function applyLearnedHours(prefer: "square" | "sales" = "square"): Promise<R> {
  await requireUser("MANAGER");
  const p = await pendingSuggestions();
  const h = p.hours;
  if (!h) return gone;
  const changes: DayChange[] = prefer === "sales" && h.salesChanges ? h.salesChanges : h.changes;
  if (!changes.length) return gone;
  if (h.target.kind === "season") {
    const id = h.target.id;
    const season = (await getSeasonalHours()).find((s) => s.id === id);
    if (!season) return gone;
    const r = await saveSeason({ ...season, hours: toRecord(applyHoursChanges(season.hours, changes)) });
    if (r.error) return r;
  } else {
    const r = await saveHours(toRecord(applyHoursChanges(await getRegularHours(), changes)));
    if (r.error) return r;
  }
  refresh();
  return { message: `Updated ${changes.length} day${changes.length === 1 ? "" : "s"}.` };
}

export async function applyLearnedWeather(): Promise<R> {
  await requireUser("MANAGER");
  const w = (await pendingSuggestions()).weather;
  if (!w) return gone;
  const r = await saveWeatherLocation({ lat: w.lat, lon: w.lon, label: w.label });
  refresh();
  return r;
}

/** `what`: the delivery days, the lead time, the order deadlines, or everything waiting for this supplier. */
export async function applyLearnedSupplier(supplierId: string, what: "days" | "lead" | "deadlines" | "all"): Promise<R> {
  await requireUser("MANAGER");
  const s = (await pendingSuggestions()).suppliers.find((x) => x.id === supplierId);
  if (!s) return gone;
  const done: string[] = [];
  if ((what === "days" || what === "all") && s.days) {
    const r = await saveDeliveryDays(supplierId, s.days.days);
    if (r.error) return r;
    done.push("delivery days");
  }
  if ((what === "lead" || what === "all") && s.lead) {
    const r = await saveSupplierField(supplierId, "leadTimeDays", String(s.lead.days));
    if (r.error) return r;
    done.push("lead time");
  }
  if ((what === "deadlines" || what === "all") && s.deadlines) {
    const sup = await db.supplier.findUnique({ where: { id: supplierId }, select: { deliveryDays: true, leadTimeDays: true } });
    if (!sup) return gone;
    const rule = cutoffRule((await loadCutoffRules())[supplierId], sup.leadTimeDays);
    const perDay = { ...Object.fromEntries(Object.entries(rule.perDay ?? {}).map(([k, v]) => [k, v!])), ...Object.fromEntries(Object.entries(s.deadlines.perDay).map(([k, v]) => [k, { day: v.day, time: v.time }])) };
    const r = await saveDeliverySchedule(supplierId, { deliveryDays: sup.deliveryDays, perDay, autoDraft: rule.autoDraft });
    if (r.error) return r;
    done.push("order deadlines");
  }
  if (!done.length) return gone;
  refresh();
  return { message: `Set ${done.join(" and ")}.` };
}

/** Minimums on hand (one, or every one waiting when `ids` is empty). */
export async function applyLearnedPars(ids: string[] = []): Promise<R> {
  await requireUser("MANAGER");
  const list = (await pendingSuggestions()).pars.filter((p) => !ids.length || ids.includes(p.ingredientId));
  if (!list.length) return gone;
  for (const p of list) await setPar(p.ingredientId, p.qtyBase);
  refresh();
  return { message: `Set a minimum on hand for ${list.length} item${list.length === 1 ? "" : "s"}.` };
}

export async function applyLearnedBuffers(ids: string[] = []): Promise<R> {
  await requireUser("MANAGER");
  const list = (await pendingSuggestions()).buffers.filter((b) => !ids.length || ids.includes(b.ingredientId));
  if (!list.length) return gone;
  for (const b of list) await db.ingredient.update({ where: { id: b.ingredientId }, data: { safetyPct: new Prisma.Decimal(b.buffer) } });
  refresh();
  return { message: `Set the order buffer for ${list.length} item${list.length === 1 ? "" : "s"}.` };
}

/** "Not now": remembers this exact suggestion so it stays hidden; a different one later still shows. */
export async function dismissLearned(key: string): Promise<R> {
  await requireUser("MANAGER");
  const p = await pendingSuggestions();
  let value: unknown;
  if (key === "hours" && p.hours) value = p.hours.changes.map((c) => [c.weekday, c.next]);
  else if (key === "weather" && p.weather) value = { lat: p.weather.lat, lon: p.weather.lon };
  else {
    for (const s of p.suppliers) {
      if (s.days?.key === key) value = s.days.days;
      if (s.lead?.key === key) value = s.lead.days;
      if (s.deadlines?.key === key) value = s.deadlines.perDay;
    }
    value ??= p.pars.find((x) => x.key === key)?.qtyBase ?? p.buffers.find((x) => x.key === key)?.buffer;
  }
  if (value === undefined) return gone;
  await dismissSuggestion(key, value);
  refresh();
  return {};
}

/** Every suggestion waiting for one supplier, put off together. */
export async function dismissLearnedSupplier(supplierId: string): Promise<R> {
  await requireUser("MANAGER");
  const s = (await pendingSuggestions()).suppliers.find((x) => x.id === supplierId);
  if (!s) return gone;
  if (s.days) await dismissSuggestion(s.days.key, s.days.days);
  if (s.lead) await dismissSuggestion(s.lead.key, s.lead.days);
  if (s.deadlines) await dismissSuggestion(s.deadlines.key, s.deadlines.perDay);
  refresh();
  return {};
}

/** "Check again" — recompute now (calls Square once). */
export async function refreshLearnedNow(): Promise<R> {
  await requireUser("MANAGER");
  try {
    const r = await refreshLearned();
    refresh();
    return { message: r.pending ? `${r.pending} suggestion${r.pending === 1 ? "" : "s"} waiting.` : "Nothing new — your settings match what the data says." };
  } catch (e) {
    return { error: `Couldn't check right now: ${(e as Error).message}` };
  }
}
