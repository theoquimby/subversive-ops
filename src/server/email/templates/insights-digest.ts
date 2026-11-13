import { money } from "@/lib/format";
import { BRAND, button, esc, footerText, h1, link, list, manageFooter, p, RenderedEmail, shell, small, textLines } from "../layout";

/** One finding in the weekly "3 things worth your attention" digest. */
export interface InsightDigestItem {
  title: string;
  action: string;
  monthly: number;
  oneOff: number | null;
  /** 0..1 */
  confidence: number;
  href: string;
}

export interface InsightsDigestEmail {
  name: string;
  items: InsightDigestItem[];
  baseUrl: string;
}

const first = (name: string) => name.trim().split(/\s+/)[0] || name;
const conf = (c: number) => (c >= 0.65 ? "solid" : c >= 0.4 ? "fair" : "rough");
const worth = (i: InsightDigestItem) => (i.oneOff ? `${money(i.oneOff, { whole: true })} one-off` : `~${money(i.monthly, { whole: true })}/month`);

/** Subject + push text. */
export function insightsDigestSummary(items: InsightDigestItem[]): { title: string; body: string } {
  const n = items.length;
  return {
    title: n === 1 ? "1 thing worth your attention" : `${n} things worth your attention`,
    body: items.map((i) => `${i.title} (${worth(i)})`).join(" · "),
  };
}

export function insightsDigestEmail(e: InsightsDigestEmail): RenderedEmail {
  const s = insightsDigestSummary(e.items);
  const url = link(e.baseUrl, "/insights");
  const html = shell({
    preheader: s.body,
    body: [
      h1(s.title),
      p(`Hi ${esc(first(e.name))} — from this week's numbers, ranked by what they're worth and how sure we are. Anything you've already seen only comes back if it changed.`),
      list(e.items.map((i) => ({ title: i.title, detail: `${i.action} · ${conf(i.confidence)} confidence`, value: esc(worth(i)), href: link(e.baseUrl, i.href) }))),
      button(url, "Open Insights"),
      small("Mark each one Done, Later or Not useful on the Insights page — it learns what you care about."),
    ].join("\n"),
    footer: manageFooter(e.baseUrl),
  });
  const text = textLines(`Hi ${first(e.name)},`, "", `${s.title}:`, "", ...e.items.map((i, n) => `${n + 1}. ${i.title} — ${worth(i)}, ${conf(i.confidence)} confidence\n   ${i.action}`), "", `Open Insights: ${url}`, footerText(`${BRAND} insights`));
  return { subject: s.title, html, text };
}
