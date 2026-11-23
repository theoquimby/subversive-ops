"use client";

import { HelpTip, HelpZone } from "@/components/help";
import { Button, Card, cx, Input } from "@/components/ui";
import { amountText, formatPrepQty, type PrepStatus, type PrepUnit } from "@/domain/prep";
import { RelativeTime } from "@/components/relative-time";
import { businessTime } from "@/lib/format";
import { Check, ChevronDown, ChevronRight, CloudOff, Minus, Plus, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { readPrepQueue, sendPrep, usePrepQueue } from "./queue";

export interface BoardLine {
  recipeId: string;
  name: string;
  station: string;
  status: PrepStatus;
  unit: PrepUnit;
  batchBase: number;
  stepBase: number;
  makeBase: number;
  amountText: string;
  why: string;
  overShelf: boolean;
  shelfLifeDays: number | null;
  shelfCapBase: number | null;
  onHandBase: number;
  onHandKnown: boolean;
  countedAt: string | null;
  countedBy: string | null;
  runsOutIn: number | null;
  done: { qtyBase: number; by: string | null; at: string } | null;
}

type Done = BoardLine["done"];

// Business-local time, so the server's HTML and the phone's first render agree (no hydration error).
const doneLabel = (d: NonNullable<Done>) => `${d.by ?? "Someone"} · ${businessTime(d.at)}`;

function overShelfText(l: BoardLine): string {
  const used = l.shelfCapBase != null ? formatPrepQty(l.shelfCapBase, l.unit) : null;
  return `Keeps ${l.shelfLifeDays} day${l.shelfLifeDays === 1 ? "" : "s"}${used ? `; about ${used} gets used in that time` : ""}. Make less if you can.`;
}

function lastsText(l: BoardLine): string | null {
  if (l.runsOutIn == null) return l.status === "enough" ? "Lasts the whole window" : null;
  if (l.runsOutIn < 1) return "Runs out during service";
  const d = Math.floor(l.runsOutIn);
  return `Lasts about ${d} day${d === 1 ? "" : "s"}`;
}

export function PrepBoard({ lines, day, me, manager }: { lines: BoardLine[]; day: string; me: string; manager: boolean }) {
  const queue = usePrepQueue();
  // Ticks shown before the server confirms (or while they wait for signal).
  const [overrides, setOverrides] = useState<Record<string, Done>>({});
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fresh server data: keep only ticks still waiting to send.
  useEffect(() => {
    const waiting = readPrepQueue().filter((q) => q.kind !== "count" && "day" in q && q.day === day);
    setOverrides(Object.fromEntries(waiting.map((q) => [q.recipeId, q.kind === "done" ? { qtyBase: q.qtyBase, by: me, at: new Date().toISOString() } : null])));
  }, [lines, day, me]);

  const doneOf = (l: BoardLine): Done => (l.recipeId in overrides ? overrides[l.recipeId] : l.done);
  const make = lines.filter((l) => l.status === "make");
  const enough = lines.filter((l) => l.status === "enough");
  const nodata = lines.filter((l) => l.status === "nodata");
  const doneCount = make.filter((l) => doneOf(l)).length;
  const byStation = new Map<string, BoardLine[]>();
  for (const l of make) byStation.set(l.station, [...(byStation.get(l.station) ?? []), l]);
  const stations = [...byStation];

  const tick = async (l: BoardLine) => {
    setError(null);
    const was = doneOf(l);
    const qtyBase = amounts[l.recipeId] ?? l.makeBase;
    const next: Done = was ? null : { qtyBase, by: me, at: new Date().toISOString() };
    setOverrides((o) => ({ ...o, [l.recipeId]: next }));
    const r = await sendPrep(was ? { kind: "undo", recipeId: l.recipeId, day, label: `Undo ${l.name}` } : { kind: "done", recipeId: l.recipeId, day, qtyBase, label: `${l.name} done` });
    if ("error" in r) {
      setOverrides((o) => ({ ...o, [l.recipeId]: was }));
      setError(r.error);
    }
  };

  const waiting = queue.length;

  return (
    <div>
      {waiting > 0 && (
        <p className="mb-4 flex items-center gap-2 rounded-xl bg-warn-bg px-4 py-3 text-sm font-medium text-warn" role="status">
          <CloudOff className="size-4 shrink-0" /> {waiting} change{waiting === 1 ? "" : "s"} waiting to send. They go as soon as there&apos;s signal.
        </p>
      )}
      {error && <p className="mb-4 rounded-xl bg-bad-bg px-4 py-3 text-sm text-bad" role="alert">{error}</p>}

      {make.length > 0 ? (
        <HelpZone id="prep.progress" className="mb-6">
          <div className="flex items-baseline justify-between gap-3">
            <div className="text-sm text-ink-2"><span className="num text-lg font-semibold text-ink">{doneCount}</span> of <span className="num">{make.length}</span> done</div>
            {doneCount === make.length && <span className="text-sm font-medium text-good">All prepped</span>}
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
            <div className="h-full rounded-full bg-good transition-[width] duration-260 ease-motion motion-reduce:transition-none" style={{ width: `${(doneCount / Math.max(1, make.length)) * 100}%` }} />
          </div>
        </HelpZone>
      ) : (
        <Card className="mb-8 border-good/30 bg-good-bg p-4 text-sm font-medium text-good">Nothing to prep: everything on the list is covered.</Card>
      )}

      <div data-tour="prep.list">
        {stations.map(([station, ls]) => (
          <section key={station} className="mb-8">
            {/* One station needs no heading: the page title and the progress above already say it. */}
            {stations.length > 1 && (
              <h2 className="mb-2 flex items-baseline justify-between px-1 text-[0.95rem] font-semibold text-ink">
                {station}
                <span className="num text-xs font-normal text-muted">{ls.filter((l) => doneOf(l)).length} of {ls.length} done</span>
              </h2>
            )}
            <Card className="divide-y divide-border overflow-hidden">
              {ls.map((l, i) => (
                <PrepRow
                  key={l.recipeId}
                  line={l}
                  first={i === 0 && station === stations[0][0]}
                  done={doneOf(l)}
                  amount={amounts[l.recipeId] ?? l.makeBase}
                  setAmount={(v) => setAmounts((a) => ({ ...a, [l.recipeId]: v }))}
                  open={open === l.recipeId}
                  toggle={() => setOpen((o) => (o === l.recipeId ? null : l.recipeId))}
                  onTick={() => void tick(l)}
                  day={day}
                />
              ))}
            </Card>
          </section>
        ))}
      </div>

      {enough.length > 0 && (
        <Collapsible title="Enough on hand" count={enough.length} help="prep.enough">
          {enough.map((l) => <StockRow key={l.recipeId} line={l} open={open === l.recipeId} toggle={() => setOpen((o) => (o === l.recipeId ? null : l.recipeId))} />)}
        </Collapsible>
      )}
      {nodata.length > 0 && (
        <Collapsible title="No forecast or par yet" count={nodata.length} help="prep.nodata" hint={manager ? <>Nothing on the menu sells it yet. Set a par in <Link href="/prep/setup" className="underline">Prep setup</Link> to keep some on hand.</> : "Nothing on the menu sells it yet. Ask a manager to set a par."}>
          {nodata.map((l) => <StockRow key={l.recipeId} line={l} open={open === l.recipeId} toggle={() => setOpen((o) => (o === l.recipeId ? null : l.recipeId))} />)}
        </Collapsible>
      )}
    </div>
  );
}

function PrepRow({ line: l, first, done, amount, setAmount, open, toggle, onTick, day }: { line: BoardLine; first: boolean; done: Done; amount: number; setAmount: (v: number) => void; open: boolean; toggle: () => void; onTick: () => void; day: string }) {
  const changed = Math.abs(amount - l.makeBase) > 1e-6;
  const shown = done ? amountText(done.qtyBase, l.batchBase, l.unit) : changed ? amountText(amount, l.batchBase, l.unit) : l.amountText;
  return (
    <div className={cx("transition-colors duration-180", done && "bg-surface-2/40")}>
      <div className="flex items-start gap-3 py-3 pr-2 pl-3">
        <button
          type="button"
          onClick={onTick}
          aria-pressed={!!done}
          aria-label={done ? `Mark ${l.name} not done` : `Mark ${l.name} done`}
          data-tour={first ? "prep.tick" : undefined}
          className={cx(
            "mt-0.5 grid size-11 shrink-0 place-items-center rounded-full border-2 transition-[background-color,border-color,transform] duration-180 ease-motion active:scale-95 motion-reduce:transition-none",
            done ? "border-good bg-good text-bg" : "border-border-strong bg-surface text-transparent hover:border-ink-2/60",
          )}
        >
          <Check className={cx("size-5", done && "animate-pop motion-reduce:animate-none")} strokeWidth={3} />
        </button>
        <button type="button" onClick={toggle} aria-expanded={open} className="min-w-0 flex-1 text-left" data-tour={first ? "prep.line" : undefined}>
          <div className={cx("font-medium", done ? "text-muted line-through decoration-1" : "text-ink")}>{l.name}</div>
          <div className={cx("num mt-0.5 text-[1.05rem] font-semibold", done ? "text-muted" : "text-ink")}>{shown}{changed && !done && <span className="ml-1.5 text-xs font-normal text-muted">(adjusted)</span>}</div>
          {done ? (
            <div className="mt-0.5 text-xs text-good">Done · {doneLabel(done)}</div>
          ) : (
            <>
              {!open && <div className="mt-1 line-clamp-3 text-sm leading-snug text-ink-2">{l.why}</div>}
              {l.overShelf && <div className="mt-0.5 text-xs text-warn">{overShelfText(l)}</div>}
            </>
          )}
        </button>
        <button type="button" onClick={toggle} aria-label={open ? "Close" : `Adjust ${l.name}`} className="grid size-10 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-2">
          <ChevronDown className={cx("size-4 transition-transform duration-180 motion-reduce:transition-none", open && "rotate-180")} />
        </button>
      </div>
      {open && (
        <div className="animate-fade-in space-y-4 border-t border-border bg-surface-2/30 px-4 py-4 motion-reduce:animate-none">
          <p className="text-sm leading-snug text-ink-2">{l.why}</p>
          {!done && (
            <div>
              <div className="mb-1.5 flex items-center gap-1 text-xs font-medium text-ink-2">Make <HelpTip id="prep.adjust" /></div>
              <div className="flex items-center gap-2">
                <Button size="lg" className="w-12 px-0" aria-label="Less" disabled={amount - l.stepBase < l.stepBase / 2} onClick={() => setAmount(Math.max(l.stepBase, amount - l.stepBase))}><Minus className="size-4" /></Button>
                <div className="num min-w-0 flex-1 text-center text-base font-semibold" aria-live="polite">{amountText(amount, l.batchBase, l.unit)}</div>
                <Button size="lg" className="w-12 px-0" aria-label="More" onClick={() => setAmount(amount + l.stepBase)}><Plus className="size-4" /></Button>
                {changed && <Button variant="ghost" size="lg" className="w-11 px-0" aria-label="Back to suggested" onClick={() => setAmount(l.makeBase)}><RotateCcw className="size-4" /></Button>}
              </div>
            </div>
          )}
          <OnHandEntry line={l} />
          <Link href={`/prep/${l.recipeId}?make=${Math.round((done?.qtyBase ?? amount) * 100) / 100}&day=${day}`} className="flex h-11 items-center justify-between rounded-lg border border-border bg-surface px-3 text-sm font-medium hover:bg-surface-2" data-tour={first ? "prep.recipe" : undefined}>
            Recipe for {formatPrepQty(done?.qtyBase ?? amount, l.unit)} <ChevronRight className="size-4 text-muted" />
          </Link>
        </div>
      )}
    </div>
  );
}

function OnHandEntry({ line: l }: { line: BoardLine }) {
  const [v, setV] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "queued">("idle");
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    const n = Number(v.replace(",", "."));
    if (!v.trim() || !Number.isFinite(n) || n < 0) {
      setError("Enter how much is there, like 1.5.");
      return;
    }
    setError(null);
    setState("saving");
    const r = await sendPrep({ kind: "count", recipeId: l.recipeId, qtyBase: n * l.unit.baseQty, at: Date.now(), label: `${l.name} on hand` });
    if ("error" in r) {
      setError(r.error);
      setState("idle");
    } else {
      setState(r.queued ? "queued" : "saved");
      setV("");
    }
  };
  const unitName = l.unit.container ? `${l.unit.name}s` : l.unit.name;
  return (
    <div data-tour="prep.onhand">
      <label htmlFor={`oh-${l.recipeId}`} className="mb-1.5 flex items-center gap-1 text-xs font-medium text-ink-2">On hand now <HelpTip id="prep.onHand" /></label>
      <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div className="relative min-w-0 flex-1">
          <Input id={`oh-${l.recipeId}`} inputMode="decimal" autoComplete="off" value={v} onChange={(e) => { setV(e.target.value); setState("idle"); }} placeholder={l.onHandKnown ? String(Math.round((l.onHandBase / l.unit.baseQty) * 100) / 100) : "0"} className="h-11 pr-16 sm:h-11" />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted">{unitName}</span>
        </div>
        <Button type="submit" size="lg" disabled={state === "saving" || !v.trim()}>Save</Button>
      </form>
      <p className="mt-1 text-xs text-muted" aria-live="polite">
        {error ? <span className="text-bad">{error}</span> : state === "saved" ? <span className="text-good">Saved. The list is updated.</span> : state === "queued" ? "Saved on this phone; it sends when there's signal." : l.countedAt ? <>Counted <RelativeTime at={l.countedAt} />{`${l.countedBy ? ` by ${l.countedBy}` : ""}${l.onHandKnown ? ` · about ${formatPrepQty(l.onHandBase, l.unit)} now` : ""}`}</> : l.onHandKnown ? `About ${formatPrepQty(l.onHandBase, l.unit)} from batches made` : "Not counted yet"}
      </p>
    </div>
  );
}

function StockRow({ line: l, open, toggle }: { line: BoardLine; open: boolean; toggle: () => void }) {
  return (
    <div>
      <button type="button" onClick={toggle} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2/50">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-ink">{l.name}</div>
          <div className="mt-0.5 line-clamp-3 text-sm leading-snug text-ink-2">{l.status === "enough" ? [lastsText(l) && `${lastsText(l)}.`, l.why].filter(Boolean).join(" ") : l.onHandKnown ? `On hand ${formatPrepQty(l.onHandBase, l.unit)}` : "Not counted yet"}</div>
        </div>
        <ChevronDown className={cx("size-4 shrink-0 text-muted transition-transform duration-180 motion-reduce:transition-none", open && "rotate-180")} />
      </button>
      {open && (
        <div className="animate-fade-in space-y-4 border-t border-border bg-surface-2/30 px-4 py-4 motion-reduce:animate-none">
          <OnHandEntry line={l} />
          <Link href={`/prep/${l.recipeId}`} className="flex h-11 items-center justify-between rounded-lg border border-border bg-surface px-3 text-sm font-medium hover:bg-surface-2">
            Recipe <ChevronRight className="size-4 text-muted" />
          </Link>
        </div>
      )}
    </div>
  );
}

function Collapsible({ title, count, help, hint, children }: { title: string; count: number; help: string; hint?: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <HelpZone id={help} className="mb-6">
      <section>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="mb-2 flex h-11 w-full items-center gap-2 px-1 text-left text-[0.95rem] font-semibold text-ink">
          <ChevronRight className={cx("size-4 text-muted transition-transform duration-180 motion-reduce:transition-none", open && "rotate-90")} />
          {title} <span className="num text-xs font-normal text-muted">{count}</span>
        </button>
        {open && (
          <>
            {hint && <p className="mb-2 px-1 text-xs text-muted">{hint}</p>}
            <Card className="animate-fade-in divide-y divide-border overflow-hidden motion-reduce:animate-none">{children}</Card>
          </>
        )}
      </section>
    </HelpZone>
  );
}
