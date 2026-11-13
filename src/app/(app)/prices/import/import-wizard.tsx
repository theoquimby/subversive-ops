"use client";

import { Badge, Button, Card, cx, DatePicker, Field, LinkButton, Select, Table, Td, Th, Tr } from "@/components/ui";
import { FileDrop, type FileDropHandle } from "@/components/file-drop";
import type { ColumnMapping } from "@/domain/priceSheet";
import { money, signedPct } from "@/lib/format";
import type { ImportPreview } from "@/server/services/priceImport";
import { useRef, useState, useTransition } from "react";
import { commitPriceSheet, previewPriceSheet } from "../actions";

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
    });

  const commit = () =>
    start(async () => {
      if (!preview) return;
      const res = await commitPriceSheet({ supplierId, filename: fileRef.current?.file?.name ?? "upload", effectiveDate, mapping: mapping as ColumnMapping, rows: preview.rows });
      setDone(res);
    });

  if (done) {
    return (
      <Card className="max-w-xl p-6">
        <div className="text-base font-semibold">Prices updated</div>
        <p className="mt-1 text-sm text-muted">
          {done.priceChanges} price change{done.priceChanges === 1 ? "" : "s"} and {done.newProducts} new product{done.newProducts === 1 ? "" : "s"}. Plate costs are already recalculated.
        </p>
        <div className="mt-5 flex gap-2">
          <LinkButton href="/menu" variant="primary">See menu costs</LinkButton>
          {done.newProducts > 0 && <LinkButton href="/prices?filter=unlinked">Link new products</LinkButton>}
        </div>
      </Card>
    );
  }

  const d = preview?.diff;
  return (
    <div className="space-y-6">
      <Card className="p-5">
        <div className="grid gap-4 sm:grid-cols-[1fr_1.4fr_12rem_auto] sm:items-end">
          <Field label="Supplier">
            <Select value={supplierId} onChange={(e) => { setSupplierId(e.target.value); setPreview(null); }}>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="File (.xlsx or .csv)">
            <FileDrop ref={fileRef} accept=".csv,.xlsx,.xls" hint="Excel or CSV, as downloaded" onFile={() => setPreview(null)} />
          </Field>
          <Field label="Prices effective">
            <DatePicker value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} aria-label="Prices effective" />
          </Field>
          <Button variant="primary" onClick={() => runPreview()} disabled={pending}>{pending && !preview ? "Reading…" : "Preview"}</Button>
        </div>
        {error && <p className="mt-3 text-sm text-bad">{error}</p>}
      </Card>

      {preview && (
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Columns</h2>
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
        </Card>
      )}

      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Count label="Price changes" n={d.changed.length} tone={d.changed.length ? "warn" : undefined} />
            <Count label="New products" n={d.newProducts.length} />
            <Count label="Unchanged" n={d.unchanged.length} />
            <Count label="Rows skipped" n={preview!.errors.length} tone={preview!.errors.length ? "bad" : undefined} />
          </div>

          {d.changed.length > 0 && (
            <div>
              <h2 className="mb-2 text-sm font-semibold">Price changes</h2>
              <Table>
                <thead><tr><Th>Item</Th><Th align="right">Was</Th><Th align="right">Now</Th><Th align="right">Change</Th></tr></thead>
                <tbody>
                  {d.changed.map((c) => (
                    <Tr key={c.row.sku}>
                      <Td><div className="font-medium">{c.row.description}</div><div className="text-xs text-muted">#{c.row.sku} {c.row.packText && `· ${c.row.packText}`}</div></Td>
                      <Td align="right" className="text-muted">{money(c.oldPrice)}</Td>
                      <Td align="right">{money(c.row.price)}</Td>
                      <Td align="right"><Badge tone={c.changePct > 0 ? "bad" : "good"}>{signedPct(c.changePct)}</Badge></Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}

          {d.newProducts.length > 0 && (
            <details className="group">
              <summary className="cursor-pointer text-sm font-semibold">New products <span className="num font-normal text-muted">{d.newProducts.length}</span></summary>
              <Table className="mt-2">
                <tbody>{d.newProducts.slice(0, 200).map((r) => <Tr key={r.sku}><Td>{r.description}<span className="ml-2 text-xs text-muted">#{r.sku}</span></Td><Td align="right">{money(r.price)}</Td></Tr>)}</tbody>
              </Table>
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
            <span className="text-sm text-muted">{preview!.rows.length} rows ready</span>
            <Button variant="primary" onClick={commit} disabled={pending || preview!.rows.length === 0}>{pending ? "Saving…" : "Save prices"}</Button>
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
