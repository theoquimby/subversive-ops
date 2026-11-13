"use client";

import { HelpZone } from "@/components/help";
import { GridCell } from "@/components/grid";
import { Badge, Button, Card, cx, DatePicker, Field, Input, Select } from "@/components/ui";
import { checkInvoiceMath, LINE_KIND_LABEL, type LineKind } from "@/domain/invoiceAutopilot";
import { parsePastedLines, pickOrder } from "@/domain/invoiceMatch";
import { money, shortDate } from "@/lib/format";
import { AlertTriangle, Plus, Receipt, ScrollText, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { addInvoicePage, quickAddSupplier, readInvoice, saveNewInvoice } from "../actions";
import { fitPages, PAGE_QUALITY, prepareUpload } from "../compress";
import { type Page, PagesPicker, ReadingOverlay } from "./pages-picker";

interface Order { id: string; supplierId: string; status: string; deliveryDate: string; invoiced: boolean; lineCount: number }
interface Row { key: number; sku: string; description: string; qty: string; unitPrice: string; kind?: LineKind; packText?: string | null; orderedQty?: number | null; lineTotal?: number | null }
type Mode = "invoice" | "receipt";
const MAX_PAGES = 10;

// Initial rows get fixed keys so server and client render the same markup.
let nextKey = 1000;
const blank = (): Row => ({ key: nextKey++, sku: "", description: "", qty: "", unitPrice: "" });
const blanks = (n: number) => Array.from({ length: n }, blank);
const isBlank = (r: Row) => !r.sku && !r.description && !r.qty && !r.unitPrice;
const toNum = (s: string) => (s.trim() === "" ? NaN : Number(s.replace(/[$,]/g, "")));

const NEW_SUPPLIER = "__new";

export function NewInvoice({ suppliers: initialSuppliers, orders, today, canRead, initialSupplierId, initialOrderId, initialMode = "invoice" }: { suppliers: { id: string; name: string }[]; orders: Order[]; today: string; canRead: boolean; initialSupplierId: string | null; initialOrderId: string | null; initialMode?: Mode }) {
  const router = useRouter();
  const [pages, setPages] = useState<Page[]>([]);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [dueDate, setDueDate] = useState("");
  const [payment, setPayment] = useState("");
  const [modeChosen, setModeChosen] = useState(initialMode === "receipt");
  const [preparing, setPreparing] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [suppliers, setSuppliers] = useState(initialSuppliers);
  const [supplierId, setSupplierId] = useState(initialSupplierId ?? "");
  // A supplier name read off the photo that isn't set up yet (e.g. Price Chopper).
  const [readSupplier, setReadSupplier] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [addingPending, startAdd] = useTransition();
  const addSupplier = (name: string) =>
    startAdd(async () => {
      const r = await quickAddSupplier(name);
      if (r.error || !r.supplier) return setError({ text: r.error ?? "Couldn't add that supplier." });
      const sup = r.supplier;
      setSuppliers((cur) => (cur.some((x) => x.id === sup.id) ? cur : [...cur, sup].sort((a, b) => a.name.localeCompare(b.name))));
      setSupplierId(sup.id);
      setOrderTouched(false);
      setReadSupplier(null);
      setAdding(false);
      setNewName("");
      setError(null);
    });
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

  // Auto-pick the likely order whenever the supplier (or date) changes, unless someone chose one.
  const autoOrder = useMemo(() => (orderTouched || !supplierId || mode === "receipt" ? null : pickOrder(orders, supplierId, date)?.id ?? ""), [supplierId, date, orders, orderTouched, mode]);
  const effectiveOrderId = mode === "receipt" ? "" : autoOrder ?? orderId;

  const supplierOrders = useMemo(() => orders.filter((o) => o.supplierId === supplierId), [orders, supplierId]);

  const addPages = async (incoming: File[], how: "camera" | "files") => {
    setError(null);
    setPreparing(true);
    const room = MAX_PAGES - pages.length;
    const added: Page[] = [];
    for (const f of incoming.slice(0, Math.max(0, room))) {
      const ready = await prepareUpload(f, PAGE_QUALITY);
      if ("error" in ready) { setError({ text: ready.error }); continue; }
      added.push({ key: nextKey++, file: ready, original: f });
    }
    setPreparing(false);
    if (incoming.length > room) setError({ text: `Up to ${MAX_PAGES} pages per invoice.` });
    if (!added.length) return;
    const next = [...pages, ...added];
    setPages(next);
    // Several files or a PDF at once is the whole invoice: read it straight away. Camera shots wait for "Read".
    if (canRead && (how === "files" || next.length === 1 && added[0].file.type === "application/pdf")) void read(next, modeChosen ? mode : "auto");
  };

  const read = async (list: Page[], m: Mode | "auto") => {
    if (!canRead || !list.length) return;
    setReadNote(null);
    setError(null);
    const fitted = await fitPages(list.map((p) => p.original), list.map((p) => p.file));
    if ("error" in fitted) { setReadNote(fitted.error); return; }
    const seq = ++readSeq.current;
    setReading(true);
    const fd = new FormData();
    for (const f of fitted) fd.append("file", f);
    fd.set("mode", m);
    const res = await readInvoice(fd).catch(() => ({ error: "Couldn't read that just now. Enter it by hand below." }));
    if (seq !== readSeq.current) return;
    setReading(false);
    if ("error" in res) { setReadNote(res.error ?? null); return; }
    const d = res.data;
    const nextMode: Mode = d.receipt ? "receipt" : "invoice";
    setMode(nextMode);
    if (d.supplierId) { setSupplierId(d.supplierId); setOrderTouched(Boolean(d.orderId)); if (d.orderId) setOrderId(d.orderId); }
    if (d.invoiceNumber) setNumber(d.invoiceNumber);
    if (d.invoiceDate) setDate(d.invoiceDate);
    setDueDate(d.dueDate ?? "");
    setPayment(d.paymentMethod ?? "");
    if (d.total != null) setTotal(d.total.toFixed(2));
    if (d.lines.length) {
      setRows([...d.lines.map((l) => ({ key: nextKey++, sku: l.sku ?? "", description: l.description, qty: String(l.qty), unitPrice: l.unitPrice.toFixed(2), kind: l.kind, packText: l.packText, orderedQty: l.orderedQty, lineTotal: l.lineTotal })), ...blanks(2)]);
      setExtracted(true);
    }
    setReadSupplier(d.supplierName && !d.supplierId ? d.supplierName : null);
    const what = nextMode === "receipt" ? "receipt" : "invoice";
    setReadNote(`Read ${d.lines.length} line${d.lines.length === 1 ? "" : "s"} from ${d.pages > 1 ? `${d.pages} pages` : `the ${what}`}${d.supplierName ? ` (“${d.supplierName}”)` : ""}.${d.issues.length ? "" : " The math adds up."} Check them against the paper before saving.`);
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

  const mathIssues = useMemo(() => {
    const lines = filled.map((r) => ({ description: r.description || r.sku, qty: toNum(r.qty), unitPrice: toNum(r.unitPrice), lineTotal: r.lineTotal ?? null, kind: r.kind }));
    if (lines.some((l) => !Number.isFinite(l.qty) || !Number.isFinite(l.unitPrice))) return [];
    return checkInvoiceMath({ lines, total: Number.isFinite(totalN) ? totalN : null }).issues;
  }, [filled, totalN]);
  const flaggedRows = new Set(mathIssues.filter((i) => i.lineIndex != null).map((i) => filled[i.lineIndex!]?.key));

  const pickMode = (m: Mode) => {
    setMode(m);
    setModeChosen(true);
    if (m === "receipt") { setOrderId(""); setOrderTouched(true); }
    else setOrderTouched(false);
  };

  const save = () => {
    setError(null);
    if (!supplierId) return setError({ text: mode === "receipt" ? "Choose the store (or add it)." : "Choose the supplier." });
    if (badRow) return setError({ text: `Add a quantity and unit price for “${badRow.description || badRow.sku || "a line"}”.` });
    if (Number.isFinite(totalN) === false && total.trim()) return setError({ text: "The total isn't a number." });
    const fd = new FormData();
    fd.set("data", JSON.stringify({
      supplierId,
      orderId: effectiveOrderId || null,
      invoiceNumber: number.trim() || null,
      invoiceDate: date,
      total: Number.isFinite(totalN) ? totalN : null,
      extractedBy: extracted ? "claude" : "manual",
      kind: mode,
      dueDate: dueDate || null,
      paymentMethod: mode === "receipt" ? payment.trim() || null : null,
      lines: filled.map((r) => ({ sku: r.sku.trim() || null, description: r.description.trim(), qty: toNum(r.qty), unitPrice: toNum(r.unitPrice), kind: r.kind ?? "item", packText: r.packText ?? null, orderedQty: r.orderedQty ?? null })),
    }));
    if (pages[0]) fd.set("file", pages[0].file);
    if (pages.length > 1) fd.set("more", "1");
    start(async () => {
      const res = await saveNewInvoice(fd);
      if (res && "error" in res) return setError({ text: res.error ?? "Couldn't save.", duplicateId: res.duplicateId });
      if (!res || !("id" in res)) return;
      // The other pages go up one request each, so every upload stays small.
      for (let i = 1; i < pages.length; i++) {
        setProgress(`Saving page ${i + 1} of ${pages.length}…`);
        const fp = new FormData();
        fp.set("file", pages[i].file);
        const r = await addInvoicePage(res.id, fp).catch(() => ({ error: "Couldn't save a page." }));
        if (r.error) { setProgress(null); setError({ text: `Saved, but page ${i + 1} didn't upload: ${r.error} Add it from the invoice.` }); router.push(`/invoices/${res.id}`); return; }
      }
      setProgress(null);
      router.push(`/invoices/${res.id}`);
    });
  };

  const receipt = mode === "receipt";
  const busy = reading || preparing;

  return (
    <div className="pb-24">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* Photos / file */}
        <HelpZone id="invoices.pages" className="space-y-3">
          <HelpZone id="invoices.receipt">
            <div role="radiogroup" aria-label="What is it?" className="grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1">
              {([["invoice", "Supplier invoice", ScrollText], ["receipt", "Store receipt", Receipt]] as const).map(([m, label, Icon]) => (
                <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => pickMode(m)} className={cx("flex h-10 items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition-colors", mode === m ? "bg-surface text-ink shadow-sm" : "text-ink-2 hover:text-ink")}>
                  <Icon className="size-4" />{label}
                </button>
              ))}
            </div>
          </HelpZone>
          <div className="relative">
            <PagesPicker receipt={receipt} pages={pages} max={MAX_PAGES} busy={busy || saving} onAdd={addPages} onRemove={(key) => setPages((ps) => ps.filter((p) => p.key !== key))} />
            {reading && <ReadingOverlay pages={pages.length} />}
          </div>
          {canRead && pages.length > 0 && !reading && (
            <Button type="button" variant={extracted ? "secondary" : "primary"} size="lg" className="w-full" disabled={busy || saving} onClick={() => read(pages, modeChosen ? mode : "auto")}>
              <Sparkles className="size-4" />{extracted ? "Read again" : `Read ${pages.length > 1 ? `all ${pages.length} pages` : receipt ? "the receipt" : "the invoice"}`}
            </Button>
          )}
          {!canRead ? (
            <Card className="flex gap-3 p-4 text-sm text-ink-2">
              <Sparkles className="mt-0.5 size-4 shrink-0 text-muted" />
              <div><span className="font-medium text-ink">Turn on AI features to have {receipt ? "receipts" : "invoices"} read for you</span> (Settings → Connections → AI features). Until then, add the photos for the record and type or paste the lines.</div>
            </Card>
          ) : readNote ? (
            <Card className="flex gap-3 p-4 text-sm text-ink-2"><Sparkles className="mt-0.5 size-4 shrink-0 text-muted" />{readNote}</Card>
          ) : null}
        </HelpZone>

        {/* Header */}
        <HelpZone id="invoices.new.details" className="h-fit"><Card className="p-4 sm:p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={receipt ? "Store" : "Supplier"}>
              {adding || !suppliers.length ? (
                <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); addSupplier(newName); }}>
                  <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Price Chopper" aria-label="New supplier name" className="min-w-0 flex-1" autoFocus={adding} />
                  <Button type="submit" variant="primary" disabled={addingPending || !newName.trim()}>{addingPending ? "Adding…" : "Add"}</Button>
                  {suppliers.length > 0 && <Button type="button" variant="ghost" onClick={() => { setAdding(false); setNewName(""); }}>Cancel</Button>}
                </form>
              ) : (
                <Select
                  value={supplierId}
                  onChange={(e) => {
                    if (e.target.value === NEW_SUPPLIER) { setAdding(true); return; }
                    setSupplierId(e.target.value);
                    setOrderTouched(receipt);
                  }}
                  options={[...suppliers.map((s) => ({ value: s.id, label: s.name })), { value: NEW_SUPPLIER, label: "+ Add a new supplier…", hint: "a distributor, or a store like Price Chopper" }]}
                  placeholder={receipt ? "Choose store…" : "Choose supplier…"}
                  aria-label={receipt ? "Store" : "Supplier"}
                  searchable
                />
              )}
              {readSupplier && !supplierId ? (
                <Button type="button" size="sm" variant="primary" className="mt-2" disabled={addingPending} onClick={() => addSupplier(readSupplier)}>
                  <Plus className="size-3.5" /> Add “{readSupplier}” as a {receipt ? "store" : "supplier"}
                </Button>
              ) : !adding && suppliers.length > 0 ? (
                <Button type="button" size="sm" variant="ghost" className="mt-1.5 px-1.5" onClick={() => setAdding(true)}>
                  <Plus className="size-3.5" /> Add a new {receipt ? "store" : "supplier"}
                </Button>
              ) : !suppliers.length ? (
                <p className="mt-1.5 text-xs text-muted">No suppliers yet — type the first one (a distributor or a store like Price Chopper).</p>
              ) : null}
            </Field>
            {receipt ? (
              <Field label="Paid with" hint="As printed, e.g. cash or Visa 4821">
                <Input value={payment} onChange={(e) => setPayment(e.target.value)} placeholder="Cash, card…" autoComplete="off" aria-label="Paid with" />
              </Field>
            ) : (
              <Field label="Order" hint={supplierId && !supplierOrders.length ? "No sent or received orders for this supplier" : undefined}>
                <Select
                  value={effectiveOrderId}
                  onChange={(e) => { setOrderId(e.target.value); setOrderTouched(true); }}
                  disabled={!supplierId}
                  aria-label="Order"
                  options={[{ value: "", label: "No order" }, ...supplierOrders.map((o) => ({ value: o.id, label: `Delivery ${shortDate(o.deliveryDate)}`, hint: `${o.status === "RECEIVED" ? "Received" : "Sent"} · ${o.lineCount} item${o.lineCount === 1 ? "" : "s"}${o.invoiced ? " · invoiced" : ""}` }))]}
                />
              </Field>
            )}
            <Field label={receipt ? "Receipt number (optional)" : "Invoice number"}>
              <Input value={number} onChange={(e) => setNumber(e.target.value)} placeholder={receipt ? "Not needed" : "e.g. 448210"} autoComplete="off" />
            </Field>
            <Field label={receipt ? "Date" : "Invoice date"}>
              <DatePicker value={date} onChange={(e) => setDate(e.target.value)} aria-label="Invoice date" />
            </Field>
            <Field label={receipt ? "Total paid" : "Invoice total"} hint={gap != null && filled.length > 0 && Math.abs(gap) > 0.05 ? <span className="text-warn">Lines add up to {money(linesTotal)} ({gap > 0 ? `${money(gap)} short` : `${money(-gap)} over`})</span> : undefined}>
              <div className="relative">
                <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted">$</span>
                <Input value={total} onChange={(e) => setTotal(e.target.value)} inputMode="decimal" placeholder="0.00" className="num pl-6" aria-label="Total" />
              </div>
            </Field>
            {!receipt && (
              <Field label="Due date" hint={dueDate ? undefined : "From your payment terms if left blank"}>
                <DatePicker value={dueDate} onChange={(e) => setDueDate(e.target.value)} aria-label="Due date" />
              </Field>
            )}
          </div>
        </Card></HelpZone>
      </div>

      {mathIssues.length > 0 && (
        <HelpZone id="invoices.math" className="mt-6">
          <Card className="border-warn/40 bg-warn-bg/40 p-4 text-sm">
            <div className="flex items-center gap-2 font-medium text-warn"><AlertTriangle className="size-4" />{mathIssues.length === 1 ? "One thing doesn't add up" : `${mathIssues.length} things don't add up`}</div>
            <ul className="mt-1.5 space-y-1 text-ink-2">{mathIssues.map((i, n) => <li key={n}>{i.message}</li>)}</ul>
            <p className="mt-2 text-xs text-muted">Check those against the paper. A misread number is the usual cause.</p>
          </Card>
        </HelpZone>
      )}

      {/* Lines */}
      <HelpZone id="invoices.new.lines" className="mt-8">
      <div className="mb-3 flex items-end justify-between gap-4">
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
              const flagged = flaggedRows.has(r.key);
              const short = r.orderedQty != null && Number.isFinite(toNum(r.qty)) && r.orderedQty - toNum(r.qty) > 1e-9 ? r.orderedQty - toNum(r.qty) : 0;
              return (
                <tr key={r.key} data-key={r.key} className={cx("border-b border-border last:border-0", flagged && "bg-warn-bg/40")}>
                  <td className="hidden px-1.5 py-1 sm:table-cell"><GridCell grid="new-lines" col="sku" value={r.sku} ariaLabel="Item number" placeholder="—" onSave={async (v) => setCell(r.key, "sku", v)} /></td>
                  <td className="px-1.5 py-1">
                    <GridCell grid="new-lines" col="description" value={r.description} ariaLabel="Description" placeholder={isBlank(r) ? "Add a line…" : ""} onSave={async (v) => setCell(r.key, "description", v)} />
                    {(r.kind && r.kind !== "item") || r.packText || short > 0 ? (
                      <div className="flex flex-wrap items-center gap-1.5 px-2 pb-1 text-xs text-muted">
                        {r.kind && r.kind !== "item" && <Badge>{LINE_KIND_LABEL[r.kind]}</Badge>}
                        {r.packText && <span>{r.packText}</span>}
                        {short > 0 && <Badge tone="warn">short {Number(short.toFixed(2))} of {r.orderedQty}</Badge>}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-1.5 py-1"><GridCell grid="new-lines" col="qty" type="number" value={r.qty} ariaLabel="Quantity" onSave={async (v) => setCell(r.key, "qty", v)} /></td>
                  <td className="px-1.5 py-1"><GridCell grid="new-lines" col="unitPrice" type="number" prefix="$" decimals={2} value={r.unitPrice} ariaLabel="Unit price" onSave={async (v) => setCell(r.key, "unitPrice", v)} /></td>
                  <td className={cx("num hidden px-3 py-1 text-right sm:table-cell", flagged ? "font-medium text-warn" : "text-ink-2")}>
                    {Number.isFinite(lt) ? money(lt) : ""}
                    {flagged && r.lineTotal != null && <div className="text-xs">printed {money(r.lineTotal)}</div>}
                  </td>
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
      </HelpZone>

      <div className="fixed inset-x-0 bottom-[var(--tabbar)] z-30 border-t border-border bg-surface/95 backdrop-blur lg:left-60">
        <HelpZone id="invoices.new.save" className="mx-auto flex max-w-6xl flex-wrap items-center justify-end gap-3 px-4 py-3 sm:px-8">
          {error ? (
            <span className="mr-auto text-sm text-bad">
              {error.text} {error.duplicateId && <Link href={`/invoices/${error.duplicateId}`} className="underline">Open it</Link>}
            </span>
          ) : progress ? <span className="mr-auto text-sm text-muted">{progress}</span> : null}
          <Button variant="primary" size="lg" disabled={saving || busy} onClick={save} className={cx("min-w-40", saving && "opacity-70")}>
            {saving ? "Saving…" : reading ? "Reading…" : "Save and check"}
          </Button>
        </HelpZone>
      </div>
    </div>
  );
}
