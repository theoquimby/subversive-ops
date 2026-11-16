"use client";

import { useConfirm } from "@/components/dialog";
import { GridCell, GridSelect } from "@/components/grid";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, cx, DatePicker, Field, Input, Textarea } from "@/components/ui";
import { profileLabel } from "@/domain/brewProfiles";
import { daysBetween } from "@/domain/dates";
import type { GravityUnit } from "@/domain/gravity";
import { shortDate } from "@/lib/format";
import type { BatchDetail, BeerOption, RecipeOption } from "@/server/services/brewery";
import { Lock, LockOpen, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cancelBrewAction, deleteReadingAction, dumpAction, editStayAction, gravityAction, releaseLockAction, setBatchFieldAction, splitAction } from "../../actions";
import { gravityExample, gravityIn } from "../../bits";
import { BrewPick, pickBbl, pickIds } from "../../brew-pick";
import { TankButtons, useForceable } from "../../floor-client";

type Batch = BatchDetail["batch"];
type Stay = BatchDetail["stays"][number];

/** One stay: its tank and dates, with the dates editable in place. */
export function StayRow({ stay, kindLabel, today }: { stay: Stay; kindLabel: string; today: string }) {
  const [editing, setEditing] = useState(false);
  const [start, setStart] = useState(stay.start);
  const [end, setEnd] = useState(stay.end ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, run] = useTransition();
  const [toast, show] = useToast();
  return (
    <div>
      {toast}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{stay.tankName}</span>
            <span className="text-xs text-muted">{kindLabel}</span>
            {stay.planned && <Badge>Planned</Badge>}
            {stay.current && <Badge tone="good">In now</Badge>}
          </div>
          <div className="num text-sm text-ink-2">
            {shortDate(stay.start)} to {stay.end ? shortDate(stay.end) : "—"}
            <span className="text-muted">{stay.days != null ? ` · ${stay.days} day${stay.days === 1 ? "" : "s"}${stay.current && !stay.end ? " so far" : ""}` : ""}{stay.current && stay.end ? " · due out" : ""}</span>
          </div>
        </div>
        <Button size="sm" variant="ghost" className="h-10 sm:h-8" onClick={() => setEditing(!editing)}>{editing ? "Close" : "Change dates"}</Button>
      </div>
      {editing && (
        <form
          className="mt-3 grid grid-cols-2 items-end gap-2 sm:grid-cols-[1fr_1fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const r = await editStayAction({ stayId: stay.id, start, end: end || null });
              if ("error" in r) setError(r.error);
              else {
                setError(null);
                setEditing(false);
                show(r.ok);
              }
            });
          }}
        >
          <Field label="In"><DatePicker value={start} today={today} onChange={(e) => setStart(e.target.value)} aria-label="Went in" /></Field>
          <Field label={stay.current ? "Due out" : "Out"} hint={stay.current || stay.planned ? "Blank: from the recipe" : undefined}><DatePicker value={end} today={today} onChange={(e) => setEnd(e.target.value)} aria-label="Came out" /></Field>
          <Button type="submit" variant="primary" disabled={pending} className="col-span-2 h-11 sm:col-span-1 sm:h-9">Save dates</Button>
          {start && end && end > start && <p className="num col-span-full text-xs text-muted">{daysBetween(start, end)} days</p>}
          {error && <p role="alert" className="col-span-full text-sm text-bad">{error}</p>}
        </form>
      )}
    </div>
  );
}

const KIND_TEXT = { og: "OG", fg: "FG", reading: "Reading" } as const;

/** Gravity readings over the brew's life, and a quick add. Shown and typed in the brewery's unit. */
export function GravityPanel({ batchId, readings, today, unit }: { batchId: string; readings: BatchDetail["readings"]; today: string; unit: GravityUnit }) {
  const [sg, setSg] = useState("");
  const [kind, setKind] = useState<"og" | "fg" | "reading">(readings.length ? "reading" : "og");
  const [on, setOn] = useState(today);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, run] = useTransition();
  const [toast, show] = useToast();
  const go = (fn: () => Promise<{ ok: string } | { error: string }>, after?: () => void) =>
    run(async () => {
      const r = await fn();
      if ("error" in r) setError(r.error);
      else {
        setError(null);
        after?.();
        show(r.ok);
      }
    });
  return (
    <Card>
      {toast}
      {readings.length > 0 && (
        <ul className="divide-y divide-border">
          {readings.map((r, i) => (
            <li key={`${r.on}-${i}`} className="flex min-h-12 items-center gap-3 px-4 py-2">
              <span className="num w-14 shrink-0 text-xs text-muted">{shortDate(r.on)}</span>
              <span className="num w-16 shrink-0 font-medium">{gravityIn(r.sg, unit)}</span>
              {r.kind !== "reading" && <Badge>{KIND_TEXT[r.kind]}</Badge>}
              <span className="min-w-0 flex-1 truncate text-sm text-muted">{r.note}</span>
              <button type="button" aria-label={`Remove the ${shortDate(r.on)} reading`} disabled={pending} onClick={() => go(() => deleteReadingAction(batchId, i))} className="grid size-10 shrink-0 place-items-center rounded-md text-muted hover:bg-bad-bg hover:text-bad sm:size-8">
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className={cx("grid grid-cols-2 items-end gap-2 p-4 sm:grid-cols-[auto_7rem_10rem_1fr_auto]", readings.length > 0 && "border-t border-border")}
        onSubmit={(e) => {
          e.preventDefault();
          go(() => gravityAction({ batchId, on, sg, kind, note: note || null }), () => { setSg(""); setNote(""); setKind("reading"); });
        }}
      >
        <div className="col-span-2 flex gap-1 sm:col-span-1" role="radiogroup" aria-label="Kind of reading">
          {(["reading", "og", "fg"] as const).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)} className={cx("h-10 flex-1 rounded-lg border px-2.5 text-sm font-medium transition-colors duration-120 sm:h-9", kind === k ? "border-ink bg-ink text-surface" : "border-border-strong bg-surface hover:bg-surface-2")}>{KIND_TEXT[k]}</button>
          ))}
        </div>
        <Field label="Gravity"><Input value={sg} onChange={(e) => setSg(e.target.value)} inputMode="decimal" placeholder={gravityExample(unit)} aria-label="Gravity" /></Field>
        <Field label="Taken on"><DatePicker value={on} today={today} onChange={(e) => setOn(e.target.value)} aria-label="Reading day" /></Field>
        <Field label="Note" className="col-span-2 sm:col-span-1"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" aria-label="Note" /></Field>
        <Button type="submit" variant="primary" disabled={pending || !sg.trim()} className="col-span-2 h-11 sm:col-span-1 sm:h-9">Add</Button>
        {error && <p role="alert" className="col-span-full text-sm text-bad">{error}</p>}
      </form>
    </Card>
  );
}

/** The brew's own fields, each saved as you leave it. */
export function BatchDetails({ batch: b, recipes, beers, unit }: { batch: Batch; recipes: RecipeOption[]; beers: BeerOption[]; unit: GravityUnit }) {
  const save = (f: Parameters<typeof setBatchFieldAction>[1]) => setBatchFieldAction.bind(null, b.id, f);
  const [notes, setNotes] = useState(b.notes ?? "");
  const [, run] = useTransition();
  const recipeBeer = recipes.find((r) => r.id === b.recipeId)?.beerId ?? null;
  const beerName = (id: string) => beers.find((x) => x.id === id)?.name ?? (id === b.beerId ? b.name : "its beer");
  const row = (label: string, node: React.ReactNode) => (
    <div className="grid grid-cols-[7.5rem_1fr] items-center gap-2 border-b border-border px-2 py-1 last:border-b-0 sm:grid-cols-[9rem_1fr]">
      <span className="px-2 text-sm text-muted">{label}</span>
      <div className="min-w-0">{node}</div>
    </div>
  );
  return (
    <Card>
      <div className="grid md:grid-cols-2 md:divide-x md:divide-border">
        <div>
          {row("Batch code", <GridCell grid="brew" col="code" value={b.code} onSave={save("code")} ariaLabel="Batch code" />)}
          {row("Beer", recipeBeer ? (
            // A brew with a recipe pours as the recipe's beer: change it on the recipe.
            <div className="px-2 py-1.5 text-sm">
              {beerName(recipeBeer)} <span className="text-xs text-muted">· from the recipe</span>
              {b.beerId !== recipeBeer && <div className="text-xs text-warn">Saved as {b.beerId ? beerName(b.beerId) : "no beer"}. Fix it on Kegs → Setup, under Needs a look.</div>}
            </div>
          ) : <GridSelect value={b.beerId ?? ""} options={[{ value: "", label: "None" }, ...beers.map((x) => ({ value: x.id, label: x.name }))]} onSave={save("beerId")} ariaLabel="Beer" />)}
          {row("Recipe", <GridSelect value={b.recipeId ?? ""} options={[{ value: "", label: "None" }, ...recipes.map((x) => ({ value: x.id, label: x.name }))]} onSave={save("recipeId")} ariaLabel="Recipe" />)}
          {row("Volume", <GridCell grid="brew" col="bbl" value={b.bbl} type="number" suffix="bbl" onSave={save("bbl")} ariaLabel="Volume in barrels" />)}
        </div>
        <div>
          {row("OG", <GridCell grid="brew" col="og" value={b.og != null ? gravityExample(unit, b.og) : null} placeholder={gravityExample(unit, 1.05)} onSave={save("og")} ariaLabel="Original gravity" />)}
          {row("FG", <GridCell grid="brew" col="fg" value={b.fg != null ? gravityExample(unit, b.fg) : null} placeholder={gravityExample(unit, 1.01)} onSave={save("fg")} ariaLabel="Final gravity" />)}
          {row("Ingredient cost", <GridCell grid="brew" col="cost" value={b.cost} type="number" prefix="$" decimals={2} placeholder="Not known yet" onSave={save("cost")} ariaLabel="Ingredient cost" />)}
          {row(b.status === "PLANNED" ? "Planned for" : "Brewed", (
            <DatePicker value={(b.status === "PLANNED" ? b.plannedOn : b.brewedOn) ?? ""} onChange={(e) => run(async () => { await setBatchFieldAction(b.id, b.status === "PLANNED" ? "plannedOn" : "brewedOn", e.target.value); })} aria-label={b.status === "PLANNED" ? "Planned brew day" : "Brew day"} />
          ))}
        </div>
      </div>
      <div className="border-t border-border p-4">
        <Field label="Notes">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== (b.notes ?? "") && run(async () => { await setBatchFieldAction(b.id, "notes", notes); })} placeholder="Anything worth remembering: dry hop timing, yeast pitch, how it tasted" rows={3} />
        </Field>
      </div>
    </Card>
  );
}

/** Cancel a planned brew, or dump one that's in a tank. */
export function BatchEnd({ batch: b, today }: { batch: Batch; today: string }) {
  const confirm = useConfirm();
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, run] = useTransition();
  if (b.status === "PLANNED") {
    return (
      <div className="flex justify-end">
        <Button variant="danger" disabled={pending} onClick={async () => {
          if (!(await confirm({ title: `Cancel ${b.code} ${b.name}?`, body: "It comes off the schedule and its tanks are free again.", confirmLabel: "Cancel brew", danger: true }))) return;
          run(async () => {
            const r = await cancelBrewAction(b.id);
            if ("error" in r) setError(r.error);
            else router.push("/brewery/schedule");
          });
        }}>Cancel this brew</Button>
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      </div>
    );
  }
  if (b.status !== "FERMENTING" && b.status !== "CONDITIONING") return null;
  return (
    <div className="flex flex-col items-end gap-2">
      {!open ? (
        <Button variant="danger" onClick={() => setOpen(true)}>Dump this brew</Button>
      ) : (
        <form className="flex w-full max-w-md gap-2" onSubmit={async (e) => {
          e.preventDefault();
          if (!reason.trim()) return setError("Say why, so the brew's history shows it");
          if (!(await confirm({ title: `Dump ${b.code} ${b.name}?`, body: "Its tank is freed and the brew is marked dumped. It stays in the list with your reason.", confirmLabel: "Dump it", danger: true }))) return;
          run(async () => {
            const r = await dumpAction({ batchId: b.id, on: today, reason });
            if ("error" in r) setError(r.error);
            else setOpen(false);
          });
        }}>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why? e.g. infected" aria-label="Reason" autoFocus />
          <Button type="submit" variant="danger" disabled={pending} className="bg-bad text-white hover:bg-bad/90 hover:text-white">Dump</Button>
        </form>
      )}
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
    </div>
  );
}

/** The brew's planned days: its timing, dry hop, fermenter move and release, and the release lock. */
export function PlanDates({ batch: b, today }: { batch: Batch; today: string }) {
  const [reason, setReason] = useState(b.lockedReason ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, run] = useTransition();
  const [toast, show] = useToast();
  const go = (fn: () => Promise<{ ok: string } | { error?: string } | void>) =>
    run(async () => {
      const r = await fn();
      if (r && "error" in r && r.error) setError(r.error);
      else {
        setError(null);
        if (r && "ok" in r) show(r.ok);
      }
    });
  const row = (label: string, node: React.ReactNode) => (
    <div className="grid grid-cols-[7.5rem_1fr] items-center gap-2 border-b border-border px-2 py-1 last:border-b-0 sm:grid-cols-[9rem_1fr]">
      <span className="px-2 text-sm text-muted">{label}</span>
      <div className="min-w-0">{node}</div>
    </div>
  );
  return (
    <Card>
      {toast}
      <div className="grid md:grid-cols-2 md:divide-x md:divide-border">
        <div>
          {row("Timing", <span className="block px-2 py-2 text-sm">{profileLabel(b.profile)}</span>)}
          {row("Dry hop", <DatePicker value={b.dryHopOn ?? ""} today={today} onChange={(e) => go(() => setBatchFieldAction(b.id, "dryHopOn", e.target.value))} aria-label="Dry-hop day" />)}
          {b.fvTransferOn && row("Fermenter move", <span className="num block px-2 py-2 text-sm">{shortDate(b.fvTransferOn)}</span>)}
        </div>
        <div>
          {row("Release", <DatePicker value={b.tapOn ?? ""} today={today} onChange={(e) => go(() => setBatchFieldAction(b.id, "tapOn", e.target.value))} aria-label="Release day" />)}
          {row("Locked", (
            <div className="flex flex-wrap items-center gap-2 px-1 py-1">
              <Button
                type="button"
                size="sm"
                variant={b.tapLocked ? "primary" : "secondary"}
                disabled={pending || (!b.tapLocked && !b.tapOn)}
                aria-pressed={b.tapLocked}
                className="h-10 sm:h-8"
                onClick={() => go(() => releaseLockAction({ batchId: b.id, locked: !b.tapLocked, reason: reason || null }))}
              >
                {b.tapLocked ? <><Lock className="size-3.5" />Locked</> : <><LockOpen className="size-3.5" />Lock the release</>}
              </Button>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} onBlur={() => reason !== (b.lockedReason ?? "") && go(() => setBatchFieldAction(b.id, "lockedReason", reason))} placeholder="Why, e.g. release event" aria-label="Why the release is locked" className="min-w-0 flex-1" />
            </div>
          ))}
        </div>
      </div>
      <p className="border-t border-border px-4 py-2.5 text-xs text-muted">A locked release stays on its day when the brew moves; the schedule says when a new brew day is too late for it.</p>
      {error && <p role="alert" className="px-4 pb-3 text-sm text-bad">{error}</p>}
    </Card>
  );
}

/**
 * Split part of this brew into another fermenter as its own brew, like the
 * two lagers brewed together and split at two weeks.
 */
export function SplitForm({ batch: b, today, recipes, beers, choices, brewOn }: { batch: Batch; today: string; recipes: RecipeOption[]; beers: BeerOption[]; choices: BatchDetail["splitTo"]; brewOn: string }) {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState("");
  const [bbl, setBbl] = useState("");
  const [tankId, setTankId] = useState("");
  const [on, setOn] = useState(today > brewOn ? today : brewOn);
  const [error, setError] = useState<string | null>(null);
  const [pending, run] = useTransition();
  const [toast, show] = useToast();
  const forceable = useForceable();
  const tanks = choices.filter((c) => c.kind !== "BRITE");
  if (!open) {
    return (
      <Card className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
        {toast}
        <p className="text-sm text-muted">Brewed together, then part goes into its own fermenter as another beer.</p>
        <Button type="button" variant="secondary" className="h-11 sm:h-9" onClick={() => setOpen(true)}>Split into another fermenter</Button>
      </Card>
    );
  }
  return (
    <Card className="p-4">
      {toast}
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!pick) return setError("Pick what the split part becomes");
          if (!tankId) return setError("Pick the fermenter it goes into");
          run(async () => {
            const r = await forceable((force) => splitAction({ batchId: b.id, ...pickIds(pick), bbl, tankId, on, force }), "Split into that tank?", "Split anyway");
            if (!r) return;
            if ("error" in r) setError(r.error);
            else {
              setError(null);
              setOpen(false);
              setPick("");
              show(r.ok);
            }
          });
        }}
      >
        <div className="text-sm font-semibold">Split {b.code} into another fermenter</div>
        <BrewPick value={pick} onChange={(v) => { setPick(v); if (!bbl) setBbl(String(Math.min(pickBbl(v, recipes, 4), Math.max(1, (b.bbl ?? 8) - 1)))); }} recipes={recipes} beers={beers} label="What the split part becomes" />
        <div className="grid grid-cols-2 gap-2">
          <Field label="Barrels taken" hint={b.bbl != null ? `Of ${b.bbl} bbl` : undefined}><Input value={bbl} onChange={(e) => setBbl(e.target.value)} inputMode="decimal" aria-label="Barrels taken" /></Field>
          <Field label="Split on"><DatePicker value={on} today={today} onChange={(e) => setOn(e.target.value)} aria-label="Split day" /></Field>
        </div>
        <TankButtons choices={tanks} value={tankId} onPick={setTankId} bbl={Number(bbl) || null} label="Fermenter it goes into" />
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={pending} className="h-11 flex-1 sm:h-9 sm:flex-none">{pending ? "Saving…" : "Split it"}</Button>
          <Button type="button" variant="ghost" className="h-11 sm:h-9" onClick={() => setOpen(false)}>Cancel</Button>
        </div>
        <p className="text-xs text-muted">The new brew gets the next letter on this code ({b.code}B), its share of the volume and cost, and its own dates from its recipe.</p>
      </form>
    </Card>
  );
}

/** The brew's history: moves, stage changes, packaging and splits, as noted. */
export function History({ entries }: { entries: BatchDetail["timeline"] }) {
  return (
    <Card>
      <ol className="divide-y divide-border">
        {entries.map((e, i) => (
          <li key={`${e.on}-${i}`} className="flex gap-3 px-4 py-2.5">
            <span className="num w-14 shrink-0 pt-0.5 text-xs text-muted">{shortDate(e.on)}</span>
            <span className="min-w-0 text-sm text-pretty">{e.text}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

/** "Split from 26-014" / "Split into 26-014B, 26-014C", linked. */
export function SplitLinks({ from, into }: { from: { id: string; code: string } | null; into: { id: string; code: string }[] }) {
  if (!from && !into.length) return null;
  return (
    <p className="mb-6 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-2">
      {from && <span>Split from <Link href={`/brewery/batches/${from.id}`} className="num font-medium underline underline-offset-2">{from.code}</Link></span>}
      {into.length > 0 && <span>Split into {into.map((s, i) => <span key={s.id}>{i ? ", " : ""}<Link href={`/brewery/batches/${s.id}`} className="num font-medium underline underline-offset-2">{s.code}</Link></span>)}</span>}
    </p>
  );
}
