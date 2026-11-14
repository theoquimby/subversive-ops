import "server-only";
import { toISODate, type ISODate } from "@/domain/dates";
import type { CutoffRule } from "@/domain/ordering";
import { isGuessed, supplierState, type BoardOrder, type NextDeadline, type PoStatus, type SupplierState } from "@/domain/orderingBoard";
import { coverageLabel, weekdaysLabel } from "@/domain/learned";
import { businessDateOf } from "@/lib/format";
import { currentPrices, orderTotal } from "@/app/(app)/ordering/estimate";
import { db, num } from "../db";
import { env } from "../env";
import { emailReady } from "../integrations/email";
import { pendingSuggestions, type SupplierSuggestion } from "./learned";
import { buildOrderPlans, supplierCutoffs } from "./planning";
import { businessToday } from "./sales";

/** One purchase order as the Ordering page lists it. */
export interface BoardPo extends BoardOrder {
  supplierName: string;
  supplierEmail: string | null;
  coverUntil: ISODate;
  estimated: boolean;
  invoiced: boolean;
  createdOn: ISODate;
  sentOn: ISODate | null;
  receivedOn: ISODate | null;
  auto: boolean;
}

/** What the deadline editor offers to fill in ("Invoices say Tue, Fri"). */
export interface LearnedHint {
  days?: number[];
  perDay?: Record<number, { day: number; time: string }>;
  note: string;
}

export interface BoardSupplier {
  id: string;
  name: string;
  kind: "DISTRIBUTOR" | "LOCAL";
  email: string | null;
  minOrder: number | null;
  leadTimeDays: number;
  deliveryDays: number[];
  items: number;
  rule: CutoffRule;
  next: NextDeadline | null;
  hoursToCutoff: number | null;
  /** Epoch ms of the next deadline, for live countdowns. */
  cutoffAt: number | null;
  guessed: boolean;
  state: SupplierState;
  lastOrder: BoardPo | null;
  recent: BoardPo[];
  learned: SupplierSuggestion | null;
  hint?: LearnedHint;
}

export interface OrderingBoard {
  today: ISODate;
  now: number;
  suppliers: BoardSupplier[];
  orders: BoardPo[];
  emailReady: boolean;
}

const HISTORY_DAYS = 120;

export async function orderingBoard(now = new Date()): Promise<OrderingBoard> {
  const today = businessToday();
  const since = new Date(now.getTime() - HISTORY_DAYS * 86400_000);
  const [suppliers, orders, cutoffs, learned, canEmail] = await Promise.all([
    db.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" }, include: { _count: { select: { products: { where: { ingredientId: { not: null } } } } } } }),
    db.purchaseOrder.findMany({
      where: { OR: [{ status: { in: ["DRAFT", "SENT"] } }, { createdAt: { gte: since } }] },
      orderBy: { createdAt: "desc" },
      take: 500,
      include: { supplier: { select: { name: true, email: true } }, lines: { select: { qty: true, unitPrice: true, supplierProductId: true } }, invoices: { select: { total: true } } },
    }),
    supplierCutoffs(now),
    pendingSuggestions(),
    emailReady().catch(() => false),
  ]);
  const prices = await currentPrices(orders.flatMap((o) => o.lines.filter((l) => l.unitPrice == null).map((l) => l.supplierProductId)), today);
  const tz = env.BUSINESS_TIMEZONE;
  const pos: BoardPo[] = orders.map((o) => {
    const t = orderTotal(
      o.lines.map((l) => ({ supplierProductId: l.supplierProductId, qty: l.qty.toNumber(), unitPrice: l.unitPrice?.toNumber() ?? null })),
      prices,
      o.invoices.map((i) => i.total?.toNumber() ?? null),
    );
    return {
      id: o.id,
      supplierId: o.supplierId,
      supplierName: o.supplier.name,
      supplierEmail: o.supplier.email,
      status: o.status as PoStatus,
      deliveryDate: toISODate(o.deliveryDate),
      coverUntil: toISODate(o.coverUntil),
      total: t.total,
      estimated: t.estimated,
      invoiced: t.invoiced,
      lines: o.lines.length,
      createdOn: businessDateOf(o.createdAt, tz),
      sentOn: o.sentAt ? businessDateOf(o.sentAt, tz) : null,
      receivedOn: o.receivedAt ? businessDateOf(o.receivedAt, tz) : null,
      auto: !!o.notes?.startsWith("Auto-drafted"),
    };
  });
  const bySupplier = new Map<string, BoardPo[]>();
  for (const o of pos) {
    const list = bySupplier.get(o.supplierId);
    if (list) list.push(o);
    else bySupplier.set(o.supplierId, [o]);
  }
  const cutoffBy = new Map(cutoffs.map((c) => [c.supplierId, c]));
  const learnedBy = new Map(learned.suppliers.map((x) => [x.id, x]));
  const minute = 60_000;

  const rows: BoardSupplier[] = suppliers.flatMap((s) => {
    const c = cutoffBy.get(s.id);
    if (!c) return [];
    const mine = bySupplier.get(s.id) ?? [];
    const l = learnedBy.get(s.id) ?? null;
    const hint: LearnedHint | undefined =
      l && (l.days || l.deadlines)
        ? {
            days: l.days?.days,
            perDay: l.deadlines?.perDay,
            note: [l.days && `${l.days.sources.includes("invoice") ? "Invoices say" : "Past orders say"} ${weekdaysLabel(l.days.days)} (${coverageLabel(l.days)}).`, l.deadlines && "Past orders suggest these deadlines."].filter(Boolean).join(" "),
          }
        : undefined;
    return [{
      id: s.id,
      name: s.name,
      kind: s.kind,
      email: s.email,
      minOrder: num(s.minOrder),
      leadTimeDays: s.leadTimeDays,
      deliveryDays: s.deliveryDays,
      items: s._count.products,
      rule: c.rule,
      next: c.next,
      hoursToCutoff: c.hoursToCutoff,
      cutoffAt: c.hoursToCutoff == null ? null : Math.round((now.getTime() + c.hoursToCutoff * 3600_000) / minute) * minute,
      guessed: isGuessed(c.rule, c.next?.deliveryDate),
      state: supplierState(c.next?.deliveryDate ?? null, mine, today),
      lastOrder: mine[0] ?? null,
      recent: mine.slice(0, 6),
      learned: l,
      hint,
    }];
  });

  return { today, now: now.getTime(), suppliers: rows, orders: pos, emailReady: !!canEmail };
}

/** The suggested order for each supplier's next delivery: the numbers the table and side panel show. */
export interface SuggestedOrder {
  deliveryDate: ISODate;
  coverUntil: ISODate;
  total: number;
  lines: number;
  runsOut: number;
  needsCount: number;
  needsSetup: number;
  minOrder: number | null;
  top: { name: string; units: number; unit: string; cost: number | null; runsOut: boolean }[];
}

export async function suggestedOrders(supplierIds: string[]): Promise<Record<string, SuggestedOrder>> {
  const plans = await buildOrderPlans(supplierIds);
  const out: Record<string, SuggestedOrder> = {};
  for (const [id, p] of plans) {
    const ordering = p.lines.filter((l) => l.suggestedUnits > 0);
    out[id] = {
      deliveryDate: p.deliveryDate,
      coverUntil: p.coverUntil,
      total: p.total,
      lines: ordering.length,
      runsOut: p.lines.filter((l) => l.status === "runs-out").length,
      needsCount: p.lines.filter((l) => l.status === "needs-count").length,
      needsSetup: p.lines.filter((l) => l.status === "needs-setup").length,
      minOrder: p.supplier.minOrder,
      top: [...ordering]
        .sort((a, b) => Number(b.status === "runs-out") - Number(a.status === "runs-out") || (b.lineCost ?? 0) - (a.lineCost ?? 0))
        .slice(0, 40)
        .map((l) => ({ name: l.ingredientName, units: l.suggestedUnits, unit: l.purchaseUnit, cost: l.lineCost, runsOut: l.status === "runs-out" })),
    };
  }
  return out;
}
