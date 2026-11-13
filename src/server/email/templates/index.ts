import type { RenderedEmail } from "../layout";
import { creditRequestEmail } from "./credit-request";
import { invoiceIssueEmail, priceSpikesEmail } from "./manager-alerts";
import { purchaseOrderEmail } from "./purchase-order";
import { schedulePublishedEmail } from "./schedule-published";
import { shiftUpdateEmail } from "./shift-update";
import { weeklyBriefEmail } from "./weekly-brief";

export { creditRequestEmail, invoiceIssueEmail, priceSpikesEmail, purchaseOrderEmail, schedulePublishedEmail, shiftUpdateEmail, weeklyBriefEmail };
export type { CreditRequestEmail } from "./credit-request";
export type { InvoiceIssueEmail, PriceSpike, PriceSpikesEmail } from "./manager-alerts";
export type { PurchaseOrderEmail } from "./purchase-order";
export type { ScheduleShift, SchedulePublishedEmail } from "./schedule-published";
export type { ShiftUpdate, ShiftUpdateEmail } from "./shift-update";
export type { BriefDigest, BriefDigestItem, WeeklyBriefEmail } from "./weekly-brief";

const BASE = "https://ops.example.com";

/** Fixed sample data for every template — used by the dev preview page and the tests. */
export const SAMPLES = {
  "purchase-order": {
    label: "Purchase order",
    render: () =>
      purchaseOrderEmail({
        supplierName: "Sysco Albany",
        deliveryDate: "2026-11-17",
        senderName: "Max",
        replyTo: "max@subversivebrewing.com",
        csvFilename: "Sysco-Albany-2026-11-17.csv",
        notes: "Back door after 9 am please.",
        lines: [
          { sku: "4127783", description: "Beef, ground 80/20 fresh chub", qty: 4, unit: "case", unitPrice: 62.4 },
          { sku: "1009912", description: "Fries, 3/8\" straight cut skin-on", qty: 6, unit: "case", unitPrice: 41.15 },
          { sku: "5518230", description: "Cheese, American yellow 160 sl", qty: 2, unit: "case", unitPrice: 48.9 },
          { sku: "7731001", description: "Lettuce, romaine hearts", qty: 1.5, unit: "case", unitPrice: 39.0 },
        ],
      }),
  },
  "schedule-published": {
    label: "Schedule published",
    render: () =>
      schedulePublishedEmail({
        name: "Jamie Rivera",
        weekStart: "2026-11-16",
        baseUrl: BASE,
        shifts: [
          { date: "2026-11-18", startMin: 16 * 60, endMin: 22 * 60, position: "Server", hours: 6 },
          { date: "2026-11-20", startMin: 16 * 60 + 30, endMin: 23 * 60, position: "Server", hours: 6.5, notes: "Trivia night" },
          { date: "2026-11-22", startMin: 11 * 60, endMin: 17 * 60, position: "Bar", hours: 6 },
        ],
      }),
  },
  "shift-changed": {
    label: "Shift changed",
    render: () =>
      shiftUpdateEmail({
        name: "Jamie Rivera",
        baseUrl: BASE,
        update: { kind: "changed", before: { date: "2026-11-18", startMin: 960, endMin: 1320, position: "Server" }, after: { date: "2026-11-18", startMin: 1020, endMin: 1380, position: "Server" } },
      }),
  },
  "swap-approved": {
    label: "Swap approved",
    render: () =>
      shiftUpdateEmail({
        name: "Jamie Rivera",
        baseUrl: BASE,
        update: { kind: "swap", role: "requester", approved: true, otherName: "Sam", shift: { date: "2026-11-20", startMin: 990, endMin: 1380, position: "Server" } },
      }),
  },
  "time-off": {
    label: "Time off decided",
    render: () =>
      shiftUpdateEmail({ name: "Jamie Rivera", baseUrl: BASE, update: { kind: "timeOff", approved: true, startDate: "2026-11-26", endDate: "2026-11-28", note: "Thanksgiving" } }),
  },
  "weekly-brief": {
    label: "Weekly brief",
    render: () =>
      weeklyBriefEmail({
        name: "Max",
        baseUrl: BASE,
        digest: {
          week: "2026-11-16",
          forecastTotal: 24850,
          salesTarget: 24000,
          busiest: ["2026-11-20", "2026-11-21"],
          events: [{ date: "2026-11-21", title: "Holiday market" }],
          laborPct: 0.27,
          laborTarget: 0.28,
          todo: [
            { title: "Order from Sysco Albany", status: "14 items · $1,284.50 · delivers Tue, Nov 17", path: "/ordering" },
            { title: "Publish the schedule", status: "18 draft shifts · 212 h · labor 27% of forecast", path: "/schedule" },
            { title: "Price increases this week", status: "3 items went up in the last 7 days", path: "/prices" },
          ],
          clear: [
            { title: "Staff requests", status: "Nothing waiting" },
            { title: "Counts", status: "Last count Nov 9" },
          ],
        },
      }),
  },
  "credit-request": {
    label: "Invoice credit request",
    render: () =>
      creditRequestEmail({
        supplierName: "Sysco Albany",
        invoiceNumber: "88123401",
        invoiceDate: "2026-11-10",
        senderName: "Max",
        replyTo: "max@subversivebrewing.com",
        items: [
          { description: "Beef, ground 80/20 fresh chub", sku: "4127783", kind: "overcharge", detail: "charged $64.90, agreed $62.40 × 4", amount: 10 },
          { description: "Lettuce, romaine hearts", sku: "7731001", kind: "short", detail: "billed 2, received 1", amount: 39 },
        ],
      }),
  },
  "price-spikes": {
    label: "Price spikes",
    render: () =>
      priceSpikesEmail({
        name: "Max",
        baseUrl: BASE,
        moves: [
          { description: "Butter, unsalted AA 36/1lb", ingredient: "Butter", supplier: "Sysco Albany", oldPrice: 98.5, newPrice: 121.2, changePct: 0.2305, date: "2026-11-12" },
          { description: "Eggs, large white 15 dz", ingredient: "Eggs", supplier: "Sysco Albany", oldPrice: 44, newPrice: 51.75, changePct: 0.1761, date: "2026-11-11" },
        ],
      }),
  },
  "invoice-issue": {
    label: "Invoice issue",
    render: () =>
      invoiceIssueEmail({
        name: "Max",
        baseUrl: BASE,
        invoiceId: "inv_sample",
        supplierName: "Sysco Albany",
        invoiceNumber: "88123401",
        invoiceDate: "2026-11-10",
        statusLabel: "Price and qty issues",
        total: 1311.9,
        creditTotal: 49,
        issues: [
          { description: "Beef, ground 80/20 fresh chub", detail: "Charged $64.90, expected $62.40" },
          { description: "Lettuce, romaine hearts", detail: "Billed 2, received 1" },
        ],
      }),
  },
} satisfies Record<string, { label: string; render: () => RenderedEmail }>;

export type TemplateKey = keyof typeof SAMPLES;
export const TEMPLATE_KEYS = Object.keys(SAMPLES) as TemplateKey[];
