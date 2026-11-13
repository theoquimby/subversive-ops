const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export const money = (n: number | null | undefined, opts?: { whole?: boolean }) =>
  n == null ? "—" : (opts?.whole ? usd0 : usd).format(n);

export const pct = (n: number | null | undefined, digits = 1) => (n == null ? "—" : `${(n * 100).toFixed(digits)}%`);

export const signedPct = (n: number | null | undefined, digits = 1) =>
  n == null ? "—" : `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n * 100).toFixed(digits)}%`;

export const qty = (n: number | null | undefined, digits = 2) =>
  n == null ? "—" : Number(n.toFixed(digits)).toLocaleString("en-US");

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const dayFmt = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

/** Format a YYYY-MM-DD business date (no timezone shifting). */
export const shortDate = (iso: string) => dateFmt.format(new Date(`${iso}T00:00:00Z`));
export const dayDate = (iso: string) => dayFmt.format(new Date(`${iso}T00:00:00Z`));

export function relativeTime(d: Date | null) {
  if (!d) return "never";
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

// ---- Timestamps in the business timezone -------------------------------------
// Timestamps (createdAt, sentAt…) must be shown as the business's local date, not
// UTC or the browser's zone. Formatting is fixed to en-US + an explicit timeZone so
// server and client render the same string (no hydration mismatch). Client
// components can't read BUSINESS_TIMEZONE, so in the browser the zone comes from
// the root layout's <meta name="business-tz"> (or pass it explicitly).

const DEFAULT_TZ = "America/New_York";
export function businessTimeZone(): string {
  if (typeof document !== "undefined") return document.querySelector<HTMLMetaElement>('meta[name="business-tz"]')?.content || DEFAULT_TZ;
  return (typeof process !== "undefined" && process.env?.BUSINESS_TIMEZONE) || DEFAULT_TZ;
}

/** Business-local YYYY-MM-DD for an instant. */
export function businessDateOf(instant: Date | string, timeZone = businessTimeZone()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(instant));
}

/** "Nov 13, 3:05pm" in the business timezone — deterministic across Node and browsers. */
export function businessDateTime(instant: Date | string, timeZone = businessTimeZone()): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(instant));
  const get = (k: string) => parts.find((p) => p.type === k)?.value ?? "";
  const h = Number(get("hour"));
  return `${get("month")} ${get("day")}, ${h % 12 === 0 ? 12 : h % 12}:${get("minute")}${h < 12 ? "am" : "pm"}`;
}
