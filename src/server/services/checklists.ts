import "server-only";
import { addDays, dateRange, ISODate, parseISODate, toISODate, zonedMidnightUTC } from "@/domain/dates";
import { CHECKLIST_PRESETS, crewFor, dayMark, itemsOn, runDateFor, runsOn, runState, shiftOrder, unfinishedCloses, type DayMark, type LastNight, type RunState } from "@/domain/checklists";
import { localParts } from "@/domain/schedule";
import { env } from "../env";
import { db } from "../db";
import { businessToday } from "./sales";

/**
 * Shift checklists: the templates (set up on /checklists), today's runs that
 * staff tick on /my/checklists, the two-week history, and last night's
 * unfinished closes for the Overview and the brief.
 */

const SEEDED_KEY = "checklists.seeded";

/** Business-time hour right now. */
export const businessHour = (now = new Date()) => Math.floor(localParts(now, env.BUSINESS_TIMEZONE).minutes / 60);

/**
 * First visit: start Max off with an opening and closing list for the bar and
 * the kitchen, aimed at his positions (bar/floor vs kitchen). Runs once — if
 * he deletes them all they stay deleted.
 */
export async function ensureChecklistPresets() {
  const seeded = await db.setting.findUnique({ where: { key: SEEDED_KEY } });
  if (seeded) return;
  const [count, positions] = await Promise.all([db.checklistTemplate.count(), db.position.findMany({ select: { id: true, area: true } })]);
  await db.setting.upsert({ where: { key: SEEDED_KEY }, create: { key: SEEDED_KEY, value: new Date().toISOString() }, update: {} });
  if (count > 0) return;
  const bar = positions.filter((p) => p.area !== "BOH").map((p) => p.id);
  const kitchen = positions.filter((p) => p.area === "BOH").map((p) => p.id);
  for (const [i, p] of CHECKLIST_PRESETS.entries()) {
    const isKitchen = /kitchen/i.test(p.name);
    await db.checklistTemplate.create({
      data: {
        name: p.name,
        shift: p.shift,
        sort: i,
        positionIds: isKitchen ? kitchen : bar,
        items: { create: p.items.map((it, j) => ({ sort: j, title: it.title, detail: it.detail ?? null, href: it.href ?? null, weekdays: it.weekdays ?? [] })) },
      },
    });
  }
}

export async function checklistTemplates() {
  const rows = await db.checklistTemplate.findMany({
    orderBy: [{ sort: "asc" }, { createdAt: "asc" }],
    include: { items: { orderBy: [{ sort: "asc" }, { id: "asc" }] } },
  });
  return rows.map((t) => ({
    id: t.id,
    name: t.name,
    shift: t.shift,
    positionIds: t.positionIds,
    weekdays: t.weekdays,
    active: t.active,
    items: t.items.map((i) => ({ id: i.id, title: i.title, detail: i.detail, href: i.href, weekdays: i.weekdays, active: i.active })),
  }));
}
export type TemplateView = Awaited<ReturnType<typeof checklistTemplates>>[number];

/** Today's crew per business date, from the schedule (assigned shifts only). */
async function crewShifts(dates: ISODate[]) {
  if (!dates.length) return new Map<ISODate, { name: string; positionId: string; start: Date; end: Date }[]>();
  const sorted = [...dates].sort();
  const from = zonedMidnightUTC(sorted[0], env.BUSINESS_TIMEZONE);
  const to = zonedMidnightUTC(addDays(sorted[sorted.length - 1], 1), env.BUSINESS_TIMEZONE);
  const shifts = await db.shift.findMany({
    where: { start: { gte: from, lt: to }, employeeId: { not: null } },
    select: { start: true, end: true, positionId: true, employee: { select: { name: true } } },
  });
  const out = new Map<ISODate, { name: string; positionId: string; start: Date; end: Date }[]>();
  for (const s of shifts) {
    const d = localParts(s.start, env.BUSINESS_TIMEZONE).date;
    const first = s.employee?.name.split(" ")[0] ?? "";
    out.set(d, [...(out.get(d) ?? []), { name: first, positionId: s.positionId, start: s.start, end: s.end }]);
  }
  return out;
}

export interface RunItemView { id: string; title: string; detail: string | null; href: string | null; doneBy: string | null; doneAt: string | null }
export interface RunView {
  templateId: string;
  name: string;
  shift: string;
  date: ISODate;
  positionIds: string[];
  /** Someone in this list's positions — the person looking. */
  forMe: boolean;
  crew: string[];
  items: RunItemView[];
  done: number;
  total: number;
  state: RunState;
  signedOffName: string | null;
  signedOffAt: string | null;
  note: string | null;
}

/**
 * The lists to work on right now: each active list on the date it covers at
 * this hour (a close after midnight is still last night's), with ticks, who
 * did them and who's on. Lists for the viewer's positions first, then by the
 * time of day.
 */
export async function todaysRuns(opts: { positionIds?: string[]; now?: Date } = {}): Promise<{ today: ISODate; hour: number; runs: RunView[] }> {
  const now = opts.now ?? new Date();
  const today = businessToday();
  const hour = businessHour(now);
  const templates = await db.checklistTemplate.findMany({
    where: { active: true },
    orderBy: [{ sort: "asc" }, { createdAt: "asc" }],
    include: { items: { where: { active: true }, orderBy: [{ sort: "asc" }, { id: "asc" }] } },
  });
  const wanted = templates.map((t) => ({ t, date: runDateFor(t.shift, today, hour) })).filter(({ t, date }) => runsOn(t.weekdays, date));
  const dates = [...new Set(wanted.map((w) => w.date))];
  const [runs, crew] = await Promise.all([
    wanted.length
      ? db.checklistRun.findMany({
          where: { OR: wanted.map((w) => ({ templateId: w.t.id, date: parseISODate(w.date) })) },
          include: { ticks: true },
        })
      : Promise.resolve([]),
    crewShifts(dates),
  ]);
  const runBy = new Map(runs.map((r) => [`${r.templateId}|${toISODate(r.date)}`, r]));
  const mine = new Set(opts.positionIds ?? []);
  const order = shiftOrder(hour);
  const views: RunView[] = wanted.map(({ t, date }) => {
    const run = runBy.get(`${t.id}|${date}`);
    const ticks = new Map((run?.ticks ?? []).map((k) => [k.itemId, k]));
    const items = itemsOn(t.items, date).map((i) => {
      const k = ticks.get(i.id);
      return { id: i.id, title: i.title, detail: i.detail, href: i.href, doneBy: k?.userName ?? null, doneAt: k?.doneAt.toISOString() ?? null };
    });
    const done = items.filter((i) => i.doneBy).length;
    return {
      templateId: t.id,
      name: t.name,
      shift: t.shift,
      date,
      positionIds: t.positionIds,
      forMe: t.positionIds.length === 0 || t.positionIds.some((p) => mine.has(p)),
      crew: crewFor(crew.get(date) ?? [], t.shift, t.positionIds),
      items,
      done,
      total: items.length,
      state: runState(done, items.length, !!run?.signedOffAt),
      signedOffName: run?.signedOffName ?? null,
      signedOffAt: run?.signedOffAt?.toISOString() ?? null,
      note: run?.note ?? null,
    };
  });
  views.sort((a, b) => Number(b.forMe) - Number(a.forMe) || order.indexOf(a.shift as never) - order.indexOf(b.shift as never));
  return { today, hour, runs: views };
}

export interface HistoryRow { templateId: string; name: string; shift: string; marks: { date: ISODate; mark: DayMark; done: number; total: number; by: string | null }[] }

/** The last `days` finished-or-current days per list: signed, done, partial, missed or not scheduled. */
export async function checklistHistory(days = 14, today: ISODate = businessToday()): Promise<{ dates: ISODate[]; rows: HistoryRow[] }> {
  const dates = dateRange(addDays(today, -(days - 1)), addDays(today, 1));
  const [templates, runs] = await Promise.all([
    db.checklistTemplate.findMany({ where: { active: true }, orderBy: [{ sort: "asc" }, { createdAt: "asc" }], include: { items: { select: { id: true, weekdays: true, active: true } } } }),
    db.checklistRun.findMany({ where: { date: { gte: parseISODate(dates[0]), lte: parseISODate(today) } }, include: { ticks: { select: { itemId: true } } } }),
  ]);
  const runBy = new Map(runs.map((r) => [`${r.templateId}|${toISODate(r.date)}`, r]));
  const rows = templates.map((t) => ({
    templateId: t.id,
    name: t.name,
    shift: t.shift,
    marks: dates.map((date) => {
      const items = itemsOn(t.items, date);
      const run = runBy.get(`${t.id}|${date}`);
      const ids = new Set(items.map((i) => i.id));
      const done = (run?.ticks ?? []).filter((k) => ids.has(k.itemId)).length;
      const applies = runsOn(t.weekdays, date) && items.length > 0 && date >= toISODate(t.createdAt);
      return { date, mark: dayMark(applies, done, items.length, !!run?.signedOffAt), done, total: items.length, by: run?.signedOffName ?? null };
    }),
  }));
  return { dates, rows };
}

/**
 * Closing lists from last night that weren't finished. Only nights with sales
 * (or a shift on the schedule) count, so a closed Monday never nags.
 */
export async function unfinishedLastNight(today: ISODate = businessToday()): Promise<LastNight[]> {
  const night = addDays(today, -1);
  const d = parseISODate(night);
  const [templates, run, sales, shifts] = await Promise.all([
    db.checklistTemplate.findMany({ where: { active: true, shift: "close" }, include: { items: { select: { id: true, weekdays: true, active: true } } } }),
    db.checklistRun.findMany({ where: { date: d }, include: { ticks: { select: { itemId: true } } } }),
    db.dailySale.count({ where: { date: d }, take: 1 }),
    db.shift.count({ where: { start: { gte: zonedMidnightUTC(night, env.BUSINESS_TIMEZONE), lt: zonedMidnightUTC(today, env.BUSINESS_TIMEZONE) } }, take: 1 }),
  ]);
  if (!templates.length || (!sales && !shifts)) return [];
  const runBy = new Map(run.map((r) => [r.templateId, r]));
  return unfinishedCloses(
    templates
      .filter((t) => runsOn(t.weekdays, night) && toISODate(t.createdAt) <= night)
      .map((t) => {
        const items = itemsOn(t.items, night);
        const ids = new Set(items.map((i) => i.id));
        const r = runBy.get(t.id);
        return { templateId: t.id, name: t.name, total: items.length, done: (r?.ticks ?? []).filter((k) => ids.has(k.itemId)).length, signedOff: !!r?.signedOffAt };
      }),
  );
}
