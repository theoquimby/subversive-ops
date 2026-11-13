"use client";

import { HelpTip } from "@/components/help";
import { Badge, Button, Card, cx, Field, LinkButton, Select, Textarea } from "@/components/ui";
import { ENTITY_LABEL, FIELD_LABEL, FIELDS, REQUIRED, type EntityOrSkip, type KegEntity, type Mapping } from "@/domain/kegImport";
import { STATUS_META } from "@/domain/kegs";
import type { ImportResult, SourceInfo } from "@/server/services/kegImport";
import { ClipboardPaste, FileUp } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { addImportFile, cancelImport, reviewImport, runKegImport, type ImportReview } from "./actions";

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

/**
 * 1. Add every export (several CSV/XLSX files, or JSON from the old app).
 * 2. Each file: what it is, and which column is which (guessed; remembered next time).
 * 3. Review what will be added and updated, then import. Safe to re-run.
 */
export function KegImportFlow() {
  const [uploadId, setUploadId] = useState(newId);
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [review, setReview] = useState<ImportReview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paste, setPaste] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [pending, start] = useTransition();
  const [reading, setReading] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const addFiles = async (files: File[]) => {
    setError(null);
    setReview(null);
    for (const f of files) {
      setReading(f.name);
      const fd = new FormData();
      fd.set("file", f);
      const r = await addImportFile(uploadId, fd);
      if ("error" in r) { setError(`${f.name}: ${r.error}`); break; }
      setSources(r.sources);
    }
    setReading(null);
  };

  const choices = () => sources.map((s) => ({ index: s.index, entity: s.entity, mapping: s.mapping }));
  const update = (i: number, patch: Partial<SourceInfo>) => { setReview(null); setSources((cur) => cur.map((s) => (s.index === i ? { ...s, ...patch } : s))); };
  const ready = sources.some((s) => s.entity !== "skip") && sources.every((s) => s.entity === "skip" || REQUIRED[s.entity as KegEntity].every((f) => s.mapping[f]));
  const reset = () => { void cancelImport(uploadId); setUploadId(newId()); setSources([]); setReview(null); setResult(null); setError(null); };

  if (result) {
    return (
      <Card className="max-w-2xl p-6">
        <div className="text-base font-semibold">Imported</div>
        <ul className="num mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-3">
          <li><b>{result.kegsCreated}</b> new kegs</li>
          <li><b>{result.kegsUpdated}</b> kegs updated</li>
          <li><b>{result.events}</b> history entries</li>
          <li><b>{result.beers}</b> new beers</li>
          <li><b>{result.accounts}</b> new accounts</li>
          <li><b>{result.batches}</b> batches · <b>{result.fills}</b> fills</li>
        </ul>
        <p className="mt-3 text-sm text-muted">Old stickers scan straight away. Each keg also got a new code for when you reprint its sticker.</p>
        <div className="mt-6 flex flex-wrap gap-2">
          <LinkButton href="/kegs/all" variant="primary">See the kegs</LinkButton>
          <LinkButton href="/kegs/setup">Check beers and Square names</LinkButton>
          <Button onClick={reset}>Import more</Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6 pb-24">
      <Card className="p-5" data-tour="kegs.import.files">
        <div
          role="button"
          tabIndex={0}
          onClick={() => input.current?.click()}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); void addFiles([...e.dataTransfer.files]); }}
          className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-border-strong px-4 py-5 transition-colors hover:border-ink-2/50 hover:bg-surface-2/50"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-surface-2 text-ink-2"><FileUp className="size-5" /></span>
          <div className="min-w-0">
            <div className="text-sm font-medium">{reading ? `Reading ${reading}…` : "Drop every export here, or tap to choose"}</div>
            <div className="text-xs text-muted">Kegs, products, batches, customers, deliveries, returns, the activity log — CSV, Excel (all tabs) or JSON. Several at once is fine.</div>
          </div>
          <input ref={input} type="file" multiple accept=".csv,.xlsx,.xls,.ods,.json" className="sr-only" tabIndex={-1} onChange={(e) => { void addFiles([...(e.target.files ?? [])]); e.target.value = ""; }} />
        </div>
        <div className="mt-3">
          {showPaste ? (
            <div className="space-y-2">
              <Textarea value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={"Keg ID\tSize\tStatus\tProduct\nSB-0001\t1/2 bbl\tFull\tGolden Lager"} className="num min-h-32 font-mono text-xs" aria-label="Pasted cells or JSON" />
              <Button disabled={!paste.trim() || pending} onClick={() => start(async () => { const fd = new FormData(); fd.set("paste", paste); const r = await addImportFile(uploadId, fd); if ("error" in r) setError(r.error); else { setSources(r.sources); setPaste(""); setShowPaste(false); } })}>Add</Button>
            </div>
          ) : (
            <button className="inline-flex h-10 items-center gap-1.5 text-sm text-ink-2 hover:text-ink" onClick={() => setShowPaste(true)}><ClipboardPaste className="size-4" /> Paste cells or JSON instead</button>
          )}
        </div>
        {error && <p role="alert" className="mt-3 text-sm text-bad">{error}</p>}
      </Card>

      {sources.map((s) => {
        const fields = s.entity === "skip" ? [] : FIELDS[s.entity];
        const missing = s.entity === "skip" ? [] : REQUIRED[s.entity].filter((f) => !s.mapping[f]);
        const used = new Set(Object.values(s.mapping));
        const unmapped = s.headers.filter((h) => !used.has(h));
        return (
          <Card key={s.index} className={cx(s.entity === "skip" && "opacity-60")} data-tour="kegs.import.mapping">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
              <div className="min-w-0">
                <div className="truncate font-medium">{s.name}</div>
                <div className="num text-xs text-muted">{s.rows.toLocaleString("en-US")} rows · {s.headers.length} columns{s.remembered ? " · columns remembered from last time" : ""}</div>
              </div>
              <div className="flex items-center gap-2">
                <HelpTip id="kegs.import" />
                <Select value={s.entity} onChange={(e) => update(s.index, { entity: e.target.value as EntityOrSkip })} options={(Object.keys(ENTITY_LABEL) as EntityOrSkip[]).map((k) => ({ value: k, label: ENTITY_LABEL[k] }))} className="w-56" aria-label="What is in this file?" />
              </div>
            </div>
            {s.entity !== "skip" && (
              <div className="space-y-4 p-5">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  {fields.map((f) => (
                    <Field key={f} label={<>{FIELD_LABEL[f]}{REQUIRED[s.entity as KegEntity].includes(f) && <span className="text-bad"> *</span>}</>}>
                      <Select value={s.mapping[f] ?? ""} onChange={(e) => update(s.index, { mapping: { ...s.mapping, [f]: e.target.value || undefined } as Mapping })} options={[{ value: "", label: "—" }, ...s.headers.map((h) => ({ value: h, label: h }))]} className={cx(!s.mapping[f] && "text-muted")} searchable={s.headers.length > 12} />
                    </Field>
                  ))}
                </div>
                {missing.length > 0 && <p className="text-sm text-warn">Pick the {missing.map((m) => FIELD_LABEL[m]).join(" and ")} column.</p>}
                {unmapped.length > 0 && <p className="text-xs text-muted">Kept as-is on each record, so nothing is lost: {unmapped.slice(0, 10).join(", ")}{unmapped.length > 10 ? ` and ${unmapped.length - 10} more` : ""}.</p>}
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-xs">
                    <thead><tr>{s.headers.slice(0, 14).map((h) => <th key={h} className="border-b border-border bg-surface-2/60 px-2.5 py-1.5 text-left font-medium whitespace-nowrap text-muted">{h}</th>)}</tr></thead>
                    <tbody>{s.sample.map((r, k) => <tr key={k}>{s.headers.slice(0, 14).map((h) => <td key={h} className="border-b border-border px-2.5 py-1.5 whitespace-nowrap">{cell(r, h)}</td>)}</tr>)}</tbody>
                  </table>
                </div>
              </div>
            )}
          </Card>
        );
      })}

      {review && <Review review={review} />}

      {sources.length > 0 && (
        <div className="fixed inset-x-0 bottom-[var(--tabbar)] z-30 border-t border-border bg-surface/95 backdrop-blur lg:left-60">
          <div className="mx-auto flex max-w-6xl items-center justify-end gap-2 px-4 py-3 sm:px-8">
            <Button variant="ghost" onClick={reset}>Start over</Button>
            {!review ? (
              <Button variant="primary" disabled={!ready || pending} onClick={() => start(async () => { setError(null); const r = await reviewImport(uploadId, choices()); if ("error" in r) setError(r.error); else setReview(r); })}>{pending ? "Checking…" : "Review import"}</Button>
            ) : (
              <Button variant="primary" disabled={pending} onClick={() => start(async () => { const r = await runKegImport(uploadId, choices()); if ("error" in r) setError(r.error); else setResult(r); })}>{pending ? "Importing…" : "Import everything"}</Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function cell(r: Record<string, unknown>, h: string): string {
  let v: unknown = r;
  for (const p of h.split(".")) v = v && typeof v === "object" ? (v as Record<string, unknown>)[p] : undefined;
  if (v === undefined) v = r[h];
  return v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
}

function Review({ review }: { review: ImportReview }) {
  const { plan, counts } = review;
  const byStatus = new Map<string, number>();
  for (const k of plan.kegs) byStatus.set(k.status ?? "—", (byStatus.get(k.status ?? "—") ?? 0) + 1);
  return (
    <Card className="p-5" data-tour="kegs.import.review">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold">What will happen</h2>
      <div className="num mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Mini label="Kegs" value={plan.kegs.length} hint={`${counts.kegsNew} new · ${counts.kegsUpdated} updated`} />
        <Mini label="History" value={plan.eventCount} hint={`${counts.eventsNew} new${counts.eventsSeen ? ` · ${counts.eventsSeen} already in` : ""}`} />
        <Mini label="Beers" value={plan.beers.length} hint={`${counts.beersNew} new`} />
        <Mini label="Accounts" value={plan.accounts.length} hint={`${counts.accountsNew} new`} />
        <Mini label="Batches" value={plan.batches.length} />
        <Mini label="Spots" value={plan.spots.filter((s) => s.name).length} />
      </div>
      {byStatus.size > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5 text-xs">
          {[...byStatus].map(([s, n]) => <Badge key={s}>{s in STATUS_META ? STATUS_META[s as keyof typeof STATUS_META].short : "Status not given"} · {n}</Badge>)}
        </div>
      )}
      {plan.issues.length > 0 && (
        <div className="mt-5">
          <div className="mb-2 text-sm font-medium">Worth a look <span className="num text-muted">{plan.issues.length}</span></div>
          <ul className="max-h-72 space-y-1.5 overflow-y-auto text-sm">
            {plan.issues.map((x, k) => (
              <li key={k} className="flex gap-2"><Badge tone={x.level === "warn" ? "warn" : "neutral"}>{x.level === "warn" ? "Check" : "Note"}</Badge><span className="text-ink-2">{x.message}</span></li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-4 text-xs text-muted">Kegs match on their old code, so importing the same files again updates them instead of adding copies. History entries are only added once.</p>
    </Card>
  );
}

function Mini({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-lg bg-surface-2/70 px-3 py-2">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-lg font-semibold">{value.toLocaleString("en-US")}</div>
      {hint && <div className="text-[11px] text-muted">{hint}</div>}
    </div>
  );
}
