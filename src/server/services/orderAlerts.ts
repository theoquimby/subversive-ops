import "server-only";
import { addDays, parseISODate, toISODate, type ISODate } from "@/domain/dates";
import { parseMorningHour } from "@/domain/morningBrief";
import { alertMode, shouldNag, type AlertMode, type SupplierNeed } from "@/domain/orderNeed";
import { dueReminders, lastPassedCutoff, missedOrder, missedPushDue, pruneSentKeys, type Deadline, type Missed, type Placed, type Reminder } from "@/domain/orderReminders";
import type { CutoffRule } from "@/domain/ordering";
import type { SupplierPrefs } from "@/domain/supplierPrefs";
import { db } from "../db";
import { orderReminderEmail } from "../email/templates/order-reminder";
import { appUrl, notify, type Delivery, type NotifyResult, type Recipient } from "./notify";
import { buildOrderPlans, localNow, supplierCutoffs } from "./planning";
import { loadSupplierPrefs, prefsOf, staffOrderers } from "./supplierPrefs";
import { instantAt } from "./scheduling";

/**
 * Where each kitchen supplier's ordering stands for alerts: its next deadline,
 * whether an order is placed, whether it should nag (cadence, stock, the
 * supplier's alert setting) and any cutoff that passed with nothing ordered.
 * The Overview's "Needs you", the morning brief, the Ordering board and the
 * reminder job all read this, so they agree.
 */

export interface SupplierAlertState {
  supplierId: string;
  name: string;
  cadence: string;
  mode: AlertMode;
  prefs: SupplierPrefs;
  rule: CutoffRule;
  deliveryDays: number[];
  next: Deadline | null;
  hoursToCutoff: number | null;
  /** The order for the next delivery. */
  placed: Placed;
  orderId: string | null;
  /** Worked out for suppliers alerted "only when stock runs low" when it matters (a deadline close, or one just missed). */
  need: SupplierNeed | null;
  nag: boolean;
  missed: Missed | null;
}

/** Stock is checked for "when stock runs low" suppliers with a deadline this close. */
export const NEED_WINDOW_HOURS = 48;

export async function orderAlertStates(now = new Date(), opts: { needFor?: "window" | "all" } = {}): Promise<SupplierAlertState[]> {
  const local = localNow(now);
  const today = local.date;
  const [cutoffs, allPrefs] = await Promise.all([supplierCutoffs(now), loadSupplierPrefs()]);
  const passedBy = new Map(cutoffs.map((c) => [c.supplierId, lastPassedCutoff(c.deliveryDays, c.rule, local.date, local.time)]));
  const dates = [...new Set(cutoffs.flatMap((c) => [c.next?.deliveryDate, passedBy.get(c.supplierId)?.deliveryDate]).filter((d): d is string => !!d))];
  const orders = dates.length
    ? await db.purchaseOrder.findMany({ where: { supplierId: { in: cutoffs.map((c) => c.supplierId) }, deliveryDate: { in: dates.map(parseISODate) } }, select: { id: true, supplierId: true, deliveryDate: true, status: true } })
    : [];
  const ordersFor = (supplierId: string, d: ISODate | undefined) => (d ? orders.filter((o) => o.supplierId === supplierId && toISODate(o.deliveryDate) === d) : []);

  const base = cutoffs.map((c) => {
    const prefs = prefsOf(allPrefs, c.supplierId);
    const mode = alertMode(c.cadence, prefs.alert);
    const mine = ordersFor(c.supplierId, c.next?.deliveryDate);
    const sent = mine.find((o) => o.status !== "DRAFT");
    const draft = mine.find((o) => o.status === "DRAFT");
    const placed: Placed = sent ? "sent" : draft ? "draft" : "none";
    const passed = passedBy.get(c.supplierId) ?? null;
    const missedOpen = !!passed && passed.deliveryDate >= today && ordersFor(c.supplierId, passed.deliveryDate).length === 0;
    const close = c.next != null && c.hoursToCutoff != null && c.hoursToCutoff > 0 && c.hoursToCutoff <= NEED_WINDOW_HOURS && placed !== "sent";
    return { c, prefs, mode, placed, orderId: (sent ?? draft)?.id ?? null, passed, wantsNeed: mode === "low" && (opts.needFor === "all" || close || missedOpen) };
  });

  const needIds = base.filter((b) => b.wantsNeed).map((b) => b.c.supplierId);
  const plans = needIds.length ? await buildOrderPlans(needIds).catch((e) => {
    console.error("order alerts: stock check failed", e);
    return new Map();
  }) : new Map();

  return base.map(({ c, prefs, mode, placed, orderId, passed }) => {
    const need: SupplierNeed | null = plans.get(c.supplierId)?.need ?? null;
    const nag = shouldNag(mode, need);
    const hasOrder = !!passed && ordersFor(c.supplierId, passed.deliveryDate).length > 0;
    return {
      supplierId: c.supplierId,
      name: c.name,
      cadence: c.cadence,
      mode,
      prefs,
      rule: c.rule,
      deliveryDays: c.deliveryDays,
      next: c.next,
      hoursToCutoff: c.hoursToCutoff,
      placed,
      orderId,
      need,
      nag,
      missed: missedOrder({ supplierId: c.supplierId, supplierName: c.name, passed, hasOrder, nag, next: c.next, today }),
    };
  });
}

// ---- The reminder job ---------------------------------------------------------------------

const SENT_KEY = "ordering.reminders.sent";

async function managers(): Promise<Recipient[]> {
  const users = await db.user.findMany({ where: { role: "MANAGER", active: true }, select: { id: true, name: true } });
  const emps = await db.employee.findMany({ where: { userId: { in: users.map((u) => u.id) } }, select: { userId: true, email: true } });
  return users.map((u) => ({ userId: u.id, name: u.name, email: emps.find((e) => e.userId === u.id)?.email ?? null }));
}

/** Logins that can place orders: managers, and staff a manager allowed. */
async function orderers(): Promise<{ id: string; name: string; role: string }[]> {
  const staff = await staffOrderers();
  return db.user.findMany({ where: { active: true, OR: [{ role: "MANAGER" }, { id: { in: staff } }] }, select: { id: true, name: true, role: true } });
}

/** Who a supplier's reminders go to: managers, chosen people, or whoever can order and is on shift today (managers if nobody is). */
export async function reminderRecipients(prefs: SupplierPrefs, today: ISODate): Promise<(Recipient & { staff: boolean })[]> {
  const can = await orderers();
  const canIds = new Set(can.map((u) => u.id));
  const withEmail = async (users: { id: string; name: string; role: string }[]) => {
    const emps = await db.employee.findMany({ where: { userId: { in: users.map((u) => u.id) } }, select: { userId: true, email: true } });
    return users.map((u) => ({ userId: u.id, name: u.name, email: emps.find((e) => e.userId === u.id)?.email ?? null, staff: u.role !== "MANAGER" }));
  };
  if (prefs.recipients === "people") {
    const people = await db.user.findMany({ where: { id: { in: prefs.people }, active: true }, select: { id: true, name: true, role: true } });
    if (people.length) return withEmail(people);
  }
  if (prefs.recipients === "shift") {
    const shifts = await db.shift.findMany({
      where: { published: true, start: { gte: instantAt(today, 0), lt: instantAt(addDays(today, 1), 0) }, employee: { active: true, userId: { not: null } } },
      select: { employee: { select: { userId: true } } },
    });
    const onShift = new Set(shifts.map((s) => s.employee?.userId).filter((x): x is string => !!x && canIds.has(x)));
    if (onShift.size) return withEmail(can.filter((u) => onShift.has(u.id)));
  }
  return (await managers()).map((m) => ({ ...m, staff: false }));
}

/**
 * Scheduled through the day (see /api/cron/morning-brief): sends each supplier's
 * first reminder and last call when they're due and nothing is placed, and one
 * push when a cutoff passes with no order. Never sends anything to a supplier.
 * Marks reminders sent before sending, so overlapping runs can't double up.
 */
export async function runOrderReminders(now = new Date()) {
  const local = localNow(now);
  const [states, sentRow, hourRow] = await Promise.all([
    orderAlertStates(now),
    db.setting.findUnique({ where: { key: SENT_KEY } }),
    db.setting.findUnique({ where: { key: "brief.morning.hour" } }),
  ]);
  let sent: string[] = [];
  try {
    const v = sentRow ? JSON.parse(sentRow.value) : [];
    sent = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    sent = [];
  }
  const sentSet = new Set(sent);
  const morningHour = parseMorningHour(hourRow?.value);
  const due: { state: SupplierAlertState; reminder: Reminder | null; missed: Missed | null; key: string }[] = [];
  for (const s of states) {
    for (const r of dueReminders({ supplierId: s.supplierId, supplierName: s.name, now: local, next: s.next, placed: s.placed, nag: s.nag, prefs: s.prefs, morningHour, sent: sentSet })) {
      due.push({ state: s, reminder: r, missed: null, key: r.key });
    }
    if (s.missed && missedPushDue(s.missed.deadline, local, sentSet, s.missed.key)) due.push({ state: s, reminder: null, missed: s.missed, key: s.missed.key });
  }
  if (due.length === 0) return { reminders: 0 };
  const value = JSON.stringify(pruneSentKeys([...sent, ...due.map((d) => d.key)], local.date));
  await db.setting.upsert({ where: { key: SENT_KEY }, create: { key: SENT_KEY, value }, update: { value } });

  const base = appUrl();
  const results: NotifyResult[] = [];
  for (const d of due) {
    try {
      const to = await reminderRecipients(d.state.prefs, local.date);
      const title = d.reminder?.title ?? d.missed!.title;
      const body = d.reminder?.body ?? d.missed!.detail;
      const deliveries: Delivery[] = to.map((r) => {
        const path = r.staff ? `/my/ordering/${d.state.supplierId}` : `/ordering/${d.state.supplierId}`;
        return {
          to: r,
          email: orderReminderEmail({ name: r.name, title, body, path, baseUrl: base }),
          push: { title, body, url: path, tag: `order-${d.key}` },
        };
      });
      results.push(await notify("orders", deliveries));
    } catch (e) {
      console.error("order reminder failed", d.key, e);
    }
  }
  return {
    reminders: due.length,
    pushed: results.reduce((s, r) => s + r.pushed, 0),
    emailed: results.reduce((s, r) => s + r.emailed, 0),
    skipped: [...new Set(results.flatMap((r) => r.skipped))],
    errors: results.flatMap((r) => r.errors),
  };
}
