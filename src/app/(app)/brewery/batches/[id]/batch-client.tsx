"use client";

import { useConfirm } from "@/components/dialog";
import { GridCell, GridSelect } from "@/components/grid";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, cx, DatePicker, Field, Input, Textarea } from "@/components/ui";
import { daysBetween } from "@/domain/dates";
import { shortDate } from "@/lib/format";
import type { BatchDetail, BeerOption, RecipeOption } from "@/server/services/brewery";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cancelBrewAction, deleteReadingAction, dumpAction, editStayAction, gravityAction, setBatchFieldAction } from "../../actions";

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

/** Gravity readings over the brew's life, and a quick add. */
export function GravityPanel({ batchId, readings, today }: { batchId: string; readings: BatchDetail["readings"]; today: string }) {
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
              <span className="num w-14 shrink-0 font-medium">{r.sg.toFixed(3)}</span>
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
        <Field label="Gravity"><Input value={sg} onChange={(e) => setSg(e.target.value)} inputMode="decimal" placeholder="1.012" aria-label="Specific gravity" /></Field>
        <Field label="Taken on"><DatePicker value={on} today={today} onChange={(e) => setOn(e.target.value)} aria-label="Reading day" /></Field>
        <Field label="Note" className="col-span-2 sm:col-span-1"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" aria-label="Note" /></Field>
        <Button type="submit" variant="primary" disabled={pending || !sg.trim()} className="col-span-2 h-11 sm:col-span-1 sm:h-9">Add</Button>
        {error && <p role="alert" className="col-span-full text-sm text-bad">{error}</p>}
      </form>
    </Card>
  );
}

/** The brew's own fields, each saved as you leave it. */
export function BatchDetails({ batch: b, recipes, beers }: { batch: Batch; recipes: RecipeOption[]; beers: BeerOption[] }) {
  const save = (f: Parameters<typeof setBatchFieldAction>[1]) => setBatchFieldAction.bind(null, b.id, f);
  const [notes, setNotes] = useState(b.notes ?? "");
  const [, run] = useTransition();
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
          {row("Beer", <GridSelect value={b.beerId ?? ""} options={[{ value: "", label: "None" }, ...beers.map((x) => ({ value: x.id, label: x.name }))]} onSave={save("beerId")} ariaLabel="Beer" />)}
          {row("Recipe", <GridSelect value={b.recipeId ?? ""} options={[{ value: "", label: "None" }, ...recipes.map((x) => ({ value: x.id, label: x.name }))]} onSave={save("recipeId")} ariaLabel="Recipe" />)}
          {row("Volume", <GridCell grid="brew" col="bbl" value={b.bbl} type="number" suffix="bbl" onSave={save("bbl")} ariaLabel="Volume in barrels" />)}
        </div>
        <div>
          {row("OG", <GridCell grid="brew" col="og" value={b.og != null ? b.og.toFixed(3) : null} placeholder="1.050" onSave={save("og")} ariaLabel="Original gravity" />)}
          {row("FG", <GridCell grid="brew" col="fg" value={b.fg != null ? b.fg.toFixed(3) : null} placeholder="1.010" onSave={save("fg")} ariaLabel="Final gravity" />)}
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
