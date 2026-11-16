import "server-only";
import { NEEDS_MANAGER } from "@/domain/swaps";
import { attentionItems, type AttentionItem } from "@/domain/attention";
import { INVOICE_ISSUE_STATUSES, isInvoiceIssue } from "@/domain/alerts";
import { addDays, parseISODate } from "@/domain/dates";
import { db } from "../db";
import { stockSummary } from "./kegs";
import { supplierCutoffs } from "./planning";
import { businessToday } from "./sales";
import { certMatrix } from "./training";
import { privateEventNeedsYou } from "./privateEvents";
import { opsAttentionItems } from "@/domain/opsAttention";
import { unfinishedLastNight } from "./checklists";
import { upkeepNeedsYou } from "./upkeep";
import { beerTaxNeedsYou } from "./beerTax";
import { kegNeedsYou } from "./kegSignals";
import { kegOrdersNeedYou } from "./kegOrders";

/**
 * What needs a manager right now, for the Overview: order cutoffs coming up,
 * invoices to approve, staff requests, an unpublished schedule, taps with no
 * keg behind them, keg orders due today or overdue, certificates and low
 * reviews, and at the bottom the keg fleet's two lists (out too long, not
 * seen lately). Each source fails on its own (logged, left out) so one
 * broken area never blanks the list.
 */
export async function attentionList(now = new Date()): Promise<AttentionItem[]> {
  const today = businessToday();
  const soft = <T,>(label: string, p: Promise<T>, fallback: T) =>
    p.catch((e) => {
      console.error(`attention: ${label} failed`, e);
      return fallback;
    });
  // Private events: follow-ups, deposits and balances due (started early, joined at the end).
  const privateEvents = soft("private events", privateEventNeedsYou(today), []);
  // Floor and brewery: unfinished closes, overdue upkeep, equipment down, beer tax due.
  const ops = Promise.all([
    soft("checklists", unfinishedLastNight(today), []),
    soft("upkeep", upkeepNeedsYou(today), { overdue: [], down: [] }),
    soft("beer tax", beerTaxNeedsYou(today), []),
  ]).then(([closes, upkeep, taxes]) => opsAttentionItems({ today, closes, overdueJobs: upkeep.overdue, down: upkeep.down, taxes }));
  // Keg fleet: kegs out too long and not seen lately. Low priority here; the morning brief skips them most days.
  const kegFleet = soft("keg fleet", kegNeedsYou(today), []);
  // Wholesale keg orders to deliver or hand over today, and ones that are overdue.
  const kegOrders = soft("keg orders", kegOrdersNeedYou(today), []);
  const [cutoffs, invoices, timeOff, swaps, draftShifts, kegs, certs, badReviews] = await Promise.all([
    soft("cutoffs", supplierCutoffs(now), []),
    soft("invoices", db.invoice.groupBy({ by: ["status"], where: { status: { not: "APPROVED" } }, _count: { _all: true } }), []),
    soft("time off", db.timeOffRequest.count({ where: { status: "PENDING", endDate: { gte: parseISODate(today) } } }), 0),
    soft("swaps", db.shiftSwap.count({ where: { ...NEEDS_MANAGER, shift: { start: { gte: now } } } }), 0),
    soft("schedule", db.shift.count({ where: { published: false, start: { gte: now, lt: new Date(now.getTime() + 7 * 86_400_000) } } }), 0),
    soft("kegs", stockSummary(), null),
    soft("certificates", certMatrix(today).then((m) => m.summary), null),
    soft("reviews", db.review.count({ where: { replied: false, rating: { lte: 2 }, postedAt: { gte: parseISODate(addDays(today, -60)) } } }), 0),
  ]);
  const draftIds = cutoffs.map((c) => c.draftId).filter((id): id is string => !!id);
  const orders = draftIds.length ? await soft("orders", db.purchaseOrder.findMany({ where: { id: { in: draftIds } }, select: { id: true, status: true } }), []) : [];
  const status = new Map(orders.map((o) => [o.id, o.status]));
  const count = (pred: (s: string) => boolean) => invoices.filter((r) => pred(r.status)).reduce((s, r) => s + r._count._all, 0);
  const items = attentionItems({
    today,
    cutoffs: cutoffs
      .filter((c) => c.next && c.hoursToCutoff != null)
      .map((c) => ({
        supplierId: c.supplierId,
        supplier: c.name,
        cutoffDate: c.next!.cutoffDate,
        cutoffTime: c.next!.cutoffTime,
        hoursToCutoff: c.hoursToCutoff!,
        sent: !!c.draftId && status.get(c.draftId) !== "DRAFT",
        drafted: !!c.draftId && status.get(c.draftId) === "DRAFT",
      })),
    invoicesToReview: count((s) => !isInvoiceIssue(s)),
    invoiceIssues: count((s) => (INVOICE_ISSUE_STATUSES as readonly string[]).includes(s)),
    timeOff,
    swaps,
    draftShifts,
    dryTaps: kegs ? kegs.beers.filter((b) => b.onTap > 0 && b.full === 0).map((b) => b.name) : [],
    certsExpired: certs?.expired ?? 0,
    certsExpiring: certs?.expiring ?? 0,
    badReviews,
  });
  return [...items, ...(await privateEvents), ...(await ops), ...(await kegOrders), ...(await kegFleet)].sort((a, b) => b.urgency - a.urgency);
}
