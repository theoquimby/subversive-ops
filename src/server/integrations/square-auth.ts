import "server-only";
import { squareCall, squareHost, squareRequest, SquareEnvironment } from "./square-http";

/** Square OAuth (code flow) plus the account lookups used while connecting. */

export const SQUARE_SCOPES = [
  "MERCHANT_PROFILE_READ",
  "ITEMS_READ",
  "ORDERS_READ",
  "PAYMENTS_READ",
  "EMPLOYEES_READ",
  "TIMECARDS_READ",
  "TIMECARDS_SETTINGS_READ",
  "INVENTORY_READ",
] as const;

export function authorizeUrl(environment: SquareEnvironment, applicationId: string, state: string): string {
  const q = new URLSearchParams({ client_id: applicationId, scope: SQUARE_SCOPES.join(" "), state });
  // Production: always show the Square sign-in, so the right account is picked. Sandbox ignores it.
  if (environment === "production") q.set("session", "false");
  return `${squareHost(environment)}/oauth2/authorize?${q}`;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_at?: string;
  merchant_id?: string;
  token_type?: string;
}

export function exchangeCode(environment: SquareEnvironment, applicationId: string, applicationSecret: string, code: string) {
  return squareRequest<TokenResponse>(environment, "/oauth2/token", {
    method: "POST",
    body: JSON.stringify({ client_id: applicationId, client_secret: applicationSecret, code, grant_type: "authorization_code" }),
  });
}

export function refreshAccessToken(environment: SquareEnvironment, applicationId: string, applicationSecret: string, refreshToken: string) {
  return squareRequest<TokenResponse>(environment, "/oauth2/token", {
    method: "POST",
    body: JSON.stringify({ client_id: applicationId, client_secret: applicationSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
}

/** Revokes every token this app holds for the merchant. */
export function revokeToken(environment: SquareEnvironment, applicationId: string, applicationSecret: string, accessToken: string) {
  return squareRequest<{ success?: boolean }>(
    environment,
    "/oauth2/revoke",
    { method: "POST", authorization: `Client ${applicationSecret}`, body: JSON.stringify({ client_id: applicationId, access_token: accessToken }) },
    2,
  );
}

export interface SquareMerchant {
  id: string;
  name: string;
  mainLocationId: string | null;
}

export async function fetchMerchant(c: { accessToken: string; environment: SquareEnvironment }): Promise<SquareMerchant> {
  const r = await squareCall<{ merchant?: { id: string; business_name?: string; main_location_id?: string } }>(c, "/merchants/me");
  if (!r.merchant) throw new Error("Square didn't return the business profile.");
  return { id: r.merchant.id, name: r.merchant.business_name || "Square business", mainLocationId: r.merchant.main_location_id ?? null };
}

export interface SquareLocation {
  id: string;
  name: string;
  active: boolean;
  timezone: string | null;
}

export async function fetchLocations(c: { accessToken: string; environment: SquareEnvironment }): Promise<SquareLocation[]> {
  const r = await squareCall<{ locations?: { id: string; name?: string; status?: string; timezone?: string }[] }>(c, "/locations");
  return (r.locations ?? []).map((l) => ({ id: l.id, name: l.name || l.id, active: l.status !== "INACTIVE", timezone: l.timezone ?? null }));
}
