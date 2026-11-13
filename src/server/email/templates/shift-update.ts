import type { ISODate } from "@/domain/dates";
import { dayDate, shortDate } from "@/lib/format";
import { badge, BRAND, button, esc, footerText, h1, link, list, p, RenderedEmail, shell, staffFooter, textLines } from "../layout";
import { shiftTime, type ScheduleShift } from "./schedule-published";

type Shift = Omit<ScheduleShift, "hours" | "notes">;

/** One template for the small "something about your shift changed" messages. */
export type ShiftUpdate =
  | { kind: "changed"; before: Shift | null; after: Shift | null; /** false when the previous state is unknown: "updated" rather than "added". */ added?: boolean }
  | { kind: "swap"; role: "requester" | "taker"; approved: boolean; shift: Shift; otherName: string | null }
  | { kind: "timeOff"; approved: boolean; startDate: ISODate; endDate: ISODate; note?: string | null };

export interface ShiftUpdateEmail {
  name: string;
  update: ShiftUpdate;
  baseUrl: string;
}

const first = (name: string) => name.trim().split(/\s+/)[0] || name;
const range = (a: ISODate, b: ISODate) => (a === b ? dayDate(a) : `${dayDate(a)} – ${dayDate(b)}`);

function content(u: ShiftUpdate): { subject: string; title: string; status?: { label: string; tone: "good" | "bad" | "neutral" }; lines: string[]; rows: { title: string; detail?: string; value?: string }[] } {
  switch (u.kind) {
    case "changed": {
      if (!u.before && u.after && u.added === false) return { subject: `Shift updated: ${dayDate(u.after.date)}`, title: "Your shift was updated", lines: [], rows: [{ title: dayDate(u.after.date), detail: u.after.position, value: esc(shiftTime(u.after)) }] };
      if (!u.before && u.after) return { subject: `New shift: ${dayDate(u.after.date)}`, title: "You've been added to a shift", lines: [], rows: [{ title: dayDate(u.after.date), detail: u.after.position, value: esc(shiftTime(u.after)) }] };
      if (u.before && !u.after) return { subject: `Shift removed: ${dayDate(u.before.date)}`, title: "A shift was taken off your schedule", status: { label: "Removed", tone: "neutral" }, lines: [], rows: [{ title: dayDate(u.before.date), detail: u.before.position, value: `<s>${esc(shiftTime(u.before))}</s>` }] };
      const b = u.before!;
      const a = u.after!;
      return {
        subject: `Shift changed: ${dayDate(a.date)}`,
        title: "Your shift changed",
        lines: ["Here's the new time."],
        rows: [
          { title: "Was", detail: b.position, value: `<span style="color:#85837c;">${esc(`${dayDate(b.date)} · ${shiftTime(b)}`)}</span>` },
          { title: "Now", detail: a.position, value: `<strong>${esc(`${dayDate(a.date)} · ${shiftTime(a)}`)}</strong>` },
        ],
      };
    }
    case "swap": {
      const when = dayDate(u.shift.date);
      if (u.role === "taker") {
        return u.approved
          ? { subject: `You picked up ${when}`, title: "The shift is yours", status: { label: "Approved", tone: "good" }, lines: [`A manager approved it${u.otherName ? ` — you're covering for ${u.otherName}` : ""}.`], rows: [{ title: when, detail: u.shift.position, value: esc(shiftTime(u.shift)) }] }
          : { subject: `Swap for ${when} wasn't approved`, title: "That swap didn't go through", status: { label: "Not approved", tone: "bad" }, lines: [`The shift stays with ${u.otherName ?? "the original person"}.`], rows: [{ title: when, detail: u.shift.position, value: esc(shiftTime(u.shift)) }] };
      }
      return u.approved
        ? { subject: `Swap approved: ${when}`, title: "Your swap was approved", status: { label: "Approved", tone: "good" }, lines: [`${u.otherName ? `${u.otherName} is taking it` : "Someone else is taking it"} — it's off your schedule.`], rows: [{ title: when, detail: u.shift.position, value: `<s>${esc(shiftTime(u.shift))}</s>` }] }
        : { subject: `Swap not approved: ${when}`, title: "Your swap wasn't approved", status: { label: "Not approved", tone: "bad" }, lines: ["You're still on this shift. Talk to a manager if you can't make it."], rows: [{ title: when, detail: u.shift.position, value: esc(shiftTime(u.shift)) }] };
    }
    case "timeOff": {
      const when = range(u.startDate, u.endDate);
      return u.approved
        ? { subject: `Time off approved: ${shortDate(u.startDate)}${u.startDate !== u.endDate ? `–${shortDate(u.endDate)}` : ""}`, title: "Your time off is approved", status: { label: "Approved", tone: "good" }, lines: ["You won't be scheduled on these days."], rows: [{ title: when, detail: u.note ?? undefined }] }
        : { subject: `Time off not approved: ${shortDate(u.startDate)}${u.startDate !== u.endDate ? `–${shortDate(u.endDate)}` : ""}`, title: "Your time off wasn't approved", status: { label: "Not approved", tone: "bad" }, lines: ["Talk to a manager if you need these days — a swap may still work."], rows: [{ title: when, detail: u.note ?? undefined }] };
    }
  }
}

export function shiftUpdateEmail(e: ShiftUpdateEmail): RenderedEmail {
  const c = content(e.update);
  const myUrl = link(e.baseUrl, "/my");
  const html = shell({
    preheader: `${c.title}. ${c.lines.join(" ")}`.trim(),
    body: [
      c.status ? `<div style="margin-bottom:10px;">${badge(c.status.label, c.status.tone)}</div>` : "",
      h1(c.title),
      p(`Hi ${esc(first(e.name))}${c.lines.length ? ` — ${esc(c.lines.join(" "))}` : "."}`),
      list(c.rows),
      button(myUrl, "Open my shifts"),
    ].join("\n"),
    footer: staffFooter(e.baseUrl),
  });
  const text = textLines(
    `Hi ${first(e.name)},`,
    "",
    `${c.title}.${c.lines.length ? ` ${c.lines.join(" ")}` : ""}`,
    "",
    ...c.rows.map((r) => `- ${r.title}${r.value ? `: ${r.value.replace(/<[^>]+>/g, "")}` : ""}${r.detail ? ` · ${r.detail}` : ""}`),
    "",
    `My shifts: ${myUrl}`,
    footerText(`${BRAND} schedule`),
  );
  return { subject: c.subject, html, text };
}

/** Short version for push notifications. */
export function shiftUpdatePush(u: ShiftUpdate): { title: string; body: string } {
  const c = content(u);
  return { title: c.title, body: [c.rows[0] ? `${c.rows[0].title}${c.rows[0].value ? ` · ${c.rows[0].value.replace(/<[^>]+>/g, "")}` : ""}` : "", ...c.lines].filter(Boolean).join(". ") };
}
