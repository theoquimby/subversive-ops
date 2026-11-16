import type { BriefDigest, BriefDigestItem } from "./templates/weekly-brief";
import type { AttentionItem } from "@/domain/attention";
import { elsewhereGroups, focusLabels, showSection, splitByFocus, type Focus } from "@/domain/focus";
import { kegWeekLines } from "@/domain/kegSignals";
import { dayDate, money, pct, shortDate, signedPct } from "@/lib/format";
import type { WeeklyBrief } from "@/server/services/brief";

const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

interface Row extends BriefDigestItem {
  /** The weekly card's id (app/(app)/brief/weekly.tsx), for domain/focus. */
  key: string;
  tone?: "bad";
}

/**
 * The /brief page's cards, as plain text for the email digest. Mirrors `buildItems` in app/(app)/brief/weekly.tsx.
 * With a focus (domain/focus): the person's areas (and the brewery's to-dos when that's one), anything red,
 * and the rest a line per area under Elsewhere. No focus: everything, as before.
 */
export function briefDigest(b: WeeklyBrief, opts: { focus?: readonly Focus[]; brewery?: readonly AttentionItem[] } = {}): BriefDigest {
  const focus = opts.focus ?? [];
  const show = (s: Parameters<typeof showSection>[0]) => showSection(s, focus);
  const rows: { needsYou: boolean; row: Row }[] = [];
  const add = (key: string, needsYou: boolean, i: BriefDigestItem, tone?: "bad") => rows.push({ needsYou, row: { key, ...i, ...(tone ? { tone } : {}) } });
  if (focus.includes("brewery")) for (const a of opts.brewery ?? []) add(a.key, true, { title: a.title, status: a.detail, path: a.href }, a.tone === "bad" ? "bad" : undefined);

  const toOrder = b.orders.filter((o) => o.items > 0 && !o.existingDraftId);
  const drafted = b.orders.filter((o) => o.existingDraftId);
  for (const o of toOrder) {
    const below = o.minOrder != null && o.total < o.minOrder;
    add(`order-${o.supplierId}`, true, { title: `Order from ${o.supplier}`, status: `${plural(o.items, "item")} · ${money(o.total)} · delivers ${dayDate(o.deliveryDate)}${below ? ` · under ${money(o.minOrder, { whole: true })} minimum` : ""}`, path: `/ordering/${o.supplierId}` });
  }
  if (drafted.length) add("orders-drafted", false, { title: "Drafted orders", status: `${list(drafted.map((o) => o.supplier))} drafted — send when ready`, path: "/ordering" });
  else if (toOrder.length === 0) add("orders", false, { title: "Orders", status: b.orders.length ? "Stock covers this week's deliveries" : "No deliveries this week", path: "/ordering" });

  const s = b.schedule;
  const laborNote = s.laborPct != null ? ` · labor ${pct(s.laborPct, 0)} of forecast` : "";
  if (s.published + s.drafts === 0) add("schedule", true, { title: "Build next week's schedule", status: "No shifts yet — draft one from the forecast in a tap", path: "/schedule" });
  else if (s.drafts > 0) add("schedule", true, { title: "Publish the schedule", status: `${plural(s.drafts, "draft shift")}${s.published ? `, ${s.published} published` : ""} · ${Math.round(s.hours)} h${laborNote}${s.open ? ` · ${s.open} open` : ""}`, path: "/schedule" });
  else add("schedule", s.open > 0, { title: s.open ? "Fill open shifts" : "Schedule", status: `Published · ${s.published} shifts · ${Math.round(s.hours)} h${laborNote}${s.open ? ` · ${s.open} open` : ""}`, path: "/schedule" });

  const req = b.requests.timeOff + b.requests.swaps;
  const reqText = [b.requests.timeOff ? `${b.requests.timeOff} time-off` : "", b.requests.swaps ? plural(b.requests.swaps, "shift swap") : ""].filter(Boolean).join(" and ");
  add("requests", req > 0, { title: req ? "Answer staff requests" : "Staff requests", status: req ? `${reqText} waiting` : "Nothing waiting", path: "/schedule" });

  const rv = b.reviews.unreplied;
  add("reviews", rv > 0, { title: rv ? "Reply to reviews" : "Reviews", status: rv ? `${plural(rv, "critical review")} without a reply — drafts are ready` : "Every critical review has a reply", path: "/reviews" });

  const inc = b.increases;
  add("prices", inc.length > 0, {
    title: inc.length ? "Price increases this week" : "Prices",
    status: inc.length ? `${list(inc.slice(0, 3).map((m) => `${m.ingredient ?? m.description} ${signedPct(m.changePct, 0)}`))}${inc.length > 3 ? ` and ${inc.length - 3} more` : ""}` : "No increases in the last 7 days",
    path: "/prices",
  });

  const over = b.overTarget;
  add("menu", over.length > 0, { title: over.length ? "Menu items over target" : "Menu costs", status: over.length ? list(over.slice(0, 3).map((r) => `${r.name} ${pct(r.foodCostPct)}`)) + (over.length > 3 ? ` and ${over.length - 3} more` : "") : "Everything's on target", path: "/menu" });

  const g = b.gap;
  const gapBad = g != null && g.foodSales > 0 && g.unexplainedCost / g.foodSales > 0.02;
  add("gap", gapBad, { title: "Margin gap", status: g == null ? "Needs two completed counts" : `${money(g.unexplainedCost, { whole: true })} unexplained between ${shortDate(g.from)} and ${shortDate(g.to)}`, path: "/variance" });

  if (b.unmapped.count) add("unmapped", true, { title: "Square items without a recipe", status: `${plural(b.unmapped.count, "item")} sold ${money(b.unmapped.sales, { whole: true })} in the last 7 days with no recipe: ${list(b.unmapped.top.slice(0, 3).map((u) => u.name))}`, path: "/sales/square-menu" });
  const inv = b.decisions.find((d) => d.key === "invoiceIssues");
  if (inv) add("invoiceIssues", true, { title: "Invoice issues", status: inv.title, path: inv.href });

  const t = b.training;
  if (t && t.hasTypes) {
    const issues = [
      t.expired.length ? `${t.expired.length} expired` : "",
      t.expiring.length ? `${t.expiring.length} expiring in 30 days` : "",
      t.missing.length ? `${t.missing.length} missing` : "",
      t.overdue.length ? `${plural(t.overdue.length, "checklist")} overdue` : "",
    ].filter(Boolean);
    const names = [...t.expired, ...t.expiring, ...t.missing].slice(0, 3).map((x) => `${x.person} (${x.cert})`);
    add("training", issues.length > 0, { title: "Training & certificates", status: issues.length ? `${issues.join(" · ")}${names.length ? `: ${list(names)}` : ""}` : "Everyone's certificates are in date", path: "/team/training" }, t.expired.length || t.missing.length ? "bad" : undefined);
  }

  const c = b.counts;
  add("counts", c.overdue, { title: c.overdue ? "Count is overdue" : "Counts", status: c.last == null ? "No completed counts yet" : c.overdue ? `Last full count was ${c.daysSince} days ago (${shortDate(c.last)})` : `Last count ${shortDate(c.last)}`, path: "/count" });

  const plain = ({ title, status, path }: Row): BriefDigestItem => ({ title, status, ...(path !== undefined ? { path } : {}) });
  const { mine: todo, elsewhere } = splitByFocus(rows.filter((r) => r.needsYou).map((r) => r.row), focus);
  const clear = splitByFocus(rows.filter((r) => !r.needsYou).map((r) => r.row), focus).mine;
  const forecast = show("forecast");

  return {
    week: b.week,
    forecastTotal: forecast ? b.forecast.total : 0,
    salesTarget: b.budget?.sales ?? null,
    busiest: forecast ? b.forecast.busiest.map((d) => d.date) : [],
    events: forecast ? b.forecast.events : [],
    laborPct: forecast ? s.laborPct : null,
    laborTarget: b.budget?.laborPct ?? null,
    todo: todo.map(plain),
    clear: clear.map(plain),
    ...(focus.length
      ? {
          focus: focusLabels(focus),
          elsewhere: elsewhereGroups(elsewhere, focus).map((g) => ({ label: g.label, count: g.items.length, line: g.line, path: g.items[0]?.path ?? g.href })),
        }
      : {}),
    lastWeek: b.lastWeek && show("lastWeek")
      ? {
          from: b.lastWeek.from,
          to: b.lastWeek.to,
          rows: b.lastWeek.rows.map((r) => ({
            label: r.label,
            actual: r.actual == null ? "—" : r.key === "sales" ? money(r.actual, { whole: true }) : pct(r.actual),
            target: r.target == null ? null : r.key === "sales" ? money(r.target, { whole: true }) : pct(r.target),
            tone: r.rag === "none" ? "neutral" : r.rag,
          })),
        }
      : null,
    kegs: b.kegs && show("kegs") ? { from: b.kegs.week.from, to: b.kegs.week.to, lines: kegWeekLines(b.kegs.week, b.kegs.look) } : null,
  };
}
