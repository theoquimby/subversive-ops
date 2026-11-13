import { BRAND, button, esc, footerText, h1, link, list, manageFooter, p, RenderedEmail, shell, textLines } from "../layout";

/** A keg alert: one kicked with nothing full behind it, or a beer running low. */
export interface KegAlert {
  kind: "kicked" | "low";
  beer: string;
  /** "Tap 4", or null for a low-stock alert. */
  where: string | null;
  fullLeft: number;
  /** "~5 days" when we can tell how long what's on tap lasts. */
  runsOut: string | null;
  who: string | null;
}

export function kegAlertSummary(a: KegAlert): { title: string; body: string } {
  if (a.kind === "kicked") {
    return {
      title: `${a.beer} kicked${a.where ? ` on ${a.where.toLowerCase()}` : ""}`,
      body: `No full keg of ${a.beer} in cold storage.${a.who ? ` Scanned by ${a.who}.` : ""} Fill one or pick what goes on that line.`,
    };
  }
  return {
    title: `${a.beer} is running low`,
    body: `${a.fullLeft} full keg${a.fullLeft === 1 ? "" : "s"} left${a.runsOut ? `; what's on tap runs out in ${a.runsOut}` : ""}. Time to fill more.`,
  };
}

const first = (name: string) => name.trim().split(/\s+/)[0] || name;

export function kegAlertEmail(e: { name: string; alert: KegAlert; baseUrl: string }): RenderedEmail {
  const s = kegAlertSummary(e.alert);
  const url = link(e.baseUrl, "/kegs/demand");
  const html = shell({
    preheader: s.body,
    body: [
      h1(s.title),
      p(`Hi ${esc(first(e.name))} — ${esc(s.body)}`),
      list([
        { title: "Full kegs left", value: esc(String(e.alert.fullLeft)) },
        ...(e.alert.runsOut ? [{ title: "On tap runs out", value: esc(e.alert.runsOut) }] : []),
      ]),
      button(url, "See kegs on hand vs needed"),
    ].join("\n"),
    footer: manageFooter(e.baseUrl),
  });
  const text = textLines(`Hi ${first(e.name)},`, "", `${s.title}. ${s.body}`, "", `Kegs: ${url}`, footerText(`${BRAND} keg alerts`));
  return { subject: s.title, html, text };
}
