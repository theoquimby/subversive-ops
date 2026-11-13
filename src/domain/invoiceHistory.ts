/**
 * Invoice approval history: an append-only log so reopening an invoice never
 * erases who approved it, when, or why an issue was waved through.
 *
 * Stored as JSON (one Setting per invoice). Entries are only ever appended;
 * `appendEvent` returns a new array and never edits earlier entries.
 */

export type InvoiceAction = "approved" | "auto-approved" | "reopened" | "prices-updated" | "credit-requested";

export interface InvoiceEvent {
  at: string; // ISO instant
  by: string; // user name, or "auto"
  action: InvoiceAction;
  /** Status when the action was taken (e.g. PRICE_ISSUE when approved anyway). */
  status?: string;
  note?: string;
}

const ACTIONS: InvoiceAction[] = ["approved", "auto-approved", "reopened", "prices-updated", "credit-requested"];

/** Parse a stored log, dropping anything malformed rather than failing. */
export function parseHistory(raw: string | null | undefined): InvoiceEvent[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter(
      (e): e is InvoiceEvent => e && typeof e.at === "string" && typeof e.by === "string" && ACTIONS.includes(e.action),
    );
  } catch {
    return [];
  }
}

export function appendEvent(history: readonly InvoiceEvent[], e: InvoiceEvent): InvoiceEvent[] {
  const note = e.note?.trim().slice(0, 500);
  return [...history, { at: e.at, by: e.by.slice(0, 80), action: e.action, ...(e.status ? { status: e.status } : {}), ...(note ? { note } : {}) }];
}

/** Approving anything but a clean match needs a reason on the record. */
export function approvalNeedsNote(status: string): boolean {
  return status !== "MATCHED";
}

/** The approval that currently stands (latest approval not followed by a reopen). */
export function currentApproval(history: readonly InvoiceEvent[]): InvoiceEvent | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const e = history[i];
    if (e.action === "reopened") return null;
    if (e.action === "approved" || e.action === "auto-approved") return e;
  }
  return null;
}

/**
 * Auto-approve only a true three-way match: every line matched within tolerance,
 * billed against an order that was checked in, and not a possible duplicate.
 * Once someone has reopened an invoice by hand, it's theirs: never auto-approved again.
 */
export function canAutoApprove(args: { status: string; orderStatus: string | null; duplicate: boolean; history?: readonly InvoiceEvent[] }): boolean {
  if (args.history?.some((e) => e.action === "reopened")) return false;
  return args.status === "MATCHED" && args.orderStatus === "RECEIVED" && !args.duplicate;
}
