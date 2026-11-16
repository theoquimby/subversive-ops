/**
 * Per-supplier ordering preferences: when and whom to remind, and how the
 * supplier takes orders. Kept on the supplier itself (orderAlert, orderFirst,
 * orderLastCallMins, orderRecipients, orderPeople, sendBy, orderPhone,
 * portalName, portalUrl); they used to live in the JSON Setting
 * `ordering.supplierPrefs`, which is no longer read. Pure: parsing, labels and
 * the mapping to and from those columns.
 */

import type { AlertMode } from "./orderNeed";

/** First reminder: a day before the cutoff, 4 hours before, the morning of, or none. */
export type FirstReminder = "24h" | "4h" | "morning" | "none";
export type Recipients = "managers" | "people" | "shift";
export type SendBy = "email" | "text" | "portal" | "phone";

export interface SupplierPrefs {
  /** Null: follow the ordering cadence (every delivery → on, when stock runs low → low). */
  alert: AlertMode | null;
  first: FirstReminder;
  /** "You haven't placed it" this many minutes before the cutoff; null = no last call. */
  lastCallMins: number | null;
  recipients: Recipients;
  /** Logins to remind when recipients is "people". */
  people: string[];
  sendBy: SendBy;
  /** For texting or calling the order in. */
  phone: string | null;
  /** The supplier's ordering site or app, by name ("Driscoll's app", "Cut+Dry"). */
  portal: string | null;
  portalUrl: string | null;
}

export const DEFAULT_SUPPLIER_PREFS: SupplierPrefs = {
  alert: null,
  first: "4h",
  lastCallMins: 60,
  recipients: "managers",
  people: [],
  sendBy: "email",
  phone: null,
  portal: null,
  portalUrl: null,
};

export const FIRST_OPTIONS: { value: FirstReminder; label: string }[] = [
  { value: "24h", label: "A day before" },
  { value: "4h", label: "4 hours before" },
  { value: "morning", label: "The morning of" },
  { value: "none", label: "No early reminder" },
];

export const LAST_CALL_OPTIONS: { value: string; label: string }[] = [
  { value: "30", label: "30 min before" },
  { value: "60", label: "1 hour before" },
  { value: "120", label: "2 hours before" },
  { value: "off", label: "No last call" },
];

export const RECIPIENT_OPTIONS: { value: Recipients; label: string }[] = [
  { value: "managers", label: "Managers" },
  { value: "people", label: "Specific people" },
  { value: "shift", label: "Whoever's on shift today" },
];

export const SEND_BY_OPTIONS: { value: SendBy; label: string; hint: string }[] = [
  { value: "email", label: "Email", hint: "Ops emails the order with a spreadsheet attached." },
  { value: "text", label: "Text message", hint: "Opens your phone's Messages with the order typed out. You press send." },
  { value: "portal", label: "Their website or app", hint: "Copy the order with item numbers and tick lines off as you key them into their site." },
  { value: "phone", label: "Phone call", hint: "A call script with every line, and a button to dial." },
];

const FIRSTS = new Set(FIRST_OPTIONS.map((o) => o.value));
const RECIPIENTS = new Set(RECIPIENT_OPTIONS.map((o) => o.value));
const SEND_BYS = new Set(SEND_BY_OPTIONS.map((o) => o.value));

const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

export function parseSupplierPrefs(raw: unknown): SupplierPrefs {
  let v: unknown = raw;
  if (typeof raw === "string") {
    try {
      v = JSON.parse(raw);
    } catch {
      v = null;
    }
  }
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const d = DEFAULT_SUPPLIER_PREFS;
  const lc = o.lastCallMins;
  const url = str(o.portalUrl, 300);
  return {
    alert: o.alert === "on" || o.alert === "low" || o.alert === "off" ? o.alert : null,
    first: FIRSTS.has(o.first as FirstReminder) ? (o.first as FirstReminder) : d.first,
    lastCallMins: lc === null ? null : typeof lc === "number" && Number.isInteger(lc) && lc > 0 && lc <= 24 * 60 ? lc : d.lastCallMins,
    recipients: RECIPIENTS.has(o.recipients as Recipients) ? (o.recipients as Recipients) : d.recipients,
    people: Array.isArray(o.people) ? o.people.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 40).slice(0, 30) : [],
    sendBy: SEND_BYS.has(o.sendBy as SendBy) ? (o.sendBy as SendBy) : d.sendBy,
    phone: str(o.phone, 40),
    portal: str(o.portal, 60),
    portalUrl: url && /^https?:\/\//i.test(url) ? url : null,
  };
}

export function parseAllSupplierPrefs(raw: string | null | undefined): Record<string, SupplierPrefs> {
  let v: unknown = null;
  try {
    v = raw ? JSON.parse(raw) : null;
  } catch {
    return {};
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, parseSupplierPrefs(x)]));
}

export function patchSupplierPrefs(cur: SupplierPrefs, patch: Partial<SupplierPrefs>): SupplierPrefs {
  return parseSupplierPrefs({ ...cur, ...patch });
}

// ---- The supplier's own columns -------------------------------------------------------------

export interface SupplierPrefsColumns {
  orderAlert: string | null;
  orderFirst: string;
  orderLastCallMins: number | null;
  orderRecipients: string;
  orderPeople: string[];
  sendBy: string;
  orderPhone: string | null;
  portalName: string | null;
  portalUrl: string | null;
}

/** The columns to select from Supplier to read its preferences. */
export const PREFS_COLUMNS = {
  orderAlert: true,
  orderFirst: true,
  orderLastCallMins: true,
  orderRecipients: true,
  orderPeople: true,
  sendBy: true,
  orderPhone: true,
  portalName: true,
  portalUrl: true,
} as const;

/** A supplier row's columns as preferences, checked the same way the old JSON was. */
export function prefsFromColumns(c: SupplierPrefsColumns): SupplierPrefs {
  return parseSupplierPrefs({
    alert: c.orderAlert,
    first: c.orderFirst,
    lastCallMins: c.orderLastCallMins,
    recipients: c.orderRecipients,
    people: c.orderPeople ?? [],
    sendBy: c.sendBy,
    phone: c.orderPhone,
    portal: c.portalName,
    portalUrl: c.portalUrl,
  });
}

/** Preferences as the supplier's columns, to write. */
export function prefsToColumns(p: SupplierPrefs): SupplierPrefsColumns {
  const v = parseSupplierPrefs(p);
  return {
    orderAlert: v.alert,
    orderFirst: v.first,
    orderLastCallMins: v.lastCallMins,
    orderRecipients: v.recipients,
    orderPeople: v.people,
    sendBy: v.sendBy,
    orderPhone: v.phone,
    portalName: v.portal,
    portalUrl: v.portalUrl,
  };
}
