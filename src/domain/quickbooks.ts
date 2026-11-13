/**
 * QuickBooks Online: the pure half of the integration. OAuth URLs and token
 * lifetimes, supplier ↔ vendor matching, choosing expense accounts, turning an
 * approved invoice into a Bill, and plain-English errors.
 *
 * Everything here was checked against Intuit's developer docs (Nov 2026):
 * - Discovery document: authorize https://appcenter.intuit.com/connect/oauth2,
 *   token https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer,
 *   revoke https://developer.api.intuit.com/v2/oauth2/tokens/revoke.
 * - Access tokens last 3,600 s. Refresh tokens roll for 100 days, the value can
 *   change on any refresh (at least every 24 h) and the old one stops working,
 *   so the newest one must always be stored. Hard limit five years.
 * - API hosts: quickbooks.api.intuit.com / sandbox-quickbooks.api.intuit.com,
 *   `/v3/company/<realmId>/…`. minorversion 75 is the floor (1–74 retired
 *   Aug 2025). `requestid` makes writes idempotent (≤ 50 chars, unique per company).
 * - Entity fields from Intuit's minor-version-75 XSD (Bill, Vendor, Account,
 *   Attachable, CompanyInfo).
 */

import { addDays, ISODate } from "./dates";
import { cents, fallbackBillNo } from "./accountingExport";

export type QboEnvironment = "production" | "sandbox";

export const QBO_SCOPE = "com.intuit.quickbooks.accounting";
export const QBO_AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";
export const QBO_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
export const QBO_REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";
export const QBO_MINOR_VERSION = 75;

export const qboApiHost = (environment: QboEnvironment) =>
  environment === "sandbox" ? "https://sandbox-quickbooks.api.intuit.com" : "https://quickbooks.api.intuit.com";

/** The company ("realm") id QuickBooks sends back with the code. Digits only — it goes into API paths. */
export const isRealmId = (v: unknown): v is string => typeof v === "string" && /^\d{1,32}$/.test(v);

export function qboAuthorizeUrl(a: { clientId: string; redirectUri: string; state: string }): string {
  const q = new URLSearchParams({ client_id: a.clientId, response_type: "code", scope: QBO_SCOPE, redirect_uri: a.redirectUri, state: a.state });
  return `${QBO_AUTHORIZE_URL}?${q}`;
}

/** `Authorization: Basic base64(client_id:client_secret)` for the token and revoke endpoints. */
export const basicAuth = (clientId: string, clientSecret: string) => `Basic ${btoa(`${clientId}:${clientSecret}`)}`;

// ---- Tokens ---------------------------------------------------------------------------

export interface QboTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type?: string;
  expires_in?: number;
  x_refresh_token_expires_in?: number;
}

export interface QboTokens {
  accessToken: string;
  refreshToken: string;
  /** ISO instant the access token stops working. */
  accessExpiresAt: string;
  /** ISO instant the refresh token expires if it isn't used (rolling 100 days). */
  refreshExpiresAt: string | null;
}

export function tokensFrom(r: QboTokenResponse, now: Date): QboTokens {
  if (!r?.access_token || !r.refresh_token) throw new Error("QuickBooks didn't send back a sign-in. Press Connect to QuickBooks again.");
  const access = Number.isFinite(r.expires_in) && r.expires_in! > 0 ? r.expires_in! : 3600;
  const refresh = Number.isFinite(r.x_refresh_token_expires_in) && r.x_refresh_token_expires_in! > 0 ? r.x_refresh_token_expires_in! : null;
  return {
    accessToken: r.access_token,
    refreshToken: r.refresh_token,
    accessExpiresAt: new Date(now.getTime() + access * 1000).toISOString(),
    refreshExpiresAt: refresh ? new Date(now.getTime() + refresh * 1000).toISOString() : null,
  };
}

/** Refresh a little before the hour is up, so a call never goes out with a dying token. */
export function accessTokenStale(expiresAt: string | null | undefined, now: Date, skewMs = 5 * 60_000): boolean {
  const t = Date.parse(expiresAt ?? "");
  return !Number.isFinite(t) || t - now.getTime() < skewMs;
}

/** Whole days until the refresh token lapses (null when unknown). Used to say "reconnect soon". */
export function refreshDaysLeft(refreshExpiresAt: string | null | undefined, now: Date): number | null {
  const t = Date.parse(refreshExpiresAt ?? "");
  if (!Number.isFinite(t)) return null;
  return Math.floor((t - now.getTime()) / 86_400_000);
}

// ---- Query language -------------------------------------------------------------------

/** A quoted string for the QuickBooks query language (backslash escapes apostrophes and backslashes). */
export const qboQuote = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

// ---- Names and vendors ----------------------------------------------------------------

const SUFFIXES = new Set(["inc", "incorporated", "llc", "l l c", "ltd", "limited", "co", "corp", "corporation", "company", "the", "pllc", "lp", "llp"]);

/** "The Catskill Bread Co., Inc." → "catskill bread". */
export function normalizeName(s: string): string {
  const words = s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  let a = 0;
  let b = words.length;
  if (words[0] === "the" && b > 1) a = 1;
  while (b - a > 1 && SUFFIXES.has(words[b - 1])) b--;
  return words.slice(a, b).join(" ");
}

/** A vendor name QuickBooks will accept: no colons, tabs or line breaks; at most 100 characters. */
export function vendorDisplayName(name: string): string {
  return name.replace(/[:\t\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 100) || "Supplier";
}

export interface VendorLite {
  id: string;
  name: string;
  /** The vendor's default expense account in QuickBooks, if set. */
  defaultAccountId?: string | null;
}

export type VendorMatch = { vendor: VendorLite; sure: boolean };

/**
 * The QuickBooks vendor a supplier most likely is. `sure` when the names are
 * the same once punctuation and Inc/LLC/Co are ignored; otherwise a
 * suggestion when one name is the other plus extra words ("Hudson Valley" ↔
 * "Hudson Valley Foodservice").
 */
export function matchVendor(supplierName: string, vendors: readonly VendorLite[]): VendorMatch | null {
  const target = normalizeName(supplierName);
  if (!target) return null;
  const exact = vendors.find((v) => normalizeName(v.name) === target);
  if (exact) return { vendor: exact, sure: true };
  const tWords = target.split(" ");
  let best: { vendor: VendorLite; score: number } | null = null;
  for (const v of vendors) {
    const n = normalizeName(v.name);
    if (!n) continue;
    const vWords = n.split(" ");
    const [short, long] = tWords.length <= vWords.length ? [tWords, vWords] : [vWords, tWords];
    // Every word of the shorter name, in order, at the start of the longer one.
    const prefix = short.every((w, i) => long[i] === w);
    if (!prefix || short.join(" ").length < 5) continue;
    const score = short.length / long.length;
    if (score >= 0.5 && (!best || score > best.score)) best = { vendor: v, score };
  }
  return best ? { vendor: best.vendor, sure: false } : null;
}

// ---- Accounts -------------------------------------------------------------------------

export interface QboAccount {
  id: string;
  name: string;
  /** "Cost of Goods Sold:Food" for sub-accounts. */
  fullName: string;
  type: string;
  subType: string | null;
  active: boolean;
}

/** Account types a bill line can go to: cost of goods sold first, then expenses. */
const BILL_TYPES = ["Cost of Goods Sold", "Expense", "Other Expense"];

export function billAccounts(accounts: readonly QboAccount[]): QboAccount[] {
  return accounts
    .filter((a) => a.active && BILL_TYPES.includes(a.type))
    .sort((a, b) => BILL_TYPES.indexOf(a.type) - BILL_TYPES.indexOf(b.type) || a.fullName.localeCompare(b.fullName));
}

const BEVERAGE = /\b(beer|wine|liquor|spirit|spirits|bev|beverage|beverages|drink|drinks|alcohol|bar|keg|kegs|cider|soda|coffee|tea|na bev)\b/i;
const SUPPLIES = /\b(suppl(y|ies)|paper|cleaning|chemicals?|disposables?|packaging|smallwares|janitorial|to.?go)\b/i;
const FOOD = /\b(food|produce|protein|meat|seafood|fish|poultry|dairy|bakery|bread|frozen|pantry|dry goods?|grocery|groceries|kitchen)\b/i;

type Kind = "beverage" | "supplies" | "food";
const kindOf = (s: string): Kind | null => (BEVERAGE.test(s) ? "beverage" : SUPPLIES.test(s) ? "supplies" : FOOD.test(s) ? "food" : null);

/** Ingredient categories are mostly food; beverage and supplies words win when present. */
const categoryKind = (category: string): Kind => kindOf(category) ?? "food";

function accountScore(a: QboAccount, kind: Kind): number {
  const name = `${a.fullName} ${a.subType ?? ""}`;
  const k = kindOf(name.replace(/cost of goods sold/i, ""));
  let s = 0;
  if (k === kind) s += 10;
  if (kind !== "supplies" && a.type === "Cost of Goods Sold") s += 3;
  if (kind === "supplies" && a.type === "Expense") s += 2;
  if (/SuppliesMaterials/i.test(a.subType ?? "") && kind !== "beverage") s += kind === "supplies" ? 4 : 1;
  return s;
}

/** The plain "Cost of Goods Sold" account, or the first COGS account, or the first expense account. */
export function defaultBillAccount(accounts: readonly QboAccount[]): QboAccount | null {
  const list = billAccounts(accounts);
  return (
    list.find((a) => a.type === "Cost of Goods Sold" && /^cost of (goods|sales)/i.test(a.name)) ??
    list.find((a) => a.type === "Cost of Goods Sold" && /food/i.test(a.fullName)) ??
    list.find((a) => a.type === "Cost of Goods Sold") ??
    list[0] ??
    null
  );
}

/** Best-guess account for an ingredient category (null when nothing stands out from the default). */
export function suggestAccount(category: string, accounts: readonly QboAccount[]): QboAccount | null {
  const kind = categoryKind(category);
  let best: { a: QboAccount; s: number } | null = null;
  for (const a of billAccounts(accounts)) {
    const s = accountScore(a, kind);
    if (s >= 10 && (!best || s > best.s)) best = { a, s };
  }
  return best?.a ?? null;
}

// ---- Mapping (saved settings) ---------------------------------------------------------

export interface QboMapping {
  /** The company these account ids belong to. A different company means start again. */
  realmId: string | null;
  /** Where any line not covered below goes. Required before anything is sent. */
  defaultAccountId: string | null;
  /** Fees, tax, deposits: the gap between the lines and the invoice total. Falls back to the default. */
  otherAccountId: string | null;
  /** Per ingredient category. */
  byCategory: Record<string, string>;
  /** Per supplier (overrides the default for that supplier's uncategorised lines). */
  bySupplier: Record<string, string>;
  /** Send each invoice by itself as soon as it's approved. */
  autoSend: boolean;
  /** Only invoices dated on or after this go automatically / in bulk (so older bills already in QuickBooks aren't doubled). */
  sendFrom: ISODate | null;
}

export const EMPTY_MAPPING: QboMapping = { realmId: null, defaultAccountId: null, otherAccountId: null, byCategory: {}, bySupplier: {}, autoSend: false, sendFrom: null };

const isId = (v: unknown): v is string => typeof v === "string" && /^[\w-]{1,40}$/.test(v);
const idRecord = (v: unknown) =>
  v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k, x]) => k.length <= 120 && isId(x)) as [string, string][]) : {};

/** Clean a saved mapping; a mapping saved for another company comes back empty (but keeps the on/off choices). */
export function qboMapping(saved: unknown, realmId: string | null): QboMapping {
  const s = (saved && typeof saved === "object" ? saved : {}) as Record<string, unknown>;
  const sendFrom = typeof s.sendFrom === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.sendFrom) ? s.sendFrom : null;
  const autoSend = s.autoSend === true;
  if (!realmId || s.realmId !== realmId) return { ...EMPTY_MAPPING, realmId, autoSend, sendFrom };
  return {
    realmId,
    defaultAccountId: isId(s.defaultAccountId) ? s.defaultAccountId : null,
    otherAccountId: isId(s.otherAccountId) ? s.otherAccountId : null,
    byCategory: idRecord(s.byCategory),
    bySupplier: idRecord(s.bySupplier),
    autoSend,
    sendFrom,
  };
}

/** Account for one invoice line: its ingredient category, else the supplier's account, else the default. */
export function accountForLine(category: string | null, supplierId: string, m: QboMapping): string | null {
  return (category && m.byCategory[category]) || m.bySupplier[supplierId] || m.defaultAccountId;
}

/** Account ids the mapping uses that aren't (or are no longer) in the company's chart of accounts. */
export function missingAccounts(m: QboMapping, accounts: readonly QboAccount[]): string[] {
  const known = new Set(billAccounts(accounts).map((a) => a.id));
  const used = [m.defaultAccountId, m.otherAccountId, ...Object.values(m.byCategory), ...Object.values(m.bySupplier)].filter((x): x is string => !!x);
  return [...new Set(used.filter((id) => !known.has(id)))];
}

// ---- Bills ------------------------------------------------------------------------------

export interface QboBillLineInput {
  description: string;
  sku: string | null;
  qty: number;
  unitPrice: number;
  category: string | null;
}

export interface QboBillInput {
  supplierId: string;
  supplierName: string;
  invoiceNumber: string | null;
  invoiceDate: ISODate;
  total: number | null;
  lines: QboBillLineInput[];
}

export interface QboBillLine {
  DetailType: "AccountBasedExpenseLineDetail";
  Amount: number;
  Description: string;
  AccountBasedExpenseLineDetail: { AccountRef: { value: string } };
}

export interface QboBillPayload {
  VendorRef: { value: string };
  TxnDate: ISODate;
  DueDate: ISODate;
  DocNumber: string;
  PrivateNote: string;
  Line: QboBillLine[];
}

export type BillBuild = { ok: true; bill: QboBillPayload; total: number; hash: string } | { ok: false; error: string };

/** QuickBooks keeps bill numbers to 21 characters. */
export const DOC_NUMBER_MAX = 21;

/**
 * An approved invoice as a QuickBooks Bill: one line per expense account
 * (food, beverage, supplies… — tidy ledgers, like the CSV export), plus an
 * "Other charges" line when the lines don't add up to the invoice total, so the
 * bill matches the paper.
 */
export function buildQboBill(inv: QboBillInput, vendorId: string, m: QboMapping, termsDays: number): BillBuild {
  if (!m.defaultAccountId) return { ok: false, error: "Choose the account bills go to first (QuickBooks → Choose accounts)." };
  const by = new Map<string, { amount: number; n: number }>();
  for (const l of inv.lines) {
    const amount = l.qty * l.unitPrice;
    if (!Number.isFinite(amount)) continue;
    const a = accountForLine(l.category, inv.supplierId, m)!;
    const cur = by.get(a) ?? { amount: 0, n: 0 };
    cur.amount += amount;
    cur.n++;
    by.set(a, cur);
  }
  const lines: QboBillLine[] = [];
  for (const [account, v] of by) {
    const amount = cents(v.amount);
    if (Math.abs(amount) < 0.005) continue;
    lines.push(line(account, amount, `${inv.supplierName} — ${v.n} line${v.n === 1 ? "" : "s"}`));
  }
  const linesTotal = cents(lines.reduce((s, l) => s + l.Amount, 0));
  if (inv.total != null && Math.abs(cents(inv.total) - linesTotal) >= 0.01) {
    lines.push(line(m.otherAccountId || m.defaultAccountId, cents(inv.total - linesTotal), "Other charges (fees, tax, deposits, rounding)"));
  }
  const total = cents(lines.reduce((s, l) => s + l.Amount, 0));
  if (!lines.length || total === 0) return { ok: false, error: "This invoice adds up to $0, so there's nothing to send." };
  if (total < 0) return { ok: false, error: "This invoice adds up to less than zero — that's a credit. Enter it in QuickBooks as a supplier credit instead." };

  const number = (inv.invoiceNumber?.trim() || fallbackBillNo(inv.supplierName, inv.invoiceDate)).slice(0, DOC_NUMBER_MAX);
  const bill: QboBillPayload = {
    VendorRef: { value: vendorId },
    TxnDate: inv.invoiceDate,
    DueDate: addDays(inv.invoiceDate, Math.max(0, Math.round(termsDays))),
    DocNumber: number,
    PrivateNote: `Sent from Subversive Ops${inv.invoiceNumber && inv.invoiceNumber.trim().length > DOC_NUMBER_MAX ? ` · invoice ${inv.invoiceNumber.trim().slice(0, 200)}` : ""}`,
    Line: lines,
  };
  return { ok: true, bill, total, hash: fingerprint(bill) };
}

const line = (account: string, amount: number, description: string): QboBillLine => ({
  DetailType: "AccountBasedExpenseLineDetail",
  Amount: amount,
  Description: description.slice(0, 4000),
  AccountBasedExpenseLineDetail: { AccountRef: { value: account } },
});

/** Short, stable fingerprint (FNV-1a, hex) of what we send — to skip unchanged re-sends and to make request ids. */
export function fingerprint(value: unknown): string {
  const s = stableJson(value);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
  }
  return ((h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0")).slice(0, 16);
}

function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}

/** `requestid` for creating a bill: the same invoice, content and predecessor always give the same id (≤ 50 chars). */
export function billRequestId(invoiceId: string, hash: string, previousBillId: string | null): string {
  return `${invoiceId.slice(0, 26)}-${hash.slice(0, 12)}-${fingerprint(previousBillId ?? "new").slice(0, 8)}`;
}

/** Whether QuickBooks shows a payment against the bill (then we don't change its amounts). */
export const billHasPayment = (b: { TotalAmt?: number; Balance?: number }) =>
  typeof b.TotalAmt === "number" && typeof b.Balance === "number" && Math.abs(b.TotalAmt - b.Balance) >= 0.005;

// ---- Errors -----------------------------------------------------------------------------

export interface QboFaultError {
  code?: string;
  Message?: string;
  Detail?: string;
  element?: string;
}

/** Pull Intuit's `Fault.Error[]` out of a response body (JSON shape of IntuitResponse). */
export function faultErrors(body: unknown): QboFaultError[] {
  const b = body as { Fault?: { Error?: QboFaultError[] }; fault?: { error?: { code?: string; message?: string; detail?: string }[] } } | null;
  if (b?.Fault?.Error?.length) return b.Fault.Error;
  if (b?.fault?.error?.length) return b.fault.error.map((e) => ({ code: e.code, Message: e.message, Detail: e.detail }));
  return [];
}

/**
 * One plain sentence for the person using the app. `status` is the HTTP
 * status (0 = couldn't reach QuickBooks); `oauthError` the `error` field from
 * the token endpoint (e.g. invalid_grant).
 */
export function friendlyQboError(status: number, errors: readonly QboFaultError[], oauthError?: string | null): string {
  if (oauthError === "invalid_grant") return "QuickBooks has signed this app out (it was disconnected in QuickBooks, or not used for 100 days). Press Connect to QuickBooks again.";
  if (oauthError === "invalid_client") return "QuickBooks didn't accept the app's Client ID and secret. Check they're the Production ones (or switch to Sandbox), then connect again.";
  if (status === 0) return "Couldn't reach QuickBooks from the server. The internet connection may be down, or the place this app is hosted may block outside connections. Try again later.";
  const codes = errors.map((e) => String(e.code ?? ""));
  const detail = errors.map((e) => e.Detail || e.Message).filter(Boolean).join(" ");
  if (status === 401 || codes.includes("3200")) return "QuickBooks didn't accept the sign-in. Press Connect to QuickBooks again.";
  if (status === 403 || codes.includes("3100")) return "QuickBooks says this sign-in isn't allowed to do that. Whoever connects needs to be an admin of the QuickBooks company — connect again with an admin login.";
  if (status === 429) return "QuickBooks says we're asking too often. Wait a minute and try again.";
  if (codes.includes("10200")) return "This QuickBooks company was reset. Disconnect and connect it again.";
  if (codes.includes("5010") || codes.includes("2020")) return "Someone changed this bill in QuickBooks at the same moment. Press Send again.";
  if (codes.includes("6240")) return "QuickBooks already has a customer, vendor or employee with that name. Pick the right vendor for this supplier on the QuickBooks page.";
  if (codes.includes("610")) return "That record was deleted in QuickBooks.";
  if (codes.includes("2500") || /invalid reference/i.test(detail)) return "An account or vendor this bill uses no longer exists in QuickBooks. Check Choose accounts and the supplier's vendor on the QuickBooks page.";
  if (codes.includes("6000") && detail) return `QuickBooks said: ${detail.slice(0, 300)}`;
  if (status >= 500) return "QuickBooks is having trouble right now. Try again in a few minutes.";
  if (detail) return `QuickBooks said: ${detail.slice(0, 300)}`;
  return `QuickBooks didn't accept that (error ${status}). Try again in a minute.`;
}
