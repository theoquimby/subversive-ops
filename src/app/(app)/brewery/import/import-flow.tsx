"use client";

import { FileDrop, type FileDropHandle } from "@/components/file-drop";
import { Badge, Button, Card, cx, LinkButton } from "@/components/ui";
import { MAX_BACKUP_BYTES, type ImportPreview } from "@/domain/brewImport";
import type { BrewImportResult } from "@/server/services/brewImport";
import { useRef, useState, useTransition, type ReactNode } from "react";
import { previewBrewImportAction, runBrewImportAction } from "./actions";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** 1. Upload Brew Manager's backup file. 2. See what it holds and what will change. 3. Import. Safe to run again. */
export function BrewImportFlow() {
  const drop = useRef<FileDropHandle>(null);
  const [json, setJson] = useState<unknown>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<BrewImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const reset = () => {
    drop.current?.clear();
    setJson(null);
    setPreview(null);
    setResult(null);
    setError(null);
  };

  const onFile = (f: File | null) => {
    setPreview(null);
    setResult(null);
    setError(null);
    setJson(null);
    if (!f) return;
    if (f.size > MAX_BACKUP_BYTES) return setError(`That file is over ${Math.round(MAX_BACKUP_BYTES / 1_000_000)} MB, bigger than a Brew Manager backup should be.`);
    start(async () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await f.text());
      } catch {
        return setError("That file isn't a backup: it isn't JSON. In Brew Manager, use Settings → Backup → Export backup JSON.");
      }
      const res = await previewBrewImportAction(parsed);
      if ("error" in res) return setError(res.error);
      setJson(parsed);
      setPreview(res.preview);
    });
  };

  const run = () =>
    start(async () => {
      setError(null);
      const res = await runBrewImportAction(json);
      if ("error" in res) return setError(res.error);
      setResult(res.result);
    });

  if (result) {
    return (
      <Card className="max-w-2xl p-5 sm:p-6">
        <h2 className="text-base font-semibold">Imported</h2>
        <ul className="num mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
          <li><b>{result.recipesCreated}</b> new recipes, <b>{result.recipesUpdated}</b> updated</li>
          <li><b>{result.batchesCreated}</b> new brews, <b>{result.batchesUpdated}</b> updated</li>
          <li><b>{result.stays}</b> stays in tanks</li>
          <li><b>{result.linkedBeers}</b> recipes linked to a beer</li>
          {result.tanksCreated.length > 0 && <li className="sm:col-span-2">New tanks: {result.tanksCreated.join(", ")}. Check their sizes in Setup.</li>}
        </ul>
        {result.unmatchedRecipes.length > 0 && (
          <p className="mt-3 text-sm text-muted">
            Not linked to a beer (no beer by that name): {result.unmatchedRecipes.join(", ")}. Link each from its recipe, or give the beer the same name in Kegs → Beers.
          </p>
        )}
        {result.unmatchedBrews.length > 0 && <p className="mt-2 text-sm text-muted">Brews with no matching beer: {result.unmatchedBrews.join(", ")}.</p>}
        <p className="mt-3 text-sm text-muted">Next: match each recipe line to an ingredient and price it, so costs come through.</p>
        <div className="mt-5 flex flex-wrap gap-2">
          <LinkButton href="/brewery/recipes" variant="primary">See the recipes</LinkButton>
          <LinkButton href="/brewery/batches">See the brews</LinkButton>
          {result.tanksCreated.length > 0 && <LinkButton href="/brewery/setup">Check the tanks</LinkButton>}
          <Button onClick={reset}>Import another file</Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="max-w-3xl space-y-5 pb-10">
      <Card className="space-y-3 p-5">
        <FileDrop ref={drop} accept=".json,application/json" hint="The .json file from Brew Manager's backup" onFile={onFile} />
        <p className="text-sm text-muted">
          To get the file: in Brew Manager, open <b className="font-medium text-ink-2">Settings → Backup → Export backup JSON</b>. It saves a file named like subversive-backup-2026-11-16.json.
        </p>
        <p className="text-xs text-muted">The backup holds recipes and batches only. Brew Manager&apos;s schedule, development beers and stock aren&apos;t in it, so they don&apos;t come across.</p>
        {pending && !preview && <p className="text-sm text-muted">Reading the file…</p>}
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      </Card>

      {preview && (
        <Card className="p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold">What&apos;s in this backup</h2>
            {preview.exportedAt && <span className="text-xs text-muted">Exported {new Date(preview.exportedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</span>}
          </div>
          <ul className="num mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
            <li><b>{preview.recipes}</b> recipes ({preview.newRecipes} new, {preview.updatedRecipes} already here, will be updated)</li>
            <li><b>{preview.lines}</b> grain, hop and yeast lines</li>
            <li><b>{preview.batches}</b> brews ({preview.newBatches} new)</li>
            <li><b>{preview.stays}</b> stays in tanks</li>
          </ul>

          {preview.tanks.length > 0 && (
            <Block title="Tanks">
              <div className="flex flex-wrap gap-1.5">
                {preview.tanks.map((t) => (
                  <Badge key={t.name} tone={t.exists ? "neutral" : "warn"}>
                    {t.name} · {t.kind === "FERMENTER" ? "fermenter" : t.kind === "BRITE" ? "brite" : "other"}
                    {!t.exists && ` · new, ${t.capacityBbl ?? 7} bbl`}
                  </Badge>
                ))}
              </div>
              {preview.tanks.some((t) => !t.exists) && <p className="mt-1.5 text-xs text-muted">New tanks get their size from the biggest brew that sat in them (or the recipe's batch size). Check them in Setup afterwards.</p>}
            </Block>
          )}

          <Block title="Beers">
            {preview.beerMatches.length > 0 && <p className="text-sm">{plural(preview.beerMatches.length, "recipe")} will be linked to the beer of the same name.</p>}
            {preview.unmatchedRecipes.length > 0 && (
              <p className="mt-1 text-sm text-muted">No beer by these names, so not linked yet: {preview.unmatchedRecipes.join(", ")}.</p>
            )}
          </Block>

          {preview.unknownUnits.length > 0 && (
            <Block title="Amounts it couldn't read">
              <p className="text-sm text-muted">These come in as 0 for you to fill in: {preview.unknownUnits.map((u) => `“${u}”`).join(", ")}.</p>
            </Block>
          )}

          {preview.warnings.length > 0 && <Warnings items={preview.warnings} />}

          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
            <Button variant="primary" onClick={run} disabled={pending}>{pending ? "Importing…" : `Import ${plural(preview.recipes, "recipe")} and ${plural(preview.batches, "brew")}`}</Button>
            <Button variant="ghost" onClick={reset} disabled={pending}>Choose another file</Button>
            <span className="text-xs text-muted">Safe to run again: it updates what came in last time.</span>
          </div>
        </Card>
      )}
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-4">
      <h3 className="mb-1.5 text-sm font-medium text-ink-2">{title}</h3>
      {children}
    </div>
  );
}

function Warnings({ items }: { items: string[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, 6);
  return (
    <Block title={`Worth a look (${items.length})`}>
      <ul className={cx("list-disc space-y-0.5 pl-5 text-sm text-muted", all && "max-h-80 overflow-y-auto")}>
        {shown.map((w, i) => <li key={i}>{w}</li>)}
      </ul>
      {items.length > 6 && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-1 text-xs text-muted underline underline-offset-2 hover:text-ink">
          {all ? "Show fewer" : `Show all ${items.length}`}
        </button>
      )}
    </Block>
  );
}
