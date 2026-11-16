import { BRAND, button, esc, footerText, h1, link, manageFooter, p, RenderedEmail, shell, textLines } from "../layout";

const first = (name: string) => name.trim().split(/\s+/)[0] || name;

/** An ordering reminder: an order is due soon and isn't placed, or a cutoff passed with none. */
export function orderReminderEmail(e: { name: string; title: string; body: string; path: string; baseUrl: string }): RenderedEmail {
  const url = link(e.baseUrl, e.path);
  const html = shell({
    preheader: e.body,
    body: [h1(e.title), p(`Hi ${esc(first(e.name))} — ${esc(e.body)}`), button(url, "Open the order"), p("Nothing is sent to the supplier until you send it.", true)].join("\n"),
    footer: manageFooter(e.baseUrl),
  });
  const text = textLines(`Hi ${first(e.name)},`, "", `${e.title}. ${e.body}`, "", `Open the order: ${url}`, "Nothing is sent to the supplier until you send it.", footerText(`${BRAND} order reminders`));
  return { subject: e.title, html, text };
}
