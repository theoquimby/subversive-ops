"use client";

import { FileDrop } from "@/components/file-drop";
import { GridCell } from "@/components/grid";
import { Button, Card, cx, DatePicker, Field, Input, Select } from "@/components/ui";
import { parsePastedLines, pickOrder } from "@/domain/invoiceMatch";
import { money, shortDate } from "@/lib/format";
import { FileText, Loader2, Plus, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { readInvoice, saveNewInvoice } from "../actions";
import { prepareUpload } from "../compress";

interface Order { id: string; supplierId: string; status: string; deliveryDate: string; invoiced: boolean; lineCount: number }
interface Row { key: number; sku: string; description: string; qty: string; unitPrice: string }

// Initial rows get fixed keys so server and client render the same markup.
let nextKey = 1000;
const blank = (): Row => ({ key: nextKey++, sku: "", description: "", qty: "", unitPrice: "" });
const blanks = (n: number) => Array.from({ length: n }, blank);
const isBlank = (r: Row) => !r.sku && !r.description && !r.qty && !r.unitPrice;
const toNum = (s: string) => (s.trim() === "" ? NaN : Number(s.replace(/[$,]/g, "")));

export function NewInvoice({ suppliers, orders, today, canRead, initialSupplierId, initialOrderId }: { suppliers: { id: string; name: string }[]; orders: Order[]; today: string; canRead: boolean; initialSupplierId: string | null; initialOrderId: string | null }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState(initialSupplierId ?? "");
  const [orderId, setOrderId] = useState(initialOrderId ?? "");
  const [orderTouched, setOrderTouched] = useState(Boolean(initialOrderId));
  const [number, setNumber] = useState("");
  const [date, setDate] = useState(today);
  const [total, setTotal] = useState("");
  const [rows, setRows] = useState<Row[]>(() => Array.from({ length: 6 }, (_, i) => ({ ...blank(), key: i + 1 })));
  const [extracted, setExtracted] = useState(false);
  const [reading, setReading] = useState(false);
  const [readNote, setReadNote] = useState<string | null>(null);
  const [error, setError] = useState<{ text: string; duplicateId?: string } | null>(null);
  const [saving, start] = useTransition();
  const readSeq = useRef(0);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  // Auto-pick the likely order whenever the supplier (or date) changes, unless someone chose one.
  useEffect(() => {
    if (orderTouched || !supplierId) return;
    setOrderId(pickOrder(orders, supplierId, date)?.id ?? "");
  }, [supplierId, date, orders, orderTouched]);

  const supplierOrders = useMemo(() => orders.filter((o) => o.supplierId === supplierId), [orders, supplierId]);

  const onFile = async (f: File | null) => {
    setError(null);
    setReadNote(null);
    if (!f) { setFile(null); setPreview(null); return; }
    const ready = await prepareUpload(f);
    if ("error" in ready) { setError({ text: ready.error }); return; }
    setFile(ready);
    setPreview(ready.type === "application/pdf" ? null : URL.createObjectURL(ready));
    if (!canRead) return;
    const seq = ++readSeq.current;
    setReading(true);
    const fd = new FormData();
    fd.set("file", ready);
    const res = await readInvoice(fd).catch(() => ({ error: "Couldn't read that just now. Enter it by hand below." }));
    if (seq !== readSeq.current) return;
    setReading(false);
    if ("error" in res) { setReadNote(res.error ?? null); return; }
    const d = res.data;
    if (d.supplierId) { setSupplierId(d.supplierId); setOrderTouched(Boolean(d.orderId)); if (d.orderId) setOrderId(d.orderId); }
    if (d.invoiceNumber) setNumber(d.invoiceNumber);
    if (d.invoiceDate) setDate(d.invoiceDate);
    if (d.total != null) setTotal(d.total.toFixed(2));
    if (d.lines.length) {
      setRows([...d.lines.map((l) => ({ key: nextKey++, sku: l.sku ?? "", description: l.description, qty: String(l.qty), unitPrice: l.unitPrice.toFixed(2) })), ...blanks(2)]);
      setExtracted(true);
    }
    setReadNote(`Read ${d.lines.length} line${d.lines.length === 1 ? "" : "s"}${d.supplierName && !d.supplierId ? ` from “${d.supplierName}” — pick the supplier` : ""}. Check them against the paper before saving.`);
  };

  const setCell = (key: number, field: keyof Omit<Row, "key">, value: string) =>
    setRows((rs) => {
      const next = rs.map((r) => (r.key === key ? { ...r, [field]: value } : r));
      // Always keep a couple of empty rows at the bottom to type into.
      const trailing = next.length - 1 - next.findLastIndex((r) => !isBlank(r));
      return trailing < 2 ? [...next, ...blanks(2 - trailing)] : next;
    });

  // Pasting several columns from a spreadsheet fills whole rows (single columns are handled by GridCell).
  const onPasteCapture = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData("text/plain");
    if (!text.includes("\t")) return;
    const parsed = parsePastedLines(text);
    if (!parsed.length) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.target as HTMLElement;
    const startKey = Number(el.closest("tr")?.dataset.key);
    setRows((rs) => {
      let at = rs.findIndex((r) => r.key === startKey);
      if (at < 0) at = rs.findIndex(isBlank);
      if (at < 0) at = rs.length;
      const incoming = parsed.map((p) => ({ key: nextKey++, sku: p.sku ?? "", description: p.description, qty: String(p.qty), unitPrice: p.unitPrice.toFixed(2) }));
      const kept = [...rs.slice(0, at), ...incoming, ...rs.slice(at)].filter((r) => !isBlank(r));
      return [...kept, ...blanks(2)];
    });
  };

  const filled = rows.filter((r) => !isBlank(r));
  const linesTotal = filled.reduce((s, r) => s + (Number.isFinite(toNum(r.qty)) ? toNum(r.qty) : 0) * (Number.isFinite(toNum(r.unitPrice)) ? toNum(r.unitPrice) : 0), 0);
  const totalN = toNum(total);
  const gap = Number.isFinite(totalN) ? Math.round((totalN - linesTotal) * 100) / 100 : null;
  const badRow = filled.find((r) => !Number.isFinite(toNum(r.qty)) || !Number.isFinite(toNum(r.unitPrice)));

  const save = () => {
    setError(null);
    if (!supplierId) return setError({ text: "Choose the supplier." });
    if (badRow) return setError({ text: `Add a quantity and unit price for “${badRow.description || badRow.sku || "a line"}”.` });
    if (Number.isFinite(totalN) === false && total.trim()) return setError({ text: "The invoice total isn't a number." });
    const fd = new FormData();
    fd.set("data", JSON.stringify({
      supplierId,
      orderId: orderId || null,
      invoiceNumber: number.trim() || null,
      invoiceDate: date,
      total: Number.isFinite(totalN) ? totalN : null,
      extractedBy: extracted ? "claude" : "manual",
      lines: filled.map((r) => ({ sku: r.sku.trim() || null, description: r.description.trim(), qty: toNum(r.qty), unitPrice: toNum(r.unitPrice) })),
    }));
    if (file) fd.set("file", file);
    start(async () => {
      const res = await saveNewInvoice(fd);
      if (res && "error" in res) setError({ text: res.error ?? "Couldn't save.", duplicateId: "duplicateId" in res ? (res.duplicateId as string) : undefined });
    });
  };

  return (
    <div className="pb-24">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* Photo / file */}
        <div className="space-y-3">
          <div className="sm:hidden">
            <FileDrop accept="image/*" capture hint="Take a photo with the camera" onFile={onFile} />
          </div>
          <FileDrop accept="image/*,application/pdf" hint="Photo or PDF of the invoice, up to 8 MB" onFile={onFile} />
          {preview ? (
            <Card className="relative overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview} alt="Invoice photo" className="max-h-[28rem] w-full object-contain bg-surface-2" />
              {reading && <ReadingOverlay />}
            </Card>
          ) : file ? (
            <Card className="relative flex items-center gap-3 p-4 text-sm"><FileText className="size-5 text-muted" />{file.name}{reading && <ReadingOverlay />}</Card>
          ) : null}
          {!canRead ? (
            <Card className="flex gap-3 p-4 text-sm text-ink-2">
              <Sparkles className="mt-0.5 size-4 shrink-0 text-muted" />
              <div><span className="font-medium text-ink">Automatic reading turns on once the Claude API key is added.</span> Until then, attach the photo for the record and type or paste the lines.</div>
            </Card>
          ) : readNote ? (
            <Card className="flex gap-3 p-4 text-sm text-ink-2"><Sparkles className="mt-0.5 size-4 shrink-0 text-muted" />{readNote}</Card>
          ) : null}
        </div>

        {/* Header */}
        <Card className="h-fit p-4 sm:p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Supplier">
              <Select value={supplierId} onChange={(e) => { setSupplierId(e.target.value); setOrderTouched(false); }} options={suppliers.map((s) => ({ value: s.id, label: s.name }))} placeholder="Choose supplier…" aria-label="Supplier" />
            </Field>
            <Field label="Order" hint={supplierId && !supplierOrders.length ? "No sent or received orders for this supplier" : undefined}>
              <Select
                value={orderId}
                onChange={(e) => { setOrderId(e.target.value); setOrderTouched(true); }}
                disabled={!supplierId}
                aria-label="Order"
                options={[{ value: "", label: "No order" }, ...supplierOrders.map((o) => ({ value: o.id, label: `Delivery ${shortDate(o.deliveryDate)}`, hint: `${o.status === "RECEIVED" ? "Received" : "Sent"} · ${o.lineCount} items${o.invoiced ? " · invoiced" : ""}` }))]}
              />
            </Field>
            <Field label="Invoice number">
              <Input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="e.g. 448210" autoComplete="off" />
            </Field>
            <Field label="Invoice date">
              <DatePicker value={date} onChange={(e) => setDate(e.target.value)} aria-label="Invoice date" />
            </Field>
            <Field label="Invoice total" hint={gap != null && filled.length > 0 && Math.abs(gap) > 0.05 ? <span className="text-warn">Lines add up to {money(linesTotal)} ({gap > 0 ? `${money(gap)} short` : `${money(-gap)} over`})</span> : undefined}>
              <div className="relative">
                <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted">$</span>
                <Input value={total} onChange={(e) => setTotal(e.target.value)} inputMode="decimal" placeholder="0.00" className="num pl-6" />
              </div>
            </Field>
          </div>
        </Card>
      </div>

      {/* Lines */}
      <div className="mt-8 mb-3 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-[0.95rem] font-semibold">Lines</h2>
          <p className="mt-0.5 text-sm text-muted">Type, or paste rows from a spreadsheet (item #, description, qty, unit price).</p>
        </div>
      </div>
      <Card className="overflow-x-auto" onPasteCapture={onPasteCapture}>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-[0.75rem] text-muted">
              <th className="hidden w-28 border-b border-border px-3 py-2.5 text-left font-medium sm:table-cell">Item #</th>
              <th className="border-b border-border px-3 py-2.5 text-left font-medium">Description</th>
              <th className="w-20 border-b border-border px-3 py-2.5 text-right font-medium sm:w-24">Qty</th>
              <th className="w-24 border-b border-border px-3 py-2.5 text-right font-medium sm:w-28">Unit price</th>
              <th className="hidden w-28 border-b border-border px-3 py-2.5 text-right font-medium sm:table-cell">Line total</th>
              <th className="w-10 border-b border-border" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const lt = toNum(r.qty) * toNum(r.unitPrice);
              return (
                <tr key={r.key} data-key={r.key} className="border-b border-border last:border-0">
                  <td className="hidden px-1.5 py-1 sm:table-cell"><GridCell grid="new-lines" col="sku" value={r.sku} ariaLabel="Item number" placeholder="—" onSave={async (v) => setCell(r.key, "sku", v)} /></td>
                  <td className="px-1.5 py-1"><GridCell grid="new-lines" col="description" value={r.description} ariaLabel="Description" placeholder={isBlank(r) ? "Add a line…" : ""} onSave={async (v) => setCell(r.key, "description", v)} /></td>
                  <td className="px-1.5 py-1"><GridCell grid="new-lines" col="qty" type="number" value={r.qty} ariaLabel="Quantity" onSave={async (v) => setCell(r.key, "qty", v)} /></td>
                  <td className="px-1.5 py-1"><GridCell grid="new-lines" col="unitPrice" type="number" prefix="$" decimals={2} value={r.unitPrice} ariaLabel="Unit price" onSave={async (v) => setCell(r.key, "unitPrice", v)} /></td>
                  <td className="num hidden px-3 py-1 text-right text-ink-2 sm:table-cell">{Number.isFinite(lt) ? money(lt) : ""}</td>
                  <td className="px-1 py-1 text-right">
                    {!isBlank(r) && (
                      <button type="button" aria-label="Remove line" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} className="grid size-10 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink sm:size-8"><X className="size-4" /></button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      <div className="mt-2 flex items-center justify-between">
        <Button type="button" variant="ghost" size="sm" onClick={() => setRows((rs) => [...rs, ...blanks(5)])}><Plus className="size-4" />More rows</Button>
        <div className="text-sm text-muted">{filled.length} line{filled.length === 1 ? "" : "s"} · <span className="num font-medium text-ink">{money(linesTotal)}</span></div>
      </div>

      <div className="fixed inset-x-0 bottom-[var(--tabbar)] z-30 border-t border-border bg-surface/95 backdrop-blur lg:left-60">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-end gap-3 px-4 py-3 sm:px-8">
          {error && (
            <span className="mr-auto text-sm text-bad">
              {error.text} {error.duplicateId && <Link href={`/invoices/${error.duplicateId}`} className="underline">Open it</Link>}
            </span>
          )}
          <Button variant="primary" size="lg" disabled={saving || reading} onClick={save} className={cx("min-w-40", saving && "opacity-70")}>
            {saving ? "Saving…" : reading ? "Reading…" : "Save and check"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ReadingOverlay() {
  return (
    <div className="absolute inset-0 grid place-items-center bg-surface/70 backdrop-blur-[1px]">
      <div className="flex items-center gap-2 rounded-lg bg-surface px-3 py-2 text-sm font-medium shadow"><Loader2 className="size-4 animate-spin" />Reading the invoice…</div>
    </div>
  );
}
