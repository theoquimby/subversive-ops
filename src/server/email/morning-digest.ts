import { money } from "@/lib/format";
import { needsFollowUp, noteSummary, shiftLabel } from "@/domain/shiftNotes";
import { shortDate } from "@/lib/format";
import { elsewhereGroups, focusLabels, showSection, splitByFocus, type ElsewhereGroup, type Focus } from "@/domain/focus";
import type { MorningBrief, TonightItem } from "@/server/services/morningBrief";
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

/**
 * The morning brief for someone's focus (domain/focus): "Before tonight" keeps
 * their areas and anything urgent; the rest becomes a line per area under
 * Elsewhere, with today's forecast and crew standing in when an area has
 * nothing waiting. No focus: everything, as before.
 */
export function morningForFocus(b: MorningBrief, focus: readonly Focus[]): { tonight: TonightItem[]; elsewhere: ElsewhereGroup<TonightItem>[] } {
  const { mine, elsewhere } = splitByFocus(b.tonight, focus);
  const notes: Partial<Record<Focus, string>> = {
    business: b.day.closed ? "Closed today" : b.day.forecast && b.day.forecast > 0 ? `Today: ${todayHeadline(b)}` : undefined,
    people: b.crew && !b.day.closed ? `${b.crew.people} on today. ${b.crew.check.line}` : undefined,
  };
  return { tonight: mine, elsewhere: elsewhereGroups(elsewhere, focus, notes) };
}

/** The /brief page as plain text for the email. Mirrors app/(app)/brief/morning.tsx. No focus: everything, as before. */
export function morningDigest(b: MorningBrief, insight: { title: string; action: string; monthly: number; oneOff: number | null } | null, focus: readonly Focus[] = []): MorningDigest {
  const f = morningForFocus(b, focus);
  const show = (s: Parameters<typeof showSection>[0]) => showSection(s, focus);
  return {
    date: b.today,
    weekdayName: b.weekdayName,
    yesterday: show("yesterday") && b.y && !b.y.closed ? { line: b.y.line, flags: b.y.flags.map((f) => ({ text: f.text, tone: f.tone })) } : null,
    today: !show("today") ? null : {
      closed: b.day.closed,
      headline: todayHeadline(b),
      weather: weatherLine(b),
      events: [
        ...b.day.events.map((e) => `${e.title}${clock(e.startTime)}`),
        ...b.parties.today.map((p) => `${p.title} · ${p.headcount} guests${clock(p.startTime)}`),
        ...b.parties.tomorrow.map((p) => `Tomorrow: ${p.title} · ${p.headcount} guests${clock(p.startTime)}`),
      ],
      crew: b.crew && !b.day.closed ? { line: `${b.crew.people} on today. ${b.crew.check.line}`, tone: b.crew.check.tone } : null,
    },
    tonight: f.tonight.slice(0, 8).map((t) => ({ title: t.title, detail: t.detail, path: t.href, tone: t.tone })),
    prepPath: b.prep && (focus.length === 0 || focus.includes("kitchen")) ? "/prep" : null,
    insight: insight && show("insight") ? { title: insight.title, action: insight.action, value: insight.oneOff ? whole(insight.oneOff) : `${whole(insight.monthly)}/mo` } : null,
    notes: show("notes") ? b.notes.slice(0, 4).map((n) => ({ who: `${shiftLabel(n.shift)} · ${n.authorName}`, summary: noteSummary(n), followUp: needsFollowUp(n) })) : [],
    wrap: b.wrap && show("wrap") ? { range: `${shortDate(b.wrap.from)} – ${shortDate(b.wrap.to)}`, lines: b.wrap.lines } : null,
    ...(focus.length
      ? {
          focus: focusLabels(focus),
          elsewhere: f.elsewhere.map((g) => ({ label: g.label, count: g.items.length, line: g.line, path: g.items[0]?.href ?? g.href })),
        }
      : {}),
  };
}
