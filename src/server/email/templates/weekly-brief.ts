import type { ISODate } from "@/domain/dates";
import { addDays } from "@/domain/dates";
import { dayDate, money, pct, shortDate } from "@/lib/format";
import { BRAND, button, esc, footerText, h1, h2, link, list, manageFooter, p, RenderedEmail, shell, textLines } from "../layout";

export interface BriefDigestItem {
  title: string;
  status: string;
  /** App path, e.g. "/schedule". */
  path?: string;
}

/** A text-only view of the weekly brief (see `briefDigest` in ../brief-digest). */
export interface BriefDigest {
  week: ISODate;
  forecastTotal: number;
  salesTarget: number | null;
  busiest: ISODate[];
  events: { date: ISODate; title: string }[];
  laborPct: number | null;
  laborTarget: number | null;
  todo: BriefDigestItem[];
  clear: BriefDigestItem[];
  /** Last week's actuals vs budget, one line each ("Food cost", "31.2%", "target 30.0%"). */
  lastWeek?: { from: ISODate; to: ISODate; rows: { label: string; actual: string; target: string | null; tone: "good" | "warn" | "bad" | "neutral" }[] } | null;
}

export interface WeeklyBriefEmail {
  name: string;
  digest: BriefDigest;
  baseUrl: string;
}

const first = (name: string) => name.trim().split(/\s+/)[0] || name;
const fullDay = (d: ISODate) => new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
const joinList = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

export function weeklyBriefEmail(e: WeeklyBriefEmail): RenderedEmail {
  const d = e.digest;
  const range = `${shortDate(d.week)} – ${shortDate(addDays(d.week, 6))}`;
  const n = d.todo.length;
  const subject = n ? `Week of ${shortDate(d.week)}: ${n} thing${n === 1 ? " needs" : "s need"} you` : `Week of ${shortDate(d.week)}: all in hand`;
  const briefUrl = link(e.baseUrl, "/brief");

  const forecast: string[] = [];
  if (d.forecastTotal > 0) {
    forecast.push(`We're forecasting ${money(d.forecastTotal, { whole: true })} in sales${d.salesTarget ? ` (${d.forecastTotal >= d.salesTarget ? "above" : "below"} the ${money(d.salesTarget, { whole: true })} target)` : ""}${d.busiest.length ? `, busiest on ${joinList(d.busiest.map(fullDay))}` : ""}.`);
  }
  if (d.laborPct != null) forecast.push(`Labor is scheduled at ${pct(d.laborPct, 0)} of forecast${d.laborTarget != null ? ` vs ${pct(d.laborTarget, 0)} target` : ""}.`);
  if (d.events.length) forecast.push(`On the calendar: ${joinList(d.events.map((x) => `${x.title} (${dayDate(x.date)})`))}.`);

  const html = shell({
    preheader: `${n ? `${n} to do` : "Nothing urgent"}${d.forecastTotal > 0 ? ` · ${money(d.forecastTotal, { whole: true })} forecast` : ""}`,
    body: [
      h1(`Week of ${range}`),
      p(`Hi ${esc(first(e.name))}. ${esc(forecast.join(" "))} ${n === 0 ? "Everything else is in hand." : `${n} thing${n === 1 ? " needs" : "s need"} you before the week starts.`}`),
      d.lastWeek && d.lastWeek.rows.length
        ? h2(`Last week (${shortDate(d.lastWeek.from)} – ${shortDate(d.lastWeek.to)})`) +
          list(d.lastWeek.rows.map((r) => ({ title: r.label, detail: r.target ? `Target ${r.target}` : "No target", value: `<span style="color:${r.tone === "bad" ? "#b42318" : r.tone === "warn" ? "#b54708" : r.tone === "good" ? "#067647" : "inherit"};">${esc(r.actual)}</span>` })))
        : "",
      n ? h2("Needs you") + list(d.todo.map((i) => ({ title: i.title, detail: i.status, href: i.path ? link(e.baseUrl, i.path) : undefined }))) : "",
      d.clear.length ? h2("In hand") + list(d.clear.map((i) => ({ title: i.title, detail: i.status }))) : "",
      button(briefUrl, "Open the brief"),
    ].join("\n"),
    footer: manageFooter(e.baseUrl),
  });

  const text = textLines(
    `Hi ${first(e.name)},`,
    "",
    `Week of ${range}. ${forecast.join(" ")}`,
    "",
    d.lastWeek ? `LAST WEEK (${shortDate(d.lastWeek.from)} – ${shortDate(d.lastWeek.to)})` : null,
    ...(d.lastWeek?.rows ?? []).map((r) => `- ${r.label}: ${r.actual}${r.target ? ` (target ${r.target})` : ""}`),
    d.lastWeek ? "" : null,
    n ? "NEEDS YOU" : null,
    ...d.todo.map((i) => `- ${i.title}: ${i.status}${i.path ? ` (${link(e.baseUrl, i.path)})` : ""}`),
    n ? "" : null,
    d.clear.length ? "IN HAND" : null,
    ...d.clear.map((i) => `- ${i.title}: ${i.status}`),
    "",
    `Full brief: ${briefUrl}`,
    footerText(`${BRAND} weekly brief`),
  );
  return { subject, html, text };
}
