import type { LabFinding } from "./lab";
import { sourceLabel, wilson } from "./webAnalytics";
import type { SalesLink } from "./webStats";

/**
 * Website findings for the Insights feed. Only things that are true by a
 * comfortable margin and lead to something Max can do; no dollar figures
 * the data can't support (they rank by the feed's floor, below money findings).
 */

export interface WebFindingInput {
  /** Last 28 days: direction clicks by source */
  directionsBySource: { source: string; count: number }[];
  /** Last 28 days: visits and visits with an action, by source */
  sources: { source: string; sessions: number; converted: number }[];
  total: { sessions: number; converted: number };
  link: SalesLink | null;
}

const pct = (f: number) => `${Math.round(f * 100)}%`;

export function webFindings(i: WebFindingInput): LabFinding[] {
  const out: LabFinding[] = [];

  // 1. Where direction clicks come from.
  const dirTotal = i.directionsBySource.reduce((s, r) => s + r.count, 0);
  const top = [...i.directionsBySource].sort((a, b) => b.count - a.count)[0];
  if (top && dirTotal >= 30) {
    const w = wilson(top.count, dirTotal)!;
    if (w.low >= 0.25) {
      const google = top.source.startsWith("google");
      out.push({
        key: `web.directions.source.${top.source}`,
        kind: "web.directions.source",
        model: "website",
        title: `${sourceLabel(top.source)} sends ${pct(w.rate)} of your website's direction clicks`,
        action: google ? "Keep the Google listing's hours, photos and menu link current: it's where most people decide to come." : `Keep ${sourceLabel(top.source)} up to date: it's where most people who come find the way.`,
        monthly: 0,
        low: 0,
        high: 0,
        confidence: Math.min(0.7, 0.35 + dirTotal / 400),
        how: [`Last 28 days: ${top.count} of ${dirTotal} direction clicks on the website came from visits that started on ${sourceLabel(top.source)}.`, `Likely between ${pct(w.low)} and ${pct(w.high)} of them.`],
        inputs: [
          { label: "Direction clicks", value: String(dirTotal) },
          { label: `From ${sourceLabel(top.source)}`, value: String(top.count) },
        ],
        href: "/website/analytics#actions",
        subject: `directions:${top.source}`,
        area: "hours",
        effort: "easy",
        vector: "earn",
        story: {
          now: `${pct(w.rate)} of the people who tap Directions on the website arrived from ${sourceLabel(top.source)}.`,
          why: "That's the step right before they get in the car.",
          todo: google ? "Check the Google listing: hours, holiday hours, photos, the menu link." : `Check ${sourceLabel(top.source)}: hours, photos and the link to the menu.`,
          gain: "",
        },
      });
    }
  }

  // 2. A source that brings plenty of visits but clearly fewer actions than the site overall.
  const all = i.total.sessions > 0 ? i.total.converted / i.total.sessions : 0;
  for (const s of i.sources) {
    if (s.sessions < 80 || s.source === "direct") continue;
    const w = wilson(s.converted, s.sessions)!;
    if (w.high < all * 0.6 && s.sessions >= i.total.sessions * 0.1) {
      out.push({
        key: `web.source.weak.${s.source}`,
        kind: "web.source.weak",
        model: "website",
        title: `Visits from ${sourceLabel(s.source)} rarely lead anywhere: ${pct(w.rate)} act, against ${pct(all)} overall`,
        action: `Check where ${sourceLabel(s.source)} links point: send them to the menu or this week's events, not the home page.`,
        monthly: 0,
        low: 0,
        high: 0,
        confidence: 0.45,
        how: [`Last 28 days: ${s.converted} of ${s.sessions} visits from ${sourceLabel(s.source)} called, got directions, ordered, booked or inquired (likely ${pct(w.low)}–${pct(w.high)}).`, `Across the whole site it's ${pct(all)}.`],
        inputs: [
          { label: "Visits", value: String(s.sessions) },
          { label: "Took an action", value: String(s.converted) },
        ],
        href: "/website/analytics#sources",
        subject: `weak:${s.source}`,
        area: "menu",
        effort: "easy",
        vector: "earn",
      });
      break;
    }
  }

  // 3. Website actions and sales: only when it survived the controls.
  if (i.link?.verdict === "real" && i.link.effect && i.link.effect.mid > 0) {
    out.push({
      key: "web.sales.link",
      kind: "web.sales.link",
      model: "website",
      title: `Busier website days go with ${pct(i.link.effect.mid)} more sales`,
      action: "Keep the website's events and menu current before busy weekends; it's part of how people decide.",
      monthly: 0,
      low: 0,
      high: 0,
      confidence: 0.4,
      how: [i.link.sentence, `Compared within each weekday, with a trend for the season and event days left out (${i.link.n} days).`],
      inputs: [{ label: "Days compared", value: String(i.link.n) }],
      href: "/website/analytics#sales",
      subject: "sales-link",
      area: "menu",
      effort: "easy",
      vector: "earn",
    });
  }
  return out;
}
