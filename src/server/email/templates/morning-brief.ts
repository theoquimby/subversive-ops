import type { ISODate } from "@/domain/dates";
import { dayDate } from "@/lib/format";
import { BRAND, badge, button, C, esc, footerText, h1, h2, link, list, manageFooter, p, RenderedEmail, shell, small, textLines, type Tone } from "../layout";

/** A text-only view of the morning brief (see `morningDigest` in ../morning-digest). Mirrors /brief. */
export interface MorningDigest {
  date: ISODate;
  weekdayName: string;
  /** "$4,210 in sales, 8% over forecast. Labor 24%, about $1,380 profit." */
  yesterday: { line: string; flags: { text: string; tone: Tone }[] } | null;
  today: {
    closed: boolean;
    /** "$3,900 forecast · busiest 5–8pm" */
    headline: string;
    /** "Rain, 48°F / 39°F" */
    weather: string | null;
    events: string[];
    crew: { line: string; tone: Tone } | null;
  };
  tonight: { title: string; detail: string; path: string; tone: Tone }[];
  prepPath: string | null;
  insight: { title: string; action: string; value: string } | null;
  notes: { who: string; summary: string; followUp: boolean }[];
  /** Monday edition only. */
  wrap: { range: string; lines: string[] } | null;
}

export interface MorningBriefEmail {
  name: string;
  digest: MorningDigest;
  baseUrl: string;
}

const first = (name: string) => name.trim().split(/\s+/)[0] || name;
const FONT = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`;
const toneColor = (t: Tone) => (t === "bad" ? C.bad : t === "warn" ? C.warn : t === "good" ? C.good : C.ink2);

/** A quiet label + line block, like the cards on /brief. */
const block = (label: string, html: string) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 10px 0;border:1px solid ${C.border};border-radius:10px;border-collapse:separate;"><tr><td style="padding:12px 14px;font:400 14px/1.5 ${FONT};color:${C.ink};">
<div style="font:600 12px/1.4 ${FONT};color:${C.muted};text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px;">${esc(label)}</div>${html}</td></tr></table>`;

export function morningBriefEmail(e: MorningBriefEmail): RenderedEmail {
  const d = e.digest;
  const n = d.tonight.length;
  const subject = d.today.closed
    ? `${d.weekdayName}: closed today${n ? ` · ${n} to do` : ""}`
    : `${d.weekdayName}: ${d.today.headline}${n ? ` · ${n} before tonight` : ""}`;
  const briefUrl = link(e.baseUrl, "/brief");

  const flags = (d.yesterday?.flags ?? []).map((f) => badge(f.text, f.tone)).join(" ");
  const todayHtml = [
    `<div style="font:600 17px/1.35 ${FONT};color:${C.ink};">${esc(d.today.closed ? "Closed today" : d.today.headline)}</div>`,
    [d.today.weather, ...d.today.events].filter(Boolean).length ? `<div style="margin-top:3px;color:${C.ink2};">${esc([d.today.weather, ...d.today.events].filter(Boolean).join(" · "))}</div>` : "",
    d.today.crew ? `<div style="margin-top:3px;color:${toneColor(d.today.crew.tone)};">${esc(d.today.crew.line)}</div>` : "",
  ].join("");

  const html = shell({
    preheader: [d.yesterday ? `Yesterday: ${d.yesterday.line}` : "", n ? `${n} before tonight` : "Nothing urgent before tonight"].filter(Boolean).join(" · "),
    body: [
      h1(`Good morning, ${first(e.name)}`),
      p(esc(dayDate(d.date)), true),
      d.yesterday ? block("Yesterday", `${esc(d.yesterday.line)}${flags ? `<div style="margin-top:8px;line-height:2;">${flags}</div>` : ""}`) : "",
      block("Today", todayHtml),
      h2(n ? "Before tonight" : "Before tonight: nothing urgent"),
      n ? list(d.tonight.map((t) => ({ title: t.title, detail: t.detail, href: link(e.baseUrl, t.path) }))) : p("Orders, invoices, kegs and requests are all clear."),
      d.prepPath ? small(`<a href="${esc(link(e.baseUrl, d.prepPath))}" style="color:${C.ink};">Today's prep list</a>`) : "",
      d.insight ? h2("One thing to act on") + list([{ title: d.insight.title, detail: d.insight.action, value: esc(d.insight.value), href: link(e.baseUrl, "/brief#insight") }]) : "",
      d.notes.length ? h2("Last night's notes") + list(d.notes.map((x) => ({ title: x.who, detail: x.summary, value: x.followUp ? badge("Follow up", "warn") : undefined }))) : "",
      d.wrap ? h2(`Last week (${d.wrap.range})`) + p(esc(d.wrap.lines.join(" "))) : "",
      button(briefUrl, "Open the brief"),
    ].join("\n"),
    footer: manageFooter(e.baseUrl),
  });

  const text = textLines(
    `Good morning, ${first(e.name)}. ${dayDate(d.date)}.`,
    "",
    d.yesterday ? `YESTERDAY: ${d.yesterday.line}` : null,
    ...(d.yesterday?.flags ?? []).map((f) => `- ${f.text}`),
    d.yesterday ? "" : null,
    `TODAY: ${d.today.closed ? "Closed today" : d.today.headline}`,
    d.today.weather,
    ...d.today.events.map((x) => `- ${x}`),
    d.today.crew?.line ?? null,
    "",
    n ? "BEFORE TONIGHT" : "BEFORE TONIGHT: nothing urgent",
    ...d.tonight.map((t) => `- ${t.title}: ${t.detail} (${link(e.baseUrl, t.path)})`),
    d.prepPath ? `Prep list: ${link(e.baseUrl, d.prepPath)}` : null,
    d.insight ? "" : null,
    d.insight ? `ONE THING TO ACT ON: ${d.insight.title} (${d.insight.value}). ${d.insight.action}` : null,
    d.notes.length ? "" : null,
    d.notes.length ? "LAST NIGHT'S NOTES" : null,
    ...d.notes.map((x) => `- ${x.who}: ${x.summary}${x.followUp ? " [follow up]" : ""}`),
    d.wrap ? "" : null,
    d.wrap ? `LAST WEEK (${d.wrap.range}): ${d.wrap.lines.join(" ")}` : null,
    "",
    `Full brief: ${briefUrl}`,
    footerText(`${BRAND} morning brief`),
  );
  return { subject, html, text };
}

/** Sample for the dev preview page and the template tests. */
export const MORNING_SAMPLE: MorningDigest = {
  date: "2026-11-16",
  weekdayName: "Monday",
  yesterday: { line: "$4,210 in sales, 8% over forecast. Labor 24% (target 26%), about $1,380 profit.", flags: [{ text: "2 items 86'd", tone: "warn" }, { text: "$38 in comps", tone: "neutral" }] },
  today: { closed: false, headline: "$3,150 forecast · busiest 5–8pm", weather: "Rain, 48°F / 39°F", events: ["Trivia night 7pm"], crew: { line: "Short one person 6–8pm.", tone: "warn" } },
  tonight: [
    { title: "Order from Sysco Albany", detail: "Due today 2pm · delivers Wed", path: "/ordering", tone: "warn" },
    { title: "2 invoices to approve", detail: "1 with a price or quantity issue", path: "/invoices?status=OPEN", tone: "warn" },
    { title: "Hazy IPA: no full keg behind it", detail: "Fill or plan what goes on that line", path: "/kegs", tone: "warn" },
  ],
  prepPath: "/prep",
  insight: { title: "Wings are under-priced for what they cost", action: "Raise wings by $1", value: "$410/mo" },
  notes: [{ who: "Close · Jamie", summary: "Slammed · 86'd Wings, Hazy IPA · Fix: Ice machine · $38 comps: Cold burger", followUp: true }],
  wrap: { range: "Nov 9 – Nov 15", lines: ["$24,180 in sales, 3% under budget.", "Labor 27%, about $6,900 profit before fixed costs.", "Best day: Saturday, $5,840."] },
};
