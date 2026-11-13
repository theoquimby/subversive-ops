import type { ISODate } from "@/domain/dates";
import { dayDate } from "@/lib/format";
import { badge, BRAND, button, esc, footerText, h1, link, list, manageFooter, p, RenderedEmail, shell, staffFooter, textLines } from "../layout";

/** One certificate that's about to expire (or just has). */
export interface CertReminderItem {
  person: string;
  cert: string;
  expiresOn: ISODate;
  stage: "30" | "7" | "expired";
}

export interface CertReminderEmail {
  name: string;
  /** "self": the person's own certificates. "team": a manager's roundup. */
  audience: "self" | "team";
  items: CertReminderItem[];
  baseUrl: string;
}

const first = (name: string) => name.trim().split(/\s+/)[0] || name;
const when = (i: CertReminderItem) => (i.stage === "expired" ? `expired ${dayDate(i.expiresOn)}` : `expires ${dayDate(i.expiresOn)}`);
const tone = (i: CertReminderItem) => (i.stage === "expired" ? "bad" : i.stage === "7" ? "warn" : "neutral");
const label = (i: CertReminderItem) => (i.stage === "expired" ? "Expired" : i.stage === "7" ? "This week" : "Within 30 days");

/** Title + body shared by the email subject and the push. */
export function certReminderSummary(items: CertReminderItem[], audience: "self" | "team"): { title: string; body: string } {
  const expired = items.filter((i) => i.stage === "expired").length;
  const top = items[0];
  if (audience === "self") {
    if (items.length === 1 && top) return { title: top.stage === "expired" ? `Your ${top.cert} has expired` : `Your ${top.cert} ${top.stage === "7" ? "expires this week" : "expires soon"}`, body: `${top.cert} ${when(top)}. Renew it and upload the new card on My shifts.` };
    return { title: `${items.length} of your certificates need renewing`, body: items.map((i) => `${i.cert} ${when(i)}`).join(" · ") };
  }
  if (items.length === 1 && top) return { title: top.stage === "expired" ? `${top.person}'s ${top.cert} has expired` : `${top.person}'s ${top.cert} expires ${dayDate(top.expiresOn)}`, body: `${top.person} · ${top.cert} ${when(top)}` };
  return {
    title: expired ? `${expired} certificate${expired === 1 ? " has" : "s have"} expired${items.length > expired ? `, ${items.length - expired} expiring` : ""}` : `${items.length} certificates expiring soon`,
    body: items.slice(0, 3).map((i) => `${i.person}: ${i.cert}`).join(" · ") + (items.length > 3 ? ` and ${items.length - 3} more` : ""),
  };
}

export function certReminderEmail(e: CertReminderEmail): RenderedEmail {
  const s = certReminderSummary(e.items, e.audience);
  const self = e.audience === "self";
  const url = link(e.baseUrl, self ? "/my#training" : "/team/training");
  const html = shell({
    preheader: s.body,
    body: [
      h1(s.title),
      p(self
        ? `Hi ${esc(first(e.name))} — renew before it runs out, then upload a photo of the new card on My shifts. A manager checks it.`
        : `Hi ${esc(first(e.name))} — these need renewing. Staff can upload the new card themselves; you verify it on the training page.`),
      list(e.items.map((i) => ({ title: self ? i.cert : `${i.person} · ${i.cert}`, detail: when(i).replace(/^./, (c) => c.toUpperCase()), value: badge(label(i), tone(i)) }))),
      button(url, self ? "Upload a new card" : "Open training"),
    ].join("\n"),
    footer: self ? staffFooter(e.baseUrl) : manageFooter(e.baseUrl),
  });
  const text = textLines(
    `Hi ${first(e.name)},`,
    "",
    `${s.title}:`,
    "",
    ...e.items.map((i) => `- ${self ? i.cert : `${i.person}: ${i.cert}`} — ${when(i)}`),
    "",
    `${self ? "Upload a new card" : "Open training"}: ${url}`,
    footerText(`${BRAND} training`),
  );
  return { subject: s.title, html, text };
}
