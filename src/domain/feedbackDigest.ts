/**
 * "Copy for Claude": feedback notes as one tidy Markdown digest the owner can
 * paste straight into a Claude Code session. One block per note: kind, who
 * and their role, the date, the page it came from, the text as a quote, the
 * reply or plan, and whether a photo is waiting in Ops. Pure.
 */

import { feedbackKindLabel, feedbackStatusLabel, roleLabel } from "./feedback";

export interface DigestNote {
  kind: string;
  userName: string | null;
  role: string | null;
  /** Business date, YYYY-MM-DD. */
  date: string;
  path: string | null;
  pageTitle: string | null;
  body: string;
  status: string;
  /** A manager's reply or plan. */
  note: string | null;
  hasPhoto: boolean;
  device?: string | null;
  appVersion?: string | null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-14" → "Nov 14, 2026". */
function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

const quote = (text: string) =>
  text
    .trim()
    .split(/\r?\n/)
    .map((l) => (l.trim() ? `> ${l.trimEnd()}` : ">"))
    .join("\n");

const oneLine = (text: string) => text.trim().replace(/\s*\r?\n\s*/g, " ");

export function feedbackDigest(notes: DigestNote[]): string {
  if (!notes.length) return "# Feedback from Subversive Ops\n\nNo notes.\n";
  const out: string[] = [
    `# Feedback from Subversive Ops (${notes.length} note${notes.length === 1 ? "" : "s"})`,
    "",
    "Sent from the Feedback button in the app. Each note names the page it was sent from.",
    "",
  ];
  notes.forEach((n, i) => {
    const who = n.userName?.trim() || "Someone";
    const role = roleLabel(n.role);
    out.push(`## ${i + 1}. ${feedbackKindLabel(n.kind)} · ${who}${role ? ` (${role})` : ""} · ${longDate(n.date)}`, "");
    const title = n.pageTitle?.trim();
    out.push(n.path ? `- Page: \`${n.path}\`${title ? ` (${title})` : ""}` : "- Page: not recorded");
    out.push(`- Status: ${feedbackStatusLabel(n.status)}`);
    if (n.note?.trim()) out.push(`- Reply or plan: ${oneLine(n.note)}`);
    const sentFrom = [n.device?.trim(), n.appVersion?.trim() ? `app ${n.appVersion.trim()}` : null].filter(Boolean).join(", ");
    if (sentFrom) out.push(`- Sent from: ${sentFrom}`);
    out.push("", quote(n.body), "");
    if (n.hasPhoto) out.push("(photo attached in Ops)", "");
  });
  return out.join("\n");
}
