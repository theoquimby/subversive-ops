/**
 * Per-user notification preferences, stored in the Setting table as JSON
 * (key `notify.prefs.<userId>`). Pure helpers here; loading/saving is in services/notify.
 */

export const NOTIFY_EVENTS = {
  schedulePublished: { label: "Schedule published", hint: "Your shifts for the week, when a manager publishes it.", audience: "everyone" },
  shiftChanges: { label: "Shift changes", hint: "A shift moved, a swap or time off was decided.", audience: "everyone" },
  certificates: { label: "Certificates", hint: "A certificate like ATAP or food handler expires in 30 or 7 days, or has expired.", audience: "everyone" },
  weeklyBrief: { label: "Weekly brief", hint: "What needs you before the week starts.", audience: "manager" },
  insights: { label: "Insights digest", hint: "Sunday: the 3 findings worth most this week.", audience: "manager" },
  priceSpikes: { label: "Price spikes", hint: "A supplier price jumped enough to move plate costs.", audience: "manager" },
  invoiceIssues: { label: "Invoice issues", hint: "An invoice doesn't match the order or delivery.", audience: "manager" },
  staffRequests: { label: "Staff requests", hint: "Someone asked for time off or to swap a shift.", audience: "manager" },
  badReviews: { label: "Low reviews", hint: "A new 1–2★ review came in.", audience: "manager" },
  kegs: { label: "Kegs", hint: "A keg kicked with no full one of that beer behind it, or a beer is running low.", audience: "manager" },
} as const;

export type NotifyEvent = keyof typeof NOTIFY_EVENTS;
export type Channel = "email" | "push";
export const EVENT_KEYS = Object.keys(NOTIFY_EVENTS) as NotifyEvent[];

export interface NotifyPrefs {
  /** Overrides the email on the linked team member. */
  email: string | null;
  events: Record<NotifyEvent, Record<Channel, boolean>>;
}

/** Calm defaults: things about your own shifts and the weekly brief by email; alerts only by push. */
export const DEFAULT_PREFS: NotifyPrefs = {
  email: null,
  events: {
    schedulePublished: { email: true, push: true },
    shiftChanges: { email: true, push: true },
    certificates: { email: true, push: true },
    weeklyBrief: { email: true, push: true },
    insights: { email: true, push: true },
    priceSpikes: { email: false, push: true },
    invoiceIssues: { email: false, push: true },
    staffRequests: { email: false, push: true },
    badReviews: { email: true, push: true },
    kegs: { email: false, push: true },
  },
};

export const prefsKey = (userId: string) => `notify.prefs.${userId}`;

/** Tolerant parse: unknown/missing fields fall back to defaults. */
export function parsePrefs(raw: string | null | undefined): NotifyPrefs {
  let v: unknown = null;
  try {
    v = raw ? JSON.parse(raw) : null;
  } catch {
    v = null;
  }
  const o = (v && typeof v === "object" ? v : {}) as { email?: unknown; events?: Record<string, Record<string, unknown>> };
  const events = {} as NotifyPrefs["events"];
  for (const k of EVENT_KEYS) {
    const e = o.events?.[k] ?? {};
    events[k] = {
      email: typeof e.email === "boolean" ? e.email : DEFAULT_PREFS.events[k].email,
      push: typeof e.push === "boolean" ? e.push : DEFAULT_PREFS.events[k].push,
    };
  }
  return { email: typeof o.email === "string" && o.email.trim() ? o.email.trim() : null, events };
}

export const eventsFor = (role: "MANAGER" | "STAFF"): NotifyEvent[] =>
  EVENT_KEYS.filter((k) => role === "MANAGER" || NOTIFY_EVENTS[k].audience === "everyone");
