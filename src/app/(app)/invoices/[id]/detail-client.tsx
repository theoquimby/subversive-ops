"use client";

import { useConfirm } from "@/components/dialog";
import { GridCell, GridSelect } from "@/components/grid";
import { Badge, Button, Card, cx, DatePicker, Input, LinkButton, Textarea, type Tone } from "@/components/ui";
import { money, qty as fmtQty, shortDate } from "@/lib/format";
import { Check, Copy, Mail, Plus, RotateCcw, Send, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { addLines, approveInvoice, deleteInvoice, deleteLine, reopenInvoice, sendCredit, updateHeader, updateLine, updatePrices } from "../actions";

type Opt = { value: string; label: string; hint?: string };

// ---- Header fields ---------------------------------------------------------------

export function HeaderFields({ id, locked, invoiceNumber, invoiceDate, total, orderId, orderOptions }: { id: string; locked: boolean; invoiceNumber: string | null; invoiceDate: string; total: number | null; orderId: string; orderOptions: Opt[] }) {
  const [date, setDate] = useState(invoiceDate);
  const [, start] = useTransition();
  useEffect(() => setDate(invoiceDate), [invoiceDate]);
  if (locked) {
    return (
      <Card className="grid grid-cols-2 gap-4 p-4 text-sm sm:grid-cols-4">
        <Item label="Number">{invoiceNumber ?? "—"}</Item>
        <Item label="Date">{shortDate(invoiceDate)}</Item>
        <Item label="Total">{money(total)}</Item>
        <Item label="Order">{orderOptions.find((o) => o.value === orderId)?.label ?? "No order"}</Item>
      </Card>
    );
  }
  return (
    <Card className="grid grid-cols-2 gap-x-3 gap-y-3 p-3 sm:grid-cols-[1fr_1.5fr_1fr_1.3fr] sm:p-4">
      <Item label="Number"><GridCell grid="inv-head" col="number" value={invoiceNumber} placeholder="—" ariaLabel="Invoice number" onSave={(v) => updateHeader(id, { field: "invoiceNumber", value: v })} className="-mx-2" /></Item>
      <Item label="Date">
        <DatePicker value={date} aria-label="Invoice date" className="h-10 sm:h-8" onChange={(e) => { const v = e.target.value; setDate(v); start(async () => { await updateHeader(id, { field: "invoiceDate", value: v }); }); }} />
      </Item>
      <Item label="Total"><GridCell grid="inv-head" col="total" type="number" prefix="$" decimals={2} align="left" value={total} placeholder="0.00" ariaLabel="Invoice total" onSave={(v) => updateHeader(id, { field: "total", value: v })} className="-mx-2" /></Item>
      <Item label="Order"><GridSelect value={orderId} options={orderOptions} ariaLabel="Linked order" onSave={(v) => updateHeader(id, { field: "orderId", value: v })} className="-mx-2" /></Item>
    </Card>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mb-0.5 text-xs text-muted">{label}</div>
      <div className="num">{children}</div>
    </div>
  );
}

// ---- Lines ---------------------------------------------------------------------

export interface LineVM {
  id: string;
  sku: string | null;
  description: string;
  qty: number;
  unitPrice: number;
  expectedQty: number | null;
  expectedPrice: number | null;
  status: string;
  productId: string | null;
  productName: string | null;
  unit: string | null;
}

const LINE_STATUS: Record<string, { label: string; tone: Tone }> = {
  OK: { label: "OK", tone: "good" },
  PRICE: { label: "Price", tone: "warn" },
  QTY: { label: "Qty", tone: "warn" },
  PRICE_QTY: { label: "Price + qty", tone: "bad" },
  UNMATCHED: { label: "No match", tone: "neutral" },
};

/** Mobile: item on its own row, then status · qty · price · remove. Desktop: one row. */
const COLS = "grid grid-cols-[minmax(0,1fr)_5.5rem_7rem_2.5rem] gap-x-1 px-1.5 sm:grid-cols-[minmax(0,1fr)_5.5rem_7rem_6rem_2.5rem]";

const off = (a: number, b: number | null, tol = 0.0001) => b != null && Math.abs(a - b) > tol;

export function LinesGrid({ invoiceId, locked, lines, products, hasOrder }: { invoiceId: string; locked: boolean; lines: LineVM[]; products: Opt[]; hasOrder: boolean }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const productOptions = [{ value: "", label: "Pick the product…" }, ...products];

  const onPasteCapture = (e: React.ClipboardEvent) => {
    if (locked) return;
    const text = e.clipboardData.getData("text/plain");
    if (!text.includes("\t")) return; // single column: GridCell fills down
    e.preventDefault();
    e.stopPropagation();
    start(async () => {
      const res = await addLines(invoiceId, text);
      setNote(res && "error" in res ? res.error ?? null : `Added ${res?.added ?? 0} line${res?.added === 1 ? "" : "s"} from the paste.`);
      router.refresh();
    });
  };

  return (
    <div>
      <div className="mb-2 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-[0.95rem] font-semibold">Lines</h2>
          <p className="mt-0.5 text-sm text-muted">{hasOrder ? "Expected = what was received (or ordered) at the order price." : "No order linked — prices are checked against the last price on record."}</p>
        </div>
      </div>
      <Card onPasteCapture={onPasteCapture}>
        <div className={cx(COLS, "hidden border-b border-border py-2.5 text-[0.75rem] font-medium text-muted sm:grid")}>
          <div className="px-2">Item</div>
          <div className="px-2 text-right">Qty</div>
          <div className="px-2 text-right">Unit price</div>
          <div className="px-2">Check</div>
          <div />
        </div>
        {lines.map((l) => {
          const st = LINE_STATUS[l.status] ?? LINE_STATUS.OK;
          const qtyOff = off(l.qty, l.expectedQty);
          const priceOff = off(l.unitPrice, l.expectedPrice, 0.005);
          const badge = <Badge tone={st.tone}>{st.label}</Badge>;
          return (
            <div key={l.id} className={cx(COLS, "items-start border-b border-border py-1.5 last:border-0", l.status !== "OK" && "bg-surface-2/40")}>
              <div className="col-span-4 min-w-0 sm:col-span-1">
                {locked ? (
                  <div className="px-2 py-1">
                    <div className="font-medium">{l.productName ?? l.description}</div>
                    <div className="text-xs text-muted">{l.sku && `#${l.sku} · `}{l.description}</div>
                  </div>
                ) : (
                  <>
                    <GridCell grid={`lines-${invoiceId}`} col="description" value={l.description} ariaLabel="Description as billed" placeholder="Description" onSave={(v) => updateLine(l.id, { field: "description", value: v })} className="font-medium" />
                    <div className="flex min-w-0 items-center gap-1">
                      <GridCell grid={`lines-${invoiceId}`} col="sku" value={l.sku} ariaLabel="Item number" placeholder="Item #" onSave={(v) => updateLine(l.id, { field: "sku", value: v })} className="w-20 shrink-0 [&_input]:text-xs [&_input]:text-muted" />
                      <div className="min-w-0 flex-1">
                        <GridSelect value={l.productId ?? ""} options={productOptions} ariaLabel="Matched product" onSave={(v) => updateLine(l.id, { field: "product", value: v })} className={cx("w-full text-xs", !l.productId && "text-warn")} />
                      </div>
                    </div>
                  </>
                )}
              </div>
              <div className="self-center px-2 sm:hidden">{badge}</div>
              <div className="text-right">
                {locked ? <div className="num px-2 py-1">{fmtQty(l.qty)}</div> : <GridCell grid={`lines-${invoiceId}`} col="qty" type="number" value={l.qty} ariaLabel="Quantity billed" onSave={(v) => updateLine(l.id, { field: "qty", value: v })} />}
                {l.expectedQty != null && <div className={cx("num px-2 text-xs whitespace-nowrap", qtyOff ? "font-medium text-warn" : "text-muted")}>exp {fmtQty(l.expectedQty)}</div>}
              </div>
              <div className="text-right">
                {locked ? <div className="num px-2 py-1">{money(l.unitPrice)}</div> : <GridCell grid={`lines-${invoiceId}`} col="unitPrice" type="number" prefix="$" decimals={2} value={l.unitPrice} ariaLabel="Unit price billed" onSave={(v) => updateLine(l.id, { field: "unitPrice", value: v })} />}
                {l.expectedPrice != null && <div className={cx("num px-2 text-xs whitespace-nowrap", priceOff ? "font-medium text-warn" : "text-muted")}>exp {money(l.expectedPrice)}</div>}
              </div>
              <div className="hidden px-2 pt-1.5 sm:block">{badge}</div>
              <div className="flex justify-end">
                {!locked && (
                  <button
                    type="button"
                    aria-label="Remove line"
                    onClick={async () => { if (await confirm({ title: "Remove this line?", body: l.description || "Empty line", confirmLabel: "Remove", danger: true })) start(async () => { await deleteLine(l.id); router.refresh(); }); }}
                    className="grid size-10 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink sm:size-8"
                  >
                    <X className="size-4" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {lines.length === 0 && <div className="px-4 py-8 text-center text-sm text-muted">No lines yet. Add one, or paste rows copied from a spreadsheet (item #, description, qty, unit price).</div>}
      </Card>
      {!locked && (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => start(async () => { await addLines(invoiceId); router.refresh(); })}><Plus className="size-4" />Add line</Button>
          <span className="text-xs text-muted">{note ?? "Tip: paste several rows from a spreadsheet anywhere in the table."}</span>
        </div>
      )}
    </div>
  );
}

// ---- Actions -------------------------------------------------------------------

interface Credit { subject: string; body: string; total: number; count: number; email: string | null; /** Email (Resend) is set up, so we can send it from here. */ canSend: boolean; lastSent: string | null }

export function InvoiceActions({ id, status, statusLabel, flagged, priceChanges, invoiceDate, credit }: { id: string; status: string; statusLabel: string; flagged: number; priceChanges: number; invoiceDate: string; credit: Credit | null }) {
  const confirm = useConfirm();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [showCredit, setShowCredit] = useState(false);
  const approved = status === "APPROVED";

  const [approving, setApproving] = useState(false);
  const approve = () => {
    if (status !== "MATCHED") {
      setApproving(true);
      return;
    }
    start(async () => {
      await approveInvoice(id);
      router.refresh();
    });
  };

  const prices = async () => {
    const ok = await confirm({
      title: `Update ${priceChanges} price${priceChanges === 1 ? "" : "s"}?`,
      body: `Records the billed prices as of ${shortDate(invoiceDate)}. Recipe and menu costs pick them up straight away.`,
      confirmLabel: "Update prices",
    });
    if (!ok) return;
    start(async () => {
      const res = await updatePrices(id);
      setMsg(`${res.updated} price${res.updated === 1 ? "" : "s"} updated`);
      router.refresh();
    });
  };

  return (
    <>
      {msg && <span className="inline-flex items-center gap-1 text-sm text-good"><Check className="size-4" />{msg}</span>}
      {credit && <Button onClick={() => setShowCredit(true)}><Mail className="size-4" />Credit request</Button>}
      {priceChanges > 0 && <Button onClick={prices} disabled={pending}>Update {priceChanges} price{priceChanges === 1 ? "" : "s"}</Button>}
      {approved ? (
        <Button variant="ghost" disabled={pending} onClick={() => start(async () => { await reopenInvoice(id); router.refresh(); })}><RotateCcw className="size-4" />Reopen</Button>
      ) : (
        <Button variant="primary" disabled={pending} onClick={approve}><Check className="size-4" />Approve</Button>
      )}
      {showCredit && credit && <CreditSheet id={id} credit={credit} onClose={() => setShowCredit(false)} />}
      {approving && <ApproveSheet id={id} statusLabel={statusLabel} flagged={flagged} credit={credit} onClose={() => setApproving(false)} />}
    </>
  );
}

/** Approving with open issues: the note is required and stays in the invoice history. */
function ApproveSheet({ id, statusLabel, flagged, credit, onClose }: { id: string; statusLabel: string; flagged: number; credit: Credit | null; onClose: () => void }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const submit = () =>
    start(async () => {
      const res = await approveInvoice(id, note);
      if (res?.error) return setError(res.error);
      onClose();
      router.refresh();
    });
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/30 p-3 backdrop-blur-[2px] sm:items-center" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Approve with open issues" onMouseDown={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-2xl">
        <div className="text-base font-semibold">Approve with open issues?</div>
        <p className="mt-1.5 text-sm text-muted">
          This invoice is marked <b className="text-ink-2">{statusLabel.toLowerCase()}</b>
          {flagged > 0 && <> with {flagged} line{flagged === 1 ? "" : "s"} that don&apos;t match</>}.
          {credit && <> You may be owed {money(credit.total)}.</>} Your name and note go on the record.
        </p>
        <Textarea
          autoFocus
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && note.trim()) submit(); }}
          placeholder="Why it's OK, e.g. rep confirmed new price, credit requested"
          aria-label="Approval note"
          maxLength={500}
          rows={3}
          className="mt-4"
        />
        {error && <p className="mt-2 text-sm text-bad">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={pending || !note.trim()} onClick={submit}><Check className="size-4" />Approve anyway</Button>
        </div>
      </div>
    </div>
  );
}

const ACTION_LABEL: Record<string, string> = { approved: "Approved", "auto-approved": "Auto-approved", reopened: "Reopened", "prices-updated": "Prices updated", "credit-requested": "Credit requested", "sent-to-quickbooks": "Sent to QuickBooks" };

/** The approval history, oldest first. Nothing in it is ever removed. */
export function InvoiceHistory({ events }: { events: { at: string; when: string; by: string; action: string; status?: string; statusLabel?: string; note?: string }[] }) {
  if (events.length === 0) return null;
  return (
    <div>
      <h2 className="mb-2 text-[0.95rem] font-semibold">History</h2>
      <Card className="divide-y divide-border text-sm">
        {events.map((e, i) => (
          <div key={`${e.at}-${i}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-4 py-2.5">
            <span className="font-medium">{ACTION_LABEL[e.action] ?? e.action}</span>
            {e.statusLabel && e.action !== "reopened" && e.status !== "MATCHED" && <Badge tone="warn">was {e.statusLabel.toLowerCase()}</Badge>}
            <span className="text-muted">by {e.by === "auto" ? "auto-approve" : e.by} · {e.when}</span>
            {e.note && <div className="w-full text-ink-2">{e.note}</div>}
          </div>
        ))}
      </Card>
    </div>
  );
}

function CreditSheet({ id, credit, onClose }: { id: string; credit: Credit; onClose: () => void }) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [to, setTo] = useState(credit.email ?? "");
  const [result, setResult] = useState<{ error?: string; ok?: string } | null>(null);
  const [sending, start] = useTransition();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const mailto = `mailto:${to.trim()}?subject=${encodeURIComponent(credit.subject)}&body=${encodeURIComponent(credit.body)}`;
  const send = () =>
    start(async () => {
      const r = await sendCredit(id, to, false);
      setResult(r);
      if (r.ok) router.refresh();
    });
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/30 p-3 backdrop-blur-[2px] sm:items-center" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Credit request" onMouseDown={(e) => e.stopPropagation()} className="flex max-h-[90dvh] w-full max-w-xl flex-col rounded-2xl border border-border bg-surface shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <div className="text-base font-semibold">Credit request</div>
            <div className="mt-0.5 text-sm text-muted">{credit.count} line{credit.count === 1 ? "" : "s"} · <span className="num font-medium text-ink">{money(credit.total)}</span>{credit.lastSent && <> · {credit.lastSent}</>}</div>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="grid size-9 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink"><X className="size-4" /></button>
        </div>
        <div className="border-b border-border px-5 py-3">
          <label className="flex items-center gap-3 text-sm">
            <span className="shrink-0 text-muted">To</span>
            <Input type="email" value={to} onChange={(e) => { setTo(e.target.value); setResult(null); }} placeholder="supplier@example.com" aria-label="Supplier email" className="min-w-0 flex-1" />
          </label>
          {!credit.email && <p className="mt-1.5 text-xs text-muted">No email on file for this supplier. Whatever you send to is saved for next time.</p>}
        </div>
        <div className="min-h-0 overflow-y-auto px-5 py-4">
          <div className="mb-2 text-xs text-muted">Subject: <span className="text-ink-2">{credit.subject}</span></div>
          <pre className="font-sans text-sm leading-relaxed whitespace-pre-wrap text-ink">{credit.body}</pre>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">
          {result && <span className={cx("mr-auto text-sm", result.error ? "text-bad" : "text-good")}>{result.error ?? result.ok}</span>}
          {!result && !credit.canSend && <span className="mr-auto text-xs text-muted">Sending from here turns on once email is set up.</span>}
          <Button onClick={async () => { await navigator.clipboard.writeText(`Subject: ${credit.subject}\n\n${credit.body}`); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}{copied ? "Copied" : "Copy"}
          </Button>
          {to.trim() && <LinkButton href={mailto} variant={credit.canSend ? "secondary" : "primary"}><Mail className="size-4" />Open in email</LinkButton>}
          {credit.canSend && (
            <Button variant="primary" disabled={sending || !to.trim() || Boolean(result?.ok)} onClick={send}>
              {result?.ok ? <Check className="size-4" /> : <Send className="size-4" />}{sending ? "Sending…" : result?.ok ? "Sent" : "Send"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function DeleteInvoice({ id }: { id: string }) {
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="danger"
      size="sm"
      disabled={pending}
      onClick={async () => { if (await confirm({ title: "Delete this invoice?", body: "The photo and lines are removed. Prices already updated from it stay.", confirmLabel: "Delete", danger: true })) start(async () => { await deleteInvoice(id); }); }}
    >
      <Trash2 className="size-4" />Delete invoice
    </Button>
  );
}
