import "server-only";
import { headers } from "next/headers";

/**
 * The app's public address, for the web addresses a manager pastes into
 * Square (redirect URL, webhook URL). APP_URL wins; otherwise the address the
 * manager is using right now; otherwise Vercel's production URL.
 */
export async function publicOrigin(): Promise<string> {
  const explicit = process.env.APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (host) {
      const proto = h.get("x-forwarded-proto") ?? (/^(localhost|127\.|\[::1\])/.test(host) ? "http" : "https");
      return `${proto.split(",")[0].trim()}://${host.split(",")[0].trim()}`;
    }
  } catch {
    /* outside a request */
  }
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() || process.env.VERCEL_URL?.trim();
  return vercel ? `https://${vercel}` : "http://localhost:3000";
}

export const SQUARE_REDIRECT_PATH = "/api/square/oauth/callback";
export const SQUARE_WEBHOOK_PATH = "/api/webhooks/square";
export const QUICKBOOKS_REDIRECT_PATH = "/api/quickbooks/oauth/callback";
/** Public pages Intuit asks for before it hands out production keys (no sign-in needed). */
export const QUICKBOOKS_PRIVACY_PATH = "/api/public/legal/privacy";
export const QUICKBOOKS_TERMS_PATH = "/api/public/legal/terms";

/** True when Square can't reach this address (it only accepts public https addresses). */
export const isLocalOrigin = (origin: string) => /^http:\/\//.test(origin) || /\/\/(localhost|127\.|\[::1\]|0\.0\.0\.0)/.test(origin);
