/**
 * Contact details for the website, from Settings → Business (one address line,
 * one phone string) into the website's shapes: address parts, a display phone
 * plus a +1 tel, and checked links. Pure.
 */

import { LINK_KEYS, type LinkKey } from "./websiteSchema";

export interface WebAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
  geo: null;
}

/**
 * "96 West Bridge Street, Catskill, NY 12414" → parts. Also takes the state and
 * zip on their own ("…, Catskill, NY, 12414") and a missing zip. Null when it
 * doesn't read as street, town, state.
 */
export function parseAddress(raw: string | null | undefined): WebAddress | null {
  const parts = String(raw ?? "")
    .split(/\s*[,\n]\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  const last = parts.join(" ").match(/\b([A-Z]{2})\s*,?\s*(\d{5}(?:-\d{4})?)?\s*$/);
  if (!last) return null;
  const state = last[1];
  const zip = last[2] ?? "";
  // Drop the trailing state / zip parts, leaving street … city.
  const head = [...parts];
  while (head.length && /^([A-Z]{2})?\s*(\d{5}(?:-\d{4})?)?$/.test(head[head.length - 1])) head.pop();
  const lastHead = head[head.length - 1] ?? "";
  // "Catskill NY 12414" in one part.
  const merged = lastHead.match(/^(.*?)\s+[A-Z]{2}(?:\s+\d{5}(?:-\d{4})?)?$/);
  if (merged) head[head.length - 1] = merged[1];
  if (head.length < 2) return null;
  const city = head.pop()!;
  const street = head.join(", ");
  if (!street || !city) return null;
  return { street, city, state, zip, geo: null };
}

/** "(518) 303-1270" / "518.303.1270" / "+1 518 303 1270" → display and tel; null when not a US number. */
export function parsePhone(raw: string | null | undefined): { display: string; tel: string } | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length !== 10 || /^[01]/.test(ten)) return null;
  return { display: `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`, tel: `+1${ten}` };
}

const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[a-z]{2,}$/i;
export const isEmailAddress = (s: string | null | undefined) => !!s && EMAIL.test(s.trim());

/** A link as typed: adds https:// to a bare domain; null when it isn't a web address. */
export function cleanUrl(raw: string | null | undefined): string | null {
  let v = String(raw ?? "").trim();
  if (!v) return null;
  if (!/^[a-z]+:\/\//i.test(v)) v = `https://${v}`;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (!u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export const LINK_LABEL: Record<LinkKey, string> = {
  order: "Order pickup",
  eGiftCard: "eGift cards",
  map: "Map / directions",
  instagram: "Instagram",
  facebook: "Facebook",
  bandBookingForm: "Band booking form",
};

export type WebLinks = Partial<Record<LinkKey, string>>;

export function parseLinks(raw: unknown): WebLinks {
  if (!raw || typeof raw !== "object") return {};
  const out: WebLinks = {};
  for (const k of LINK_KEYS) {
    const u = cleanUrl((raw as Record<string, unknown>)[k] as string);
    if (u) out[k] = u;
  }
  return out;
}
