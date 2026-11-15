import "server-only";
import { addDays, ISODate } from "@/domain/dates";
import { monthEnd, monthOf, type ClosePeriod } from "@/domain/monthEnd";
import type { QboAccount } from "@/domain/quickbooks";
import {
  buildQboJournal,
  JOURNAL_ACCOUNT_KEYS,
  JOURNAL_ACCOUNT_LABELS,
  journalAction,
  journalLines,
  journalRequestId,
  modeConflict,
  parseJournalSettings,
  suggestJournalAccounts,
  summarize,
  type JournalAccountKey,
  type JournalMode,
  type JournalSettings,
  type SalesDayFigures,
  type SalesSummary,
} from "@/domain/salesJournal";
import { Prisma } from "@prisma/client";
import { db } from "../db";
import { createJournalEntry, friendlyQuickBooksError, readJournalEntry, updateJournalEntry } from "../integrations/quickbooks";
import { logProblem, quickbooksAccounts, quickbooksRealm, quickbooksStatus, withQuickBooks } from "./quickbooks";
import { salesByDay } from "./monthEnd";
import { businessToday } from "./sales";
import { readSettingJSON, writeSettingJSON } from "./square";

/**
 * The Square sales summary sent to QuickBooks as a JournalEntry, per day or
 * per month. Off until the manager turns it on and picks accounts. Each entry
 * is linked in QuickBooksLink (kind "journal", localId "day:YYYY-MM-DD" or
 * "month:YYYY-MM"), so sending again updates the same entry, and an entry
 * whose figures haven't changed is never re-sent.
 */

const KEY = "monthEnd.journal";
const KIND = "journal";
const SENDING_FOR_MS = 2 * 60_000;

export async function loadJournalSettings(): Promise<JournalSettings> {
  return parseJournalSettings(await readSettingJSON(KEY), await quickbooksRealm());
}

export type JournalChange =
  | { field: "enabled"; value: boolean }
  | { field: "mode"; value: JournalMode }
  | { field: "sendFrom"; value: ISODate | null }
  | { field: "account"; key: JournalAccountKey; value: string | null }
  | { field: "useSuggestions" };

export async function saveJournalSettings(change: JournalChange): Promise<JournalSettings> {
  const realmId = await quickbooksRealm();
  const cur = parseJournalSettings(await readSettingJSON(KEY), realmId);
  const next: JournalSettings = { ...cur, realmId, accounts: { ...cur.accounts } };
  if (change.field === "enabled") {
    next.enabled = change.value;
    // First time on: start from the last full month, so older days already in the books aren't sent.
    if (change.value && !next.sendFrom) next.sendFrom = `${monthOf(addDays(`${monthOf(businessToday())}-01`, -1))}-01`;
  } else if (change.field === "mode") next.mode = change.value;
  else if (change.field === "sendFrom") next.sendFrom = change.value;
  else {
    if (!realmId) throw new Error("Connect QuickBooks first, then choose accounts.");
    const { accounts } = await quickbooksAccounts();
    if (change.field === "useSuggestions") {
      const s = suggestJournalAccounts(accounts);
      for (const k of JOURNAL_ACCOUNT_KEYS) if (!next.accounts[k] && s[k]) next.accounts[k] = s[k];
    } else {
      if (change.value) {
        const a = accounts.find((x) => x.id === change.value);
        if (!a) throw new Error("That account isn't in QuickBooks any more. Refresh the list and pick again.");
        if (!JOURNAL_ACCOUNT_LABELS[change.key].types.includes(a.type)) throw new Error(`${a.fullName} is a ${a.type} account; ${JOURNAL_ACCOUNT_LABELS[change.key].label} needs ${JOURNAL_ACCOUNT_LABELS[change.key].hint.toLowerCase()}.`);
      }
      next.accounts[change.key] = change.value;
    }
  }
  await writeSettingJSON(KEY, next);
  return next;
}

// ---- Entries ---------------------------------------------------------------------------------------

export type EntryState = "not-sent" | "sent" | "changed" | "not-ready" | "error" | "blocked" | "before-start" | "sending";

export interface JournalEntryView {
  key: string;
  label: string;
  txnDate: ISODate;
  summary: SalesSummary;
  lines: { key: JournalAccountKey; label: string; account: string | null; posting: "Debit" | "Credit"; amount: number; description: string }[];
  debits: number;
  credits: number;
  balanced: boolean;
  notes: string[];
  state: EntryState;
  /** Why it can't go (not ready, conflict, missing account) or the last error. */
  reason: string | null;
  qboId: string | null;
  sentAt: string | null;
  sentBy: string | null;
}

const figures = (d: Awaited<ReturnType<typeof salesByDay>>[number]): SalesDayFigures => ({
  date: d.date,
  food: d.food,
  beverage: d.beverage,
  other: d.other,
  discounts: d.discounts,
  tax: d.tax,
  tips: d.tips,
  cardFees: d.cardFees,
  cardVolume: d.cardVolume,
  feePending: d.feePending,
});

/** Summaries for the entries touching [from, to]: days in it, or the whole months it touches. */
async function summariesFor(from: ISODate, to: ISODate, mode: JournalMode): Promise<SalesSummary[]> {
  const today = businessToday();
  const start = mode === "monthly" ? `${monthOf(from)}-01` : from;
  const end = mode === "monthly" ? monthEnd(monthOf(to)) : to;
  const days = await salesByDay(start, addDays(end, 1));
  const out = summarize(days.map(figures), mode, today);
  // Monthly: the current month is listed (not ready) so it's clear why there's nothing to send.
  return out;
}

function entryWindow(key: string): { from: ISODate; to: ISODate; mode: JournalMode } {
  if (key.startsWith("month:")) {
    const m = key.slice(6);
    return { from: `${m}-01`, to: monthEnd(m), mode: "monthly" };
  }
  const d = key.slice(4);
  return { from: d, to: d, mode: "daily" };
}

const isKey = (k: string) => /^day:\d{4}-\d{2}-\d{2}$/.test(k) || /^month:\d{4}-\d{2}$/.test(k);

export interface JournalOverview {
  enabled: boolean;
  connected: boolean;
  companyName: string | null;
  settings: JournalSettings;
  accounts: QboAccount[];
  suggestions: Record<JournalAccountKey, string | null>;
  entries: JournalEntryView[];
  counts: { notSent: number; changed: number; notReady: number; sent: number; error: number; blocked: number };
}

/** Where the period's sales entries stand, with a preview of each. Works with QuickBooks disconnected (preview only). */
export async function journalOverview(p: Pick<ClosePeriod, "from" | "to">): Promise<JournalOverview> {
  const [settings, status] = await Promise.all([loadJournalSettings(), quickbooksStatus().catch(() => null)]);
  const connected = !!status?.connected && !!status.realmId;
  const [{ accounts }, summaries] = await Promise.all([connected ? quickbooksAccounts() : Promise.resolve({ accounts: [] as QboAccount[] }), summariesFor(p.from, p.to, settings.mode)]);
  const links = connected ? await db.quickBooksLink.findMany({ where: { realmId: status!.realmId!, kind: KIND } }) : [];
  const byKey = new Map(links.map((l) => [l.localId, l]));
  const sentKeys = new Set(links.filter((l) => l.qboId).map((l) => l.localId));
  const name = new Map(accounts.map((a) => [a.id, a.fullName]));
  const entries: JournalEntryView[] = summaries.map((s) => {
    const built = journalLines(s);
    const b = buildQboJournal(s, settings.accounts);
    const link = byKey.get(s.key) ?? null;
    const conflict = modeConflict(s.key, new Set([...sentKeys].filter((k) => k !== s.key)));
    let state: EntryState;
    let reason: string | null = null;
    if (link?.status === "sending" && Date.now() - link.updatedAt.getTime() < SENDING_FOR_MS) state = "sending";
    else if (s.notReady.length) [state, reason] = ["not-ready", s.notReady.join(" ")];
    else if (link?.qboId) {
      state = b.ok && journalAction(link, b.hash) === "update" ? "changed" : "sent";
      if (link.status === "error") [state, reason] = ["error", link.error];
    } else if (conflict) [state, reason] = ["blocked", conflict];
    else if (settings.sendFrom && s.txnDate < settings.sendFrom && !(s.mode === "monthly" && monthEnd(s.label) >= settings.sendFrom)) [state, reason] = ["before-start", `Before the start date (${settings.sendFrom}).`];
    else if (link?.status === "error") [state, reason] = ["error", link.error];
    else state = "not-sent";
    if (!b.ok && (state === "not-sent" || state === "changed" || state === "error") && !reason) reason = b.error;
    return {
      key: s.key,
      label: s.label,
      txnDate: s.txnDate,
      summary: s,
      lines: built.lines.map((l) => ({ ...l, label: JOURNAL_ACCOUNT_LABELS[l.key].label, account: settings.accounts[l.key] ? name.get(settings.accounts[l.key]!) ?? "Account no longer in QuickBooks" : null })),
      debits: built.debits,
      credits: built.credits,
      balanced: built.balanced,
      notes: built.notes,
      state,
      reason,
      qboId: link?.qboId ?? null,
      sentAt: link?.sentAt?.toISOString() ?? null,
      sentBy: link?.sentBy ?? null,
    };
  });
  const n = (st: EntryState) => entries.filter((e) => e.state === st).length;
  return {
    enabled: settings.enabled,
    connected,
    companyName: status?.companyName ?? null,
    settings,
    accounts,
    suggestions: suggestJournalAccounts(accounts),
    entries,
    counts: { notSent: n("not-sent"), changed: n("changed"), notReady: n("not-ready"), sent: n("sent"), error: n("error"), blocked: n("blocked") },
  };
}

// ---- Sending -------------------------------------------------------------------------------------------

const linkKey = (realmId: string, localId: string) => ({ realmId_kind_localId: { realmId, kind: KIND, localId } });

/** Claim an entry for sending so a double tap can't send it twice. */
async function claim(realmId: string, key: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - SENDING_FOR_MS);
  const r = await db.quickBooksLink.updateMany({ where: { realmId, kind: KIND, localId: key, OR: [{ status: { not: "sending" } }, { updatedAt: { lt: cutoff } }] }, data: { status: "sending" } });
  if (r.count) return true;
  try {
    await db.quickBooksLink.create({ data: { realmId, kind: KIND, localId: key, status: "sending" } });
    return true;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return false;
    throw e;
  }
}

export type JournalSendResult = { ok: true; message: string; qboId: string | null; action: "create" | "update" | "skip" } | { ok: false; error: string };

/**
 * Send one entry: create it, update it if its figures changed since it was
 * sent, or do nothing if they didn't. A deleted entry is created again.
 */
export async function sendJournalEntry(key: string, by: string): Promise<JournalSendResult> {
  if (!isKey(key)) return { ok: false, error: "That entry isn't one we know." };
  const [settings, realmId] = await Promise.all([loadJournalSettings(), quickbooksRealm()]);
  if (!realmId) return { ok: false, error: "QuickBooks isn't connected. Connect it in Settings → Connections → QuickBooks." };
  if (!settings.enabled) return { ok: false, error: "Sales to QuickBooks is off. Turn it on first." };
  const w = entryWindow(key);
  if (w.mode !== settings.mode) return { ok: false, error: `Entries are set to ${settings.mode === "daily" ? "daily" : "monthly"} now.` };
  const summary = (await summariesFor(w.from, w.to, w.mode)).find((s) => s.key === key);
  if (!summary) return { ok: false, error: "Nothing to send for that one: no Square sales." };
  const b = buildQboJournal(summary, settings.accounts);
  if (!b.ok) return { ok: false, error: b.error };
  if (settings.sendFrom && summary.txnDate < settings.sendFrom && !(w.mode === "monthly" && w.to >= settings.sendFrom)) return { ok: false, error: `That's before the start date (${settings.sendFrom}).` };
  const sent = await db.quickBooksLink.findMany({ where: { realmId, kind: KIND, qboId: { not: null }, localId: { not: key } }, select: { localId: true } });
  const conflict = modeConflict(key, new Set(sent.map((s) => s.localId)));
  if (conflict) return { ok: false, error: conflict };

  const existing = await db.quickBooksLink.findUnique({ where: linkKey(realmId, key) });
  if (existing?.qboId && journalAction(existing, b.hash) === "skip" && existing.status === "ok") return { ok: true, action: "skip", qboId: existing.qboId, message: "Already up to date in QuickBooks." };
  if (!(await claim(realmId, key))) return { ok: false, error: "It's already being sent. Give it a few seconds." };

  const fail = async (message: string): Promise<JournalSendResult> => {
    await db.quickBooksLink.update({ where: linkKey(realmId, key), data: { status: "error", error: message.slice(0, 500) } });
    await logProblem(`Sales entry ${summary.label}: ${message}`).catch(() => undefined);
    return { ok: false, error: message };
  };

  try {
    return await withQuickBooks(async (c) => {
      const link = await db.quickBooksLink.findUniqueOrThrow({ where: linkKey(realmId, key) });
      const current = link.qboId ? await readJournalEntry(c, link.qboId) : null;
      let out;
      let action: "create" | "update" | "skip";
      if (current && link.hash === b.hash) {
        action = "skip";
        out = current;
      } else if (current) {
        action = "update";
        out = await updateJournalEntry(c, current.Id, current.SyncToken, b.payload);
      } else {
        action = "create";
        out = await createJournalEntry(c, b.payload, journalRequestId(key, b.hash, link.qboId));
      }
      await db.quickBooksLink.update({ where: { id: link.id }, data: { qboId: out.Id, syncToken: out.SyncToken, hash: b.hash, status: "ok", error: null, sentAt: new Date(), sentBy: by } });
      const message = action === "skip" ? "Already up to date in QuickBooks." : action === "update" ? `Updated journal entry ${b.payload.DocNumber} in QuickBooks.` : link.qboId ? `The entry had been deleted in QuickBooks, so ${b.payload.DocNumber} was sent again.` : `Sent ${b.payload.DocNumber} to QuickBooks.`;
      return { ok: true as const, action, qboId: out.Id, message };
    });
  } catch (e) {
    return fail(friendlyQuickBooksError(e));
  }
}

/** Send every entry in the period that's ready and new or changed, one at a time. */
export async function sendJournalEntries(p: Pick<ClosePeriod, "from" | "to">, by: string, max = 20) {
  const o = await journalOverview(p);
  const todo = o.entries.filter((e) => (e.state === "not-sent" || e.state === "changed" || e.state === "error") && !e.reason?.startsWith("Choose")).slice(0, max);
  let sent = 0;
  let updated = 0;
  let failed = 0;
  let firstError: string | null = null;
  const started = Date.now();
  for (const e of todo) {
    if (Date.now() - started > 40_000) break;
    const r = await sendJournalEntry(e.key, by);
    if (!r.ok) {
      failed++;
      firstError ??= r.error;
      if (/isn't connected|Connect/.test(r.error)) break;
    } else if (r.action === "create") sent++;
    else if (r.action === "update") updated++;
  }
  return { sent, updated, failed, firstError, left: Math.max(0, todo.length - sent - updated - failed) };
}

