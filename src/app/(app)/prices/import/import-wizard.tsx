"use client";

import { Badge, Button, Card, cx, DatePicker, Field, LinkButton, Select, Table, Td, Th, Tr } from "@/components/ui";
import { Checkbox } from "@/components/data-table";
import { FileDrop, type FileDropHandle } from "@/components/file-drop";
import { looksLikeMisread, MISREAD_CHANGE, type ColumnMapping } from "@/domain/priceSheet";
import { money, signedPct } from "@/lib/format";
import type { ImportPreview } from "@/server/services/priceImport";
import { useRef, useState, useTransition } from "react";
import { commitPriceSheet, previewPriceSheet } from "../actions";
import { HelpTip, HelpZone } from "@/components/help";

const FIELDS: { key: keyof ColumnMapping; label: string; required: boolean }[] = [
  { key: "sku", label: "Item number", required: true },
  { key: "description", label: "Description", required: true },
  { key: "price", label: "Price", required: true },
  { key: "pack", label: "Pack / size", required: false },
  { key: "unit", label: "Unit (CS / EA)", required: false },
];

export function ImportWizard({ suppliers, today }: { suppliers: { id: string; name: string; kind: string }[]; today: string }) {
  const fileRef = useRef<FileDropHandle>(null);
  const [supplierId, setSupplierId] = useState(suppliers.find((s) => s.kind === "DISTRIBUTOR")?.id ?? suppliers[0]?.id ?? "");
  const [effectiveDate, setEffectiveDate] = useState(today);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<Partial<ColumnMapping>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ newProducts: number; priceChanges: number } | null>(null);
  const [pending, start] = useTransition();
  // Rows unticked here are left out of the save (a misread price, a product you don't buy).
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const toggle = (sku: string) => setSkip((cur) => { const next = new Set(cur); if (next.has(sku)) next.delete(sku); else next.add(sku); return next; });

  const runPreview = (override?: Partial<ColumnMapping>) =>
    start(async () => {
      setError(null);
      const file = fileRef.current?.file;
      if (!file) return setError("Choose a file first.");
      const fd = new FormData();
      fd.set("file", file);
      fd.set("supplierId", supplierId);
      if (override) fd.set("mapping", JSON.stringify(override));
      const res = await previewPriceSheet(fd);
      if (res.error) return setError(res.error);
      setPreview(res.preview!);
      setMapping(res.preview!.mapping);
      setSkip(new Set());
    });

  const commit = () =>
    start(async () => {
      if (!preview) return;
      const res = await commitPriceSheet({ supplierId, filename: fileRef.current?.file?.name ?? "upload", effectiveDate, mapping: mapping as ColumnMapping, rows: preview.rows.filter((r) => !skip.has(r.sku)) });
      setDone(res);
    });

  if (done) {
    return (
      <HelpZone id="prices.import.done" className="max-w-xl"><Card className="p-6">
        <div className="text-base font-semibold">Prices updated</div>
        <p className="mt-1 text-sm text-muted">
          {done.priceChanges} price change{done.priceChanges === 1 ? "" : "s"} and {done.newProducts} new product{done.newProducts === 1 ? "" : "s"}. Plate costs are already recalculated.
        </p>
        <div className="mt-5 flex gap-2">
          <LinkButton href="/menu" variant="primary">See menu costs</LinkButton>
          {done.newProducts > 0 && <LinkButton href="/prices?filter=unlinked">Link new products</LinkButton>}
        </div>
      </Card></HelpZone>
    );
  }

  const d = preview?.diff;
  const misreads = d ? d.changed.filter((c) => looksLikeMisread(c.changePct)) : [];
  const ready = preview ? preview.rows.filter((r) => !skip.has(r.sku)).length : 0;
  return (
    <div className="space-y-6">
      <Card className="p-5">
        <div className="grid gap-4 sm:grid-cols-[1fr_1.4fr_12rem_auto] sm:items-end">
          <HelpZone id="prices.import.supplier" tour="prices.import.supplier">
          <Field label="Supplier">
            <Select value={supplierId} onChange={(e) => { setSupplierId(e.target.value); setPreview(null); }}>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          </HelpZone>
          <HelpZone id="prices.import.file" tour="prices.import.file">
          <Field label="Price sheet">
            <FileDrop ref={fileRef} accept=".csv,.xlsx,.xls,.pdf,image/*" hint="Excel or .csv from the distributor — or a PDF or photo of a paper sheet" onFile={() => setPreview(null)} />
          </Field>
          </HelpZone>
          <HelpZone id="prices.import.effective" tour="prices.import.effective">
          <Field label={<span className="inline-flex items-center gap-1.5">Prices effective <HelpTip id="prices.import.effective" /></span>}>
            <DatePicker value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} aria-label="Prices effective" />
          </Field>
          </HelpZone>
          <Button variant="primary" onClick={() => runPreview()} disabled={pending} data-tour="prices.import.preview">{pending && !preview ? "Reading…" : "Preview"}</Button>
        </div>
        {error && <p className="mt-3 text-sm text-bad">{error}</p>}
      </Card>

      {preview && (
        <HelpZone id="prices.import.columns"><Card className="p-5" data-tour="prices.import.columns">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold">Columns <HelpTip id="prices.import.columns" /></h2>
            <span className="text-xs text-muted">Remembered for this supplier next time</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-5">
            {FIELDS.map((f) => (
              <Field key={f.key} label={<>{f.label}{f.required && <span className="text-bad"> *</span>}</>}>
                <Select value={mapping[f.key] ?? ""} onChange={(e) => { const m = { ...mapping, [f.key]: e.target.value || undefined }; setMapping(m); runPreview(m); }}>
                  <option value="">—</option>
                  {preview.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </Select>
              </Field>
            ))}
          </div>
        </Card></HelpZone>
      )}

      {d && (
        <>
          <HelpZone id="prices.import.diff" tour="prices.import.diff" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Count label="Price changes" n={d.changed.length} tone={d.changed.length ? "warn" : undefined} />
            <Count label="New products" n={d.newProducts.length} />
            <Count label="Unchanged" n={d.unchanged.length} />
            <Count label="Rows skipped" n={preview!.errors.length} tone={preview!.errors.length ? "bad" : undefined} />
          </HelpZone>

          {misreads.length > 0 && (
            <p role="status" className="rounded-lg bg-warn-bg px-4 py-3 text-sm text-warn">
              {misreads.length === 1 ? "One price changed" : `${misreads.length} prices changed`} by more than {Math.round(MISREAD_CHANGE * 100)}%. That&apos;s often a misread column or a different pack size. Check {misreads.length === 1 ? "it" : "them"} below and untick any that look wrong.
            </p>
          )}

          {d.changed.length > 0 && (
            <HelpZone id="prices.import.changes">
              <h2 className="mb-2 text-sm font-semibold">Price changes</h2>
              <Table>
                <thead><tr><Th className="w-12"><span className="sr-only">Save</span></Th><Th>Item</Th><Th align="right">Was</Th><Th align="right">Now</Th><Th align="right">Change</Th></tr></thead>
                <tbody>
                  {d.changed.map((c) => {
                    const off = skip.has(c.row.sku);
                    return (
                      <Tr key={c.row.sku} className={cx(off && "opacity-50")}>
                        <Td className="w-12 px-1"><Checkbox checked={!off} onChange={() => toggle(c.row.sku)} label={`Save the new price for ${c.row.description}`} /></Td>
                        <Td><div className={cx("font-medium", off && "line-through")}>{c.row.description}</div><div className="text-xs text-muted">#{c.row.sku} {c.row.packText && `· ${c.row.packText}`}{off && " · left out"}</div></Td>
                        <Td align="right" className="text-muted">{money(c.oldPrice)}</Td>
                        <Td align="right">{money(c.row.price)}</Td>
                        <Td align="right">
                          <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
                            {looksLikeMisread(c.changePct) && <Badge tone="warn">Check this</Badge>}
                            <Badge tone={c.changePct > 0 ? "bad" : "good"}>{signedPct(c.changePct)}</Badge>
                          </span>
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            </HelpZone>
          )}

          {d.newProducts.length > 0 && (
            <details className="group">
              <summary className="cursor-pointer text-sm font-semibold">New products <span className="num font-normal text-muted">{d.newProducts.length}</span></summary>
              <Table className="mt-2">
                <tbody>{d.newProducts.slice(0, 200).map((r) => {
                  const off = skip.has(r.sku);
                  return (
                    <Tr key={r.sku} className={cx(off && "opacity-50")}>
                      <Td className="w-12 px-1"><Checkbox checked={!off} onChange={() => toggle(r.sku)} label={`Add ${r.description}`} /></Td>
                      <Td className={cx(off && "line-through")}>{r.description}<span className="ml-2 text-xs text-muted">#{r.sku}</span></Td>
                      <Td align="right">{money(r.price)}</Td>
                    </Tr>
                  );
                })}</tbody>
              </Table>
              {d.newProducts.length > 200 && <p className="mt-2 text-xs text-muted">Showing the first 200. The other {d.newProducts.length - 200} are added too.</p>}
            </details>
          )}
          {preview!.errors.length > 0 && (
            <details>
              <summary className="cursor-pointer text-sm font-semibold">Skipped rows <span className="num font-normal text-muted">{preview!.errors.length}</span></summary>
              <ul className="mt-2 space-y-1 text-sm text-muted">{preview!.errors.slice(0, 100).map((e) => <li key={e.row}>Row {e.row}: {e.message}</li>)}</ul>
            </details>
          )}
          {d.missing.length > 0 && (
            <p className="text-sm text-muted">{d.missing.length} product{d.missing.length === 1 ? " is" : "s are"} on file but not in this sheet — their last price is kept.</p>
          )}

          <div className={cx("sticky bottom-0 -mx-4 flex items-center justify-end gap-3 border-t border-border bg-bg/95 px-4 py-3 backdrop-blur sm:-mx-8 sm:px-8")}>
            <HelpZone id="prices.import.save" className="flex flex-1 items-center justify-end gap-3">
            <span className="text-sm text-muted">{ready} row{ready === 1 ? "" : "s"} ready{skip.size ? `, ${skip.size} left out` : ""}</span>
            <Button variant="primary" onClick={commit} pending={pending && !!preview} disabled={ready === 0}>{pending ? "Saving…" : "Save prices"}</Button>
            </HelpZone>
          </div>
        </>
      )}
      {preview && !preview.mappingComplete && <p className="text-sm text-warn">Pick the item number, description and price columns to continue.</p>}
    </div>
  );
}

function Count({ label, n, tone }: { label: string; n: number; tone?: "warn" | "bad" }) {
  return (
    <Card className="p-4">
      <div className="text-[0.8rem] text-muted">{label}</div>
      <div className={cx("num mt-1 text-xl font-semibold", tone === "warn" && n > 0 && "text-warn", tone === "bad" && n > 0 && "text-bad")}>{n}</div>
    </Card>
  );
}
