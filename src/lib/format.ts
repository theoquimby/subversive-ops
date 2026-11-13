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
  return `${Math.round(hrs / 24)} days ago`;
}
