/**
 * Names, masking and validation for the keys a manager pastes into
 * Settings → Connections. Pure and browser-safe (no crypto), so the paste
 * fields can validate as you type; the store lives in ./secrets.
 */

export const SECRET_NAMES = [
  "SQUARE_APPLICATION_ID",
  "SQUARE_APPLICATION_SECRET",
  "SQUARE_WEBHOOK_SIGNATURE_KEY",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "ANTHROPIC_API_KEY",
  "GOOGLE_PLACES_API_KEY",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "VAPID_SUBJECT",
  "QUICKBOOKS_CLIENT_ID",
  "QUICKBOOKS_CLIENT_SECRET",
] as const;

export type SecretName = (typeof SECRET_NAMES)[number];

export const isSecretName = (s: string): s is SecretName => (SECRET_NAMES as readonly string[]).includes(s);

/** Values that aren't really secret (shown in full in the UI rather than masked). */
const PUBLIC: ReadonlySet<SecretName> = new Set(["SQUARE_APPLICATION_ID", "EMAIL_FROM", "VAPID_PUBLIC_KEY", "VAPID_SUBJECT", "QUICKBOOKS_CLIENT_ID"]);
export const isPublicSetting = (n: SecretName) => PUBLIC.has(n);

/** Setting-table key for a stored secret. */
export const secretKey = (n: SecretName) => `secret.${n}`;

// ---- Masking ------------------------------------------------------------------------

/** "…ab12" — enough to tell two keys apart, never enough to use one. */
export function maskSecret(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  if (v.length <= 8) return "…" + "•".repeat(Math.min(4, v.length));
  return `…${v.slice(-4)}`;
}

/** What the UI may show about a saved value. */
export function hintFor(name: SecretName, value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  return isPublicSetting(name) ? value.trim() : maskSecret(value);
}

// ---- Cleaning and validation ---------------------------------------------------------

/** Undo the usual copy-paste accidents: surrounding spaces, quotes, "Bearer ", a trailing newline. */
export function cleanPasted(raw: string): string {
  let v = raw.replace(/[​-‍﻿]/g, "").trim();
  v = v.replace(/^(["'`])([\s\S]*)\1$/, "$2").trim();
  v = v.replace(/^bearer\s+/i, "").trim();
  // A key copied as `NAME=value` from a settings file.
  const assign = /^[A-Z_]{3,40}\s*=\s*(.+)$/.exec(v);
  if (assign) v = assign[1].trim().replace(/^(["'])(.*)\1$/, "$2");
  return v;
}

export type Validation = { ok: true; value: string } | { ok: false; error: string };

const fail = (error: string): Validation => ({ ok: false, error });

const FREE_MAIL = /@(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|icloud|me|mac|aol|proton|protonmail)\.[a-z.]+$/i;
const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[a-z]{2,}$/i;

/** Parse "Name <a@b.com>" or "a@b.com". */
export function parseSender(v: string): { name: string | null; address: string } | null {
  const m = /^\s*"?([^"<]*?)"?\s*<\s*([^>]+)\s*>\s*$/.exec(v);
  if (m) return EMAIL.test(m[2]) ? { name: m[1].trim() || null, address: m[2].trim() } : null;
  return EMAIL.test(v.trim()) ? { name: null, address: v.trim() } : null;
}

/** Recognise a value pasted into the wrong box, so the message can say where it goes. */
function looksLike(v: string): string | null {
  if (/^(sandbox-)?sq0(idp|idb)-/.test(v)) return "That's the Square Application ID";
  if (/^(sandbox-)?sq0(csp|csb)-/.test(v)) return "That's the Square Application secret";
  if (/^EAAA/.test(v)) return "That's a Square access token";
  if (/^re_/.test(v)) return "That's an email service (Resend) key";
  if (/^sk-ant-/.test(v)) return "That's a Claude key";
  if (/^AIza/.test(v)) return "That's a Google key";
  if (/^https?:\/\//i.test(v)) return "That's a web address";
  if (/^\d{9,20}$/.test(v)) return "That's a QuickBooks company ID (Realm ID)";
  if (/^eyJ|^eJ/.test(v) && v.length > 200) return "That's a QuickBooks sign-in token";
  return null;
}

const wrongBox = (v: string, expected: string) => {
  const what = looksLike(v);
  return what ? `${what}, not ${expected}. Check you copied the right one.` : null;
};

/**
 * Check a pasted value before it's saved. Errors say what's wrong and what to
 * do, in plain English. Returns the cleaned value on success.
 */
export function validateSecret(name: SecretName, raw: string): Validation {
  const v = cleanPasted(raw);
  if (!v) return fail("Paste the value first.");
  if (/\s/.test(v) && name !== "EMAIL_FROM" && name !== "VAPID_SUBJECT") return fail("That has a space in it, so part of something else came along. Copy just the code again, with no spaces.");

  switch (name) {
    case "SQUARE_APPLICATION_ID":
      if (/^(sandbox-sq0idb|sq0idp)-[\w-]{10,}$/.test(v)) return { ok: true, value: v };
      return fail(wrongBox(v, "the Application ID") ?? "That doesn't look like a Square Application ID. It starts with sq0idp- and is at the top of the Credentials page.");
    case "SQUARE_APPLICATION_SECRET":
      if (/^(sandbox-sq0csb|sq0csp)-[\w-]{10,}$/.test(v)) return { ok: true, value: v };
      return fail(wrongBox(v, "the Application secret") ?? "That doesn't look like a Square Application secret. It starts with sq0csp- — it's on the OAuth page in Square — press Show next to it, then copy.");
    case "SQUARE_WEBHOOK_SIGNATURE_KEY":
      if (/^[\w-]{16,100}$/.test(v) && !looksLike(v)) return { ok: true, value: v };
      return fail(wrongBox(v, "the signature key") ?? "That doesn't look like a signature key. It's a string of about 22 letters and numbers, shown after you save the subscription.");
    case "RESEND_API_KEY":
      if (/^re_[\w]{10,}$/.test(v)) return { ok: true, value: v };
      return fail(wrongBox(v, "an email service key") ?? "That doesn't look like a Resend key. It starts with re_ and is shown once, right after you create it.");
    case "EMAIL_FROM": {
      const s = parseSender(v);
      if (!s) return fail("Use an address like orders@yourrestaurant.com, or a name and address: Subversive <orders@yourrestaurant.com>.");
      if (FREE_MAIL.test(s.address)) return fail("Gmail, Yahoo, Outlook and iCloud addresses can't send through the email service. Use an address at your restaurant's own website, e.g. orders@yourrestaurant.com.");
      return { ok: true, value: s.name ? `${s.name} <${s.address}>` : s.address };
    }
    case "ANTHROPIC_API_KEY":
      if (/^sk-ant-admin/.test(v)) return fail("That's an admin key. Create a regular key instead (it starts with sk-ant-api).");
      if (/^sk-ant-[\w-]{20,}$/.test(v)) return { ok: true, value: v };
      return fail(wrongBox(v, "a Claude key") ?? "That doesn't look like a Claude key. It starts with sk-ant- and is shown once, right after you create it.");
    case "GOOGLE_PLACES_API_KEY":
      if (/^AIza[\w-]{35}$/.test(v)) return { ok: true, value: v };
      if (/^AIza/.test(v)) return fail("That Google key looks cut short or too long — it should be 39 characters. Copy it again in full.");
      return fail(wrongBox(v, "a Google key") ?? "That doesn't look like a Google key. It starts with AIza and is shown under Keys & credentials.");
    case "VAPID_PUBLIC_KEY":
    case "VAPID_PRIVATE_KEY":
      if (/^[\w-]{40,120}$/.test(v)) return { ok: true, value: v };
      return fail("That isn't a valid notification key. Use the Turn on button and the app makes one for you.");
    case "QUICKBOOKS_CLIENT_ID":
      // Intuit doesn't document a format; real ones are ~50 letters and digits (e.g. AB…).
      if (/^[A-Za-z0-9]{40,64}$/.test(v) && /[A-Za-z]/.test(v) && /\d/.test(v) && !looksLike(v)) return { ok: true, value: v };
      if (/^[A-Za-z0-9]{20,39}$/.test(v) && !looksLike(v)) return fail("That looks cut short — a Client ID is about 50 letters and numbers. Turn on Show credentials and copy it again in full.");
      return fail(wrongBox(v, "the Client ID") ?? "That doesn't look like a QuickBooks Client ID. It's about 50 letters and numbers, under Keys and credentials → Production.");
    case "QUICKBOOKS_CLIENT_SECRET":
      if (/^[A-Za-z0-9]{30,64}$/.test(v) && /[A-Za-z]/.test(v) && /\d/.test(v) && !looksLike(v)) return { ok: true, value: v };
      if (/^[A-Za-z0-9]{12,29}$/.test(v) && !looksLike(v)) return fail("That looks cut short — a Client secret is about 40 letters and numbers. Copy it again in full.");
      return fail(wrongBox(v, "the Client secret") ?? "That doesn't look like a QuickBooks Client secret. It's about 40 letters and numbers, just below the Client ID.");
    case "VAPID_SUBJECT":
      if (/^mailto:[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v) || /^https:\/\/(?!localhost)[^\s]+$/i.test(v)) return { ok: true, value: v };
      return fail("Use mailto: followed by an email address, or an https:// web address.");
  }
}
