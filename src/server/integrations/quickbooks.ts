import "server-only";
import {
  basicAuth,
  faultErrors,
  friendlyQboError,
  qboApiHost,
  qboQuote,
  QBO_MINOR_VERSION,
  QBO_REVOKE_URL,
  QBO_TOKEN_URL,
  type QboAccount,
  type QboBillPayload,
  type QboEnvironment,
  type QboFaultError,
  type QboTokenResponse,
  type VendorLite,
} from "@/domain/quickbooks";

/**
 * QuickBooks Online REST client: OAuth token calls and the handful of
 * Accounting API calls the app makes (company info, accounts, vendors, bills,
 * attachments). Plain fetch. Retries network errors and 5xx; a 429 is retried
 * once after a short pause (Intuit asks for 60 s, more than a page can wait).
 */

export class QboError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errors: QboFaultError[] = [],
    readonly oauthError: string | null = null,
  ) {
    super(message);
    this.name = "QboError";
  }
  get codes() {
    return this.errors.map((e) => String(e.code ?? ""));
  }
}

export const friendlyQuickBooksError = (e: unknown): string =>
  e instanceof QboError ? e.message : (e as Error)?.message || "Something went wrong talking to QuickBooks. Try again in a minute.";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function send(url: string, init: RequestInit, attempts = 3): Promise<{ res: Response; body: unknown }> {
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(25_000) });
    } catch (e) {
      last = new QboError(friendlyQboError(0, []), 0);
      console.warn("QuickBooks unreachable:", (e as Error).message);
      if (attempt < attempts) {
        await sleep(400 * attempt);
        continue;
      }
      throw last;
    }
    const retryable = res.status >= 500 || res.status === 429;
    if (retryable && attempt < Math.min(attempts, res.status === 429 ? 2 : attempts)) {
      const ra = Number(res.headers.get("retry-after"));
      await sleep(res.status === 429 ? Math.min(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 3000, 5000) : 500 * attempt);
      continue;
    }
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!res.ok) {
      const errors = faultErrors(body);
      const oauthError = typeof (body as { error?: unknown })?.error === "string" ? ((body as { error: string }).error) : null;
      // intuit_tid lets Intuit support find the request; never log tokens or bodies with data.
      console.warn(`QuickBooks ${res.status}`, { tid: res.headers.get("intuit_tid"), codes: errors.map((x) => x.code), oauthError });
      throw new QboError(friendlyQboError(res.status, errors, oauthError), res.status, errors, oauthError);
    }
    return { res, body };
  }
  throw last ?? new QboError(friendlyQboError(0, []), 0);
}

// ---- OAuth ------------------------------------------------------------------------------

export interface QboApp {
  clientId: string;
  clientSecret: string;
}

function tokenRequest(app: QboApp, form: Record<string, string>) {
  return send(
    QBO_TOKEN_URL,
    {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded", Authorization: basicAuth(app.clientId, app.clientSecret) },
      body: new URLSearchParams(form).toString(),
    },
    // Never retry a code exchange or refresh blindly: a second attempt with the same value can invalidate the tokens.
    1,
  ).then((r) => r.body as QboTokenResponse);
}

export const exchangeCode = (app: QboApp, code: string, redirectUri: string) => tokenRequest(app, { grant_type: "authorization_code", code, redirect_uri: redirectUri });

export const refreshTokens = (app: QboApp, refreshToken: string) => tokenRequest(app, { grant_type: "refresh_token", refresh_token: refreshToken });

/** Revokes the refresh token (and with it the app's access to the company). */
export async function revokeToken(app: QboApp, token: string) {
  await send(
    QBO_REVOKE_URL,
    { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: basicAuth(app.clientId, app.clientSecret) }, body: JSON.stringify({ token }) },
    2,
  );
}

// ---- Accounting API -------------------------------------------------------------------------

export interface QboClient {
  environment: QboEnvironment;
  realmId: string;
  accessToken: string;
}

function apiUrl(c: QboClient, path: string, params: Record<string, string> = {}) {
  const q = new URLSearchParams({ ...params, minorversion: String(QBO_MINOR_VERSION) });
  return `${qboApiHost(c.environment)}/v3/company/${encodeURIComponent(c.realmId)}${path}?${q}`;
}

async function api<T>(c: QboClient, method: "GET" | "POST", path: string, opts: { params?: Record<string, string>; json?: unknown; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json", Authorization: `Bearer ${c.accessToken}` };
  let body: BodyInit | undefined;
  if (opts.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.json);
  } else if (opts.form) body = opts.form;
  const { body: out } = await send(apiUrl(c, path, opts.params), { method, headers, body }, method === "GET" ? 3 : 2);
  return out as T;
}

/** `select * from X …` → the entities in QueryResponse. */
async function query<T>(c: QboClient, entity: string, statement: string): Promise<T[]> {
  const r = await api<{ QueryResponse?: Record<string, unknown> }>(c, "GET", "/query", { params: { query: statement } });
  return ((r.QueryResponse?.[entity] as T[] | undefined) ?? []);
}

export async function fetchCompanyInfo(c: QboClient): Promise<{ name: string; country: string | null }> {
  const r = await api<{ CompanyInfo?: { CompanyName?: string; LegalName?: string; Country?: string } }>(c, "GET", `/companyinfo/${encodeURIComponent(c.realmId)}`);
  const ci = r.CompanyInfo;
  if (!ci) throw new QboError("QuickBooks didn't send the company details.", 500);
  return { name: ci.CompanyName || ci.LegalName || "QuickBooks company", country: ci.Country ?? null };
}

interface RawAccount {
  Id: string;
  Name: string;
  FullyQualifiedName?: string;
  AccountType?: string;
  AccountSubType?: string;
  Active?: boolean;
}

/** The chart of accounts (active accounts; up to 1,000, Intuit's per-page maximum). */
export async function fetchAccounts(c: QboClient): Promise<QboAccount[]> {
  const rows = await query<RawAccount>(c, "Account", "select * from Account where Active = true maxresults 1000");
  return rows.map((a) => ({ id: a.Id, name: a.Name, fullName: a.FullyQualifiedName || a.Name, type: a.AccountType ?? "", subType: a.AccountSubType ?? null, active: a.Active !== false }));
}

interface RawVendor {
  Id: string;
  DisplayName: string;
  Active?: boolean;
  SyncToken?: string;
  PrefillAccountRef?: { value: string };
}

const toVendor = (v: RawVendor): VendorLite => ({ id: v.Id, name: v.DisplayName, defaultAccountId: v.PrefillAccountRef?.value ?? null });

/** Active vendors, paged 1,000 at a time (capped at 5,000). */
export async function fetchVendors(c: QboClient): Promise<VendorLite[]> {
  const out: VendorLite[] = [];
  for (let start = 1; start <= 4001; start += 1000) {
    const page = await query<RawVendor>(c, "Vendor", `select * from Vendor where Active = true startposition ${start} maxresults 1000`);
    out.push(...page.map(toVendor));
    if (page.length < 1000) break;
  }
  return out;
}

export async function findVendorByName(c: QboClient, name: string): Promise<VendorLite | null> {
  const rows = await query<RawVendor>(c, "Vendor", `select * from Vendor where DisplayName = ${qboQuote(name)}`);
  return rows[0] ? toVendor(rows[0]) : null;
}

export async function createVendor(c: QboClient, v: { displayName: string; email?: string | null }): Promise<VendorLite> {
  const r = await api<{ Vendor: RawVendor }>(c, "POST", "/vendor", {
    json: { DisplayName: v.displayName, CompanyName: v.displayName, ...(v.email ? { PrimaryEmailAddr: { Address: v.email } } : {}) },
  });
  return toVendor(r.Vendor);
}

export interface QboBill {
  Id: string;
  SyncToken: string;
  DocNumber?: string;
  TotalAmt?: number;
  Balance?: number;
  VendorRef?: { value: string };
}

/** A bill by id, or null if it was deleted in QuickBooks. */
export async function readBill(c: QboClient, id: string): Promise<QboBill | null> {
  try {
    const r = await api<{ Bill?: QboBill }>(c, "GET", `/bill/${encodeURIComponent(id)}`);
    return r.Bill ?? null;
  } catch (e) {
    if (e instanceof QboError && (e.status === 404 || e.codes.includes("610"))) return null;
    // A deleted bill reads back as an "Object Not Found" validation fault (HTTP 400).
    if (e instanceof QboError && e.status === 400 && e.errors.some((x) => /not found|deleted/i.test(`${x.Message} ${x.Detail}`))) return null;
    throw e;
  }
}

/** Bills with this number (any vendor). Used to spot a bill someone already typed in by hand. */
export async function findBillsByNumber(c: QboClient, docNumber: string): Promise<QboBill[]> {
  return query<QboBill>(c, "Bill", `select * from Bill where DocNumber = ${qboQuote(docNumber)}`);
}

export async function createBill(c: QboClient, bill: QboBillPayload, requestId: string): Promise<QboBill> {
  const r = await api<{ Bill: QboBill }>(c, "POST", "/bill", { params: { requestid: requestId }, json: bill });
  return r.Bill;
}

/** Sparse update: only the fields we send change (lines are replaced as a whole). */
export async function updateBill(c: QboClient, id: string, syncToken: string, bill: QboBillPayload): Promise<QboBill> {
  const r = await api<{ Bill: QboBill }>(c, "POST", "/bill", { json: { ...bill, Id: id, SyncToken: syncToken, sparse: true } });
  return r.Bill;
}

/** Upload a file and attach it to a bill in one multipart call (`file_metadata_01` + `file_content_01`). */
export async function attachToBill(c: QboClient, billId: string, file: { name: string; type: string; bytes: Uint8Array }): Promise<string> {
  const form = new FormData();
  const meta = { AttachableRef: [{ EntityRef: { type: "Bill", value: billId } }], FileName: file.name, ContentType: file.type };
  form.append("file_metadata_01", new Blob([JSON.stringify(meta)], { type: "application/json" }), "attachment.json");
  form.append("file_content_01", new Blob([new Uint8Array(file.bytes)], { type: file.type }), file.name);
  const r = await api<{ AttachableResponse?: { Attachable?: { Id: string }; Fault?: { Error?: QboFaultError[] } }[] }>(c, "POST", "/upload", { form });
  const first = r.AttachableResponse?.[0];
  if (first?.Attachable?.Id) return first.Attachable.Id;
  const errors = first?.Fault?.Error ?? [];
  throw new QboError(friendlyQboError(400, errors), 400, errors);
}
