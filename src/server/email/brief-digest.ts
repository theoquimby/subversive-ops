import type { BriefDigest, BriefDigestItem } from "./templates/weekly-brief";
import { dayDate, money, pct, shortDate, signedPct } from "@/lib/format";
import type { WeeklyBrief } from "@/server/services/brief";

const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The /brief page's cards, as plain text for the email digest. Mirrors `buildItems` in app/(app)/brief/page.tsx. */
export function briefDigest(b: WeeklyBrief): BriefDigest {
  const todo: BriefDigestItem[] = [];
  const clear: BriefDigestItem[] = [];
  const add = (needsYou: boolean, i: BriefDigestItem) => (needsYou ? todo : clear).push(i);

  const toOrder = b.orders.filter((o) => o.items > 0 && !o.existingDraftId);
  const drafted = b.orders.filter((o) => o.existingDraftId);
  for (const o of toOrder) {
    const below = o.minOrder != null && o.total < o.minOrder;
    add(true, { title: `Order from ${o.supplier}`, status: `${plural(o.items, "item")} · ${money(o.total)} · delivers ${dayDate(o.deliveryDate)}${below ? ` · under ${money(o.minOrder, { whole: true })} minimum` : ""}`, path: `/ordering/${o.supplierId}` });
  }
  if (drafted.length) add(false, { title: "Drafted orders", status: `${list(drafted.map((o) => o.supplier))} drafted — send when ready`, path: "/ordering" });
  else if (toOrder.length === 0) add(false, { title: "Orders", status: b.orders.length ? "Stock covers this week's deliveries" : "No deliveries this week", path: "/ordering" });

  const s = b.schedule;
  const laborNote = s.laborPct != null ? ` · labor ${pct(s.laborPct, 0)} of forecast` : "";
  if (s.published + s.drafts === 0) add(true, { title: "Build next week's schedule", status: "No shifts yet — draft one from the forecast in a tap", path: "/schedule" });
  else if (s.drafts > 0) add(true, { title: "Publish the schedule", status: `${plural(s.drafts, "draft shift")}${s.published ? `, ${s.published} published` : ""} · ${Math.round(s.hours)} h${laborNote}${s.open ? ` · ${s.open} open` : ""}`, path: "/schedule" });
  else add(s.open > 0, { title: s.open ? "Fill open shifts" : "Schedule", status: `Published · ${s.published} shifts · ${Math.round(s.hours)} h${laborNote}${s.open ? ` · ${s.open} open` : ""}`, path: "/schedule" });

  const req = b.requests.timeOff + b.requests.swaps;
  const reqText = [b.requests.timeOff ? `${b.requests.timeOff} time-off` : "", b.requests.swaps ? plural(b.requests.swaps, "shift swap") : ""].filter(Boolean).join(" and ");
  add(req > 0, { title: req ? "Answer staff requests" : "Staff requests", status: req ? `${reqText} waiting` : "Nothing waiting", path: "/schedule" });

  const rv = b.reviews.unreplied;
  add(rv > 0, { title: rv ? "Reply to reviews" : "Reviews", status: rv ? `${plural(rv, "critical review")} without a reply — drafts are ready` : "Every critical review has a reply", path: "/reviews" });

  const inc = b.increases;
  add(inc.length > 0, {
    title: inc.length ? "Price increases this week" : "Prices",
    status: inc.length ? `${list(inc.slice(0, 3).map((m) => `${m.ingredient ?? m.description} ${signedPct(m.changePct, 0)}`))}${inc.length > 3 ? ` and ${inc.length - 3} more` : ""}` : "No increases in the last 7 days",
    path: "/prices",
  });

  const over = b.overTarget;
  add(over.length > 0, { title: over.length ? "Menu items over target" : "Menu costs", status: over.length ? list(over.slice(0, 3).map((r) => `${r.name} ${pct(r.foodCostPct)}`)) + (over.length > 3 ? ` and ${over.length - 3} more` : "") : "Everything's on target", path: "/menu" });

  const g = b.gap;
  const gapBad = g != null && g.foodSales > 0 && g.unexplainedCost / g.foodSales > 0.02;
  add(gapBad, { title: "Margin gap", status: g == null ? "Needs two completed counts" : `${money(g.unexplainedCost, { whole: true })} unexplained between ${shortDate(g.from)} and ${shortDate(g.to)}`, path: "/variance" });

  if (b.unmapped.count) add(true, { title: "Square items without a recipe", status: `${plural(b.unmapped.count, "item")} sold ${money(b.unmapped.sales, { whole: true })} in the last 7 days with no recipe: ${list(b.unmapped.top.slice(0, 3).map((u) => u.name))}`, path: "/sales/square-menu" });
  const inv = b.decisions.find((d) => d.key === "invoiceIssues");
  if (inv) add(true, { title: "Invoice issues", status: inv.title, path: inv.href });

  const t = b.training;
  if (t && t.hasTypes) {
    const issues = [
      t.expired.length ? `${t.expired.length} expired` : "",
      t.expiring.length ? `${t.expiring.length} expiring in 30 days` : "",
      t.missing.length ? `${t.missing.length} missing` : "",
      t.overdue.length ? `${plural(t.overdue.length, "checklist")} overdue` : "",
    ].filter(Boolean);
    const names = [...t.expired, ...t.expiring, ...t.missing].slice(0, 3).map((x) => `${x.person} (${x.cert})`);
    add(issues.length > 0, { title: "Training & certificates", status: issues.length ? `${issues.join(" · ")}${names.length ? `: ${list(names)}` : ""}` : "Everyone's certificates are in date", path: "/team/training" });
  }

  const c = b.counts;
  add(c.overdue, { title: c.overdue ? "Count is overdue" : "Counts", status: c.last == null ? "No completed counts yet" : c.overdue ? `Last full count was ${c.daysSince} days ago (${shortDate(c.last)})` : `Last count ${shortDate(c.last)}`, path: "/count" });

  return {
    week: b.week,
    forecastTotal: b.forecast.total,
    salesTarget: b.budget?.sales ?? null,
    busiest: b.forecast.busiest.map((d) => d.date),
    events: b.forecast.events,
    laborPct: s.laborPct,
    laborTarget: b.budget?.laborPct ?? null,
    todo,
    clear,
    lastWeek: b.lastWeek
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
  };
}
