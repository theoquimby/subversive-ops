import "server-only";
import { addDays, parseISODate, toISODate, type ISODate } from "@/domain/dates";
import {
  ACTIONS,
  addTotals,
  change,
  changeIsClear,
  conversionRates,
  dailySeries,
  funnel,
  inquiryAttribution,
  KEY_SEP,
  periods,
  share,
  sourceLabel,
  sumByKey,
  ZERO,
  type ActionName,
  type FunnelStep,
  type InquiryBySource,
  type PeriodId,
  type RateRow,
  type Totals,
} from "@/domain/webAnalytics";
import { salesLink, type SalesLink } from "@/domain/webStats";
import { db } from "../db";
import { businessToday, dailyNetSalesExcludingIgnored } from "./sales";
import { dailyRows, firstHitDay, inquiryFunnelRows, mainWebsiteOrigin, refreshRollups, websiteOrigins, type DailyRow } from "./webAnalytics";

/**
 * Everything /website/analytics shows, read from the daily rollups (plus
 * today's, rebuilt at most every 10 minutes), Square sales and private
 * events. One call per page view. Google Search and the Google listing have
 * their own home on the Online pages (./online.ts).
 */

export interface Kpi {
  cur: number;
  prev: number;
  change: number | null;
  clear: boolean;
}
const kpi = (cur: number, prev: number): Kpi => ({ cur, prev, change: change(cur, prev), clear: changeIsClear(cur, prev) });
const rateKpi = (curN: number, curD: number, prevN: number, prevD: number) => {
  const c = curD > 0 ? curN / curD : 0;
  const p = prevD > 0 ? prevN / prevD : 0;
  return { cur: c, prev: p, change: prevD > 0 && p > 0 ? c / p - 1 : null, clear: changeIsClear(curN, prevD > 0 ? (prevN * curD) / prevD : 0) };
};

export interface SourceRow extends RateRow {
  label: string;
  medium: string;
  share: number | null;
  views: number;
}

export interface WebDashboard {
  periodId: PeriodId;
  from: ISODate;
  to: ISODate;
  prevFrom: ISODate;
  prevTo: ISODate;
  origins: string[];
  website: string | null;
  firstDay: ISODate | null;
  hasData: boolean;
  kpis: { visitors: Kpi; sessions: Kpi; views: Kpi; actions: Kpi; convRate: Kpi; bounceRate: Kpi; engagedRate: Kpi };
  trend: { x: ISODate; visitors: number; sessions: number; views: number; actions: number; prevSessions: number }[];
  pages: { path: string; views: number; visitors: number; entries: number; bounceRate: number | null; converted: number; sessions: number; actions: number; rate: number | null }[];
  sources: SourceRow[];
  mediums: { key: string; sessions: number; share: number | null; converted: number }[];
  campaigns: { key: string; sessions: number; converted: number; rate: number | null }[];
  devices: { key: string; sessions: number; share: number | null; converted: number; rate: number | null }[];
  places: { key: string; label: string; sessions: number; share: number | null }[];
  countries: { key: string; sessions: number; share: number | null }[];
  funnel: FunnelStep[];
  actions: { kind: ActionName; count: number; sessions: number; prev: number; topSource: { key: string; label: string; share: number } | null }[];
  actionSources: Record<string, { key: string; label: string; count: number; share: number }[]>;
  eventPages: { path: string; views: number; sessions: number; tickets: number; rsvps: number; rate: number | null }[];
  link: { directions: SalesLink; all: SalesLink; days: { x: ISODate; sales: number | null; directions: number; actions: number; event: boolean }[] };
  inquiries: { rows: InquiryBySource[]; total: InquiryBySource; unattributed: number };
}

const sum = (rows: DailyRow[]) => rows.reduce((t, r) => addTotals(t, r), ZERO);

function placeLabel(key: string) {
  const [city, region, country] = key.split(KEY_SEP);
  return [city, region, country !== "US" ? country : null].filter(Boolean).join(", ");
}

export async function webDashboard(periodId: PeriodId): Promise<WebDashboard> {
  await refreshRollups().catch((e) => console.error("rollups", e));
  const today = businessToday();
  const { cur, prev } = periods(periodId, today);
  const linkFrom = addDays(today, -365);
  const [rows, prevRows, origins, website, firstDay] = await Promise.all([
    dailyRows(cur.from, cur.to, ["total", "page", "source", "medium", "campaign", "device", "country", "city", "action", "eventSource", "eventPage"]),
    dailyRows(prev.from, prev.to, ["total", "action", "source"]),
    websiteOrigins(),
    mainWebsiteOrigin(),
    firstHitDay(),
  ]);
  const by = (dim: string, rs = rows) => rs.filter((r) => r.dim === dim);
  const t = sum(by("total"));
  const p = sum(by("total", prevRows));

  const kpis = {
    visitors: kpi(t.visitors, p.visitors),
    sessions: kpi(t.sessions, p.sessions),
    views: kpi(t.views, p.views),
    actions: kpi(t.count, p.count),
    convRate: rateKpi(t.converted, t.sessions, p.converted, p.sessions),
    bounceRate: rateKpi(t.bounces, t.sessions, p.bounces, p.sessions),
    engagedRate: rateKpi(t.engaged, t.sessions, p.engaged, p.sessions),
  };

  const totalByDay = new Map(by("total").map((r) => [r.day, r]));
  const prevByOffset = new Map(by("total", prevRows).map((r) => [r.day, r]));
  const trend = dailySeries([], cur.from, cur.to).map(({ x }, i) => {
    const r = totalByDay.get(x);
    const pr = prevByOffset.get(addDays(prev.from, i));
    return { x, visitors: r?.visitors ?? 0, sessions: r?.sessions ?? 0, views: r?.views ?? 0, actions: r?.count ?? 0, prevSessions: pr?.sessions ?? 0 };
  });

  const pages = sumByKey(by("page"), "views")
    .slice(0, 15)
    .map((r) => ({ path: r.key, views: r.views, visitors: r.visitors, entries: r.entries, bounceRate: r.entries > 0 ? r.bounces / r.entries : null, converted: r.converted, sessions: r.sessions, actions: r.count, rate: r.sessions > 0 ? r.converted / r.sessions : null }));

  // Source → its medium (the most common one for that source in the window).
  const mediumOf = new Map<string, string>();
  const sourceRows = by("source");
  const srcSum = sumByKey(sourceRows);
  for (const s of srcSum) mediumOf.set(s.key, "");
  {
    const mRows = await db.webHit.groupBy({ by: ["source", "medium"], where: { day: { gte: parseISODate(cur.from), lte: parseISODate(cur.to) }, kind: "pageview" }, _count: { _all: true } });
    const best = new Map<string, number>();
    for (const m of mRows) {
      if ((best.get(m.source) ?? -1) >= m._count._all) continue;
      best.set(m.source, m._count._all);
      mediumOf.set(m.source, m.medium);
    }
  }
  const rates = conversionRates(srcSum, t);
  const sources: SourceRow[] = srcSum.slice(0, 12).map((s, i) => ({ ...rates[i], label: sourceLabel(s.key), medium: mediumOf.get(s.key) ?? "", share: share(s.sessions, t.sessions), views: s.views }));

  const mediums = sumByKey(by("medium")).map((r) => ({ key: r.key, sessions: r.sessions, share: share(r.sessions, t.sessions), converted: r.converted }));
  const campaigns = sumByKey(by("campaign")).slice(0, 8).map((r) => ({ key: r.key, sessions: r.sessions, converted: r.converted, rate: r.sessions ? r.converted / r.sessions : null }));
  const devices = sumByKey(by("device")).map((r) => ({ key: r.key, sessions: r.sessions, share: share(r.sessions, t.sessions), converted: r.converted, rate: r.sessions ? r.converted / r.sessions : null }));
  const places = sumByKey(by("city")).slice(0, 10).map((r) => ({ key: r.key, label: placeLabel(r.key), sessions: r.sessions, share: share(r.sessions, t.sessions) }));
  const countries = sumByKey(by("country")).slice(0, 6).map((r) => ({ key: r.key, sessions: r.sessions, share: share(r.sessions, t.sessions) }));

  // Actions and where they came from.
  const actionRows = sumByKey(by("action"), "count");
  const prevActions = sumByKey(by("action", prevRows), "count");
  const es = by("eventSource").map((r) => {
    const [kind, source] = r.key.split(KEY_SEP);
    return { ...r, kind, source };
  });
  const actionSources: WebDashboard["actionSources"] = {};
  for (const kind of ACTIONS) {
    const mine = es.filter((r) => r.kind === kind);
    const total = mine.reduce((s, r) => s + r.count, 0);
    actionSources[kind] = sumByKey(mine.map((r) => ({ ...r, key: r.source })), "count")
      .slice(0, 6)
      .map((r) => ({ key: r.key, label: sourceLabel(r.key), count: r.count, share: total ? r.count / total : 0 }));
  }
  const actions = ACTIONS.map((kind) => {
    const a = actionRows.find((r) => r.key === kind);
    const top = actionSources[kind][0];
    return { kind, count: a?.count ?? 0, sessions: a?.sessions ?? 0, prev: prevActions.find((r) => r.key === kind)?.count ?? 0, topSource: top ? { key: top.key, label: top.label, share: top.share } : null };
  });

  const steps = funnel([
    { id: "visits", label: "Visits", value: t.sessions },
    { id: "interest", label: "Looked at the menu or an event", value: t.engaged },
    { id: "action", label: "Called, got directions, ordered, booked or inquired", value: t.converted },
  ]);

  // Event pages: views, plus ticket and RSVP clicks on each.
  const ep = by("eventPage").map((r) => {
    const [kind, path] = r.key.split(KEY_SEP);
    return { kind, path, count: r.count };
  });
  const eventPages = sumByKey(by("page").filter((r) => r.key.startsWith("/events/")), "views")
    .slice(0, 12)
    .map((r) => {
      const tickets = ep.filter((x) => x.path === r.key && x.kind === "ticket_click").reduce((s, x) => s + x.count, 0);
      const rsvps = ep.filter((x) => x.path === r.key && x.kind === "rsvp_click").reduce((s, x) => s + x.count, 0);
      return { path: r.key, views: r.views, sessions: r.sessions, tickets, rsvps, rate: r.sessions ? r.converted / r.sessions : null };
    });

  const [link, inquiries] = await Promise.all([linkBlock(linkFrom, addDays(today, -1), firstDay), inquiryBlock(cur.from, cur.to)]);

  return {
    periodId,
    from: cur.from,
    to: cur.to,
    prevFrom: prev.from,
    prevTo: prev.to,
    origins,
    website,
    firstDay,
    hasData: t.sessions > 0 || !!firstDay,
    kpis,
    trend,
    pages,
    sources,
    mediums,
    campaigns,
    devices,
    places,
    countries,
    funnel: steps,
    actions,
    actionSources,
    eventPages,
    link,
    inquiries,
  };
}

async function linkBlock(from: ISODate, to: ISODate, firstDay: ISODate | null): Promise<WebDashboard["link"]> {
  const start = firstDay && firstDay > from ? firstDay : from;
  if (start > to) return { directions: salesLink([], "direction clicks"), all: salesLink([], "website actions"), days: [] };
  const [acts, sales, events] = await Promise.all([
    dailyRows(start, to, ["action"]),
    dailyNetSalesExcludingIgnored(start, addDays(to, 1)),
    db.event.findMany({ where: { date: { gte: parseISODate(start), lte: parseISODate(to) } }, select: { date: true, kind: true } }),
  ]);
  const evDays = new Set(events.map((e) => toISODate(e.date)));
  const days = dailySeries([], start, to).map(({ x }) => {
    const mine = acts.filter((a) => a.day === x);
    const dir = mine.filter((a) => a.key === "click_directions").reduce((s, a) => s + a.count, 0);
    const all = mine.reduce((s, a) => s + a.count, 0);
    const sv = sales.get(x);
    return { x, sales: sv && sv > 0 ? sv : null, directions: dir, actions: all, event: evDays.has(x) };
  });
  return {
    directions: salesLink(days.map((d) => ({ date: d.x, sales: d.sales, actions: d.directions, event: d.event })), "direction clicks"),
    all: salesLink(days.map((d) => ({ date: d.x, sales: d.sales, actions: d.actions, event: d.event })), "website actions"),
    days,
  };
}

async function inquiryBlock(from: ISODate, to: ISODate): Promise<WebDashboard["inquiries"]> {
  const { convs, events } = await inquiryFunnelRows(from, to);
  const rows = inquiryAttribution(convs, events);
  const total = rows.reduce((t, r) => ({ ...t, inquiries: t.inquiries + r.inquiries, quoted: t.quoted + r.quoted, booked: t.booked + r.booked, revenue: t.revenue + r.revenue }), { source: "all", inquiries: 0, quoted: 0, booked: 0, revenue: 0 });
  const unattributed = rows.find((r) => r.source === "(not set)")?.inquiries ?? 0;
  return { rows: rows.map((r) => ({ ...r })), total, unattributed };
}

export type { Totals };
