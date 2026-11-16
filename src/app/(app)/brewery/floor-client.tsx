"use client";

import { useConfirm } from "@/components/dialog";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, cx, DatePicker, Field, Input } from "@/components/ui";
import { daysBetween } from "@/domain/dates";
import { shortDate } from "@/lib/format";
import type { BatchView, BeerOption, BriteChoice, RecipeOption, TankView } from "@/server/services/brewery";
import type { FloorTank } from "@/domain/tankPlan";
import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { brewIntoTankAction, dumpAction, editStayAction, gravityAction, markBrewedAction, packageAction, transferAction } from "./actions";
import { BeerDot, bblText, DayBar, gravityText } from "./bits";
import { BrewPick, pickBbl, pickIds } from "./brew-pick";

type Mode = "brew" | "brewed" | "transfer" | "package" | "gravity" | "dates" | "dump" | null;
type Res = { ok: string } | { error: string };

/**
 * One tank on the floor: what's in it and how far along, or when it's next
 * booked; and the things to do with it, each opening a short form in the card.
 */
export function TankCard({ tank: f, today, batch, next, transferTo, plannedBrite, recipes, beers }: {
  tank: FloorTank & { tank: TankView };
  today: string;
  batch: BatchView | null;
  next: BatchView | null;
  transferTo: BriteChoice[];
  plannedBrite: string | null;
  recipes: RecipeOption[];
  beers: BeerOption[];
}) {
  const [mode, setMode] = useState<Mode>(null);
  const [toast, show] = useToast();
  const t = f.tank;
  const now = f.now;
  const prompt = now?.prompt;
  const late = prompt ? prompt.overdueDays : -1;
  const done = (r: Res) => {
    if ("ok" in r) {
      show(r.ok);
      setMode(null);
    }
  };
  const nextSoon = !now && next?.status === "PLANNED" && f.next && f.next.start <= addDay(today);

  return (
    <Card id={`tank-${t.id}`} className={cx("flex scroll-mt-24 flex-col p-4", prompt && late >= 3 && "border-bad/40", prompt && late < 3 && "border-warn/40")}>
      {toast}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-base font-semibold tracking-tight">{t.name}</div>
          <div className="num text-xs text-muted">{bblText(t.capacityBbl)}</div>
        </div>
        {prompt ? (
          <Badge tone={late >= 3 ? "bad" : "warn"}>{prompt.label}</Badge>
        ) : now ? (
          <Badge tone="good">{now.stage === "ferment" ? "Fermenting" : "Conditioning"}</Badge>
        ) : (
          <Badge>Empty</Badge>
        )}
      </div>

      {now && batch ? (
        <div className="mt-3 space-y-3">
          <Link href={`/brewery/batches/${batch.id}`} className="group flex min-h-10 items-center gap-2.5">
            <BeerDot color={batch.color} className="size-3.5" />
            <span className="min-w-0">
              <span className="block truncate text-[0.95rem] font-medium group-hover:underline">{batch.name}</span>
              <span className="num block text-xs text-muted">{batch.code}{batch.bbl ? ` · ${bblText(batch.bbl)}` : ""}</span>
            </span>
          </Link>
          <DayBar day={now.day} of={now.of} />
          <dl className="num grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted">In since</dt>
            <dd className="text-right">{shortDate(now.start)}</dd>
            <dt className="text-muted">{now.stage === "ferment" ? "Transfer" : "Package"}</dt>
            <dd className={cx("text-right", late > 0 && "font-medium text-warn")}>{shortDate(now.dueOn)}</dd>
            <dt className="text-muted">OG · FG</dt>
            <dd className="text-right">{gravityText(batch.og)} · {gravityText(batch.fg)}</dd>
          </dl>
        </div>
      ) : (
        <div className="mt-3 text-sm text-muted">
          {next && f.next ? (
            <>
              {nextSoon ? "Brew day " : "Booked from "}
              <span className="font-medium text-ink">{f.next.start === today ? "today" : f.next.start === addDay(today) ? "tomorrow" : shortDate(f.next.start)}</span>
              {f.next.start < today && <span className="text-warn"> (was {shortDate(f.next.start)})</span>}
            </>
          ) : (
            "Nothing booked."
          )}
        </div>
      )}

      {next && f.next && (
        <Link href={`/brewery/batches/${next.id}`} className="mt-3 flex min-h-10 items-center gap-2 rounded-lg bg-surface-2/60 px-3 py-2 text-xs hover:bg-surface-2">
          <span className="text-muted">{now ? "Next" : "Coming"}</span>
          <BeerDot color={next.color} className="size-2.5" />
          <span className="min-w-0 flex-1 truncate font-medium">{next.name}</span>
          <span className="num shrink-0 text-muted">{next.code} · {shortDate(f.next.start)}</span>
        </Link>
      )}

      <div className="mt-auto pt-4">
        {mode === null ? (
          <div className="flex flex-wrap gap-1.5">
            {now && batch ? (
              <>
                {now.stage === "ferment" && <Button size="sm" variant={prompt?.kind === "transfer" ? "primary" : "secondary"} className="h-10 sm:h-8" onClick={() => setMode("transfer")}>Transfer</Button>}
                <Button size="sm" variant={prompt?.kind === "package" ? "primary" : "secondary"} className="h-10 sm:h-8" onClick={() => setMode("package")}>Package</Button>
                <Button size="sm" variant="ghost" className="h-10 sm:h-8" onClick={() => setMode("gravity")}>Gravity</Button>
                <Button size="sm" variant="ghost" className="h-10 sm:h-8" onClick={() => setMode("dates")}>Dates</Button>
                <Button size="sm" variant="danger" className="h-10 sm:h-8" onClick={() => setMode("dump")}>Dump</Button>
              </>
            ) : (
              <>
                {nextSoon && <Button size="sm" variant="primary" className="h-10 sm:h-8" onClick={() => setMode("brewed")}>Mark {next!.name} brewed</Button>}
                <Button size="sm" variant={nextSoon ? "secondary" : "primary"} className="h-10 sm:h-8" onClick={() => setMode("brew")}>Brew into {t.name}</Button>
              </>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-surface-2/40 p-3">
            {mode === "brew" && <BrewForm tank={t} today={today} recipes={recipes} beers={beers} onDone={done} onCancel={() => setMode(null)} />}
            {mode === "brewed" && next && <BrewedForm batch={next} tankId={t.id} today={today} onDone={done} onCancel={() => setMode(null)} />}
            {mode === "transfer" && batch && <TransferForm batch={batch} from={t} today={today} choices={transferTo} pencilled={plannedBrite} onDone={done} onCancel={() => setMode(null)} />}
            {mode === "package" && batch && <PackageForm batch={batch} today={today} onDone={done} onCancel={() => setMode(null)} />}
            {mode === "gravity" && batch && <GravityForm batch={batch} today={today} onDone={done} onCancel={() => setMode(null)} />}
            {mode === "dates" && now && <DatesForm stayId={now.stayId} start={now.start} end={now.dueOn} today={today} stage={now.stage} onDone={done} onCancel={() => setMode(null)} />}
            {mode === "dump" && batch && <DumpForm batch={batch} tankName={t.name} today={today} onDone={done} onCancel={() => setMode(null)} />}
          </div>
        )}
      </div>
    </Card>
  );
}

const addDay = (d: string) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
};

/** The shared frame of every form in a card: title, fields, an error line, and Save / Cancel. */
function FormFrame({ title, children, error, pending, submit, onSubmit, onCancel, danger }: { title: string; children: ReactNode; error: string | null; pending: boolean; submit: string; onSubmit: () => void; onCancel: () => void; danger?: boolean }) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="space-y-3"
    >
      <div className="text-sm font-semibold">{title}</div>
      {children}
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" variant={danger ? "danger" : "primary"} disabled={pending} className={cx("h-11 flex-1 sm:h-9", danger && "bg-bad text-white hover:bg-bad/90 hover:text-white")}>{pending ? "Saving…" : submit}</Button>
        <Button type="button" variant="ghost" className="h-11 sm:h-9" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

/** Run an action; keep its error in the form, hand success to the card. */
function useSubmit(onDone: (r: Res) => void) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const go = (fn: () => Promise<Res>) =>
    start(async () => {
      const r = await fn();
      if ("error" in r) setError(r.error);
      else {
        setError(null);
        onDone(r);
      }
    });
  return { error, pending, go, setError };
}

interface FormProps {
  today: string;
  onDone: (r: Res) => void;
  onCancel: () => void;
}

function BrewForm({ tank, today, recipes, beers, onDone, onCancel }: FormProps & { tank: TankView; recipes: RecipeOption[]; beers: BeerOption[] }) {
  const [pick, setPick] = useState("");
  const [on, setOn] = useState(today);
  const [bbl, setBbl] = useState(String(tank.capacityBbl));
  const [code, setCode] = useState("");
  const [og, setOg] = useState("");
  const s = useSubmit(onDone);
  return (
    <FormFrame title={`Brew into ${tank.name}`} submit="Brewed" error={s.error} pending={s.pending} onCancel={onCancel}
      onSubmit={() => {
        if (!pick) return s.setError("Pick what you're brewing");
        s.go(() => brewIntoTankAction({ tankId: tank.id, ...pickIds(pick), brewedOn: on, bbl, code: code || null, og: og || null }));
      }}
    >
      <BrewPick value={pick} onChange={(v) => { setPick(v); setBbl(String(Math.min(tank.capacityBbl, pickBbl(v, recipes, tank.capacityBbl)))); }} recipes={recipes} beers={beers} />
      <div className="grid grid-cols-2 gap-2">
        <Field label="Brew day"><DatePicker value={on} today={today} onChange={(e) => setOn(e.target.value)} aria-label="Brew day" /></Field>
        <Field label="Volume, bbl"><Input value={bbl} onChange={(e) => setBbl(e.target.value)} inputMode="decimal" aria-label="Volume in barrels" /></Field>
        <Field label="Batch code" hint="Blank: next number"><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Auto" aria-label="Batch code" autoComplete="off" /></Field>
        <Field label="OG" hint="Optional"><Input value={og} onChange={(e) => setOg(e.target.value)} inputMode="decimal" placeholder="1.050" aria-label="Original gravity" /></Field>
      </div>
    </FormFrame>
  );
}

function BrewedForm({ batch, tankId, today, onDone, onCancel }: FormProps & { batch: BatchView; tankId: string }) {
  const [on, setOn] = useState(today);
  const [bbl, setBbl] = useState(batch.bbl != null ? String(batch.bbl) : "");
  const [og, setOg] = useState("");
  const s = useSubmit(onDone);
  return (
    <FormFrame title={`${batch.code} ${batch.name} brewed`} submit="Brewed" error={s.error} pending={s.pending} onCancel={onCancel}
      onSubmit={() => s.go(() => markBrewedAction({ batchId: batch.id, brewedOn: on, bbl: bbl || null, og: og || null, tankId }))}
    >
      <div className="grid grid-cols-2 gap-2">
        <Field label="Brew day"><DatePicker value={on} today={today} onChange={(e) => setOn(e.target.value)} aria-label="Brew day" /></Field>
        <Field label="Volume, bbl"><Input value={bbl} onChange={(e) => setBbl(e.target.value)} inputMode="decimal" aria-label="Volume in barrels" /></Field>
        <Field label="OG" hint="Optional" className="col-span-2 sm:col-span-1"><Input value={og} onChange={(e) => setOg(e.target.value)} inputMode="decimal" placeholder="1.050" aria-label="Original gravity" /></Field>
      </div>
      <p className="text-xs text-muted">The cost is worked out from today's ingredient prices and kept with the brew.</p>
    </FormFrame>
  );
}

function TransferForm({ batch, from, today, choices, pencilled, onDone, onCancel }: FormProps & { batch: BatchView; from: TankView; choices: BriteChoice[]; pencilled: string | null }) {
  const usable = choices.filter((c) => c.id !== from.id);
  const first = usable.find((c) => c.id === pencilled && c.freeNow) ?? usable.find((c) => c.freeNow);
  const [to, setTo] = useState(first?.id ?? "");
  const [on, setOn] = useState(today);
  const s = useSubmit(onDone);
  return (
    <FormFrame title={`Move ${batch.name} out of ${from.name}`} submit="Moved" error={s.error} pending={s.pending} onCancel={onCancel}
      onSubmit={() => (to ? s.go(() => transferAction({ batchId: batch.id, tankId: to, on })) : s.setError("Pick the tank it went into"))}
    >
      {usable.length ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {usable.map((c) => {
            const small = batch.bbl != null && batch.bbl > c.capacityBbl;
            const off = !c.freeNow || small;
            return (
              <button
                key={c.id}
                type="button"
                disabled={off}
                aria-pressed={to === c.id}
                onClick={() => setTo(c.id)}
                className={cx("flex min-h-14 flex-col items-start justify-center rounded-xl border px-3 py-2 text-left transition-colors duration-120", to === c.id ? "border-ink bg-surface ring-1 ring-ink" : "border-border-strong bg-surface hover:bg-surface-2", off && "opacity-50")}
              >
                <span className="text-sm font-semibold">{c.name}{c.id === pencilled ? " · planned" : ""}</span>
                <span className="text-[11px] text-muted">{!c.freeNow ? "In use" : small ? `Holds ${c.capacityBbl} bbl` : c.bookedFrom ? `Free until ${shortDate(c.bookedFrom)}` : "Free"}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-muted">No brite tanks yet. Add one on Setup, or package straight from {from.name}.</p>
      )}
      <Field label="Moved on"><DatePicker value={on} today={today} onChange={(e) => setOn(e.target.value)} aria-label="Transfer day" /></Field>
    </FormFrame>
  );
}

function PackageForm({ batch, today, onDone, onCancel }: FormProps & { batch: BatchView }) {
  const [on, setOn] = useState(today);
  const s = useSubmit(onDone);
  return (
    <FormFrame title={`Package ${batch.name}`} submit="Packaged" error={s.error} pending={s.pending} onCancel={onCancel}
      onSubmit={() => s.go(() => packageAction({ batchId: batch.id, on }))}
    >
      <Field label="Packaged on"><DatePicker value={on} today={today} onChange={(e) => setOn(e.target.value)} aria-label="Packaging day" /></Field>
      <p className="text-xs text-muted">This empties the tank and makes keg batch <span className="num font-medium text-ink">{batch.kegBatchCode ?? batch.code}</span>, so the kegs you fill can be marked as this brew.</p>
    </FormFrame>
  );
}

function GravityForm({ batch, today, onDone, onCancel }: FormProps & { batch: BatchView }) {
  const [kind, setKind] = useState<"og" | "fg" | "reading">(batch.og == null ? "og" : "reading");
  const [sg, setSg] = useState("");
  const [on, setOn] = useState(today);
  const [note, setNote] = useState("");
  const s = useSubmit(onDone);
  const kinds = [{ v: "reading", l: "Reading" }, { v: "og", l: "OG" }, { v: "fg", l: "FG" }] as const;
  return (
    <FormFrame title={`Gravity for ${batch.name}`} submit="Save" error={s.error} pending={s.pending} onCancel={onCancel}
      onSubmit={() => s.go(() => gravityAction({ batchId: batch.id, on, sg, kind, note: note || null }))}
    >
      <div className="flex gap-1.5" role="radiogroup" aria-label="Kind of reading">
        {kinds.map((k) => (
          <button key={k.v} type="button" role="radio" aria-checked={kind === k.v} onClick={() => setKind(k.v)} className={cx("h-10 flex-1 rounded-lg border text-sm font-medium transition-colors duration-120 sm:h-8", kind === k.v ? "border-ink bg-ink text-surface" : "border-border-strong bg-surface hover:bg-surface-2")}>
            {k.l}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Gravity"><Input value={sg} onChange={(e) => setSg(e.target.value)} inputMode="decimal" placeholder="1.012" aria-label="Specific gravity" autoFocus /></Field>
        <Field label="Taken on"><DatePicker value={on} today={today} onChange={(e) => setOn(e.target.value)} aria-label="Reading day" /></Field>
      </div>
      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional), e.g. 66°F, tasted clean" aria-label="Note" />
    </FormFrame>
  );
}

function DatesForm({ stayId, start, end, today, stage, onDone, onCancel }: FormProps & { stayId: string; start: string; end: string; stage: "ferment" | "condition" }) {
  const [a, setA] = useState(start);
  const [b, setB] = useState(end);
  const s = useSubmit(onDone);
  const days = a && b ? daysBetween(a, b) : null;
  return (
    <FormFrame title="Dates in this tank" submit="Save dates" error={s.error} pending={s.pending} onCancel={onCancel}
      onSubmit={() => s.go(() => editStayAction({ stayId, start: a, end: b || null }))}
    >
      <div className="grid grid-cols-2 gap-2">
        <Field label="Went in"><DatePicker value={a} today={today} onChange={(e) => setA(e.target.value)} aria-label="Went in" /></Field>
        <Field label={stage === "ferment" ? "Transfer on" : "Package on"}><DatePicker value={b} today={today} onChange={(e) => setB(e.target.value)} aria-label="Due out" /></Field>
      </div>
      {days != null && days > 0 && <p className="num text-xs text-muted">{days} days in the tank.</p>}
    </FormFrame>
  );
}

function DumpForm({ batch, tankName, today, onDone, onCancel }: FormProps & { batch: BatchView; tankName: string }) {
  const confirm = useConfirm();
  const [reason, setReason] = useState("");
  const [on, setOn] = useState(today);
  const s = useSubmit(onDone);
  return (
    <FormFrame title={`Dump ${batch.name}`} submit="Dump it" danger error={s.error} pending={s.pending} onCancel={onCancel}
      onSubmit={async () => {
        if (!reason.trim()) return s.setError("Say why, so the brew's history shows it");
        if (!(await confirm({ title: `Dump ${batch.code} ${batch.name}?`, body: `${tankName} is freed and the brew is marked dumped. It stays in the brew list with your reason.`, confirmLabel: "Dump it", danger: true }))) return;
        s.go(() => dumpAction({ batchId: batch.id, on, reason }));
      }}
    >
      <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why? e.g. infected, off flavour" aria-label="Reason" autoFocus />
      <Field label="Dumped on"><DatePicker value={on} today={today} onChange={(e) => setOn(e.target.value)} aria-label="Dump day" /></Field>
    </FormFrame>
  );
}
