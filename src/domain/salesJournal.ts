/**
 * The Square sales summary as a QuickBooks Online JournalEntry. Pure.
 *
 * Checked against Intuit's docs (Nov 2026):
 * - minor-version-75 XSD (Finance.xsd): `JournalEntry` is a Transaction —
 *   "Accounting transaction, consists of journal lines, each of which is
 *   either a debit or a credit. The total of the debits must equal the total
 *   of the credits." Each line's `JournalEntryLineDetail` has `PostingType`
 *   (`PostingTypeEnum`: "Credit" | "Debit") and `AccountRef`; `Entity`,
 *   `ClassRef`, `DepartmentRef` and the tax fields are optional.
 * - DocNumber (Transaction): "The maximum length for DocNumber is 21 characters."
 * - Error 2300 "Amount on debits not equal to credits"; 2260
 *   "MissingPostingType … Valid values are Credit or Debit"; 2250 "Missing
 *   lines … at least one split line".
 * - Intuit's own CRUD sample builds lines as DetailType JOURNAL_ENTRY_LINE_DETAIL
 *   with a positive Amount and the side in PostingType.
 * - Full updates: "If a writable attribute is omitted or missing from the
 *   request body, full updates clear the field's value", so an update sends
 *   every field we own (Id + SyncToken + the same body as a create).
 *
 * The entry, per day or per month, from Square's own figures:
 *   Debit  card clearing    card payments (incl. tips) less card fees
 *   Debit  card fees        net processing fees
 *   Debit  cash clearing    the rest of the takings
 *   Debit  discounts        comps & discounts (contra revenue)
 *   Credit food / beverage / other sales   net sales + their discounts (gross)
 *   Credit sales tax payable                tax collected
 *   Credit tips payable                     tips collected
 * Cash is the balancing figure in cents, so the entry always balances.
 */

import { addMonths, monthEnd, monthOf } from "./monthEnd";
import { fingerprint, type QboAccount } from "./quickbooks";
import type { ISODate } from "./dates";

const r2 = (n: number) => Math.round(n * 100) / 100;
const c = (n: number) => Math.round(n * 100);

// ---- Accounts --------------------------------------------------------------------------------

export const JOURNAL_ACCOUNT_KEYS = ["foodSales", "beverageSales", "otherSales", "discounts", "salesTax", "tips", "cardFees", "cardClearing", "cashClearing"] as const;
export type JournalAccountKey = (typeof JOURNAL_ACCOUNT_KEYS)[number];

export const JOURNAL_ACCOUNT_LABELS: Record<JournalAccountKey, { label: string; hint: string; types: string[] }> = {
  foodSales: { label: "Food sales", hint: "Income", types: ["Income", "Other Income"] },
  beverageSales: { label: "Beverage sales", hint: "Income: beer, wine, drinks", types: ["Income", "Other Income"] },
  otherSales: { label: "Other sales", hint: "Income: merch, unlinked items", types: ["Income", "Other Income"] },
  discounts: { label: "Comps & discounts", hint: "Income (contra) or expense", types: ["Income", "Other Income", "Expense", "Cost of Goods Sold"] },
  salesTax: { label: "Sales tax payable", hint: "Other current liability", types: ["Other Current Liability"] },
  tips: { label: "Tips payable", hint: "Other current liability", types: ["Other Current Liability"] },
  cardFees: { label: "Card fees", hint: "Expense", types: ["Expense", "Other Expense", "Cost of Goods Sold"] },
  cardClearing: { label: "Card deposits clearing", hint: "Bank or other current asset", types: ["Bank", "Other Current Asset"] },
  cashClearing: { label: "Cash clearing", hint: "Bank or other current asset", types: ["Bank", "Other Current Asset"] },
};

export type JournalAccounts = Record<JournalAccountKey, string | null>;
export type JournalMode = "daily" | "monthly";

export interface JournalSettings {
  /** Off by default: nothing is sent until the manager turns it on. */
  enabled: boolean;
  mode: JournalMode;
  /** The QuickBooks company the account ids belong to. */
  realmId: string | null;
  accounts: JournalAccounts;
  /** Days before this are never sent (they're already in the books another way). */
  sendFrom: ISODate | null;
}

const emptyAccounts = (): JournalAccounts => Object.fromEntries(JOURNAL_ACCOUNT_KEYS.map((k) => [k, null])) as JournalAccounts;
export const DEFAULT_JOURNAL: JournalSettings = { enabled: false, mode: "daily", realmId: null, accounts: emptyAccounts(), sendFrom: null };

const isId = (v: unknown): v is string => typeof v === "string" && /^[\w-]{1,40}$/.test(v);

/** Clean saved settings; accounts saved for another QuickBooks company are dropped. */
export function parseJournalSettings(raw: unknown, realmId: string | null): JournalSettings {
  const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const mode: JournalMode = s.mode === "monthly" ? "monthly" : "daily";
  const sendFrom = typeof s.sendFrom === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.sendFrom) ? s.sendFrom : null;
  const accounts = emptyAccounts();
  if (realmId && s.realmId === realmId && s.accounts && typeof s.accounts === "object") {
    for (const k of JOURNAL_ACCOUNT_KEYS) {
      const v = (s.accounts as Record<string, unknown>)[k];
      if (isId(v)) accounts[k] = v;
    }
  }
  return { enabled: s.enabled === true, mode, realmId, accounts, sendFrom };
}

/** Accounts still to choose (all are needed: a line with no account can't be sent). */
export const missingJournalAccounts = (a: JournalAccounts) => JOURNAL_ACCOUNT_KEYS.filter((k) => !a[k]);

/** Accounts of the right kind for one slot, best guesses first. */
export function journalAccountChoices(key: JournalAccountKey, accounts: readonly QboAccount[]): QboAccount[] {
  const types = JOURNAL_ACCOUNT_LABELS[key].types;
  return accounts
    .filter((a) => a.active && types.includes(a.type))
    .sort((a, b) => accountScore(key, b) - accountScore(key, a) || types.indexOf(a.type) - types.indexOf(b.type) || a.fullName.localeCompare(b.fullName));
}

const WORDS: Record<JournalAccountKey, RegExp[]> = {
  foodSales: [/\bfood\b/i, /\bkitchen\b/i, /\bsales\b|\brevenue\b|\bincome\b/i],
  beverageSales: [/\b(beverage|bev|beer|bar|drinks?|liquor|alcohol|taproom)\b/i, /\bsales\b|\brevenue\b/i],
  otherSales: [/\b(other|merch|merchandise|retail|misc)\b/i, /\bsales\b|\bincome\b/i],
  discounts: [/\b(discounts?|comps?|promotions?)\b/i, /\b(given|allowances?)\b/i],
  salesTax: [/\bsales tax\b/i, /\btax\b/i],
  tips: [/\b(tips?|gratuit(y|ies))\b/i, /\bpayable\b/i],
  cardFees: [/\b(merchant|card|processing|square)\b/i, /\b(bank charges|fees?)\b/i],
  cardClearing: [/\b(square|clearing|card|merchant)\b/i, /\bundeposited\b/i],
  cashClearing: [/\b(cash)\b/i, /\b(undeposited|clearing|on hand|drawer)\b/i],
};

function accountScore(key: JournalAccountKey, a: QboAccount): number {
  const name = `${a.fullName} ${a.subType ?? ""}`;
  let s = 0;
  WORDS[key].forEach((re, i) => {
    if (re.test(name)) s += 10 - i * 3;
  });
  if (key === "foodSales" && /\b(beverage|bev|beer|bar|drinks?|merch|discount)\b/i.test(name)) s -= 8;
  if ((key === "foodSales" || key === "beverageSales" || key === "otherSales") && /discount/i.test(name)) s -= 10;
  if (key === "salesTax" && /SalesTaxPayable|GlobalTaxPayable/i.test(a.subType ?? "")) s += 4;
  if (key === "cardFees" && /BankCharges/i.test(a.subType ?? "")) s += 3;
  if (key === "cardClearing" && /UndepositedFunds/i.test(a.subType ?? "")) s += 2;
  if (key === "cashClearing" && /UndepositedFunds|CashOnHand/i.test(a.subType ?? "")) s += 3;
  if (key === "discounts" && /DiscountsRefundsGiven/i.test(a.subType ?? "")) s += 6;
  return s;
}

/** Best guess for each slot (null when nothing of the right kind exists). Never chooses for the manager: shown as suggestions. */
export function suggestJournalAccounts(accounts: readonly QboAccount[]): JournalAccounts {
  const out = emptyAccounts();
  for (const k of JOURNAL_ACCOUNT_KEYS) {
    const list = journalAccountChoices(k, accounts);
    const best = list[0];
    out[k] = best && accountScore(k, best) > 0 ? best.id : null;
  }
  return out;
}

// ---- The day's (or month's) figures -----------------------------------------------------------

export interface SalesDayFigures {
  date: ISODate;
  /** Net sales (after discounts, before tax and tips) by revenue group. "other" = retail, unlinked and ignored items. */
  food: number;
  beverage: number;
  other: number;
  /** Comps & discounts by revenue group; null when the orders sync hasn't covered the day. */
  discounts: { food: number; beverage: number; other: number } | null;
  /** null = not stored by the sync. */
  tax: number | null;
  tips: number | null;
  /** Net card fees and card payment volume (incl. tips); null = the payments sync hasn't covered the day. */
  cardFees: number | null;
  cardVolume: number | null;
  /** Square still adding fees to some payments. */
  feePending: number;
}

export interface SalesSummary {
  /** "day:2026-10-31" or "month:2026-10": the stable id of the entry. */
  key: string;
  mode: JournalMode;
  /** Date the entry is booked on (the day, or the month's last day). */
  txnDate: ISODate;
  label: string;
  days: number;
  food: number;
  beverage: number;
  other: number;
  discounts: { food: number; beverage: number; other: number };
  tax: number;
  tips: number;
  cardFees: number;
  cardVolume: number;
  /** Why the entry can't be sent yet (data still to come). Empty = ready. */
  notReady: string[];
}

export const journalKey = (mode: JournalMode, dateOrMonth: string) => (mode === "daily" ? `day:${dateOrMonth}` : `month:${dateOrMonth.slice(0, 7)}`);

/**
 * Days → entries: one per day with any money, or one per calendar month.
 * `today` keeps the current day (and month) out: they aren't finished.
 */
export function summarize(days: readonly SalesDayFigures[], mode: JournalMode, today: ISODate): SalesSummary[] {
  const groups = new Map<string, SalesDayFigures[]>();
  for (const d of days) {
    if (d.date >= today) continue;
    const k = journalKey(mode, d.date);
    groups.set(k, [...(groups.get(k) ?? []), d]);
  }
  const out: SalesSummary[] = [];
  for (const [key, ds] of groups) {
    const notReady: string[] = [];
    const sum = (f: (d: SalesDayFigures) => number | null | undefined) => r2(ds.reduce((s, d) => s + (f(d) ?? 0), 0));
    const withSales = ds.filter((d) => Math.abs(d.food + d.beverage + d.other) >= 0.005);
    if (mode === "monthly") {
      const m = key.slice(6);
      if (monthEnd(m) >= today) notReady.push("The month isn't over yet.");
    }
    const count = (f: (d: SalesDayFigures) => boolean) => withSales.filter(f).length;
    const noTax = count((d) => d.tax == null);
    const noFees = count((d) => d.cardFees == null || d.cardVolume == null);
    const noDisc = count((d) => d.discounts == null);
    const pending = withSales.reduce((s, d) => s + d.feePending, 0);
    const days = (n: number) => (mode === "daily" ? "" : ` on ${n} day${n === 1 ? "" : "s"}`);
    if (noTax) notReady.push(`Sales tax isn't in from Square yet${days(noTax)}.`);
    if (noFees) notReady.push(`Card fees aren't in from Square yet${days(noFees)}.`);
    if (noDisc) notReady.push(`Comps & discounts aren't in from Square yet${days(noDisc)}.`);
    if (pending) notReady.push(`Square is still adding fees to ${pending} payment${pending === 1 ? "" : "s"}.`);
    const first = ds[0].date;
    const txnDate = mode === "daily" ? first : monthEnd(monthOf(first));
    out.push({
      key,
      mode,
      txnDate,
      label: mode === "daily" ? first : monthOf(first),
      days: ds.length,
      food: sum((d) => d.food),
      beverage: sum((d) => d.beverage),
      other: sum((d) => d.other),
      discounts: { food: sum((d) => d.discounts?.food), beverage: sum((d) => d.discounts?.beverage), other: sum((d) => d.discounts?.other) },
      tax: sum((d) => d.tax),
      tips: sum((d) => d.tips),
      cardFees: sum((d) => d.cardFees),
      cardVolume: sum((d) => d.cardVolume),
      notReady,
    });
  }
  // Daily mode: a day with nothing at all (closed) has no entry.
  return out
    .filter((s) => s.mode === "monthly" || Math.abs(s.food + s.beverage + s.other) + Math.abs(s.tax) + Math.abs(s.tips) + Math.abs(s.cardVolume) >= 0.005)
    .sort((a, b) => a.key.localeCompare(b.key));
}

// ---- Lines ------------------------------------------------------------------------------------

export type Posting = "Debit" | "Credit";

export interface JournalLine {
  key: JournalAccountKey;
  posting: Posting;
  /** Always positive, in dollars (cents exact). */
  amount: number;
  description: string;
}

export interface BuiltJournal {
  lines: JournalLine[];
  debits: number;
  credits: number;
  balanced: boolean;
  /** Notes worth showing in the preview (e.g. card payments above takings). */
  notes: string[];
}

/** Signed cents (positive = debit) → a line on the right side, or nothing for zero. */
function line(key: JournalAccountKey, signedCents: number, description: string): JournalLine | null {
  if (signedCents === 0) return null;
  return { key, posting: signedCents > 0 ? "Debit" : "Credit", amount: Math.abs(signedCents) / 100, description };
}

/**
 * The balanced lines for one summary. Amounts are worked in cents; cash is
 * the balancing figure, so debits always equal credits. A negative figure (a
 * day of refunds) simply moves to the other side.
 */
export function journalLines(s: SalesSummary): BuiltJournal {
  const notes: string[] = [];
  const gross = { food: c(s.food) + c(s.discounts.food), beverage: c(s.beverage) + c(s.discounts.beverage), other: c(s.other) + c(s.discounts.other) };
  const disc = c(s.discounts.food) + c(s.discounts.beverage) + c(s.discounts.other);
  const tax = c(s.tax);
  const tips = c(s.tips);
  const fees = c(s.cardFees);
  // What came in: net sales + tax + tips.
  const takings = c(s.food) + c(s.beverage) + c(s.other) + tax + tips;
  let card = c(s.cardVolume);
  if (card > takings && takings >= 0) {
    notes.push("Card payments were more than sales + tax + tips (gift card sales or service charges?), so card clearing is capped at the takings and cash is $0.");
    card = takings;
  }
  const cash = takings - card;
  const what = s.mode === "daily" ? `Square ${s.label}` : `Square ${s.label} (${s.days} days)`;
  const candidates = [
    line("cardClearing", card - fees, `${what}: card payments less fees`),
    line("cardFees", fees, `${what}: card processing fees`),
    line("cashClearing", cash, `${what}: cash and other tenders`),
    line("discounts", disc, `${what}: comps & discounts`),
    line("foodSales", -gross.food, `${what}: food sales before discounts`),
    line("beverageSales", -gross.beverage, `${what}: beverage sales before discounts`),
    line("otherSales", -gross.other, `${what}: other sales before discounts`),
    line("salesTax", -tax, `${what}: sales tax collected`),
    line("tips", -tips, `${what}: tips collected`),
  ];
  const lines = candidates.filter((l): l is JournalLine => !!l);
  const debitC = lines.filter((l) => l.posting === "Debit").reduce((t, l) => t + c(l.amount), 0);
  const creditC = lines.filter((l) => l.posting === "Credit").reduce((t, l) => t + c(l.amount), 0);
  return { lines, debits: debitC / 100, credits: creditC / 100, balanced: debitC === creditC && lines.length >= 2, notes };
}

/** Debits equal credits, to the cent, with at least two lines (Intuit errors 2300 and 2250). */
export function isBalanced(lines: readonly { posting: Posting; amount: number }[]): boolean {
  if (lines.length < 2 || lines.some((l) => !(l.amount > 0))) return false;
  let d = 0;
  for (const l of lines) d += (l.posting === "Debit" ? 1 : -1) * c(l.amount);
  return d === 0;
}

// ---- QuickBooks payload ------------------------------------------------------------------------

export interface QboJournalLine {
  DetailType: "JournalEntryLineDetail";
  Amount: number;
  Description: string;
  JournalEntryLineDetail: { PostingType: Posting; AccountRef: { value: string } };
}

export interface QboJournalPayload {
  TxnDate: ISODate;
  DocNumber: string;
  PrivateNote: string;
  Line: QboJournalLine[];
}

export type JournalBuild = { ok: true; payload: QboJournalPayload; hash: string; built: BuiltJournal } | { ok: false; error: string; built: BuiltJournal | null };

/** "SQ-20261031" / "SQ-2026-10": ≤ 21 characters, QuickBooks' DocNumber limit. */
export const journalDocNumber = (s: Pick<SalesSummary, "mode" | "label">) => (s.mode === "daily" ? `SQ-${s.label.replace(/-/g, "")}` : `SQ-${s.label}`).slice(0, 21);

/** The JournalEntry body for a summary, or why it can't be sent. */
export function buildQboJournal(s: SalesSummary, accounts: JournalAccounts): JournalBuild {
  if (s.notReady.length) return { ok: false, error: s.notReady[0], built: null };
  const built = journalLines(s);
  if (!built.balanced) return { ok: false, error: built.lines.length < 2 ? "Nothing to send for this one." : "The entry doesn't balance, so it wasn't sent.", built };
  const missing = built.lines.filter((l) => !accounts[l.key]).map((l) => JOURNAL_ACCOUNT_LABELS[l.key].label);
  if (missing.length) return { ok: false, error: `Choose a QuickBooks account for ${[...new Set(missing)].join(", ")} first.`, built };
  const payload: QboJournalPayload = {
    TxnDate: s.txnDate,
    DocNumber: journalDocNumber(s),
    PrivateNote: `Square sales summary ${s.label}, sent from Subversive Ops. Changes are made by sending again from Month-end.`,
    Line: built.lines.map((l) => ({
      DetailType: "JournalEntryLineDetail",
      Amount: l.amount,
      Description: l.description.slice(0, 4000),
      JournalEntryLineDetail: { PostingType: l.posting, AccountRef: { value: accounts[l.key]! } },
    })),
  };
  if (!isBalanced(payload.Line.map((l) => ({ posting: l.JournalEntryLineDetail.PostingType, amount: l.Amount })))) return { ok: false, error: "The entry doesn't balance, so it wasn't sent.", built };
  return { ok: true, payload, hash: fingerprint(payload), built };
}

// ---- Idempotency ---------------------------------------------------------------------------------

export interface JournalLinkState {
  qboId: string | null;
  hash: string | null;
  status: string;
}

export type JournalAction = "create" | "update" | "skip";

/**
 * What sending should do: nothing sent yet → create; sent with the same
 * content → skip (never re-sent unless changed); sent but changed → update the
 * same entry.
 */
export function journalAction(link: JournalLinkState | null, hash: string): JournalAction {
  if (!link?.qboId) return "create";
  return link.hash === hash ? "skip" : "update";
}

/** `requestid` for a create: same entry, content and predecessor → same id (≤ 50 characters). */
export const journalRequestId = (key: string, hash: string, previousId: string | null) => `je-${key.replace(/[^\w-]/g, "")}-${hash.slice(0, 12)}-${fingerprint(previousId ?? "new").slice(0, 8)}`.slice(0, 50);

/**
 * Switching between daily and monthly must never book a day twice: a monthly
 * entry is blocked while any of its days was sent as a daily entry, and a
 * daily one while its month was sent as a monthly entry.
 */
export function modeConflict(key: string, sentKeys: ReadonlySet<string>): string | null {
  if (key.startsWith("month:")) {
    const m = key.slice(6);
    const clash = [...sentKeys].find((k) => k.startsWith(`day:${m}-`));
    return clash ? `Days in ${m} were already sent one by one (${clash.slice(4)}…). Keep daily entries for that month, or delete them in QuickBooks first.` : null;
  }
  const m = key.slice(4, 11);
  return sentKeys.has(`month:${m}`) ? `${m} was already sent as one monthly entry. Keep it monthly, or delete that entry in QuickBooks first.` : null;
}

/** Months between two dates, inclusive, for listing monthly entries. */
export function monthsBetween(from: ISODate, to: ISODate): string[] {
  const out: string[] = [];
  for (let m = monthOf(from); m <= monthOf(to); m = addMonths(m, 1)) out.push(m);
  return out;
}

export const journalTotals = (s: SalesSummary) => ({ net: r2(s.food + s.beverage + s.other), discounts: r2(s.discounts.food + s.discounts.beverage + s.discounts.other) });
