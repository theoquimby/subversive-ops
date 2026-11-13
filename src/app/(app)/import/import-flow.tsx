"use client";

import { Badge, Button, Card, cx, Field, Input, LinkButton, Select, Textarea } from "@/components/ui";
import { FIELD_LABELS, fieldsFor, type ImportPlan, type Mapping, type TableKind } from "@/domain/bulkImport";
import type { ApplyResult } from "@/server/services/bulkImport";
import { FileSpreadsheet, Link2, ClipboardPaste } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { FileDrop, type FileDropHandle } from "@/components/file-drop";
import { previewPlan, readSource, runImport, type DetectedTable } from "./actions";
import { HelpTip, HelpZone } from "@/components/help";

type Source = "file" | "paste" | "link";

const KIND_LABEL: Record<TableKind, string> = { ingredients: "Ingredients & prices", recipes: "Recipes", skip: "Skip this tab" };
const REQUIRED: Record<TableKind, string[]> = { ingredients: ["ingredient"], recipes: ["ingredient", "qty"], skip: [] };

export function ImportFlow() {
  const [source, setSource] = useState<Source>("file");
  const [tables, setTables] = useState<DetectedTable[]>([]);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fileRef = useRef<FileDropHandle>(null);
  const [paste, setPaste] = useState("");
  const [pasteName, setPasteName] = useState("");
  const [link, setLink] = useState("");

  const read = () =>
    start(async () => {
      setError(null);
      setPlan(null);
      const fd = new FormData();
      if (source === "file" && fileRef.current?.file) fd.set("file", fileRef.current.file);
      if (source === "paste") { fd.set("paste", paste); fd.set("pasteName", pasteName); }
      if (source === "link") fd.set("link", link);
      const res = await readSource(fd);
      if (res.error) return setError(res.error);
      // Pasting adds to what's already loaded, so several tables can be pasted one after another.
      setTables((cur) => (source === "paste" ? [...cur, ...res.tables!] : res.tables!));
      if (source === "paste") { setPaste(""); setPasteName(""); }
    });

  const update = (i: number, patch: Partial<DetectedTable>) => { setPlan(null); setTables((cur) => cur.map((t, j) => (j === i ? { ...t, ...patch } : t))); };
  const ready = tables.some((t) => t.kind !== "skip") && tables.every((t) => t.kind === "skip" || REQUIRED[t.kind].every((f) => t.mapping[f as keyof Mapping]));
  const specs = () => tables.map(({ table, kind, mapping }) => ({ table, kind, mapping }));

  if (result) {
    return (
      <HelpZone id="import.done" className="max-w-2xl"><Card className="p-6">
        <div className="text-base font-semibold">Imported</div>
        <ul className="num mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-3">
          <li><b>{result.ingredientsCreated}</b> new ingredients</li>
          <li><b>{result.ingredientsUpdated}</b> updated</li>
          <li><b>{result.suppliers}</b> new suppliers</li>
          <li><b>{result.products}</b> supplier products</li>
          <li><b>{result.prices}</b> prices</li>
          <li><b>{result.recipesCreated + result.recipesUpdated}</b> recipes</li>
        </ul>
        <div className="mt-6 flex flex-wrap gap-2">
          <LinkButton href="/menu" variant="primary">See menu costs</LinkButton>
          <LinkButton href="/ingredients">Review ingredients</LinkButton>
          <Button onClick={() => { setResult(null); setTables([]); setPlan(null); }}>Import more</Button>
        </div>
      </Card></HelpZone>
    );
  }

  return (
    <div className="space-y-6 pb-24">
      {/* 1. Source */}
      <HelpZone id="import.sources"><Card data-tour="import.sources">
        <div className="flex border-b border-border">
          {([
            ["file", "Upload a file", FileSpreadsheet],
            ["paste", "Paste from Sheets", ClipboardPaste],
            ["link", "Google Sheets link", Link2],
          ] as const).map(([k, label, Icon]) => (
            <button key={k} onClick={() => setSource(k)} className={cx("-mb-px flex flex-1 items-center justify-center gap-2 border-b-2 px-3 py-3 text-sm", source === k ? "border-ink font-medium text-ink" : "border-transparent text-muted hover:text-ink")}>
              <Icon className="size-4" strokeWidth={1.75} /> <span className="hidden sm:inline">{label}</span><span className="sm:hidden">{label.split(" ")[0]}</span>
            </button>
          ))}
        </div>
        <div className="space-y-3 p-5">
          {source === "file" && (
            <>
              <p className="text-sm text-muted">The whole workbook is read — every tab. In Google Sheets: File → Download → Microsoft Excel (.xlsx).</p>
              <FileDrop ref={fileRef} accept=".xlsx,.xls,.ods,.csv" hint="Excel, or a Google Sheets download (.csv works too)" />
            </>
          )}
          {source === "paste" && (
            <>
              <p className="text-sm text-muted">Select the cells in Google Sheets or Excel (include the header row), copy, and paste here. Paste several tables one after another.</p>
              <Input value={pasteName} onChange={(e) => setPasteName(e.target.value)} placeholder="Name (optional — e.g. a recipe name if this is one recipe)" />
              <Textarea value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={"Ingredient\tSupplier\tPrice\tPack\nGround beef\tGreene County Beef\t61.50\t10 lb"} className="num min-h-40 font-mono text-xs" />
            </>
          )}
          {source === "link" && (
            <>
              <p className="text-sm text-muted">Share the sheet as <b>Anyone with the link → Viewer</b>, then paste its address. Every tab is imported.</p>
              <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" type="url" />
            </>
          )}
          <div className="flex items-center gap-3">
            <Button variant="primary" onClick={read} disabled={pending}>{pending && !tables.length ? "Reading…" : source === "paste" && tables.length ? "Add table" : "Read sheet"}</Button>
            {error && <span className="text-sm text-bad">{error}</span>}
          </div>
        </div>
      </Card></HelpZone>

      {/* 2. Tables */}
      {tables.map((t, i) => {
        const fields = fieldsFor(t.kind);
        const missing = REQUIRED[t.kind].filter((f) => !t.mapping[f as keyof Mapping]);
        return (
          <HelpZone key={`${t.table.name}-${i}`} id="import.tabs"><Card className={cx(t.kind === "skip" && "opacity-60")}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
              <div>
                <div className="font-medium">{t.table.name}</div>
                <div className="num text-xs text-muted">{t.table.rows.length} rows · {t.table.headers.length} columns</div>
              </div>
              <div className="flex items-center gap-2">
              <HelpTip id="import.tabs" />
              <Select value={t.kind} onChange={(e) => update(i, { kind: e.target.value as TableKind })} className="w-52" aria-label="What is this tab?">
                {(Object.keys(KIND_LABEL) as TableKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </Select>
              </div>
            </div>
            {t.kind !== "skip" && (
              <div className="space-y-4 p-5">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  {fields.map((f) => (
                    <Field key={f} label={<>{FIELD_LABELS[f]}{REQUIRED[t.kind].includes(f) && <span className="text-bad"> *</span>}</>}>
                      <Select value={t.mapping[f] ?? ""} onChange={(e) => update(i, { mapping: { ...t.mapping, [f]: e.target.value || undefined } })} className={cx(!t.mapping[f] && "text-muted")}>
                        <option value="">—</option>
                        {t.table.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                      </Select>
                    </Field>
                  ))}
                </div>
                {t.kind === "recipes" && !t.mapping.recipe && <p className="text-xs text-muted">No recipe column, so this whole tab becomes one recipe called “{t.table.name}”.</p>}
                {missing.length > 0 && <p className="text-sm text-warn">Pick the {missing.map((m) => FIELD_LABELS[m as keyof typeof FIELD_LABELS]).join(" and ")} column.</p>}
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-xs">
                    <thead><tr>{t.table.headers.map((h) => <th key={h} className="border-b border-border bg-surface-2/60 px-2.5 py-1.5 text-left font-medium whitespace-nowrap text-muted">{h}</th>)}</tr></thead>
                    <tbody>{t.table.rows.slice(0, 3).map((r, k) => <tr key={k}>{t.table.headers.map((h) => <td key={h} className="border-b border-border px-2.5 py-1.5 whitespace-nowrap">{String(r[h] ?? "")}</td>)}</tr>)}</tbody>
                  </table>
                </div>
              </div>
            )}
          </Card></HelpZone>
        );
      })}

      {/* 3. Review */}
      {plan && (
        <HelpZone id="import.review"><Card className="p-5">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">What will happen <HelpTip id="import.review" /></h2>
          <div className="num mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Mini label="Ingredients" value={plan.ingredients.length} hint={`${plan.ingredients.filter((i) => !i.existingId).length} new`} />
            <Mini label="With prices" value={plan.ingredients.filter((i) => i.product?.price != null).length} />
            <Mini label="Recipes" value={plan.recipes.length} hint={`${plan.recipes.filter((r) => r.kind === "PREP").length} prep`} />
            <Mini label="Suppliers" value={plan.suppliers.length} />
          </div>
          {plan.issues.length > 0 && (
            <div className="mt-5">
              <div className="mb-2 text-sm font-medium">Worth a look <span className="num text-muted">{plan.issues.length}</span></div>
              <ul className="max-h-72 space-y-1.5 overflow-y-auto text-sm">
                {plan.issues.map((x, k) => (
                  <li key={k} className="flex gap-2"><Badge tone={x.level === "warn" ? "warn" : "neutral"}>{x.level === "warn" ? "Check" : "Note"}</Badge><span className="text-ink-2">{x.message}</span></li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted">None of these block the import — they can all be fixed afterwards in the grid.</p>
            </div>
          )}
        </Card></HelpZone>
      )}

      {tables.length > 0 && (
        <div className="fixed inset-x-0 bottom-[var(--tabbar)] z-30 border-t border-border bg-surface/95 backdrop-blur lg:left-60">
          <HelpZone id="import.actions" className="mx-auto flex max-w-6xl items-center justify-end gap-2 px-4 py-3 sm:px-8">
            <Button variant="ghost" onClick={() => { setTables([]); setPlan(null); }}>Start over</Button>
            {!plan ? (
              <Button variant="primary" disabled={!ready || pending} onClick={() => start(async () => setPlan(await previewPlan(specs())))}>{pending ? "Checking…" : "Review import"}</Button>
            ) : (
              <Button variant="primary" disabled={pending} onClick={() => start(async () => setResult(await runImport(specs())))}>{pending ? "Importing…" : "Import everything"}</Button>
            )}
          </HelpZone>
        </div>
      )}
    </div>
  );
}

function Mini({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-lg bg-surface-2/60 p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-0.5 text-lg font-semibold">{value}</div>
      {hint && <div className="text-xs text-muted">{hint}</div>}
    </div>
  );
}
