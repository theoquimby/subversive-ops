/** The Square events the app listens to for instant updates. */
export const SQUARE_WEBHOOK_EVENTS = [
  "order.created",
  "order.updated",
  "payment.created",
  "payment.updated",
  "refund.created",
  "refund.updated",
  "labor.timecard.created",
  "labor.timecard.updated",
  "labor.timecard.deleted",
  "catalog.version.updated",
] as const;

/**
 * Check a pasted Square access token (the one on the Credentials page).
 * Used once to set up instant updates, never stored.
 */
export function checkAccessToken(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const v = raw.trim().replace(/^Bearer\s+/i, "");
  if (!v) return { ok: false, error: "Paste the access token first." };
  if (/^(sandbox-)?sq0(idp|idb)-/.test(v)) return { ok: false, error: "That's the Application ID. Copy the Access token instead — it's on the same page and starts with EAAA." };
  if (/^(sandbox-)?sq0(csp|csb)-/.test(v)) return { ok: false, error: "That's the Application secret. Copy the Access token instead — it starts with EAAA." };
  if (/\s/.test(v)) return { ok: false, error: "That has a space in it. Copy just the token again." };
  if (!/^EAAA[\w-]{20,}$/.test(v)) return { ok: false, error: "That doesn't look like a Square access token. It starts with EAAA — press Show next to it on the Credentials page, then copy." };
  return { ok: true, value: v };
}
