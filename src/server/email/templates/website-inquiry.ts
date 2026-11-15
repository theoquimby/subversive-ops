import { dayDate } from "@/lib/format";
import { BRAND, button, esc, footerText, h1, link, list, manageFooter, p, shell, textLines, type RenderedEmail } from "../layout";

/** A private-event inquiry that came in through the website form. */
export interface WebsiteInquiryEmail {
  name: string;
  inquiry: { from: string; email: string | null; phone: string | null; date: string | null; guests: number | null; type: string | null; message: string | null; privateEventId: string | null };
  baseUrl: string;
}

const first = (name: string) => name.trim().split(/\s+/)[0] || name;
const snippet = (t: string, n = 140) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);

export function websiteInquirySummary(i: WebsiteInquiryEmail["inquiry"]): { title: string; body: string } {
  const bits = [i.type, i.date ? dayDate(i.date) : null, i.guests ? `${i.guests} guests` : null].filter(Boolean);
  return { title: `${i.from} asked about a private event`, body: bits.length ? bits.join(" · ") : snippet((i.message ?? "From the website form").replace(/\s+/g, " ")) };
}

export function websiteInquiryEmail(e: WebsiteInquiryEmail): RenderedEmail {
  const i = e.inquiry;
  const s = websiteInquirySummary(i);
  const url = link(e.baseUrl, i.privateEventId ? `/events/private/${i.privateEventId}` : "/website/inquiries");
  const rows = [
    ...(i.type ? [{ title: "Kind of event", value: esc(i.type) }] : []),
    ...(i.date ? [{ title: "Date", value: esc(dayDate(i.date)) }] : []),
    ...(i.guests ? [{ title: "Guests", value: esc(String(i.guests)) }] : []),
    ...(i.email ? [{ title: "Email", value: esc(i.email) }] : []),
    ...(i.phone ? [{ title: "Phone", value: esc(i.phone) }] : []),
  ];
  const html = shell({
    preheader: s.body,
    body: [h1(s.title), p(`Hi ${esc(first(e.name))} — this came in through the website. It's on the private events board as an inquiry.`), list(rows), i.message ? p(`&ldquo;${esc(i.message)}&rdquo;`, true) : "", button(url, "Open the inquiry")].join("\n"),
    footer: manageFooter(e.baseUrl),
  });
  const text = textLines(`Hi ${first(e.name)},`, "", `${s.title}: ${s.body}.`, i.email ? `Email: ${i.email}` : null, i.phone ? `Phone: ${i.phone}` : null, i.message ? `"${i.message}"` : null, "", `Open: ${url}`, footerText(`${BRAND} website`));
  return { subject: s.title, html, text };
}
