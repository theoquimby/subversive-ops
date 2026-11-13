import "server-only";
import { parseISODate, toISODate, type ISODate } from "@/domain/dates";
import {
  accessTokenStale,
  billAccounts,
  billHasPayment,
  billRequestId,
  buildQboBill,
  isRealmId,
  matchVendor,
  missingAccounts,
  qboMapping,
  refreshDaysLeft,
  tokensFrom,
  vendorDisplayName,
  type QboAccount,
  type QboEnvironment,
  type QboMapping,
  type VendorLite,
} from "@/domain/quickbooks";
import { decryptJSON, deriveKey, encryptJSON } from "@/domain/squareSecurity";
import { Prisma } from "@prisma/client";
import { db } from "../db";
import { env } from "../env";
import {
  attachToBill,
  createBill,
  createVendor,
  exchangeCode,
  fetchAccounts,
  fetchCompanyInfo,
  fetchVendors,
  findBillsByNumber,
  findVendorByName,
  friendlyQuickBooksError,
  QboError,
  readBill,
  refreshTokens,
  revokeToken,
  updateBill,
  type QboApp,
  type QboClient,
} from "../integrations/quickbooks";
import { loadAccounts } from "./accounting";
import { getSecrets } from "./secrets";

/**
 * The QuickBooks Online connection and "send approved invoices as bills".
 *
 * - Tokens live in Setting `quickbooks.connection`, encrypted like Square's
 *   (AES-256-GCM, key derived from SESSION_SECRET), and never reach the browser.
 * - Access tokens last an hour and are renewed a few minutes early. Intuit
 *   may hand back a new refresh token on any renewal and the old one then stops
 *   working, so renewals run one at a time (a Postgres advisory lock) and the
 *   newest token is always saved before it's used.
 * - What's been sent is in QuickBooksLink (supplier ↔ vendor, invoice ↔ bill),
 *   per QuickBooks company. Sending again updates the same bill.
 */

const CONNECTION_KEY = "quickbooks.connection";
const ENVIRONMENT_KEY = "quickbooks.environment";
const SETTINGS_KEY = "quickbooks.settings";
const ACCOUNTS_KEY = "quickbooks.accounts";
const VENDORS_KEY = "quickbooks.vendors";
const LOG_KEY = "quickbooks.log";
const LAST_SYNC_KEY = "quickbooks.lastSync";
/** Arbitrary constant for pg_advisory_xact_lock: one token renewal at a time across every server instance. */
const REFRESH_LOCK = 72_450_117;

const cryptoKey = () => deriveKey(env.SESSION_SECRET, "quickbooks.connection");

interface Stored {
  v: 1;
  environment: QboEnvironment;
  realmId: string;
  companyName: string | null;
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string | null;
  connectedAt: string;
  connectedBy: string | null;
  /** Set when QuickBooks refused a renewal: the owner has to connect again. */
  needsReconnect?: string | null;
}

export class QuickBooksNotConnectedError extends Error {
  constructor(message = "QuickBooks isn't connected yet. Connect it in Settings → Connections → QuickBooks.") {
    super(message);
  }
}

// ---- Small settings helpers --------------------------------------------------------------

async function readJSON<T>(key: string, client: Prisma.TransactionClient | typeof db = db): Promise<T | null> {
  const s = await client.setting.findUnique({ where: { key } });
  if (!s) return null;
  try {
    return JSON.parse(s.value) as T;
  } catch {
    return null;
  }
}

async function writeRaw(key: string, value: string, client: Prisma.TransactionClient | typeof db = db) {
  await client.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

const writeJSON = (key: string, value: unknown) => writeRaw(key, JSON.stringify(value));

// ---- App credentials and environment --------------------------------------------------------

/** The Intuit app's Client ID and secret (Part 1 of the guide). Null until both are saved. */
export async function quickbooksApp(): Promise<QboApp | null> {
  const s = await getSecrets(["QUICKBOOKS_CLIENT_ID", "QUICKBOOKS_CLIENT_SECRET"] as const);
  return s.QUICKBOOKS_CLIENT_ID && s.QUICKBOOKS_CLIENT_SECRET ? { clientId: s.QUICKBOOKS_CLIENT_ID, clientSecret: s.QUICKBOOKS_CLIENT_SECRET } : null;
}

/** Production unless the manager picked Sandbox (or QUICKBOOKS_ENVIRONMENT=sandbox is set). */
export async function quickbooksEnvironment(): Promise<QboEnvironment> {
  const s = await db.setting.findUnique({ where: { key: ENVIRONMENT_KEY } });
  if (s?.value === "sandbox" || s?.value === "production") return s.value;
  return process.env.QUICKBOOKS_ENVIRONMENT?.trim() === "sandbox" ? "sandbox" : "production";
}

export async function setQuickbooksEnvironment(environment: QboEnvironment) {
  const s = await readStored();
  if (s && s.environment !== environment) throw new Error("Disconnect QuickBooks first, then switch.");
  await writeRaw(ENVIRONMENT_KEY, environment);
}

// ---- Connection -----------------------------------------------------------------------------

async function readStored(client: Prisma.TransactionClient | typeof db = db): Promise<Stored | null> {
  const s = await client.setting.findUnique({ where: { key: CONNECTION_KEY } });
  if (!s) return null;
  try {
    const v = decryptJSON<Stored>(cryptoKey(), s.value);
    return v?.v === 1 && isRealmId(v.realmId) ? v : null;
  } catch {
    // SESSION_SECRET changed or the row was altered: treat as disconnected.
    return null;
  }
}

const writeStored = (s: Stored, client: Prisma.TransactionClient | typeof db = db) => writeRaw(CONNECTION_KEY, encryptJSON(cryptoKey(), s), client);

/** Finish "Connect to QuickBooks": swap the one-time code for tokens and remember the company. */
export async function connectQuickBooks(args: { code: string; realmId: string; redirectUri: string; by: string }) {
  if (!isRealmId(args.realmId)) throw new QboError("QuickBooks didn't say which company was picked. Press Connect to QuickBooks again.", 400);
  const app = await quickbooksApp();
  if (!app) throw new QuickBooksNotConnectedError("Finish Part 1 first: paste the Client ID and Client secret, then connect.");
  const environment = await quickbooksEnvironment();
  const old = await readStored();
  const t = tokensFrom(await exchangeCode(app, args.code, args.redirectUri), new Date());
  const stored: Stored = { v: 1, environment, realmId: args.realmId, companyName: null, ...t, connectedAt: new Date().toISOString(), connectedBy: args.by, needsReconnect: null };
  await writeStored(stored);
  // A different company (or reconnecting after a reset): forget cached lists, keep the links (they're per company).
  if (old && old.realmId !== args.realmId) await db.setting.deleteMany({ where: { key: { in: [ACCOUNTS_KEY, VENDORS_KEY] } } });
  let companyName = "your QuickBooks company";
  try {
    const info = await fetchCompanyInfo({ environment, realmId: args.realmId, accessToken: t.accessToken });
    companyName = info.name;
    await writeStored({ ...stored, companyName });
  } catch (e) {
    await logProblem(`Connected, but couldn't read the company name: ${friendlyQuickBooksError(e)}`);
  }
  // Fill the account and vendor lists so "Choose accounts" is ready straight away.
  await Promise.allSettled([refreshAccounts(), refreshVendors()]);
  return { companyName };
}

/**
 * An API client with a live access token, renewing it when it's under five
 * minutes from expiry (or when `force`, after a 401).
 */
async function getClient(force = false): Promise<QboClient> {
  const s = await readStored();
  if (!s) throw new QuickBooksNotConnectedError();
  if (s.needsReconnect) throw new QuickBooksNotConnectedError(s.needsReconnect);
  if (!force && !accessTokenStale(s.accessExpiresAt, new Date())) return { environment: s.environment, realmId: s.realmId, accessToken: s.accessToken };
  const app = await quickbooksApp();
  if (!app) throw new QuickBooksNotConnectedError("The QuickBooks Client ID or secret was removed. Paste them again in Settings → Connections → QuickBooks.");
  const usedToken = s.accessToken;
  const next = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${REFRESH_LOCK})`;
      // Another request may have renewed while we waited for the lock.
      const cur = await readStored(tx);
      if (!cur) throw new QuickBooksNotConnectedError();
      if (cur.needsReconnect) throw new QuickBooksNotConnectedError(cur.needsReconnect);
      if (cur.accessToken !== usedToken && !accessTokenStale(cur.accessExpiresAt, new Date())) return cur;
      try {
        const t = tokensFrom(await refreshTokens(app, cur.refreshToken), new Date());
        const updated: Stored = { ...cur, ...t, needsReconnect: null };
        await writeStored(updated, tx);
        return updated;
      } catch (e) {
        // Returned, not thrown, so the "connect again" flag is committed with the transaction.
        if (e instanceof QboError && (e.oauthError === "invalid_grant" || e.oauthError === "invalid_client")) {
          const signedOut: Stored = { ...cur, needsReconnect: e.message };
          await writeStored(signedOut, tx);
          return signedOut;
        }
        throw e;
      }
    },
    { timeout: 30_000, maxWait: 30_000 },
  );
  if (next.needsReconnect) {
    await logProblem(next.needsReconnect).catch(() => undefined);
    throw new QuickBooksNotConnectedError(next.needsReconnect);
  }
  return { environment: next.environment, realmId: next.realmId, accessToken: next.accessToken };
}

/** Run an API call; on a 401 renew the token once and try again. */
async function withClient<T>(fn: (c: QboClient) => Promise<T>): Promise<T> {
  const c = await getClient();
  try {
    return await fn(c);
  } catch (e) {
    if (e instanceof QboError && e.status === 401) return fn(await getClient(true));
    throw e;
  }
}

/** Revoke the app's access in QuickBooks (best effort) and forget the tokens. Links and settings stay. */
export async function disconnectQuickBooks(): Promise<{ revokeError?: string }> {
  const s = await readStored();
  const app = await quickbooksApp();
  let revokeError: string | undefined;
  if (s && app) {
    try {
      await revokeToken(app, s.refreshToken);
    } catch (e) {
      revokeError = friendlyQuickBooksError(e);
    }
  }
  await db.setting.deleteMany({ where: { key: { in: [CONNECTION_KEY, ACCOUNTS_KEY, VENDORS_KEY] } } });
  return { revokeError };
}

/** Calls CompanyInfo; refreshes the stored company name. */
export async function testQuickBooksConnection(): Promise<{ companyName: string; environment: QboEnvironment }> {
  const info = await withClient((c) => fetchCompanyInfo(c));
  const s = await readStored();
  if (s) await writeStored({ ...s, companyName: info.name });
  return { companyName: info.name, environment: s?.environment ?? "production" };
}

// ---- Status (no secrets, no network) -------------------------------------------------------

export interface QuickBooksStatus {
  appReady: boolean;
  environment: QboEnvironment;
  connected: boolean;
  needsReconnect: string | null;
  realmId: string | null;
  companyName: string | null;
  connectedAt: string | null;
  connectedBy: string | null;
  /** Days until QuickBooks signs the app out if nothing is sent (rolling 100 days). */
  refreshDaysLeft: number | null;
  lastSync: string | null;
  mapping: QboMapping;
  /** A default account is picked, so bills can be sent. */
  mappingReady: boolean;
}

export async function quickbooksStatus(): Promise<QuickBooksStatus> {
  const [s, appReady, environment, last] = await Promise.all([readStored(), quickbooksApp().then(Boolean), quickbooksEnvironment(), db.setting.findUnique({ where: { key: LAST_SYNC_KEY } })]);
  const mapping = await loadMapping(s?.realmId ?? null);
  return {
    appReady,
    environment: s?.environment ?? environment,
    connected: !!s && !s.needsReconnect,
    needsReconnect: s?.needsReconnect ?? null,
    realmId: s?.realmId ?? null,
    companyName: s?.companyName ?? null,
    connectedAt: s?.connectedAt ?? null,
    connectedBy: s?.connectedBy ?? null,
    refreshDaysLeft: s ? refreshDaysLeft(s.refreshExpiresAt, new Date()) : null,
    lastSync: last?.value ?? null,
    mapping,
    mappingReady: !!mapping.defaultAccountId,
  };
}

export async function isQuickBooksConnected() {
  const s = await readStored();
  return !!s && !s.needsReconnect;
}

// ---- Problems log ------------------------------------------------------------------------------

export interface QuickBooksProblem {
  at: string;
  message: string;
}

export async function logProblem(message: string) {
  const cur = (await readJSON<QuickBooksProblem[]>(LOG_KEY)) ?? [];
  cur.unshift({ at: new Date().toISOString(), message: message.slice(0, 500) });
  await writeJSON(LOG_KEY, cur.slice(0, 20));
}

export const quickbooksProblems = async () => (await readJSON<QuickBooksProblem[]>(LOG_KEY)) ?? [];
export const clearQuickbooksProblems = () => db.setting.deleteMany({ where: { key: LOG_KEY } });

// ---- Accounts and vendors (cached lists) ----------------------------------------------------------

interface Cached<T> {
  realmId: string;
  at: string;
  items: T[];
}

async function cached<T>(key: string): Promise<{ items: T[]; at: string | null }> {
  const s = await readStored();
  const c = await readJSON<Cached<T>>(key);
  return s && c?.realmId === s.realmId ? { items: c.items, at: c.at } : { items: [], at: null };
}

export async function refreshAccounts(): Promise<QboAccount[]> {
  const s = await readStored();
  if (!s) throw new QuickBooksNotConnectedError();
  const items = await withClient((c) => fetchAccounts(c));
  await writeJSON(ACCOUNTS_KEY, { realmId: s.realmId, at: new Date().toISOString(), items } satisfies Cached<QboAccount>);
  return items;
}

export async function refreshVendors(): Promise<VendorLite[]> {
  const s = await readStored();
  if (!s) throw new QuickBooksNotConnectedError();
  const items = await withClient((c) => fetchVendors(c));
  await writeJSON(VENDORS_KEY, { realmId: s.realmId, at: new Date().toISOString(), items } satisfies Cached<VendorLite>);
  return items;
}

/** The chart of accounts (from the cache; fetched once if there's none yet). */
export async function quickbooksAccounts(): Promise<{ accounts: QboAccount[]; at: string | null }> {
  const c = await cached<QboAccount>(ACCOUNTS_KEY);
  if (c.at || !(await isQuickBooksConnected())) return { accounts: c.items, at: c.at };
  try {
    return { accounts: await refreshAccounts(), at: new Date().toISOString() };
  } catch {
    return { accounts: [], at: null };
  }
}

export async function quickbooksVendors(): Promise<{ vendors: VendorLite[]; at: string | null }> {
  const c = await cached<VendorLite>(VENDORS_KEY);
  if (c.at || !(await isQuickBooksConnected())) return { vendors: c.items, at: c.at };
  try {
    return { vendors: await refreshVendors(), at: new Date().toISOString() };
  } catch {
    return { vendors: [], at: null };
  }
}

// ---- Mapping ---------------------------------------------------------------------------------------

async function loadMapping(realmId: string | null): Promise<QboMapping> {
  return qboMapping(await readJSON(SETTINGS_KEY), realmId);
}

export async function quickbooksMapping(): Promise<QboMapping> {
  return loadMapping((await readStored())?.realmId ?? null);
}

export type MappingChange =
  | { field: "defaultAccountId" | "otherAccountId"; value: string | null }
  | { field: "category"; key: string; value: string | null }
  | { field: "supplier"; key: string; value: string | null }
  | { field: "autoSend"; value: boolean }
  | { field: "sendFrom"; value: ISODate | null };

export async function saveMapping(change: MappingChange) {
  const s = await readStored();
  if (!s && change.field !== "autoSend") throw new QuickBooksNotConnectedError();
  const cur = await loadMapping(s?.realmId ?? null);
  const next: QboMapping = { ...cur, realmId: s?.realmId ?? cur.realmId, byCategory: { ...cur.byCategory }, bySupplier: { ...cur.bySupplier } };
  if (change.field === "defaultAccountId" || change.field === "otherAccountId" || change.field === "category" || change.field === "supplier") {
    if (change.value) {
      const { accounts } = await quickbooksAccounts();
      if (!billAccounts(accounts).some((a) => a.id === change.value)) throw new Error("That account isn't in QuickBooks any more. Press Refresh list and pick again.");
    }
  }
  switch (change.field) {
    case "defaultAccountId":
    case "otherAccountId":
      next[change.field] = change.value;
      break;
    case "category":
    case "supplier": {
      const map = change.field === "category" ? next.byCategory : next.bySupplier;
      if (change.value) map[change.key] = change.value;
      else delete map[change.key];
      break;
    }
    case "autoSend":
      next.autoSend = change.value;
      break;
    case "sendFrom":
      next.sendFrom = change.value;
      break;
  }
  await writeJSON(SETTINGS_KEY, next);
  return next;
}

/** Accounts the mapping points at that QuickBooks no longer has. */
export async function mappingProblems(): Promise<string[]> {
  const [m, { accounts, at }] = await Promise.all([quickbooksMapping(), quickbooksAccounts()]);
  return at ? missingAccounts(m, accounts) : [];
}

/** The first day invoices are sent from (bulk and automatic): the saved date, else the 1st of the month QuickBooks was connected. */
export function effectiveSendFrom(m: QboMapping, connectedAt: string | null): ISODate {
  return m.sendFrom ?? `${(connectedAt ?? new Date().toISOString()).slice(0, 7)}-01`;
}

// ---- Links -------------------------------------------------------------------------------------------

type Kind = "vendor" | "bill";
const linkKey = (realmId: string, kind: Kind, localId: string) => ({ realmId_kind_localId: { realmId, kind, localId } });

export interface SupplierVendorRow {
  supplierId: string;
  supplierName: string;
  vendorId: string | null;
  vendorName: string | null;
  suggestion: { id: string; name: string } | null;
  accountId: string | null;
}

/** Each active supplier with its QuickBooks vendor (or a suggested one) and account override. */
export async function supplierVendors(): Promise<SupplierVendorRow[]> {
  const s = await readStored();
  const [suppliers, { vendors }, mapping] = await Promise.all([
    db.supplier.findMany({ where: { OR: [{ active: true }, { invoices: { some: { status: "APPROVED" } } }] }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    quickbooksVendors(),
    loadMapping(s?.realmId ?? null),
  ]);
  const links = s ? await db.quickBooksLink.findMany({ where: { realmId: s.realmId, kind: "vendor" } }) : [];
  const byLocal = new Map(links.map((l) => [l.localId, l]));
  const vendorName = new Map(vendors.map((v) => [v.id, v.name]));
  return suppliers.map((sup) => {
    const l = byLocal.get(sup.id);
    const vendorId = l?.qboId ?? null;
    const m = vendorId ? null : matchVendor(sup.name, vendors);
    return {
      supplierId: sup.id,
      supplierName: sup.name,
      vendorId,
      vendorName: vendorId ? vendorName.get(vendorId) ?? l?.error ?? "Vendor in QuickBooks" : null,
      suggestion: m ? { id: m.vendor.id, name: m.vendor.name } : null,
      accountId: mapping.bySupplier[sup.id] ?? null,
    };
  });
}

async function saveVendorLink(realmId: string, supplierId: string, vendor: VendorLite | null) {
  if (!vendor) {
    await db.quickBooksLink.deleteMany({ where: { realmId, kind: "vendor", localId: supplierId } });
    return;
  }
  // `error` doubles as the vendor's display name for vendor links (shown when the cached list is stale).
  const data = { qboId: vendor.id, status: "ok", error: vendor.name.slice(0, 200), sentAt: new Date() };
  await db.quickBooksLink.upsert({ where: linkKey(realmId, "vendor", supplierId), create: { realmId, kind: "vendor", localId: supplierId, ...data }, update: data });
}

/** Point a supplier at a QuickBooks vendor ("new" creates one with the supplier's name; null unlinks). */
export async function linkSupplier(supplierId: string, vendorId: string | "new" | null): Promise<{ vendorName: string | null }> {
  const s = await readStored();
  if (!s) throw new QuickBooksNotConnectedError();
  if (vendorId === null) {
    await saveVendorLink(s.realmId, supplierId, null);
    return { vendorName: null };
  }
  if (vendorId === "new") {
    const sup = await db.supplier.findUniqueOrThrow({ where: { id: supplierId }, select: { id: true, name: true, email: true } });
    const v = await withClient((c) => findOrCreateVendor(c, sup));
    await saveVendorLink(s.realmId, supplierId, v);
    return { vendorName: v.name };
  }
  const { vendors } = await quickbooksVendors();
  const v = vendors.find((x) => x.id === vendorId);
  if (!v) throw new Error("That vendor isn't in QuickBooks any more. Press Refresh list and pick again.");
  await saveVendorLink(s.realmId, supplierId, v);
  return { vendorName: v.name };
}

/** Link every unlinked supplier whose name clearly matches a QuickBooks vendor. Creates nothing. */
export async function autoMatchSuppliers(): Promise<{ matched: number }> {
  const s = await readStored();
  if (!s) throw new QuickBooksNotConnectedError();
  const { vendors } = await quickbooksVendors();
  const rows = await supplierVendors();
  let matched = 0;
  for (const r of rows) {
    if (r.vendorId) continue;
    const m = matchVendor(r.supplierName, vendors);
    if (m?.sure) {
      await saveVendorLink(s.realmId, r.supplierId, m.vendor);
      matched++;
    }
  }
  return { matched };
}

async function findOrCreateVendor(c: QboClient, sup: { name: string; email: string | null }): Promise<VendorLite> {
  const name = vendorDisplayName(sup.name);
  const existing = await findVendorByName(c, name);
  if (existing) return existing;
  try {
    const v = await createVendor(c, { displayName: name, email: sup.email });
    await addCachedVendor(c.realmId, v);
    return v;
  } catch (e) {
    // The name is taken by a customer or employee (names are shared across all three in QuickBooks).
    if (e instanceof QboError && e.codes.includes("6240")) {
      const alt = vendorDisplayName(`${name} (supplier)`);
      const again = (await findVendorByName(c, alt)) ?? (await createVendor(c, { displayName: alt, email: sup.email }));
      await addCachedVendor(c.realmId, again);
      return again;
    }
    throw e;
  }
}

async function addCachedVendor(realmId: string, v: VendorLite) {
  const c = await readJSON<Cached<VendorLite>>(VENDORS_KEY);
  if (c?.realmId !== realmId || c.items.some((x) => x.id === v.id)) return;
  await writeJSON(VENDORS_KEY, { ...c, items: [...c.items, v] });
}

async function vendorFor(c: QboClient, sup: { id: string; name: string; email: string | null }): Promise<string> {
  const link = await db.quickBooksLink.findUnique({ where: linkKey(c.realmId, "vendor", sup.id) });
  if (link?.qboId) return link.qboId;
  const { vendors } = await quickbooksVendors();
  const m = matchVendor(sup.name, vendors);
  const v = m?.sure ? m.vendor : await findOrCreateVendor(c, sup);
  await saveVendorLink(c.realmId, sup.id, v);
  return v.id;
}

// ---- Sending bills ------------------------------------------------------------------------------------

export type BillState =
  | { state: "not-sent" }
  | { state: "sending" }
  | { state: "sent"; billId: string; at: string | null; by: string | null; attached: boolean; changed: boolean }
  | { state: "linked"; billId: string; at: string | null }
  | { state: "error"; error: string; at: string | null; billId: string | null };

const SENDING_FOR_MS = 2 * 60_000;

function stateOf(l: { status: string; manual: boolean; qboId: string | null; error: string | null; sentAt: Date | null; sentBy: string | null; attachableId: string | null; updatedAt: Date } | null, changed = false): BillState {
  if (!l) return { state: "not-sent" };
  const at = l.sentAt?.toISOString() ?? null;
  if (l.status === "sending" && Date.now() - l.updatedAt.getTime() < SENDING_FOR_MS) return { state: "sending" };
  if (l.status === "error" || l.status === "sending") return { state: "error", error: l.error ?? "Sending didn't finish. Press Send again.", at, billId: l.qboId };
  if (l.manual && l.qboId) return { state: "linked", billId: l.qboId, at };
  if (l.qboId) return { state: "sent", billId: l.qboId, at, by: l.sentBy, attached: !!l.attachableId, changed };
  return { state: "not-sent" };
}

/** Where an invoice stands with QuickBooks (for the badge on the invoice page). */
export async function invoiceBillState(invoiceId: string): Promise<BillState | null> {
  const s = await readStored();
  if (!s) return null;
  const l = await db.quickBooksLink.findUnique({ where: linkKey(s.realmId, "bill", invoiceId) });
  return stateOf(l);
}

/** Bill states for many invoices at once (the invoices list). */
export async function billStates(invoiceIds: string[]): Promise<Map<string, BillState>> {
  const s = await readStored();
  if (!s || !invoiceIds.length) return new Map();
  const links = await db.quickBooksLink.findMany({ where: { realmId: s.realmId, kind: "bill", localId: { in: invoiceIds } } });
  return new Map(links.map((l) => [l.localId, stateOf(l)]));
}

/** Claim the invoice for sending, so a double tap (or approve + auto-send) can't send twice. */
async function claim(realmId: string, invoiceId: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - SENDING_FOR_MS);
  const r = await db.quickBooksLink.updateMany({
    where: { realmId, kind: "bill", localId: invoiceId, OR: [{ status: { not: "sending" } }, { updatedAt: { lt: cutoff } }] },
    data: { status: "sending" },
  });
  if (r.count) return true;
  try {
    await db.quickBooksLink.create({ data: { realmId, kind: "bill", localId: invoiceId, status: "sending" } });
    return true;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return false;
    throw e;
  }
}

export type SendResult = { ok: true; message: string; billId: string } | { ok: false; error: string };

const extFor = (type: string | null) => (type === "application/pdf" ? "pdf" : type === "image/png" ? "png" : type === "image/webp" ? "webp" : type === "image/gif" ? "gif" : "jpg");

/**
 * Send one approved invoice to QuickBooks as a bill (with its photo or PDF
 * attached). Sending again updates the same bill — unless a payment has been
 * recorded against it in QuickBooks, which we never change.
 */
export async function sendInvoiceToQuickBooks(invoiceId: string, by: string): Promise<SendResult> {
  const s = await readStored();
  if (!s) return { ok: false, error: new QuickBooksNotConnectedError().message };
  if (s.needsReconnect) return { ok: false, error: s.needsReconnect };
  const inv = await db.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      status: true,
      invoiceNumber: true,
      invoiceDate: true,
      total: true,
      imageType: true,
      supplier: { select: { id: true, name: true, email: true } },
      lines: { orderBy: { id: "asc" }, select: { description: true, sku: true, qty: true, unitPrice: true, product: { select: { ingredient: { select: { category: true } } } } } },
    },
  });
  if (!inv) return { ok: false, error: "That invoice is gone." };
  if (inv.status !== "APPROVED") return { ok: false, error: "Approve the invoice first — only approved invoices go to QuickBooks." };
  const [mapping, accounting] = await Promise.all([loadMapping(s.realmId), loadAccounts()]);
  if (!mapping.defaultAccountId) return { ok: false, error: "Choose which QuickBooks account bills go to first (QuickBooks → Choose accounts)." };
  if (!(await claim(s.realmId, invoiceId))) return { ok: false, error: "It's already being sent — give it a few seconds." };

  const fail = async (message: string): Promise<SendResult> => {
    await db.quickBooksLink.update({ where: linkKey(s.realmId, "bill", invoiceId), data: { status: "error", error: message.slice(0, 500) } });
    await logProblem(`${inv.supplier.name}${inv.invoiceNumber ? ` #${inv.invoiceNumber}` : ""}: ${message}`);
    return { ok: false, error: message };
  };

  try {
    return await withClient(async (c) => {
      const vendorId = await vendorFor(c, inv.supplier);
      const built = buildQboBill(
        {
          supplierId: inv.supplier.id,
          supplierName: inv.supplier.name,
          invoiceNumber: inv.invoiceNumber,
          invoiceDate: toISODate(inv.invoiceDate),
          total: inv.total?.toNumber() ?? null,
          lines: inv.lines.map((l) => ({ description: l.description, sku: l.sku, qty: l.qty.toNumber(), unitPrice: l.unitPrice.toNumber(), category: l.product?.ingredient?.category ?? null })),
        },
        vendorId,
        mapping,
        accounting.termsDays,
      );
      if (!built.ok) return fail(built.error);

      const link = await db.quickBooksLink.findUniqueOrThrow({ where: linkKey(s.realmId, "bill", invoiceId) });
      let existing = link.qboId ? await readBill(c, link.qboId) : null;
      let message: string;

      if (!existing && !link.qboId) {
        // Already typed into QuickBooks by hand? Link to it and leave it alone.
        const same = await findBillsByNumber(c, built.bill.DocNumber).catch(() => []);
        const match = same.find((b) => b.VendorRef?.value === vendorId);
        if (match) {
          await db.quickBooksLink.update({ where: { id: link.id }, data: { qboId: match.Id, syncToken: match.SyncToken, hash: built.hash, manual: true, status: "ok", error: null, sentAt: new Date(), sentBy: by } });
          await touchSync();
          return { ok: true, billId: match.Id, message: `Bill ${built.bill.DocNumber} was already in QuickBooks, so it's linked and left as it is.` };
        }
      }

      if (existing && link.manual) {
        message = "This bill was entered in QuickBooks by hand, so it's left as it is.";
      } else if (existing && link.hash === built.hash) {
        message = "Already up to date in QuickBooks.";
      } else if (existing) {
        if (billHasPayment(existing)) {
          return fail("A payment is already recorded against this bill in QuickBooks, so it wasn't changed. Make any change in QuickBooks.");
        } else {
          existing = await updateBill(c, existing.Id, existing.SyncToken, built.bill);
          message = "Updated the bill in QuickBooks.";
        }
      } else {
        existing = await createBill(c, built.bill, billRequestId(invoiceId, built.hash, link.qboId));
        message = link.qboId ? "The bill had been deleted in QuickBooks, so it was sent again." : "Sent to QuickBooks as a bill.";
        if (link.manual) await db.quickBooksLink.update({ where: { id: link.id }, data: { manual: false } });
      }

      let attachableId = existing.Id === link.qboId ? link.attachableId : null;
      let attachNote = "";
      if (!attachableId && inv.imageType && !(link.manual && existing.Id === link.qboId)) {
        try {
          const img = await db.invoice.findUnique({ where: { id: invoiceId }, select: { image: true } });
          if (img?.image) {
            const number = (inv.invoiceNumber || toISODate(inv.invoiceDate)).replace(/[^\w.-]+/g, "-");
            const name = `${inv.supplier.name.replace(/[^\w.-]+/g, "-")}-${number}.${extFor(inv.imageType)}`.slice(0, 100);
            attachableId = await attachToBill(c, existing.Id, { name, type: inv.imageType, bytes: img.image });
            attachNote = " The invoice photo is attached.";
          }
        } catch (e) {
          attachNote = " The photo couldn't be attached — press Send again to retry.";
          await logProblem(`Attaching the photo for ${inv.supplier.name}${inv.invoiceNumber ? ` #${inv.invoiceNumber}` : ""}: ${friendlyQuickBooksError(e)}`);
        }
      }

      await db.quickBooksLink.update({
        where: { id: link.id },
        data: { qboId: existing.Id, syncToken: existing.SyncToken, hash: built.hash, attachableId, status: "ok", error: null, sentAt: new Date(), sentBy: by },
      });
      await touchSync();
      if (message.startsWith("Sent") || message.startsWith("Updated") || message.startsWith("The bill had")) {
        const { recordEvent } = await import("./invoices");
        await recordEvent(invoiceId, { by, action: "sent-to-quickbooks", note: `${message.replace(/\.$/, "")}${attachableId && attachNote.includes("attached") ? " with the photo" : ""}` });
      }
      return { ok: true, billId: existing.Id, message: message + attachNote };
    });
  } catch (e) {
    return fail(friendlyQuickBooksError(e));
  }
}

async function touchSync() {
  await writeRaw(LAST_SYNC_KEY, new Date().toISOString());
}

/** Approved invoices dated from the send-from date that haven't gone to QuickBooks (or failed). */
export async function pendingInvoices(limit = 500): Promise<{ id: string; date: ISODate }[]> {
  const s = await readStored();
  if (!s) return [];
  const mapping = await loadMapping(s.realmId);
  const from = effectiveSendFrom(mapping, s.connectedAt);
  const done = await db.quickBooksLink.findMany({ where: { realmId: s.realmId, kind: "bill", status: "ok", qboId: { not: null } }, select: { localId: true } });
  const rows = await db.invoice.findMany({
    where: { status: "APPROVED", invoiceDate: { gte: parseISODate(from) }, id: { notIn: done.map((d) => d.localId) } },
    orderBy: [{ invoiceDate: "asc" }, { createdAt: "asc" }],
    select: { id: true, invoiceDate: true },
    take: limit,
  });
  return rows.map((r) => ({ id: r.id, date: toISODate(r.invoiceDate) }));
}

/** Send up to `max` waiting invoices, one at a time (QuickBooks asks for one write at a time per company). */
export async function sendPending(by: string, max = 15): Promise<{ sent: number; failed: number; remaining: number; firstError: string | null }> {
  const all = await pendingInvoices();
  let sent = 0;
  let failed = 0;
  let firstError: string | null = null;
  const started = Date.now();
  for (const inv of all.slice(0, max)) {
    // Stay well inside a serverless function's time; the page carries on with another call.
    if (Date.now() - started > 40_000) break;
    const r = await sendInvoiceToQuickBooks(inv.id, by);
    if (r.ok) sent++;
    else {
      failed++;
      firstError ??= r.error;
      if (/Connect to QuickBooks|isn't connected|Choose which/.test(r.error)) break;
    }
  }
  const remaining = (await pendingInvoices()).length;
  return { sent, failed, remaining, firstError };
}

/** Called after an invoice is approved: sends it if "send automatically" is on. Never throws. */
export async function autoSendApproved(invoiceId: string, by: string) {
  try {
    const s = await readStored();
    if (!s || s.needsReconnect) return;
    const m = await loadMapping(s.realmId);
    if (!m.autoSend || !m.defaultAccountId) return;
    const inv = await db.invoice.findUnique({ where: { id: invoiceId }, select: { invoiceDate: true, status: true } });
    if (!inv || inv.status !== "APPROVED" || toISODate(inv.invoiceDate) < effectiveSendFrom(m, s.connectedAt)) return;
    await sendInvoiceToQuickBooks(invoiceId, by);
  } catch (e) {
    console.error("QuickBooks auto-send failed", (e as Error).message);
  }
}
