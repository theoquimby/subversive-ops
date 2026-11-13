import "server-only";
import { after } from "next/server";
import { isBadReview, newSpikes, parseSentKeys, parseSpikeThreshold, spikeKey } from "@/domain/alerts";
import { addDays, businessDate, ISODate, toISODate } from "@/domain/dates";
import { creditItems } from "@/domain/invoiceMatch";
import { shiftPaidHours } from "@/domain/schedule";
import { money } from "@/lib/format";
import { db, num } from "../db";
import { env } from "../env";
import { briefDigest } from "../email/brief-digest";
import type { RenderedEmail } from "../email/layout";
import { DEFAULT_PREFS, NotifyEvent, NotifyPrefs, parsePrefs, prefsKey } from "../email/prefs";
import { badReviewEmail, invoiceIssueEmail, priceSpikesEmail, schedulePublishedEmail, shiftUpdateEmail, staffRequestEmail, weeklyBriefEmail, type PriceSpike, type ShiftUpdate, type StaffRequest } from "../email/templates";
import { badReviewSummary, staffRequestSummary } from "../email/templates/manager-requests";
import { shiftUpdatePush } from "../email/templates/shift-update";
import { emailConfigured, isEmail, sendEmail } from "../integrations/email";
import { weeklyBrief } from "./brief";
import { recentPriceMoves } from "./insights";
import { loadTolerance, STATUS_META } from "./invoices";
import { PushPayload, pushConfigured, sendPush } from "./push";
import { businessToday } from "./sales";
import { instantAt, shiftView } from "./scheduling";

/**
 * One way out for everything we tell people. `notify(event, deliveries)` checks each
 * recipient's preferences and sends email and/or web push. Missing config is not an
 * error: channels that aren't set up are skipped and reported in the result.
 *
 * Callers (schedule, labor, invoices, cron) use the typed helpers at the bottom.
 * They never throw — a failed notification must not undo the action that caused it.
 */

export interface Recipient {
  /** Login, if any — needed for push and preferences. */
  userId: string | null;
  name: string;
  /** Fallback address when the user hasn't set one (e.g. Employee.email). */
  email: string | null;
}

export interface Delivery {
  to: Recipient;
  email?: RenderedEmail;
  push?: PushPayload;
}

export interface NotifyResult {
  event: NotifyEvent;
  recipients: number;
  emailed: number;
  pushed: number;
  /** Plain-English reasons something wasn't sent ("Email isn't set up yet", "Jamie has no email"). */
  skipped: string[];
  errors: string[];
}

/**
 * Run a notification after the response is sent when we're inside a request
 * (server action / route), or straight away (unawaited) in scripts and crons.
 */
export function inBackground(task: () => Promise<unknown>) {
  const run = () => task().then(() => undefined, (e) => console.error("background notification failed", e));
  try {
    after(run);
  } catch {
    void run();
  }
}

export function appUrl(): string {
  const explicit = process.env.APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() || process.env.VERCEL_URL?.trim();
  return vercel ? `https://${vercel}` : "http://localhost:3000";
}

// ---- Preferences ---------------------------------------------------------------------

export async function loadPrefs(userId: string): Promise<NotifyPrefs> {
  const row = await db.setting.findUnique({ where: { key: prefsKey(userId) } });
  return parsePrefs(row?.value);
}

export async function savePrefs(userId: string, prefs: NotifyPrefs) {
  const value = JSON.stringify(prefs);
  await db.setting.upsert({ where: { key: prefsKey(userId) }, create: { key: prefsKey(userId), value }, update: { value } });
}

/** The address we'd email this login at: their own setting, else their team-member email. */
export async function emailForUser(userId: string): Promise<string | null> {
  const [prefs, emp] = await Promise.all([loadPrefs(userId), db.employee.findUnique({ where: { userId }, select: { email: true } })]);
  return prefs.email ?? (isEmail(emp?.email) ? emp!.email!.trim() : null);
}

// ---- Fan-out ---------------------------------------------------------------------------

export async function notify(event: NotifyEvent, deliveries: Delivery[]): Promise<NotifyResult> {
  const out: NotifyResult = { event, recipients: deliveries.length, emailed: 0, pushed: 0, skipped: [], errors: [] };
  const skip = (s: string) => !out.skipped.includes(s) && out.skipped.push(s);
  const canEmail = emailConfigured();
  const canPush = pushConfigured();
  if (!canEmail) skip("Email isn't set up yet");
  if (!canPush) skip("Push notifications aren't set up yet");

  await Promise.all(
    deliveries.map(async (d) => {
      try {
        const prefs = d.to.userId ? await loadPrefs(d.to.userId) : DEFAULT_PREFS;
        const want = prefs.events[event];
        if (d.email && want.email && canEmail) {
          const address = prefs.email ?? (isEmail(d.to.email) ? d.to.email.trim() : null);
          if (!address) skip(`${d.to.name} has no email`);
          else {
            const r = await sendEmail({ to: address, ...d.email, tags: { event } });
            if ("ok" in r) out.emailed++;
            else if ("error" in r) out.errors.push(`${d.to.name}: ${r.error}`);
          }
        }
        if (d.push && want.push && canPush && d.to.userId) {
          const r = await sendPush(d.to.userId, d.push);
          if ("sent" in r && r.sent > 0) out.pushed++;
        }
      } catch (e) {
        console.error(`notify ${event} failed for ${d.to.name}`, e);
        out.errors.push(`${d.to.name}: ${(e as Error).message}`);
      }
    }),
  );
  return out;
}

async function safely(event: NotifyEvent, fn: () => Promise<Delivery[]>): Promise<NotifyResult> {
  try {
    return await notify(event, await fn());
  } catch (e) {
    console.error(`notify ${event}: building messages failed`, e);
    return { event, recipients: 0, emailed: 0, pushed: 0, skipped: [], errors: [(e as Error).message] };
  }
}

async function managers(): Promise<Recipient[]> {
  const users = await db.user.findMany({ where: { role: "MANAGER", active: true }, select: { id: true, name: true } });
  const emps = await db.employee.findMany({ where: { userId: { in: users.map((u) => u.id) } }, select: { userId: true, email: true } });
  return users.map((u) => ({ userId: u.id, name: u.name, email: emps.find((e) => e.userId === u.id)?.email ?? null }));
}

const employeeRecipient = (e: { userId: string | null; name: string; email: string | null }): Recipient => ({ userId: e.userId, name: e.name, email: e.email });

// ---- Staff: schedule & requests -------------------------------------------------------

/**
 * Call after `publishWeek(monday)`. Emails each person on the schedule their own shifts
 * for the week (everyone's published shifts, so re-publishing after edits resends the full week).
 */
export function notifySchedulePublished(weekStart: ISODate) {
  return safely("schedulePublished", async () => {
    const shifts = await db.shift.findMany({
      where: { published: true, employeeId: { not: null }, start: { gte: instantAt(weekStart, 0), lt: instantAt(addDays(weekStart, 7), 0) } },
      include: { position: { select: { name: true } }, employee: { select: { id: true, name: true, email: true, userId: true, active: true } } },
      orderBy: { start: "asc" },
    });
    const byEmployee = new Map<string, typeof shifts>();
    for (const s of shifts) if (s.employee?.active) byEmployee.set(s.employee.id, [...(byEmployee.get(s.employee.id) ?? []), s]);
    const base = appUrl();
    return [...byEmployee.values()].map((list) => {
      const emp = list[0].employee!;
      const mine = list.map((s) => {
        const v = shiftView(s);
        return { date: v.date, startMin: v.startMin, endMin: v.endMin, position: s.position.name, hours: shiftPaidHours(v), notes: s.notes };
      });
      const hours = mine.reduce((a, s) => a + s.hours, 0);
      return {
        to: employeeRecipient(emp),
        email: schedulePublishedEmail({ name: emp.name, weekStart, shifts: mine, baseUrl: base }),
        push: { title: "Schedule is out", body: `${mine.length} shift${mine.length === 1 ? "" : "s"} · ${Number(hours.toFixed(1))} h the week of ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${weekStart}T00:00:00Z`))}`, url: "/my", tag: `schedule-${weekStart}` },
      };
    });
  });
}

/** What a shift looked like before an edit. Capture it with `shiftSnapshot(id)` before you change or delete the shift. */
export interface ShiftSnapshot {
  employeeId: string | null;
  positionId: string;
  start: Date;
  end: Date;
  published: boolean;
}

export async function shiftSnapshot(shiftId: string): Promise<ShiftSnapshot | null> {
  return db.shift.findUnique({ where: { id: shiftId }, select: { employeeId: true, positionId: true, start: true, end: true, published: true } });
}

/**
 * Call after editing, reassigning or deleting a *published* shift. Pass the `before`
 * snapshot so people get "was → now" (and the old assignee hears it was removed).
 * Without `before`, the current assignee just gets "your shift changed" with the new time.
 */
export function notifyShiftChanged(shiftId: string, before?: ShiftSnapshot | null) {
  return safely("shiftChanges", async () => {
    const after = await db.shift.findUnique({ where: { id: shiftId }, include: { position: { select: { name: true } } } });
    const posIds = [after?.positionId, before?.positionId].filter((x): x is string => !!x);
    const positions = new Map((await db.position.findMany({ where: { id: { in: posIds } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
    const view = (s: { start: Date; end: Date; positionId: string; employeeId: string | null }) => {
      const v = shiftView({ ...s, id: shiftId, breakMinutes: 0, notes: null, published: true });
      return { date: v.date, startMin: v.startMin, endMin: v.endMin, position: positions.get(s.positionId) ?? "Shift" };
    };
    const a = after && after.published ? after : null;
    const b = before && before.published ? before : null;
    const ids = [...new Set([a?.employeeId, b?.employeeId].filter((x): x is string => !!x))];
    const emps = await db.employee.findMany({ where: { id: { in: ids }, active: true }, select: { id: true, name: true, email: true, userId: true } });
    const base = appUrl();
    const out: Delivery[] = [];
    for (const e of emps) {
      const had = b?.employeeId === e.id ? view(b) : null;
      const has = a?.employeeId === e.id ? view(a) : null;
      if (!had && !has) continue;
      if (had && has && had.date === has.date && had.startMin === has.startMin && had.endMin === has.endMin && had.position === has.position) continue;
      // Without a snapshot we only know the new state, so it reads "updated" rather than "added".
      const update: ShiftUpdate = { kind: "changed", before: had, after: has, added: before !== undefined };
      out.push({ to: employeeRecipient(e), email: shiftUpdateEmail({ name: e.name, update, baseUrl: base }), push: { ...shiftUpdatePush(update), url: "/my", tag: `shift-${shiftId}` } });
    }
    return out;
  });
}

/** Call after a time-off request is approved or denied. */
export function notifyTimeOffDecided(requestId: string) {
  return safely("shiftChanges", async () => {
    const r = await db.timeOffRequest.findUnique({ where: { id: requestId }, include: { employee: { select: { name: true, email: true, userId: true } } } });
    if (!r || r.status === "PENDING") return [];
    const update: ShiftUpdate = { kind: "timeOff", approved: r.status === "APPROVED", startDate: toISODate(r.startDate), endDate: toISODate(r.endDate), note: r.note };
    return [{ to: employeeRecipient(r.employee), email: shiftUpdateEmail({ name: r.employee.name, update, baseUrl: appUrl() }), push: { ...shiftUpdatePush(update), url: "/my", tag: `timeoff-${r.id}` } }];
  });
}

/** Call after a shift swap is approved or denied. Tells the requester and (if any) the person taking it. */
export function notifySwapDecided(swapId: string) {
  return safely("shiftChanges", async () => {
    const s = await db.shiftSwap.findUnique({
      where: { id: swapId },
      include: {
        shift: { include: { position: { select: { name: true } } } },
        requester: { select: { name: true, email: true, userId: true } },
        taker: { select: { name: true, email: true, userId: true } },
      },
    });
    if (!s || s.status === "PENDING") return [];
    const v = shiftView(s.shift);
    const shift = { date: v.date, startMin: v.startMin, endMin: v.endMin, position: s.shift.position.name };
    const approved = s.status === "APPROVED";
    const base = appUrl();
    const out: Delivery[] = [];
    const reqUpdate: ShiftUpdate = { kind: "swap", role: "requester", approved, shift, otherName: s.taker?.name ?? null };
    out.push({ to: employeeRecipient(s.requester), email: shiftUpdateEmail({ name: s.requester.name, update: reqUpdate, baseUrl: base }), push: { ...shiftUpdatePush(reqUpdate), url: "/my", tag: `swap-${s.id}` } });
    if (s.taker) {
      const takerUpdate: ShiftUpdate = { kind: "swap", role: "taker", approved, shift, otherName: s.requester.name };
      out.push({ to: employeeRecipient(s.taker), email: shiftUpdateEmail({ name: s.taker.name, update: takerUpdate, baseUrl: base }), push: { ...shiftUpdatePush(takerUpdate), url: "/my", tag: `swap-${s.id}` } });
    }
    return out;
  });
}

// ---- Managers ---------------------------------------------------------------------------

/** The weekly brief digest to every manager. Called by /api/cron/weekly-brief. */
export function notifyWeeklyBrief() {
  return safely("weeklyBrief", async () => {
    const digest = briefDigest(await weeklyBrief());
    const base = appUrl();
    const n = digest.todo.length;
    return (await managers()).map((m) => ({
      to: m,
      email: weeklyBriefEmail({ name: m.name, digest, baseUrl: base }),
      push: { title: "Your weekly brief", body: n ? `${n} thing${n === 1 ? " needs" : "s need"} you: ${digest.todo.slice(0, 2).map((t) => t.title).join(", ")}${n > 2 ? "…" : ""}` : "Nothing urgent this week.", url: "/brief", tag: `brief-${digest.week}` },
    }));
  });
}

/** Price increases worth knowing about (pass `recentPriceMoves()` output, already filtered to your threshold). */
export function notifyPriceSpikes(moves: PriceSpike[]) {
  return safely("priceSpikes", async () => {
    const ups = moves.filter((m) => m.changePct > 0);
    if (ups.length === 0) return [];
    const base = appUrl();
    const top = [...ups].sort((a, b) => b.changePct - a.changePct)[0];
    return (await managers()).map((m) => ({
      to: m,
      email: priceSpikesEmail({ name: m.name, moves: ups, baseUrl: base }),
      push: { title: ups.length === 1 ? "A price jumped" : `${ups.length} prices jumped`, body: `${top.ingredient ?? top.description} ${money(top.oldPrice)} → ${money(top.newPrice)} (${top.supplier})${ups.length > 1 ? ` and ${ups.length - 1} more` : ""}`, url: "/prices", tag: "price-spikes" },
    }));
  });
}

/** Call when an invoice lands with a price/qty mismatch (status PRICE_ISSUE, QTY_ISSUE or PRICE_AND_QTY). */
export function notifyInvoiceIssue(invoiceId: string) {
  return safely("invoiceIssues", async () => {
    const inv = await db.invoice.findUnique({ where: { id: invoiceId }, omit: { image: true }, include: { supplier: { select: { name: true } }, lines: { orderBy: { id: "asc" } } } });
    if (!inv || !["PRICE_ISSUE", "QTY_ISSUE", "PRICE_AND_QTY"].includes(inv.status)) return [];
    const lines = inv.lines.map((l) => ({ description: l.description, sku: l.sku, qty: num(l.qty)!, unitPrice: num(l.unitPrice)!, expectedQty: num(l.expectedQty), expectedPrice: num(l.expectedPrice), status: l.status }));
    const issues = lines
      .filter((l) => l.status !== "OK")
      .map((l) => ({
        description: l.description,
        detail:
          l.status === "UNMATCHED" ? "Not on the order"
          : [
              l.status.includes("PRICE") && l.expectedPrice != null ? `Charged ${money(l.unitPrice)}, expected ${money(l.expectedPrice)}` : "",
              l.status.includes("QTY") && l.expectedQty != null ? `Billed ${Number(l.qty.toFixed(2))}, received ${Number(l.expectedQty.toFixed(2))}` : "",
            ].filter(Boolean).join(" · ") || "Doesn't match",
      }));
    const credit = creditItems(lines, await loadTolerance()).reduce((s, c) => s + c.amount, 0);
    const label = STATUS_META[inv.status].label;
    const base = appUrl();
    const ref = inv.invoiceNumber ? `#${inv.invoiceNumber}` : toISODate(inv.invoiceDate);
    return (await managers()).map((m) => ({
      to: m,
      email: invoiceIssueEmail({ name: m.name, invoiceId: inv.id, supplierName: inv.supplier.name, invoiceNumber: inv.invoiceNumber, invoiceDate: toISODate(inv.invoiceDate), statusLabel: label, total: num(inv.total), issues, creditTotal: credit > 0 ? credit : null, baseUrl: base }),
      push: { title: `${inv.supplier.name} invoice ${ref}`, body: `${label}: ${issues.length} line${issues.length === 1 ? "" : "s"} don't match${credit > 0 ? ` · ${money(credit)} credit to request` : ""}`, url: `/invoices/${inv.id}`, tag: `invoice-${inv.id}` },
    }));
  });
}

// ---- Price spikes: threshold + "already sent" bookkeeping ---------------------------------

export const SPIKE_THRESHOLD_KEY = "alerts.priceSpikeThreshold";
const SPIKES_SENT_KEY = "alerts.priceSpikes.sent";

/** Minimum increase (fraction, default 0.08) that counts as a spike. */
export async function spikeThreshold(): Promise<number> {
  return parseSpikeThreshold((await db.setting.findUnique({ where: { key: SPIKE_THRESHOLD_KEY } }))?.value);
}

export async function saveSpikeThreshold(fraction: number) {
  const value = String(fraction);
  await db.setting.upsert({ where: { key: SPIKE_THRESHOLD_KEY }, create: { key: SPIKE_THRESHOLD_KEY, value }, update: { value } });
}

/**
 * Tell managers about price increases at or over the threshold that took effect in the
 * last `days` days and haven't been alerted yet (one alert per product per price date).
 * Called by the daily-ops cron and after a price sheet is imported. Never throws.
 */
export async function alertPriceSpikes(days = 7): Promise<{ spikes: number } & Partial<Pick<NotifyResult, "emailed" | "pushed" | "skipped" | "errors">>> {
  try {
    const today = businessToday();
    const [threshold, sentRow, moves] = await Promise.all([spikeThreshold(), db.setting.findUnique({ where: { key: SPIKES_SENT_KEY } }), recentPriceMoves(days)]);
    const sent = parseSentKeys(sentRow?.value, today);
    const fresh = newSpikes(moves, threshold, new Set(sent));
    if (fresh.length === 0) return { spikes: 0 };
    // Mark first: a slow or failed send must not turn into a repeat alert tomorrow.
    const value = JSON.stringify([...sent, ...fresh.map(spikeKey)]);
    await db.setting.upsert({ where: { key: SPIKES_SENT_KEY }, create: { key: SPIKES_SENT_KEY, value }, update: { value } });
    const r = await notifyPriceSpikes(fresh);
    return { spikes: fresh.length, emailed: r.emailed, pushed: r.pushed, skipped: r.skipped, errors: r.errors };
  } catch (e) {
    console.error("price spike alert failed", e);
    return { spikes: 0, errors: [(e as Error).message] };
  }
}

// ---- Managers: things waiting on a decision ----------------------------------------------

/** Call after a staff member asks for time off or posts a swap. */
export function notifyStaffRequest(ref: { timeOffId: string } | { swapId: string }) {
  return safely("staffRequests", async () => {
    let request: StaffRequest;
    let tag: string;
    if ("timeOffId" in ref) {
      const r = await db.timeOffRequest.findUnique({ where: { id: ref.timeOffId }, include: { employee: { select: { name: true } } } });
      if (!r || r.status !== "PENDING") return [];
      const startDate = toISODate(r.startDate);
      const endDate = toISODate(r.endDate);
      const shiftsAffected = await db.shift.count({ where: { employeeId: r.employeeId, published: true, start: { gte: instantAt(startDate, 0), lt: instantAt(addDays(endDate, 1), 0) } } });
      request = { kind: "timeOff", employee: r.employee.name, type: r.type, startDate, endDate, hours: num(r.hours), note: r.note, shiftsAffected };
      tag = `request-timeoff-${r.id}`;
    } else {
      const s = await db.shiftSwap.findUnique({
        where: { id: ref.swapId },
        include: { shift: { include: { position: { select: { name: true } } } }, requester: { select: { name: true } }, taker: { select: { name: true } } },
      });
      if (!s || s.status !== "PENDING") return [];
      const v = shiftView(s.shift);
      request = { kind: "swap", employee: s.requester.name, shift: { date: v.date, startMin: v.startMin, endMin: v.endMin, position: s.shift.position.name }, taker: s.taker?.name ?? null };
      tag = `request-swap-${s.id}`;
    }
    const base = appUrl();
    const sum = staffRequestSummary(request);
    return (await managers()).map((m) => ({
      to: m,
      email: staffRequestEmail({ name: m.name, request, baseUrl: base }),
      push: { title: sum.title, body: sum.body, url: "/schedule/requests", tag },
    }));
  });
}

/** Call with newly imported review ids; managers hear about recent 1–2★ ones only. */
export function notifyBadReviews(reviewIds: string[]) {
  return safely("badReviews", async () => {
    if (reviewIds.length === 0) return [];
    // A first import can pull in old reviews; only recent ones are news.
    const since = instantAt(addDays(businessToday(), -14), 0);
    const rows = await db.review.findMany({ where: { id: { in: reviewIds }, postedAt: { gte: since } }, orderBy: { postedAt: "desc" }, select: { author: true, rating: true, source: true, text: true, postedAt: true } });
    const bad = rows.filter((r) => isBadReview(r.rating)).map((r) => ({ author: r.author, rating: r.rating, source: r.source, text: r.text, date: businessDate(r.postedAt, env.BUSINESS_TIMEZONE) }));
    if (bad.length === 0) return [];
    const base = appUrl();
    const sum = badReviewSummary(bad);
    return (await managers()).map((m) => ({
      to: m,
      email: badReviewEmail({ name: m.name, reviews: bad, baseUrl: base }),
      push: { title: sum.title, body: sum.body, url: "/reviews", tag: `reviews-${bad[0].date}` },
    }));
  });
}

/** A test notification to one login, from the settings page. */
export async function sendTestNotification(userId: string, name: string) {
  return sendPush(userId, { title: "Notifications are on", body: `Hi ${name.split(" ")[0]} — this is how alerts from Subversive Ops will look.`, url: "/settings/notifications", tag: "test" });
}
