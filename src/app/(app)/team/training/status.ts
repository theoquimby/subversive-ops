/** Labels and colours for certificate statuses, shared by /team/training and /my. */

import type { AssignmentState, CertStatus } from "@/domain/certs";
import type { Tone } from "@/components/ui";
import { shortDate } from "@/lib/format";

export const STATUS_LABEL: Record<CertStatus, string> = {
  valid: "Valid",
  expiring: "Expiring",
  expired: "Expired",
  missing: "Missing",
  "not-required": "Not required",
};

export const STATUS_TONE: Record<CertStatus, Tone> = { valid: "good", expiring: "warn", expired: "bad", missing: "bad", "not-required": "neutral" };

/** Tinted matrix cells. Missing is outlined rather than filled so it reads as "nothing here yet". */
export const CELL_CLASS: Record<CertStatus, string> = {
  valid: "bg-good-bg text-good hover:bg-good-bg/70",
  expiring: "bg-warn-bg text-warn hover:bg-warn-bg/70",
  expired: "bg-bad-bg text-bad hover:bg-bad-bg/70",
  missing: "border border-dashed border-bad/45 text-bad hover:bg-bad-bg/40",
  "not-required": "text-muted hover:bg-surface-2",
};

const monthYear = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
const fullDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
export const monthYearOf = (iso: string) => monthYear.format(new Date(`${iso}T00:00:00Z`));
export const fullDateOf = (iso: string) => fullDate.format(new Date(`${iso}T00:00:00Z`));

/** Short text inside a matrix cell. */
export function cellText(c: { status: CertStatus; expiresOn: string | null; daysLeft: number | null; hasCert: boolean }): string {
  switch (c.status) {
    case "missing": return "Missing";
    case "expired": return "Expired";
    case "expiring": return c.daysLeft === 0 ? "Today" : c.daysLeft != null && c.daysLeft <= 14 ? `${c.daysLeft} day${c.daysLeft === 1 ? "" : "s"}` : shortDate(c.expiresOn!);
    case "valid": return c.expiresOn ? monthYearOf(c.expiresOn) : "No expiry";
    default: return c.hasCert ? "On file" : "—";
  }
}

/** One sentence about where a certificate stands. */
export function statusSentence(c: { status: CertStatus; expiresOn: string | null; daysLeft: number | null }): string {
  switch (c.status) {
    case "missing": return "Nothing on file";
    case "expired": return `Expired ${fullDateOf(c.expiresOn!)}`;
    case "expiring": return c.daysLeft === 0 ? "Expires today" : `Expires ${fullDateOf(c.expiresOn!)} · ${c.daysLeft} day${c.daysLeft === 1 ? "" : "s"} left`;
    case "valid": return c.expiresOn ? `Good until ${fullDateOf(c.expiresOn)}` : "Doesn't expire";
    default: return "Not required";
  }
}

export const REASON_LABEL: Record<string, string> = { everyone: "Required for everyone", minor: "Required for minors", position: "Required for their position" };

export const ASSIGNMENT_LABEL: Record<AssignmentState, { label: string; tone: Tone }> = {
  "signed-off": { label: "Signed off", tone: "good" },
  ready: { label: "Ready to sign off", tone: "warn" },
  overdue: { label: "Overdue", tone: "bad" },
  "in-progress": { label: "In progress", tone: "neutral" },
  "not-started": { label: "Not started", tone: "neutral" },
};

export const validityText = (m: number | null) => (m == null ? "Never expires" : m % 12 === 0 ? `${m / 12} year${m === 12 ? "" : "s"}` : `${m} months`);
