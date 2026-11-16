import { badge, BRAND, button, esc, footerText, h1, link, list, manageFooter, p, RenderedEmail, shell, staffFooter, textLines } from "../layout";

/**
 * One plain template for the small workforce messages: a shift offered to
 * you, a shout-out, a new hire's checklist, a message from the team. Short
 * title, a line or two, optional rows, one button.
 */
export interface TeamNoteEmail {
  name: string;
  subject: string;
  title: string;
  lines: string[];
  rows?: { title: string; detail?: string; value?: string }[];
  status?: { label: string; tone: "good" | "warn" | "bad" | "neutral" };
  action: { path: string; label: string };
  audience: "staff" | "manager";
  baseUrl: string;
}

const first = (name: string) => name.trim().split(/\s+/)[0] || name;

export function teamNoteEmail(e: TeamNoteEmail): RenderedEmail {
  const url = link(e.baseUrl, e.action.path);
  const html = shell({
    preheader: `${e.title}. ${e.lines.join(" ")}`.trim(),
    body: [
      e.status ? `<div style="margin-bottom:10px;">${badge(e.status.label, e.status.tone)}</div>` : "",
      h1(e.title),
      p(`Hi ${esc(first(e.name))} — ${esc(e.lines.join(" "))}`),
      e.rows?.length ? list(e.rows.map((r) => ({ title: r.title, detail: r.detail, value: r.value != null ? esc(r.value) : undefined }))) : "",
      button(url, e.action.label),
    ].join("\n"),
    footer: e.audience === "staff" ? staffFooter(e.baseUrl) : manageFooter(e.baseUrl),
  });
  const text = textLines(
    `Hi ${first(e.name)},`,
    "",
    `${e.title}. ${e.lines.join(" ")}`,
    ...(e.rows?.length ? ["", ...e.rows.map((r) => `- ${r.title}${r.value ? `: ${r.value}` : ""}${r.detail ? ` · ${r.detail}` : ""}`)] : []),
    "",
    `${e.action.label}: ${url}`,
    footerText(BRAND),
  );
  return { subject: e.subject, html, text };
}
