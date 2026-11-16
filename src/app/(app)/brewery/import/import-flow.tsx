"use client";

import { DataTable, type Column } from "@/components/data-table";
import { FileDrop, type FileDropHandle } from "@/components/file-drop";
import { Badge, Button, Card, cx, LinkButton, Select } from "@/components/ui";
import { LEAD_REF_LABEL } from "@/domain/brewDay";
import type { LinkSummary } from "@/domain/brewIngredientLink";
import { MAX_BACKUP_BYTES, type AppImportPreview, type ImportPreview, type ScheduleRow } from "@/domain/brewImport";
import { shortDate } from "@/lib/format";
import type { AnyImportPreview, AnyImportResult, AppImportResult, BrewImportResult } from "@/server/services/brewImport";
import { Lock } from "lucide-react";
import { useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { LinkSummaryView } from "../link-summary";
import { previewBrewImportAction, runBrewImportAction } from "./actions";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
type Opts = { includePast: boolean; picks: Record<string, string> };

/**
 * 1. Upload one of Brew Manager's two files. 2. See what it holds and what will
 * change (and, for the app data, pick recipes for schedule names it couldn't
 * match). 3. Import. Safe to run again.
 */
export function BrewImportFlow() {
  const drop = useRef<FileDropHandle>(null);
  const [json, setJson] = useState<unknown>(null);
  const [opts, setOpts] = useState<Opts>({ includePast: false, picks: {} });
  const [preview, setPreview] = useState<AnyImportPreview | null>(null);
  const [result, setResult] = useState<AnyImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const reset = () => {
    drop.current?.clear();
    setJson(null);
    setPreview(null);
    setResult(null);
    setError(null);
    setOpts({ includePast: false, picks: {} });
  };

  const onFile = (f: File | null) => {
    setPreview(null);
    setResult(null);
    setError(null);
    setJson(null);
    if (!f) return;
    if (f.size > MAX_BACKUP_BYTES) return setError(`That file is over ${Math.round(MAX_BACKUP_BYTES / 1_000_000)} MB, bigger than a Brew Manager file should be.`);
    start(async () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await f.text());
      } catch {
        return setError("That file isn't one of Brew Manager's: it isn't JSON.");
      }
      const fresh = { includePast: false, picks: {} };
      const res = await previewBrewImportAction(parsed, fresh);
      if ("error" in res) return setError(res.error);
      setOpts(fresh);
      setJson(parsed);
      setPreview(res.preview);
    });
  };

  /** New choices (past brews, a recipe for a name): the preview is worked out again. */
  const change = (next: Opts) => {
    setOpts(next);
    start(async () => {
      const res = await previewBrewImportAction(json, next);
      if ("error" in res) return setError(res.error);
      setPreview(res.preview);
    });
  };

  const run = () =>
    start(async () => {
      setError(null);
      const res = await runBrewImportAction(json, opts);
      if ("error" in res) return setError(res.error);
      setResult(res.result);
    });

  if (result) return result.kind === "app" ? <AppResult r={result} onAgain={reset} /> : <BackupResult r={result} onAgain={reset} />;

  return (
    <div className="max-w-4xl space-y-5 pb-10">
      <Card className="space-y-3 p-5">
        <FileDrop ref={drop} accept=".json,application/json" hint="A .json file from Brew Manager" onFile={onFile} />
        <p className="text-sm text-muted">
          Upload <b className="font-medium text-ink-2">brewmanager-app-data.json</b> (made from Brew Manager&apos;s own page) for recipes, the 2026 schedule, development beers and tanks; upload Brew Manager&apos;s backup file (<b className="font-medium text-ink-2">Settings → Backup → Export backup JSON</b>) for brews.
        </p>
        <p className="text-xs text-muted">Either file can go first, and each can be imported again later: what came in last time is updated, never copied.</p>
        {pending && !preview && <p className="text-sm text-muted">Reading the file…</p>}
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      </Card>

      {preview?.kind === "backup" && <BackupPreview p={preview} pending={pending} onRun={run} onReset={reset} />}
      {preview?.kind === "app" && <AppPreview p={preview} opts={opts} pending={pending} onChange={change} onRun={run} onReset={reset} />}
    </div>
  );
}

// ---- The backup ---------------------------------------------------------------------------

function BackupPreview({ p, pending, onRun, onReset }: { p: ImportPreview; pending: boolean; onRun: () => void; onReset: () => void }) {
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">What&apos;s in this backup</h2>
        {p.exportedAt && <span className="text-xs text-muted">Exported {new Date(p.exportedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</span>}
      </div>
      <ul className="num mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
        <li><b>{p.recipes}</b> recipes ({p.newRecipes} new, {p.updatedRecipes} already here, will be updated)</li>
        <li><b>{p.lines}</b> grain, hop and yeast lines</li>
        <li><b>{p.batches}</b> brews ({p.newBatches} new)</li>
        <li><b>{p.stays}</b> stays in tanks</li>
      </ul>

      {p.tanks.length > 0 && (
        <Block title="Tanks">
          <div className="flex flex-wrap gap-1.5">
            {p.tanks.map((t) => (
              <Badge key={t.name} tone={t.exists ? "neutral" : "warn"}>
                {t.name} · {t.kind === "FERMENTER" ? "fermenter" : t.kind === "BRITE" ? "brite" : "other"}
                {!t.exists && ` · new, ${t.capacityBbl ?? 7} bbl`}
              </Badge>
            ))}
          </div>
          {p.tanks.some((t) => !t.exists) && <p className="mt-1.5 text-xs text-muted">New tanks get their size from the biggest brew that sat in them (or the recipe&apos;s batch size). The app data file has the real sizes; importing it afterwards puts them right.</p>}
        </Block>
      )}

      <Block title="Beers">
        {p.beerMatches.length > 0 && <p className="text-sm">{plural(p.beerMatches.length, "recipe")} will be linked to the beer of the same name.</p>}
        {p.unmatchedRecipes.length > 0 && <p className="mt-1 text-sm text-muted">No beer by these names, so not linked yet: {p.unmatchedRecipes.join(", ")}.</p>}
      </Block>

      {p.unknownUnits.length > 0 && (
        <Block title="Amounts it couldn't read">
          <p className="text-sm text-muted">These come in as 0 for you to fill in: {p.unknownUnits.map((u) => `“${u}”`).join(", ")}.</p>
        </Block>
      )}

      {p.warnings.length > 0 && <Warnings items={p.warnings} />}

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <Button variant="primary" size="lg" onClick={onRun} disabled={pending}>{pending ? "Importing…" : `Import ${plural(p.recipes, "recipe")} and ${plural(p.batches, "brew")}`}</Button>
        <Button variant="ghost" onClick={onReset} disabled={pending}>Choose another file</Button>
        <span className="text-xs text-muted">Safe to run again: it updates what came in last time.</span>
      </div>
    </Card>
  );
}

function BackupResult({ r, onAgain }: { r: BrewImportResult; onAgain: () => void }) {
  return (
    <Card className="max-w-2xl p-5 sm:p-6">
      <h2 className="text-base font-semibold">Imported</h2>
      <ul className="num mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
        <li><b>{r.recipesCreated}</b> new recipes, <b>{r.recipesUpdated}</b> updated</li>
        <li><b>{r.batchesCreated}</b> new brews, <b>{r.batchesUpdated}</b> updated</li>
        <li><b>{r.stays}</b> stays in tanks</li>
        <li><b>{r.linkedBeers}</b> recipes linked to a beer</li>
        {r.tanksCreated.length > 0 && <li className="sm:col-span-2">New tanks: {r.tanksCreated.join(", ")}. Check their sizes in Setup.</li>}
      </ul>
      {r.unmatchedRecipes.length > 0 && <p className="mt-3 text-sm text-muted">Not linked to a beer (no beer by that name): {r.unmatchedRecipes.join(", ")}. Link each from its recipe, or give the beer the same name in Kegs → Beers.</p>}
      {r.unmatchedBrews.length > 0 && <p className="mt-2 text-sm text-muted">Brews with no matching beer: {r.unmatchedBrews.join(", ")}.</p>}
      <Links links={r.links} />
      <div className="mt-5 flex flex-wrap gap-2">
        <LinkButton href="/brewery/recipes" variant="primary">See the recipes</LinkButton>
        <LinkButton href="/brewery/batches">See the brews</LinkButton>
        {r.tanksCreated.length > 0 && <LinkButton href="/brewery/setup">Check the tanks</LinkButton>}
        <Button onClick={onAgain}>Import another file</Button>
      </div>
    </Card>
  );
}

// ---- The app data -------------------------------------------------------------------------

const HOW: Record<NonNullable<ScheduleRow["how"]>, string> = { exact: "same name", alias: "short name", close: "close match", picked: "picked" };

function AppPreview({ p, opts, pending, onChange, onRun, onReset }: { p: AppImportPreview; opts: Opts; pending: boolean; onChange: (o: Opts) => void; onRun: () => void; onReset: () => void }) {
  const c = p.scheduleCounts;
  const choiceOptions = useMemo(() => [{ value: "", label: "No recipe (just the beer)" }, ...p.recipeChoices.map((r) => ({ value: r.ref, label: r.name, group: r.ref.startsWith("file:") ? "In this file" : "Already in Ops" }))], [p.recipeChoices]);
  const columns = useMemo<Column<ScheduleRow>[]>(
    () => [
      { id: "date", header: "Brew day", sort: (r) => r.brewDate, csv: (r) => r.brewDate, cell: (r) => <span className={cx("num", !r.included && "text-muted")}>{shortDate(r.brewDate)}</span> },
      { id: "beer", header: "Beer", sort: (r) => r.beer, csv: (r) => r.beer, cell: (r) => <span className={cx("font-medium", !r.included && "text-muted")}>{r.beer}</span> },
      {
        id: "recipe",
        header: "Recipe",
        sort: (r) => r.recipeName ?? "",
        csv: (r) => r.recipeName ?? "",
        cell: (r) => (r.recipeName ? <span className="text-ink-2">{r.recipeName}{r.how && r.how !== "exact" && <span className="ml-1.5 text-xs text-muted">({HOW[r.how]})</span>}</span> : <span className="text-warn">None found</span>),
      },
      { id: "profile", header: "Profile", sort: (r) => r.profileLabel ?? "", csv: (r) => r.profileLabel ?? "", cell: (r) => <span className="text-ink-2">{r.profileLabel ?? "—"}</span> },
      { id: "dryhop", header: "Dry hop", defaultHidden: true, sort: (r) => r.dryHopOn ?? "", csv: (r) => r.dryHopOn ?? "", cell: (r) => <span className="num text-ink-2">{r.dryHopOn ? shortDate(r.dryHopOn) : "—"}</span> },
      {
        id: "tap",
        header: "Release",
        sort: (r) => r.tapOn ?? "",
        csv: (r) => r.tapOn ?? "",
        cell: (r) => (
          <span className="num inline-flex items-center gap-1 text-ink-2">
            {r.tapOn ? shortDate(r.tapOn) : "—"}
            {r.locked && <span title={r.lockedReason ?? "Locked"} className="inline-flex items-center gap-0.5 text-xs text-muted"><Lock className="size-3" />{r.lockedReason ?? "locked"}</span>}
          </span>
        ),
      },
      {
        id: "state",
        header: "This import",
        sort: (r) => (r.included ? (r.state === "new" ? 0 : 1) : 2),
        csv: (r) => stateText(r),
        cell: (r) => <Badge tone={r.state === "brewed" ? "neutral" : r.included ? "good" : "neutral"}>{stateText(r)}</Badge>,
      },
    ],
    [],
  );

  return (
    <Card className="p-5">
      <h2 className="text-base font-semibold">What&apos;s in Brew Manager&apos;s app data</h2>
      <ul className="num mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
        <li><b>{p.recipes}</b> recipes ({p.newRecipes} new, {p.updatedRecipes} already here, will be updated)</li>
        <li><b>{p.devBeers}</b> development beers ({p.newDevBeers} new), as recipes in development</li>
        <li><b>{c.total}</b> planned brews ({c.future} still to come, {c.past} already past)</li>
        <li><b>{p.tanks.length}</b> tanks, <b>{p.suppliers.length}</b> suppliers&apos; lead times</li>
      </ul>

      {p.tanks.length > 0 && (
        <Block title="Tanks and where they stand">
          <div className="flex flex-wrap gap-1.5">
            {p.tanks.map((t) => (
              <Badge key={t.name} tone={t.exists && t.sizeFrom == null ? "neutral" : "warn"}>
                {t.name} · {t.capacityBbl ?? "?"} bbl{t.zone ? ` · ${t.zone.toLowerCase()}` : ""}
                {!t.exists ? " · new" : t.sizeFrom != null ? ` · was ${t.sizeFrom} bbl` : ""}
              </Badge>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-muted">Tanks already here keep the size set in Ops, except sizes the backup import guessed. Each gets its spot on Brew Manager&apos;s floor plan if it has none yet.</p>
        </Block>
      )}

      <Block title="The schedule">
        <label className="mb-2 flex min-h-10 cursor-pointer items-center gap-2.5 text-sm">
          <Switch on={opts.includePast} onChange={(v) => onChange({ ...opts, includePast: v })} label="Include past brews" disabled={pending} />
          <span>Include past brews <span className="text-muted">({c.past}): they show what was planned, not what was brewed. Real brews come from the backup file.</span></span>
        </label>
        <p className="mb-2 text-sm text-muted">
          {plural(c.included, "planned brew")} will be imported{c.brewed > 0 ? `; ${plural(c.brewed, "brew")} already brewed in Ops since the last import ${c.brewed === 1 ? "is" : "are"} left alone` : ""}. Each gets its dry-hop and release dates from its profile, with transfers on a Monday or Tuesday and packaging on a Wednesday, and goes on the tank schedule where a fermenter is free.
        </p>
        <DataTable
          id="brew-import-schedule"
          rows={p.schedule}
          rowKey={(r) => r.sourceKey}
          columns={columns}
          noun={["planned brew", "planned brews"]}
          searchText={(r) => `${r.beer} ${r.recipeName ?? ""} ${r.profileLabel ?? ""}`}
          filters={[{ id: "included", label: "Imported", kind: "toggle", test: (r) => r.included }]}
          defaultView={{ sort: [{ id: "date", dir: "asc" }] }}
          urlSearch={false}
          csvName="brew-manager-schedule"
          maxHeight="28rem"
          card={(r) => ({ title: r.beer, subtitle: `${shortDate(r.brewDate)} · ${r.recipeName ?? "no recipe"}${r.profileLabel ? ` · ${r.profileLabel}` : ""}`, value: stateText(r), sub: r.tapOn ? `release ${shortDate(r.tapOn)}${r.locked ? " (locked)" : ""}` : undefined })}
        />
      </Block>

      {p.unmatched.length > 0 && (
        <Block title="Names with no recipe found">
          <p className="mb-2 text-sm text-muted">Pick the recipe each brews, or leave it as just the beer. Recipes by the same name, a known short name (Marzen for Mountain Marzen) or a close name were matched already.</p>
          <div className="space-y-2">
            {p.unmatched.map((name) => (
              <div key={name} className="grid grid-cols-1 items-center gap-1.5 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-3">
                <span className="text-sm font-medium">{name}</span>
                <Select aria-label={`Recipe for ${name}`} searchable value={opts.picks[name] ?? ""} onChange={(e) => onChange({ ...opts, picks: { ...opts.picks, [name]: e.target.value } })} options={choiceOptions} />
              </div>
            ))}
          </div>
        </Block>
      )}

      <Block title="Beers">
        {p.beerMatches.length > 0 && <p className="text-sm">{plural(p.beerMatches.length, "recipe")} will be linked to a beer of the same (or a known short) name.</p>}
        {p.unmatchedRecipes.length > 0 && <p className="mt-1 text-sm text-muted">No beer by these names, so not linked yet: {p.unmatchedRecipes.join(", ")}.</p>}
      </Block>

      {p.suppliers.length > 0 && (
        <Block title="Suppliers' lead times">
          <ul className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {p.suppliers.map((s) => (
              <li key={s.name}>
                <span className="font-medium">{s.name}</span> <span className="text-muted">· {plural(s.leadDays, "day")} before the {LEAD_REF_LABEL[s.ref].toLowerCase()}{s.exists ? "" : " · new brewery supplier"}</span>
              </li>
            ))}
          </ul>
        </Block>
      )}

      {p.unknownUnits.length > 0 && (
        <Block title="Amounts it couldn't read">
          <p className="text-sm text-muted">These come in as 0 for you to fill in: {p.unknownUnits.map((u) => `“${u}”`).join(", ")}.</p>
        </Block>
      )}

      {p.warnings.length > 0 && <Warnings items={p.warnings} />}

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <Button variant="primary" size="lg" onClick={onRun} disabled={pending}>{pending ? "Working…" : "Import"}</Button>
        <Button variant="ghost" onClick={onReset} disabled={pending}>Choose another file</Button>
        <span className="text-xs text-muted">Safe to run again: it updates what came in last time.</span>
      </div>
    </Card>
  );
}

const stateText = (r: ScheduleRow) => (r.state === "brewed" ? "Brewed in Ops, left alone" : !r.included ? "Past, skipped" : r.state === "update" ? "Update" : "New");

function AppResult({ r, onAgain }: { r: AppImportResult; onAgain: () => void }) {
  return (
    <Card className="max-w-2xl p-5 sm:p-6">
      <h2 className="text-base font-semibold">Imported</h2>
      <ul className="num mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
        <li><b>{r.recipesCreated}</b> new recipes, <b>{r.recipesUpdated}</b> updated</li>
        <li><b>{r.devCreated}</b> new development beers, <b>{r.devUpdated}</b> updated</li>
        <li><b>{r.plannedCreated}</b> new planned brews, <b>{r.plannedUpdated}</b> updated</li>
        <li><b>{r.placed}</b> put on the tank schedule</li>
        {r.plannedLeft > 0 && <li className="sm:col-span-2">{plural(r.plannedLeft, "brew")} brewed in Ops since the last import left alone.</li>}
        {(r.tanksCreated.length > 0 || r.tanksUpdated.length > 0) && <li className="sm:col-span-2">Tanks: {[r.tanksCreated.length ? `new ${r.tanksCreated.join(", ")}` : "", r.tanksUpdated.length ? `updated ${r.tanksUpdated.join(", ")}` : ""].filter(Boolean).join("; ")}.</li>}
        {(r.suppliersCreated.length > 0 || r.suppliersUpdated.length > 0) && <li className="sm:col-span-2">Brewery suppliers: {[...r.suppliersCreated, ...r.suppliersUpdated].join(", ")}, with their lead times.</li>}
      </ul>
      {r.notPlaced.length > 0 && <p className="mt-3 text-sm text-warn">No tank free for: {r.notPlaced.join("; ")}. They&apos;re planned with no tank yet; move them on the schedule.</p>}
      {r.profilesSet.length > 0 && <p className="mt-2 text-sm text-muted">Timing profile set from the schedule on: {r.profilesSet.join(", ")}.</p>}
      <Links links={r.links} />
      <div className="mt-5 flex flex-wrap gap-2">
        <LinkButton href="/brewery/schedule" variant="primary">See the schedule</LinkButton>
        <LinkButton href="/brewery/recipes">See the recipes</LinkButton>
        <LinkButton href="/brewery">See the tanks</LinkButton>
        <Button onClick={onAgain}>Import another file</Button>
      </div>
    </Card>
  );
}

// ---- Bits -----------------------------------------------------------------------------------

/** Recipe lines linked to ingredients after the import. */
function Links({ links }: { links: LinkSummary | null }) {
  return (
    <Block title="Ingredients">
      {links ? (
        <LinkSummaryView s={links} />
      ) : (
        <p className="text-sm text-warn">The recipe lines weren&apos;t linked to ingredients this time. Press Link them on Recipes to do it.</p>
      )}
    </Block>
  );
}

function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cx("relative inline-flex h-6 w-10 shrink-0 items-center rounded-full border transition-colors duration-120 disabled:opacity-50", on ? "border-ink bg-ink" : "border-border-strong bg-surface-2")}
    >
      <span className={cx("inline-block size-4 rounded-full bg-surface shadow transition-transform duration-120", on ? "translate-x-5" : "translate-x-1")} />
    </button>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-5">
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
