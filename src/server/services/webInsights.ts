import "server-only";
import { addDays } from "@/domain/dates";
import type { LabFinding } from "@/domain/lab";
import { KEY_SEP, sumByKey } from "@/domain/webAnalytics";
import { webFindings } from "@/domain/webFindings";
import { salesLink } from "@/domain/webStats";
import { db } from "../db";
import { businessToday, dailyNetSalesExcludingIgnored } from "./sales";
import { dailyRows, firstHitDay } from "./webAnalytics";

/**
 * Website findings for the Insights feed. Worked out nightly (and when the
 * analytics page is opened) and cached in Setting `webAnalytics.findings`,
 * so the feed only reads one row.
 */

const KEY = "webAnalytics.findings";

export async function computeWebFindings(): Promise<LabFinding[]> {
  const today = businessToday();
  const to = addDays(today, -1);
  const from = addDays(to, -27);
  const first = await firstHitDay();
  if (!first) return save([]);
  const rows = await dailyRows(from, to, ["total", "source", "eventSource"]);
  const total = sumByKey(rows.filter((r) => r.dim === "total"))[0] ?? { sessions: 0, converted: 0 };
  const sources = sumByKey(rows.filter((r) => r.dim === "source")).map((r) => ({ source: r.key, sessions: r.sessions, converted: r.converted }));
  const directionsBySource = rows
    .filter((r) => r.dim === "eventSource" && r.key.startsWith(`click_directions${KEY_SEP}`))
    .map((r) => ({ source: r.key.split(KEY_SEP)[1], count: r.count }))
    .reduce<{ source: string; count: number }[]>((acc, r) => {
      const x = acc.find((a) => a.source === r.source);
      if (x) x.count += r.count;
      else acc.push({ ...r });
      return acc;
    }, []);

  // Actions vs sales over up to a year of tracked days.
  const lf = addDays(today, -365) > first ? addDays(today, -365) : first;
  const [acts, sales, events] = await Promise.all([dailyRows(lf, to, ["total"]), dailyNetSalesExcludingIgnored(lf, today), db.event.findMany({ where: { date: { gte: new Date(`${lf}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } }, select: { date: true } })]);
  const ev = new Set(events.map((e) => e.date.toISOString().slice(0, 10)));
  const byDay = new Map(acts.map((a) => [a.day, a.count]));
  const days: { date: string; sales: number | null; actions: number; event: boolean }[] = [];
  for (let d = lf; d <= to; d = addDays(d, 1)) days.push({ date: d, sales: sales.get(d) ?? null, actions: byDay.get(d) ?? 0, event: ev.has(d) });
  const link = salesLink(days, "website actions");

  return save(webFindings({ directionsBySource, sources, total, link }));
}

async function save(items: LabFinding[]) {
  const value = JSON.stringify({ at: new Date().toISOString(), items });
  await db.setting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
  return items;
}

/** What the feed shows: the cached findings (never computes on the request). */
export async function cachedWebFindings(): Promise<LabFinding[]> {
  try {
    const s = await db.setting.findUnique({ where: { key: KEY }, select: { value: true } });
    if (!s) return [];
    const v = JSON.parse(s.value) as { items?: LabFinding[] };
    return Array.isArray(v.items) ? v.items : [];
  } catch {
    return [];
  }
}
