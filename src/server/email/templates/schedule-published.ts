import type { ISODate } from "@/domain/dates";
import { formatMinutes } from "@/domain/schedule";
import { dayDate, shortDate } from "@/lib/format";
import { BRAND, button, esc, footerText, h1, link, list, p, RenderedEmail, shell, staffFooter, textLines } from "../layout";

export interface ScheduleShift {
  date: ISODate;
  startMin: number;
  endMin: number;
  position: string;
  hours: number;
  notes?: string | null;
}

export interface SchedulePublishedEmail {
  name: string;
  weekStart: ISODate;
  shifts: ScheduleShift[];
  baseUrl: string;
}

const first = (name: string) => name.trim().split(/\s+/)[0] || name;
const hrs = (n: number) => `${Number(n.toFixed(2))} h`;
export const shiftTime = (s: Pick<ScheduleShift, "startMin" | "endMin">) => `${formatMinutes(s.startMin)} – ${formatMinutes(s.endMin)}`;

export function schedulePublishedEmail(e: SchedulePublishedEmail): RenderedEmail {
  const week = shortDate(e.weekStart);
  const total = e.shifts.reduce((s, x) => s + x.hours, 0);
  const shifts = [...e.shifts].sort((a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin);
  const myUrl = link(e.baseUrl, "/my");
  const summary = shifts.length
    ? `${shifts.length} shift${shifts.length === 1 ? "" : "s"} · ${hrs(total)}`
    : "You're not on the schedule this week";
  const subject = `Your shifts for the week of ${week}`;

  const html = shell({
    preheader: `${summary}. Tap to see them in the app.`,
    body: [
      h1(`Week of ${week}`),
      p(`Hi ${esc(first(e.name))} — the schedule is out. ${shifts.length ? `You have <strong>${esc(summary)}</strong>.` : "You're not on it this week. If that's a surprise, check with a manager."}`),
      shifts.length
        ? list(shifts.map((s) => ({ title: dayDate(s.date), detail: `${s.position}${s.notes ? ` · ${s.notes}` : ""}`, value: esc(shiftTime(s)) })))
        : "",
      button(myUrl, "Open my shifts"),
      p(`Need to swap or can't make one? Request it in the app so a manager sees it.`, true),
    ].join("\n"),
    footer: staffFooter(e.baseUrl),
  });

  const text = textLines(
    `Hi ${first(e.name)},`,
    "",
    `The schedule for the week of ${week} is out. ${shifts.length ? `You have ${summary}:` : "You're not on it this week."}`,
    "",
    ...shifts.map((s) => `- ${dayDate(s.date)}: ${shiftTime(s)} · ${s.position}${s.notes ? ` (${s.notes})` : ""}`),
    "",
    `See your shifts, swap or ask for time off: ${myUrl}`,
    footerText(`${BRAND} schedule`),
  );
  return { subject, html, text };
}
