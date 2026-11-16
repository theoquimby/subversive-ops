/**
 * The brewery calendar feed (iCalendar, RFC 5545): brew days, dry hops,
 * transfers, packaging and release days as all-day events, for calendar
 * apps (Google, Apple, Outlook) to subscribe to. Each event's UID is the brew
 * plus what happens, so a moved brew updates its events instead of adding
 * new ones. Pure: plain data in, text out.
 */

import { addDays, type ISODate } from "./dates";

export interface CalEvent {
  /** Stable across fetches: the same brew and step always has the same UID. */
  uid: string;
  /** All day. */
  date: ISODate;
  title: string;
  description?: string | null;
}

/** Escape a TEXT value: backslash, semicolon, comma and line breaks. */
export function icsEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
}

const enc = new TextEncoder();

/** Fold a content line at 75 octets: CRLF and a space start each continuation. Never splits a character. */
export function foldLine(line: string): string {
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let size = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const limit = out.length ? 74 : 75; // continuation lines carry a leading space
    if (size + n > limit) {
      out.push(cur);
      cur = "";
      size = 0;
    }
    cur += ch;
    size += n;
  }
  out.push(cur);
  return out.map((p, i) => (i ? ` ${p}` : p)).join("\r\n");
}

const day = (d: ISODate) => d.replace(/-/g, "");
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** A whole calendar, CRLF line ends, ending with CRLF. */
export function buildICalendar(events: CalEvent[], opts: { name: string; stamp: Date }): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Subversive Ops//Brewery//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(opts.name)}`,
    "X-PUBLISHED-TTL:PT1H",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
  ];
  const at = stamp(opts.stamp);
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `DTSTAMP:${at}`,
      `DTSTART;VALUE=DATE:${day(e.date)}`,
      `DTEND;VALUE=DATE:${day(addDays(e.date, 1))}`,
      `SUMMARY:${icsEscape(e.title)}`,
      ...(e.description ? [`DESCRIPTION:${icsEscape(e.description)}`] : []),
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

// ---- Brewery events ------------------------------------------------------------------------------

export interface CalBrew {
  id: string;
  code: string;
  name: string;
  status: "PLANNED" | "FERMENTING" | "CONDITIONING" | "PACKAGED" | "DUMPED";
  /** Brewed, else planned. */
  brewOn: ISODate | null;
  dryHopOn: ISODate | null;
  fvTransferOn: ISODate | null;
  tapOn: ISODate | null;
  tapLocked: boolean;
  lockedReason: string | null;
  packagedOn: ISODate | null;
  /** In order; `end` null = still in, no day out yet. */
  stays: { tankName: string; kind: string; start: ISODate; end: ISODate | null }[];
}

const MONTH_DAYS = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** `n` months from `d`, clamped to the month's last day. */
function addMonths(d: ISODate, n: number): ISODate {
  const [y, m, dd] = d.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12), nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(dd, MONTH_DAYS(ny, nm))).padStart(2, "0")}`;
}

/** The feed covers the last month and the next six: [from, to). */
export const calendarWindow = (today: ISODate) => ({ from: addMonths(today, -1), to: addMonths(today, 6) });

const DOMAIN = "subversive-ops";

/** Every dated step of every brew that falls in [from, to), by date. Dumped brews are left out. */
export function breweryEvents(brews: CalBrew[], window: { from: ISODate; to: ISODate }): CalEvent[] {
  const out: (CalEvent & { order: number })[] = [];
  for (const b of brews) {
    if (b.status === "DUMPED") continue;
    const add = (step: string, order: number, date: ISODate | null, title: string, description?: string | null) => {
      if (date && date >= window.from && date < window.to) out.push({ uid: `${b.id}.${step}@${DOMAIN}`, date, title, description: description ?? null, order });
    };
    const first = b.stays[0];
    add("brew", 0, b.brewOn, `Brew: ${b.name} (${b.code})`, `${b.status === "PLANNED" ? "Planned brew" : "Brewed"}${first ? `, into ${first.tankName}` : ""}.`);
    add("dryhop", 1, b.dryHopOn, `Dry hop: ${b.name}`, first ? `In ${first.tankName}.` : null);
    add("fvmove", 2, b.fvTransferOn, `Fermenter move: ${b.name}`, "Fermenter to fermenter.");
    b.stays.forEach((s, i) => {
      if (i === 0) return;
      add(`transfer.${i}`, 3, s.start, `Transfer to ${s.tankName}: ${b.name}`, `From ${b.stays[i - 1].tankName} to ${s.tankName}.`);
    });
    const last = b.stays[b.stays.length - 1];
    const pkg = b.packagedOn ?? (b.status !== "PACKAGED" ? last?.end ?? null : null);
    add("package", 4, pkg, `Package: ${b.name}`, last ? `From ${last.tankName}.` : null);
    add("release", 5, b.tapOn, `Release${b.tapLocked ? " (locked)" : ""}: ${b.name}`, b.tapLocked ? `Locked release day${b.lockedReason ? `: ${b.lockedReason}` : ""}.` : "On tap.");
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order).map((e) => ({ uid: e.uid, date: e.date, title: e.title, description: e.description }));
}
