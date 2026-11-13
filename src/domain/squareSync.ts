import { addDays, ISODate, parseISODate, toISODate } from "./dates";

/**
 * Scheduling rules for pulling data from Square: history import chunks,
 * retry backoff, token refresh timing, freshness and webhook routing.
 */

export interface DateChunk {
  from: ISODate;
  toExclusive: ISODate;
}

/** The same calendar day `months` months before `today` (clamped to month end). */
export function monthsBefore(today: ISODate, months: number): ISODate {
  const d = parseISODate(today);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() - months;
  const target = new Date(Date.UTC(y, m, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), lastDay));
  return toISODate(target);
}

/**
 * Split [from, toExclusive) into chunks of `days`, newest first — so the most
 * useful recent weeks land before older history.
 */
export function planChunks(from: ISODate, toExclusive: ISODate, days = 7): DateChunk[] {
  if (days < 1) throw new Error("Chunk size must be at least one day.");
  const out: DateChunk[] = [];
  for (let end = toExclusive; end > from; end = addDays(end, -days)) {
    const start = addDays(end, -days) < from ? from : addDays(end, -days);
    out.push({ from: start, toExclusive: end });
  }
  return out;
}

/**
 * How long to wait before retry `attempt` (1-based). Honors Retry-After
 * (seconds or an HTTP date) when present, else exponential backoff.
 * Capped so a single request never blows the serverless time budget.
 */
export function retryDelayMs(attempt: number, retryAfter: string | null | undefined, now = Date.now(), capMs = 10_000): number {
  if (retryAfter) {
    const secs = Number(retryAfter);
    if (Number.isFinite(secs) && secs >= 0) return Math.min(capMs, Math.round(secs * 1000));
    const at = Date.parse(retryAfter);
    if (Number.isFinite(at)) return Math.min(capMs, Math.max(0, at - now));
  }
  return Math.min(capMs, 500 * 2 ** (attempt - 1));
}

export const isRetryableStatus = (status: number) => status === 429 || status >= 500;

/** OAuth access tokens last 30 days; refresh once fewer than `days` remain. */
export function tokenNeedsRefresh(expiresAt: string | null | undefined, now: Date, days = 7): boolean {
  if (!expiresAt) return false;
  const t = Date.parse(expiresAt);
  if (!Number.isFinite(t)) return false;
  return t - now.getTime() < days * 86_400_000;
}

/** True when the last run is missing or older than `maxAgeMinutes`. */
export function isStale(lastRun: string | null | undefined, now: Date, maxAgeMinutes: number): boolean {
  if (!lastRun) return true;
  const t = Date.parse(lastRun);
  return !Number.isFinite(t) || now.getTime() - t >= maxAgeMinutes * 60_000;
}

// ---- Webhooks ------------------------------------------------------------------

export type WebhookStream = "sales" | "labor" | "catalog" | null;

/** Which data a Square webhook event type should resync. */
export function webhookStream(type: string): WebhookStream {
  if (type.startsWith("order.") || type.startsWith("payment.") || type.startsWith("refund.")) return "sales";
  if (type.startsWith("labor.timecard.") || type.startsWith("labor.shift.")) return "labor";
  if (type === "catalog.version.updated") return "catalog";
  return null;
}

/** Find the most relevant timestamp in a webhook payload's data.object. */
export function webhookTimestamp(event: { created_at?: string; data?: { object?: Record<string, unknown> } }): string | null {
  const obj = event.data?.object ?? {};
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      for (const k of ["closed_at", "start_at", "updated_at", "created_at"]) {
        if (typeof o[k] === "string") return o[k] as string;
      }
    }
  }
  return event.created_at ?? null;
}

export interface PendingWork {
  sales: ISODate[];
  labor: ISODate[];
  catalog: boolean;
}

export const emptyPending = (): PendingWork => ({ sales: [], labor: [], catalog: false });

/** Merge new dirty dates into the pending queue (deduped, sorted, capped). */
export function mergePending(cur: PendingWork, add: Partial<PendingWork>, cap = 14): PendingWork {
  const merge = (a: ISODate[], b: ISODate[] = []) => [...new Set([...a, ...b])].sort().slice(-cap);
  return { sales: merge(cur.sales, add.sales), labor: merge(cur.labor, add.labor), catalog: cur.catalog || !!add.catalog };
}

/** Collapse dirty dates into the fewest contiguous [from, toExclusive) ranges. */
export function dateRuns(dates: ISODate[]): DateChunk[] {
  const sorted = [...new Set(dates)].sort();
  const out: DateChunk[] = [];
  for (const d of sorted) {
    const last = out[out.length - 1];
    if (last && last.toExclusive === d) last.toExclusive = addDays(d, 1);
    else out.push({ from: d, toExclusive: addDays(d, 1) });
  }
  return out;
}
