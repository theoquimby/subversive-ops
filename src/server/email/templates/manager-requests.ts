import type { ISODate } from "@/domain/dates";
import { dayDate } from "@/lib/format";
import { BRAND, button, esc, footerText, h1, link, list, manageFooter, p, RenderedEmail, shell, textLines } from "../layout";
import { shiftTime, type ScheduleShift } from "./schedule-published";

type Shift = Omit<ScheduleShift, "hours" | "notes">;

/** Something a staff member asked for that a manager has to decide. */
export type StaffRequest =
  | { kind: "timeOff"; employee: string; type: "PTO" | "SICK" | "UNPAID"; startDate: ISODate; endDate: ISODate; hours: number | null; note: string | null; /** Published shifts they're on in that range. */ shiftsAffected: number }
  | { kind: "swap"; employee: string; shift: Shift; taker: string | null };

export interface StaffRequestEmail {
  name: string;
  request: StaffRequest;
  baseUrl: string;
}

const first = (name: string) => name.trim().split(/\s+/)[0] || name;
const range = (a: ISODate, b: ISODate) => (a === b ? dayDate(a) : `${dayDate(a)} – ${dayDate(b)}`);
const LEAVE: Record<string, string> = { PTO: "Paid time off", SICK: "Sick time", UNPAID: "Time off" };

/** Short title + body, shared by the email and the push. */
export function staffRequestSummary(r: StaffRequest): { title: string; body: string } {
  if (r.kind === "timeOff") {
    const hours = r.hours != null ? ` · ${Number(r.hours.toFixed(2))} h` : "";
    return {
      title: `${r.employee} asked for ${r.type === "SICK" ? "sick time" : "time off"}`,
      body: `${range(r.startDate, r.endDate)}${hours}${r.shiftsAffected ? ` · on ${r.shiftsAffected} shift${r.shiftsAffected === 1 ? "" : "s"}` : ""}`,
    };
  }
  return {
    title: `${r.employee} wants to swap a shift`,
    body: `${dayDate(r.shift.date)} ${shiftTime(r.shift)} · ${r.shift.position}${r.taker ? ` · ${r.taker} would take it` : " · open to anyone"}`,
  };
}

export function staffRequestEmail(e: StaffRequestEmail): RenderedEmail {
  const r = e.request;
  const s = staffRequestSummary(r);
  const url = link(e.baseUrl, "/schedule/requests");
  const rows =
    r.kind === "timeOff"
      ? [
          { title: LEAVE[r.type] ?? "Time off", detail: r.hours != null ? `${Number(r.hours.toFixed(2))} hours` : undefined, value: esc(range(r.startDate, r.endDate)) },
          ...(r.shiftsAffected ? [{ title: "Already scheduled", detail: "Approving can open these shifts up for others.", value: esc(`${r.shiftsAffected} shift${r.shiftsAffected === 1 ? "" : "s"}`) }] : []),
        ]
      : [
          { title: dayDate(r.shift.date), detail: r.shift.position, value: esc(shiftTime(r.shift)) },
          { title: "Taking it", value: esc(r.taker ?? "Open to anyone who can cover") },
        ];
  const html = shell({
    preheader: s.body,
    body: [
      h1(s.title),
      p(`Hi ${esc(first(e.name))} — this is waiting for you to approve or deny.`),
      list(rows),
      r.kind === "timeOff" && r.note ? p(`&ldquo;${esc(r.note)}&rdquo;`, true) : "",
      button(url, "Review requests"),
    ].join("\n"),
    footer: manageFooter(e.baseUrl),
  });
  const text = textLines(`Hi ${first(e.name)},`, "", `${s.title}: ${s.body}.`, r.kind === "timeOff" && r.note ? `Note: ${r.note}` : null, "", `Review: ${url}`, footerText(`${BRAND} requests`));
  return { subject: s.title, html, text };
}

export interface BadReviewEmail {
  name: string;
  reviews: { author: string | null; rating: number; source: string; date: ISODate; text: string }[];
  baseUrl: string;
}

const stars = (n: number) => "★".repeat(Math.max(0, Math.min(5, Math.round(n)))) + "☆".repeat(Math.max(0, 5 - Math.round(n)));
const SOURCE: Record<string, string> = { GOOGLE: "Google", YELP: "Yelp", TRIPADVISOR: "Tripadvisor", OPENTABLE: "OpenTable", OTHER: "Review" };
const snippet = (t: string, n = 180) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);

export function badReviewSummary(reviews: BadReviewEmail["reviews"]): { title: string; body: string } {
  const top = reviews[0];
  if (reviews.length === 1 && top) return { title: `New ${top.rating}★ review on ${SOURCE[top.source] ?? top.source}`, body: snippet(top.text.replace(/\s+/g, " "), 120) || "No text, just stars." };
  return { title: `${reviews.length} new low reviews`, body: reviews.slice(0, 3).map((r) => `${r.rating}★ ${SOURCE[r.source] ?? r.source}`).join(" · ") };
}

export function badReviewEmail(e: BadReviewEmail): RenderedEmail {
  const s = badReviewSummary(e.reviews);
  const url = link(e.baseUrl, "/reviews");
  const html = shell({
    preheader: s.body,
    body: [
      h1(s.title),
      p(`Hi ${esc(first(e.name))} — a quick, personal reply usually helps. There's a draft waiting on the reviews page.`),
      list(e.reviews.slice(0, 8).map((r) => ({ title: `${r.author ?? "A guest"} · ${SOURCE[r.source] ?? r.source}`, detail: `${dayDate(r.date)} · ${snippet(r.text.replace(/\s+/g, " "))}`, value: `<span style="color:#b42318;">${esc(stars(r.rating))}</span>` }))),
      button(url, "Reply to reviews"),
    ].join("\n"),
    footer: manageFooter(e.baseUrl),
  });
  const text = textLines(
    `Hi ${first(e.name)},`,
    "",
    `${s.title}:`,
    "",
    ...e.reviews.map((r) => `- ${r.rating}★ ${r.author ?? "A guest"} (${SOURCE[r.source] ?? r.source}, ${r.date}): ${snippet(r.text.replace(/\s+/g, " "))}`),
    "",
    `Reply: ${url}`,
    footerText(`${BRAND} reviews`),
  );
  return { subject: s.title, html, text };
}
