/**
 * Getting an order to a supplier the way they take it: a text message typed
 * out for the person to send from their own phone, the lines with item
 * numbers for keying into their website, or a call script. Nothing here
 * sends anything; the person always presses send. Pure: no DB, no DOM.
 */

import { WEEKDAYS, weekday, type ISODate } from "./dates";

export interface SendLine {
  qty: number;
  unit: string;
  name: string;
  sku: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Wed Nov 18". */
export const deliveryDay = (d: ISODate) => `${WEEKDAYS[weekday(d)]} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;
const q = (n: number) => String(Number(n.toFixed(2)));

/** A short, plain text: greeting, delivery day, "qty unit item" per line, sign-off. */
export function textOrderMessage(a: { supplierName: string; deliveryDate: ISODate; lines: readonly SendLine[]; from: string }): string {
  const body = a.lines.length ? a.lines.map((l) => `${q(l.qty)} ${l.unit} ${l.name}`) : ["(no items)"];
  return [`Hi ${a.supplierName}, order for ${deliveryDay(a.deliveryDate)}:`, ...body, `Thanks! ${a.from}`].join("\n");
}

/** Digits (and a leading +) only. */
export const digitsOnly = (phone: string) => {
  const t = phone.trim();
  return `${t.startsWith("+") ? "+" : ""}${t.replace(/\D/g, "")}`;
};

export type Platform = "ios" | "android" | "desktop";

/** iPhone/iPad, Android, or anything else (a computer). iPadOS says it's a Mac but has touch points. */
export function devicePlatform(userAgent: string, maxTouchPoints = 0): Platform {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "ios";
  if (/Android/i.test(userAgent)) return "android";
  if (/Macintosh/i.test(userAgent) && maxTouchPoints > 1) return "ios";
  return "desktop";
}

/**
 * Opens Messages with the order typed in. iOS wants `sms:<num>&body=`,
 * Android (and the rest) `sms:<num>?body=`.
 */
export function smsHref(phone: string, body: string, platform: Platform): string {
  return `sms:${digitsOnly(phone)}${platform === "ios" ? "&" : "?"}body=${encodeURIComponent(body)}`;
}

export const telHref = (phone: string) => `tel:${digitsOnly(phone)}`;

/**
 * The supplier's own order (their order guide, as on their invoices) where it's known,
 * then everything else by name.
 */
export function sortByGuide<T extends { sku: string; name: string }>(lines: readonly T[], guide: ReadonlyMap<string, number>): T[] {
  return [...lines].sort((a, b) => {
    const ra = guide.get(a.sku);
    const rb = guide.get(b.sku);
    if (ra != null && rb != null) return ra - rb;
    if (ra != null) return -1;
    if (rb != null) return 1;
    return a.name.localeCompare(b.name);
  });
}

/** One line each, item number first: easy to find in a portal's search box. */
export const portalText = (lines: readonly SendLine[]) => lines.map((l) => `#${l.sku}  ${q(l.qty)} ${l.unit}  ${l.name}`).join("\n");

export function portalCsv(lines: readonly SendLine[]): string {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return [["Item #", "Qty", "Unit", "Description"], ...lines.map((l) => [l.sku, q(l.qty), l.unit, l.name])].map((r) => r.map(esc).join(",")).join("\r\n");
}

/** What to say on the phone, one line at a time. */
export function callScript(a: { supplierName: string; deliveryDate: ISODate; lines: readonly SendLine[]; from: string }): string[] {
  return [
    `Hi, this is ${a.from} placing an order for ${deliveryDay(a.deliveryDate)}.`,
    ...a.lines.map((l) => `${q(l.qty)} ${l.unit} — ${l.name} (#${l.sku})`),
    "Could you read that back to me? Thanks!",
  ];
}
