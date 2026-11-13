/**
 * Shared building blocks for transactional email. Pure string functions — no I/O,
 * no React — so templates are cheap to render and easy to snapshot-test.
 *
 * Email clients ignore <style> blocks unevenly, so everything is inline CSS on
 * tables. Colors match globals.css (light theme only; email dark modes invert it).
 */

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export const BRAND = "Subversive";
export const C = {
  bg: "#f7f7f5",
  surface: "#ffffff",
  surface2: "#f1f1ee",
  border: "#e6e5e1",
  ink: "#1b1a18",
  ink2: "#4a4843",
  muted: "#85837c",
  good: "#1f7a4d",
  goodBg: "#e8f3ec",
  warn: "#a15c07",
  warnBg: "#fbf1e2",
  bad: "#b42318",
  badBg: "#fcebea",
} as const;
const FONT = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`;

export const esc = (s: string | number | null | undefined) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Join a base URL and a path without doubling slashes. */
export const link = (baseUrl: string, path: string) => `${baseUrl.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;

export function shell(args: { preheader: string; body: string; footer?: string }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(BRAND)}</title>
</head>
<body style="margin:0;padding:0;background:${C.bg};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.bg};">${esc(args.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
<tr><td style="padding:0 4px 14px 4px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td width="26" height="26" align="center" valign="middle" style="width:26px;height:26px;background:${C.ink};border-radius:7px;color:#f7f7f5;font:700 15px/26px ${FONT};">S</td>
<td style="padding-left:9px;font:600 15px/26px ${FONT};color:${C.ink};">${esc(BRAND)}</td>
</tr></table>
</td></tr>
<tr><td style="background:${C.surface};border:1px solid ${C.border};border-radius:12px;padding:28px 24px;font:400 15px/1.55 ${FONT};color:${C.ink};">
${args.body}
</td></tr>
<tr><td style="padding:16px 4px 0 4px;font:400 12px/1.5 ${FONT};color:${C.muted};">${args.footer ?? `${esc(BRAND)} · Catskill, NY`}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

export const h1 = (s: string) => `<h1 style="margin:0 0 6px 0;font:600 21px/1.3 ${FONT};color:${C.ink};letter-spacing:-0.01em;">${esc(s)}</h1>`;
export const h2 = (s: string) => `<h2 style="margin:24px 0 8px 0;font:600 15px/1.4 ${FONT};color:${C.ink};">${esc(s)}</h2>`;
export const p = (html: string, muted = false) => `<p style="margin:0 0 14px 0;color:${muted ? C.muted : C.ink2};">${html}</p>`;
export const small = (html: string) => `<p style="margin:14px 0 0 0;font-size:13px;line-height:1.5;color:${C.muted};">${html}</p>`;

export function button(href: string, label: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 4px 0;"><tr>
<td style="background:${C.ink};border-radius:8px;"><a href="${esc(href)}" style="display:inline-block;padding:11px 18px;font:600 14px/1 ${FONT};color:#ffffff;text-decoration:none;border-radius:8px;">${esc(label)}</a></td>
</tr></table>`;
}

export type Tone = "good" | "warn" | "bad" | "neutral";
export function badge(label: string, tone: Tone = "neutral") {
  const [fg, bg] = { good: [C.good, C.goodBg], warn: [C.warn, C.warnBg], bad: [C.bad, C.badBg], neutral: [C.ink2, C.surface2] }[tone];
  return `<span style="display:inline-block;padding:2px 7px;border-radius:6px;background:${bg};color:${fg};font:600 12px/1.5 ${FONT};white-space:nowrap;">${esc(label)}</span>`;
}

export interface Col {
  label: string;
  align?: "left" | "right";
  /** Narrow columns stay on one line. */
  nowrap?: boolean;
}

/** A clean bordered table. Cells are raw HTML — escape before passing. */
export function table(cols: Col[], rows: string[][], foot?: string[]) {
  const cell = (c: Col, html: string, head = false, last = false) =>
    `<td align="${c.align ?? "left"}" style="padding:${head ? "8px" : "10px"} 10px;${last ? "" : `border-bottom:1px solid ${C.border};`}text-align:${c.align ?? "left"};vertical-align:top;${c.nowrap ? "white-space:nowrap;" : ""}${head ? `font:500 12px/1.4 ${FONT};color:${C.muted};background:${C.surface2};` : `font:400 14px/1.45 ${FONT};color:${C.ink};`}${c.align === "right" ? "font-variant-numeric:tabular-nums;" : ""}">${html}</td>`;
  const body = rows.map((r, i) => `<tr>${cols.map((c, j) => cell(c, r[j] ?? "", false, i === rows.length - 1 && !foot)).join("")}</tr>`).join("\n");
  const footer = foot ? `<tr>${cols.map((c, j) => cell(c, foot[j] ? `<strong>${foot[j]}</strong>` : "", false, true)).join("")}</tr>` : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${C.border};border-radius:8px;border-collapse:separate;overflow:hidden;margin:4px 0 8px 0;">
<tr>${cols.map((c) => cell(c, esc(c.label), true)).join("")}</tr>
${body}
${footer}
</table>`;
}

/** Simple stacked rows: bold title, muted detail underneath, optional right-aligned value. */
export function list(items: { title: string; detail?: string; value?: string; href?: string }[]) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${C.border};border-radius:8px;border-collapse:separate;margin:4px 0 8px 0;">
${items
  .map((it, i) => {
    const title = it.href ? `<a href="${esc(it.href)}" style="color:${C.ink};text-decoration:none;font-weight:600;">${esc(it.title)}</a>` : `<span style="font-weight:600;">${esc(it.title)}</span>`;
    const border = i < items.length - 1 ? `border-bottom:1px solid ${C.border};` : "";
    return `<tr><td style="padding:10px 12px;${border}font:400 14px/1.45 ${FONT};color:${C.ink};">${title}${it.detail ? `<div style="color:${C.muted};font-size:13px;margin-top:2px;">${esc(it.detail)}</div>` : ""}</td>${
      it.value != null ? `<td align="right" style="padding:10px 12px;${border}font:500 14px/1.45 ${FONT};color:${C.ink};white-space:nowrap;vertical-align:top;font-variant-numeric:tabular-nums;">${it.value}</td>` : ""
    }</tr>`;
  })
  .join("\n")}
</table>`;
}

/** Plain-text helpers. */
export const textLines = (...parts: (string | null | undefined | false)[]) => parts.filter((x) => x !== null && x !== undefined && x !== false).join("\n");
export const footerText = (extra?: string) => textLines("", "—", extra, `${BRAND} · Catskill, NY`);
export const manageFooter = (baseUrl: string) =>
  `You get this because notifications are on for your login. <a href="${esc(link(baseUrl, "/settings/notifications"))}" style="color:${C.muted};">Change what you get</a> · ${esc(BRAND)} · Catskill, NY`;
export const staffFooter = (baseUrl: string) =>
  `You get this because you're on the ${esc(BRAND)} team. Turn emails off on <a href="${esc(link(baseUrl, "/my"))}" style="color:${C.muted};">My shifts</a> · Catskill, NY`;
