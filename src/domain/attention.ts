/**
 * "What needs me": the short list on the Overview of things only a manager can
 * clear, most urgent first. Each item links to the page where it's done. Pure.
 */

import { addDays, ISODate, WEEKDAYS, weekday } from "./dates";

export interface AttentionCutoff {
  supplierId: string;
  supplier: string;
  cutoffDate: ISODate;
  /** HH:MM, business time. */
  cutoffTime: string;
  hoursToCutoff: number;
  /** An order for that delivery is already sent (a draft doesn't count). */
  sent: boolean;
  /** A draft is saved for that delivery. */
  drafted: boolean;
}

export interface AttentionInput {
  today: ISODate;
  cutoffs: AttentionCutoff[];
  invoicesToReview: number;
  invoiceIssues: number;
  timeOff: number;
  swaps: number;
  /** Unpublished shifts in the next 7 days. */
  draftShifts: number;
  /** Beers on tap with no full keg behind them. */
  dryTaps: string[];
  certsExpired: number;
  certsExpiring: number;
  /** 1–2★ reviews from the last 60 days with no reply. */
  badReviews: number;
}

export interface AttentionItem {
  key: string;
  title: string;
  detail: string;
  href: string;
  tone: "bad" | "warn" | "neutral";
  /** Higher first. */
  urgency: number;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "2pm", "10:30am". */
export function clockLabel(hhmm: string): string {
  const h = Number(hhmm.slice(0, 2));
  const m = hhmm.slice(3, 5);
  return `${h % 12 === 0 ? 12 : h % 12}${m === "00" ? "" : `:${m}`}${h < 12 ? "am" : "pm"}`;
}

/** "today 2pm", "tomorrow 10am", "Mon 2pm". */
export function dueLabel(today: ISODate, date: ISODate, hhmm: string): string {
  const day = date === today ? "today" : date === addDays(today, 1) ? "tomorrow" : WEEKDAYS[weekday(date)];
  return `${day} ${clockLabel(hhmm)}`;
}

/** Order cutoffs this close count as needing attention. */
export const CUTOFF_WINDOW_HOURS = 36;

export function attentionItems(i: AttentionInput): AttentionItem[] {
  const out: AttentionItem[] = [];

  const due = i.cutoffs.filter((c) => !c.sent && c.hoursToCutoff > 0 && c.hoursToCutoff <= CUTOFF_WINDOW_HOURS).sort((a, b) => a.hoursToCutoff - b.hoursToCutoff);
  if (due.length === 1) {
    const c = due[0];
    out.push({
      key: `order.${c.supplierId}`,
      title: `Order from ${c.supplier}`,
      detail: `${c.drafted ? "Draft ready · " : ""}due ${dueLabel(i.today, c.cutoffDate, c.cutoffTime)}`,
      href: `/ordering/${c.supplierId}`,
      tone: c.hoursToCutoff <= 6 ? "bad" : "warn",
      urgency: 100 - c.hoursToCutoff,
    });
  } else if (due.length > 1) {
    const first = due[0];
    const names = due.slice(0, 2).map((c) => c.supplier).join(", ");
    out.push({
      key: "orders",
      title: `${plural(due.length, "order")} to place`,
      detail: `${names}${due.length > 2 ? ` and ${due.length - 2} more` : ""} · first due ${dueLabel(i.today, first.cutoffDate, first.cutoffTime)}`,
      href: "/ordering",
      tone: first.hoursToCutoff <= 6 ? "bad" : "warn",
      urgency: 100 - first.hoursToCutoff,
    });
  }

  const invoices = i.invoicesToReview + i.invoiceIssues;
  if (invoices > 0) {
    out.push({
      key: "invoices",
      title: `${plural(invoices, "invoice")} to approve`,
      detail: i.invoiceIssues ? `${i.invoiceIssues} with a price or quantity issue` : "Waiting for a look",
      href: "/invoices?status=OPEN",
      tone: i.invoiceIssues ? "warn" : "neutral",
      urgency: i.invoiceIssues ? 60 : 40,
    });
  }

  if (i.dryTaps.length) {
    out.push({
      key: "kegs",
      title: i.dryTaps.length === 1 ? `${i.dryTaps[0]}: no full keg behind it` : `${plural(i.dryTaps.length, "beer")} on tap with no full keg behind`,
      detail: i.dryTaps.length === 1 ? "Fill or plan what goes on that line" : i.dryTaps.slice(0, 3).join(", ") + (i.dryTaps.length > 3 ? "…" : ""),
      href: "/kegs",
      tone: "warn",
      urgency: 55,
    });
  }

  const requests = i.timeOff + i.swaps;
  if (requests > 0) {
    const parts = [i.timeOff ? plural(i.timeOff, "time-off request") : "", i.swaps ? plural(i.swaps, "shift swap") : ""].filter(Boolean);
    out.push({ key: "requests", title: `${plural(requests, "staff request")} to answer`, detail: parts.join(" · "), href: "/schedule/requests", tone: "neutral", urgency: 50 });
  }

  if (i.draftShifts > 0) {
    out.push({ key: "schedule", title: "Schedule not published", detail: `${plural(i.draftShifts, "draft shift")} in the next 7 days`, href: "/schedule", tone: "warn", urgency: 45 });
  }

  if (i.certsExpired + i.certsExpiring > 0) {
    out.push({
      key: "certs",
      title: i.certsExpired ? `${plural(i.certsExpired, "certificate")} expired` : `${plural(i.certsExpiring, "certificate")} expiring soon`,
      detail: i.certsExpired && i.certsExpiring ? `and ${i.certsExpiring} expiring soon` : i.certsExpired ? "Upload the renewed certificates" : "Renew before they lapse",
      href: "/team/training",
      tone: i.certsExpired ? "bad" : "neutral",
      urgency: i.certsExpired ? 58 : 30,
    });
  }

  if (i.badReviews > 0) {
    out.push({ key: "reviews", title: `${plural(i.badReviews, "low review")} without a reply`, detail: "1–2★ in the last 60 days", href: "/reviews", tone: "neutral", urgency: 35 });
  }

  return out.sort((a, b) => b.urgency - a.urgency);
}
