import { money } from "@/lib/format";
import { needsFollowUp, noteSummary, shiftLabel } from "@/domain/shiftNotes";
import { shortDate } from "@/lib/format";
import type { MorningBrief } from "@/server/services/morningBrief";
import type { MorningDigest } from "./templates/morning-brief";

const whole = (n: number) => money(n, { whole: true });

/** "$3,150 forecast · busiest 5–8pm" (or the range when the statistical forecast has one). */
export function todayHeadline(b: MorningBrief): string {
  const f = b.day.forecast;
  if (f == null || f <= 0) return "No forecast yet";
  return [`${whole(f)} forecast`, b.day.busy ? `busiest ${b.day.busy.label}` : ""].filter(Boolean).join(" · ");
}

export function weatherLine(b: MorningBrief): string | null {
  const w = b.day.weather;
  return w ? `${w.label}, ${w.hiF}°F / ${w.loF}°F` : null;
}

const clock = (hhmm: string | null) => {
  if (!hhmm) return "";
  const h = Number(hhmm.slice(0, 2));
  const m = hhmm.slice(3, 5);
  return ` ${h % 12 === 0 ? 12 : h % 12}${m === "00" ? "" : `:${m}`}${h < 12 ? "am" : "pm"}`;
};

/** The /brief page as plain text for the email. Mirrors app/(app)/brief/morning.tsx. */
export function morningDigest(b: MorningBrief, insight: { title: string; action: string; monthly: number; oneOff: number | null } | null): MorningDigest {
  return {
    date: b.today,
    weekdayName: b.weekdayName,
    yesterday: b.y && !b.y.closed ? { line: b.y.line, flags: b.y.flags.map((f) => ({ text: f.text, tone: f.tone })) } : null,
    today: {
      closed: b.day.closed,
      headline: todayHeadline(b),
      weather: weatherLine(b),
      events: b.day.events.map((e) => `${e.title}${clock(e.startTime)}`),
      crew: b.crew && !b.day.closed ? { line: `${b.crew.people} on today. ${b.crew.check.line}`, tone: b.crew.check.tone } : null,
    },
    tonight: b.tonight.slice(0, 8).map((t) => ({ title: t.title, detail: t.detail, path: t.href, tone: t.tone })),
    prepPath: b.prep ? "/prep" : null,
    insight: insight ? { title: insight.title, action: insight.action, value: insight.oneOff ? whole(insight.oneOff) : `${whole(insight.monthly)}/mo` } : null,
    notes: b.notes.slice(0, 4).map((n) => ({ who: `${shiftLabel(n.shift)} · ${n.authorName}`, summary: noteSummary(n), followUp: needsFollowUp(n) })),
    wrap: b.wrap ? { range: `${shortDate(b.wrap.from)} – ${shortDate(b.wrap.to)}`, lines: b.wrap.lines } : null,
  };
}
