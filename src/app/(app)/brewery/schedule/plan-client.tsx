"use client";

import { useConfirm } from "@/components/dialog";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, cx, DatePicker, Field, Input, Select } from "@/components/ui";
import { BREW_PROFILES, guessProfile, PROFILE_KEYS, profileLabel, RECIPE_DAYS } from "@/domain/brewProfiles";
import { daysBetween } from "@/domain/dates";
import type { BrewProposal, BrewSuggestion } from "@/domain/tankPlan";
import { shortDate } from "@/lib/format";
import type { BatchView, BeerOption, RecipeOption, TankView } from "@/server/services/brewery";
import type { ProposedTiming } from "@/server/services/breweryWrite";
import { ArrowRight, CalendarPlus, Lock } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { cancelBrewAction, moveBrewAction, planBrewAction, proposeBrewAction } from "../actions";
import { BeerDot, bblText } from "../bits";
import { BrewPick, pickBbl, pickIds, pickOf } from "../brew-pick";

type Proposal = { proposal: BrewProposal; fermentDays: number; conditionDays: number; timing: ProposedTiming } | { error: string } | null;

/** Ask the server where a brew would go and its dates whenever the inputs change (the latest answer wins). */
function useProposal(input: { pick: string; brewOn: string; bbl: string; fermenterId: string; exceptBatchId?: string; profile?: string }) {
  const [result, setResult] = useState<Proposal>(null);
  const [pending, start] = useTransition();
  const seq = useRef(0);
  const { pick, brewOn, bbl, fermenterId, exceptBatchId, profile } = input;
  useEffect(() => {
    const ids = pickIds(pick);
    if ((!ids.recipeId && !ids.beerId) || !brewOn || !(Number(bbl) > 0)) {
      setResult(null);
      return;
    }
    const n = ++seq.current;
    const t = setTimeout(() => {
      start(async () => {
        const r = await proposeBrewAction({ ...ids, brewOn, bbl: Number(bbl), fermenterId: fermenterId || null, exceptBatchId: exceptBatchId ?? null, profile: profile || null });
        if (n === seq.current) setResult(r);
      });
    }, 150);
    return () => clearTimeout(t);
  }, [pick, brewOn, bbl, fermenterId, exceptBatchId, profile]);
  return { result, pending };
}

/** What the plan would be, in a few plain lines, or why it doesn't fit and a button for the first day that does. */
function ProposalView({ result, pending, onUseDate }: { result: Proposal; pending: boolean; onUseDate: (d: string) => void }) {
  if (!result) return <p className="text-sm text-muted">Pick what you&apos;re brewing and a day to see which tanks it gets and its dates.</p>;
  if ("error" in result) return <p className="text-sm text-bad">{result.error}</p>;
  const p = result.proposal;
  if (!p.ok) {
    return (
      <div className={cx("rounded-lg bg-warn-bg px-3 py-2.5 text-sm text-warn transition-opacity", pending && "opacity-60")}>
        <p>{p.reason}</p>
        {p.earliest && <Button type="button" size="sm" className="mt-2 h-10 sm:h-8" onClick={() => onUseDate(p.earliest!)}>Brew on {shortDate(p.earliest)} instead</Button>}
      </div>
    );
  }
  const t = result.timing;
  const step = (name: string, a: string, b: string, what: string) => (
    <li className="flex items-center gap-2.5">
      <span className="grid h-8 min-w-12 place-items-center rounded-md bg-surface px-2 text-sm font-semibold ring-1 ring-border">{name}</span>
      <span className="num min-w-0 text-sm">{shortDate(a)} <ArrowRight className="inline size-3 text-muted" /> {shortDate(b)} <span className="text-muted">· {what}, {daysBetween(a, b)} days</span></span>
    </li>
  );
  const marks = [
    t.dryHopOn ? `Dry hop ${shortDate(t.dryHopOn)}` : null,
    t.fvTransferOn ? `fermenter move ${shortDate(t.fvTransferOn)}` : null,
    `release ${shortDate(t.tapOn)}${t.tapLocked ? " (locked)" : ""}`,
  ].filter(Boolean).join(" · ");
  return (
    <div className={cx("rounded-lg bg-surface-2/70 px-3 py-3 transition-opacity", pending && "opacity-60")} aria-live="polite">
      <ol className="space-y-2">
        {step(p.fermenter.tankName, p.fermenter.start, p.fermenter.end, p.brite ? "fermenting" : "fermenting and conditioning")}
        {p.brite && step(p.brite.tankName, p.brite.start, p.brite.end, "conditioning")}
      </ol>
      <p className="num mt-2.5 text-sm font-medium">Ready to package {shortDate(p.packageOn)}</p>
      <p className="num mt-0.5 text-xs text-muted">{marks.charAt(0).toUpperCase() + marks.slice(1)} · {profileLabel(t.profile)}</p>
      {p.notes.map((n) => <p key={n} className="mt-1 text-xs text-warn">{n}</p>)}
      {t.releaseWarning && (
        <div className="mt-2 rounded-md bg-bad-bg px-2.5 py-2 text-sm text-bad">
          <p>{t.releaseWarning}{t.lockedReason ? ` (${t.lockedReason})` : ""}</p>
          {t.brewBy && <Button type="button" size="sm" className="mt-2 h-10 sm:h-8" onClick={() => onUseDate(t.brewBy!)}>Brew on {shortDate(t.brewBy)} instead</Button>}
        </div>
      )}
    </div>
  );
}

const fermenterOptions = (tanks: TankView[]) => [{ value: "", label: "First free fermenter" }, ...tanks.filter((t) => t.active && t.kind === "FERMENTER").map((t) => ({ value: t.id, label: `${t.name} · ${t.capacityBbl} bbl` }))];

/** Timing choices: the recipe's own (its profile, or a guess shown as a hint), each of Brew Manager's profiles, or the recipe's days. */
function profileOptions(recipe: RecipeOption | undefined) {
  const own = recipe?.profile ? profileLabel(recipe.profile) : null;
  return [
    { value: "", label: own ? `From the recipe: ${own}` : "From the recipe's days" },
    ...PROFILE_KEYS.map((k) => ({ value: k, label: BREW_PROFILES[k].label, hint: BREW_PROFILES[k].hint })),
    { value: RECIPE_DAYS, label: "Recipe days", hint: "Its fermenting and conditioning days" },
  ];
}

/**
 * The top of the schedule: plan a brew (with the proposed tanks and dates
 * shown before saving) beside the suggested brews from keg demand.
 */
export function PlanArea({ today, recipes, beers, tanks, suggestions }: { today: string; recipes: RecipeOption[]; beers: BeerOption[]; tanks: TankView[]; suggestions: BrewSuggestion[] }) {
  const [pick, setPick] = useState("");
  const [brewOn, setBrewOn] = useState(today);
  const [bbl, setBbl] = useState("7");
  const [fermenterId, setFermenterId] = useState("");
  const [profile, setProfile] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, start] = useTransition();
  const [toast, show] = useToast();
  const { result, pending } = useProposal({ pick, brewOn, bbl, fermenterId, profile });
  const formRef = useRef<HTMLDivElement>(null);
  const ok = !!result && !("error" in result) && result.proposal.ok;
  const recipe = recipes.find((r) => `r:${r.id}` === pick);

  const choose = (v: string) => {
    setPick(v);
    setBbl(String(pickBbl(v, recipes, Number(bbl) || 7)));
    // A recipe with no profile: suggest one from its style, as Brew Manager did.
    const r = recipes.find((x) => `r:${x.id}` === v);
    setProfile(r && !r.profile && r.style ? guessProfile(r.style, r.name) : "");
  };
  const planIt = (s: BrewSuggestion) => {
    const r = recipes.find((x) => x.beerId === s.beerId);
    choose(r ? `r:${r.id}` : `b:${s.beerId}`);
    setBrewOn(s.brewBy > today ? s.brewBy : today);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const save = () =>
    start(async () => {
      const r = await planBrewAction({ ...pickIds(pick), brewOn, bbl: Number(bbl), fermenterId: fermenterId || null, code: code || null, profile: profile || null });
      if ("error" in r) setError(r.error);
      else {
        setError(null);
        setPick("");
        setCode("");
        setProfile("");
        show(r.ok);
      }
    });
  const color = new Map(beers.map((b) => [b.id, b.color]));
  const open = suggestions.filter((s) => !s.planned);
  const planned = suggestions.filter((s) => s.planned);

  return (
    <div className="mb-10 grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      {toast}
      <div ref={formRef} id="plan" className="scroll-mt-24">
        <Card className="p-4 sm:p-5">
          <div className="mb-3 flex items-center gap-2 text-[0.95rem] font-semibold"><CalendarPlus className="size-4 text-area" />Plan a brew</div>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (ok) save(); }}>
            <BrewPick value={pick} onChange={choose} recipes={recipes} beers={beers} />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Field label="Brew day" className="col-span-1"><DatePicker value={brewOn} today={today} onChange={(e) => setBrewOn(e.target.value)} aria-label="Brew day" /></Field>
              <Field label="Size, bbl"><Input value={bbl} onChange={(e) => setBbl(e.target.value)} inputMode="decimal" aria-label="Size in barrels" /></Field>
              <Field label="Fermenter" className="col-span-2"><Select value={fermenterId} onChange={(e) => setFermenterId(e.target.value)} options={fermenterOptions(tanks)} aria-label="Fermenter" /></Field>
              <Field label="Timing" className="col-span-2 sm:col-span-4"><Select value={profile} onChange={(e) => setProfile(e.target.value)} options={profileOptions(recipe)} aria-label="Timing profile" /></Field>
            </div>
            <ProposalView result={result} pending={pending} onUseDate={setBrewOn} />
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Batch code" hint="Blank: next number" className="w-36"><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Auto" aria-label="Batch code" autoComplete="off" /></Field>
              <Button type="submit" variant="primary" disabled={!ok || saving} className="h-11 flex-1 sm:h-9 sm:flex-none">{saving ? "Saving…" : "Put it on the schedule"}</Button>
              {recipe && brewOn === today && <Link href={`/brewery/brew/new?recipe=${recipe.id}`} className="inline-flex h-11 items-center text-sm font-medium text-ink-2 underline-offset-2 hover:text-ink hover:underline sm:h-9">Or start its brew day now</Link>}
            </div>
            {error && <p role="alert" className="text-sm text-bad">{error}</p>}
          </form>
        </Card>
      </div>

      <section aria-labelledby="suggested">
        <div className="mb-3">
          <h2 id="suggested" className="text-[0.95rem] font-semibold">Suggested brews</h2>
          <p className="mt-0.5 text-sm text-muted">From keg sales: the last day to brew so a full keg is ready before the last one runs out.</p>
        </div>
        {suggestions.length === 0 ? (
          <Card className="px-4 py-3.5 text-sm text-muted">No suggestions yet. They come from keg sales, so they show once beers are selling on Square and kegs are tracked.</Card>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
            {[...open, ...planned].slice(0, 10).map((s) => (
              <li key={s.beerId} className="flex min-h-14 items-center gap-3 px-4 py-2.5">
                <BeerDot color={color.get(s.beerId) ?? null} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="truncate text-sm font-medium">{s.name}</span>
                    {s.state === "late" && <Badge tone="bad">{s.alreadyOut ? "Already out" : "Late"}</Badge>}
                    {s.state === "soon" && <Badge tone="warn">Soon</Badge>}
                  </div>
                  <div className="num truncate text-xs text-muted">
                    {s.planned
                      ? s.planned.inTanks ? `${s.planned.code} is in the tanks` : `Planned for ${s.planned.on ? shortDate(s.planned.on) : "—"} (${s.planned.code})`
                      : s.daysToBrewBy < 0 ? `Should have been brewed by ${shortDate(s.brewBy)} · runs out ~${shortDate(s.runOutOn)}` : `Brew by ${shortDate(s.brewBy)} · runs out ~${shortDate(s.runOutOn)} · ${s.leadDays} days in tanks`}
                  </div>
                </div>
                {s.planned ? (
                  <Link href={`/brewery/batches/${s.planned.batchId}`} className="shrink-0 text-xs text-muted underline-offset-2 hover:text-ink hover:underline">View</Link>
                ) : (
                  <Button size="sm" className="h-10 shrink-0 sm:h-8" onClick={() => planIt(s)}>Plan it</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Planned brews, soonest first: move one (the tanks and dates are worked out again; a locked release stays) or cancel it. */
export function PlannedList({ planned, stays, today, tanks }: { planned: BatchView[]; stays: Record<string, { tankId: string; tankName: string; start: string; end: string | null }[]>; today: string; tanks: TankView[] }) {
  const [moving, setMoving] = useState<string | null>(null);
  const [toast, show] = useToast();
  if (!planned.length) return <Card className="px-4 py-3.5 text-sm text-muted">Nothing planned yet. Plan a brew above, or from a suggestion.</Card>;
  return (
    <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
      {toast}
      {planned.map((b) => (
        <li key={b.id} className="px-4 py-3">
          <PlannedRow b={b} path={stays[b.id] ?? []} today={today} open={moving === b.id} onOpen={() => setMoving(moving === b.id ? null : b.id)} tanks={tanks} onDone={(m) => { setMoving(null); show(m); }} />
        </li>
      ))}
    </ul>
  );
}

function PlannedRow({ b, path, today, open, onOpen, tanks, onDone }: { b: BatchView; path: { tankName: string; start: string }[]; today: string; open: boolean; onOpen: () => void; tanks: TankView[]; onDone: (m: string) => void }) {
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [brewOn, setBrewOn] = useState(b.plannedOn ?? today);
  const [bbl, setBbl] = useState(String(b.bbl ?? 7));
  const [fermenterId, setFermenterId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { result, pending: thinking } = useProposal({ pick: open ? pickOf(b) : "", brewOn, bbl, fermenterId, exceptBatchId: b.id });
  const ok = !!result && !("error" in result) && result.proposal.ok && !result.timing.releaseWarning;
  const late = b.plannedOn && b.plannedOn < today;
  const dates = [b.dryHopOn ? `dry hop ${shortDate(b.dryHopOn)}` : null, b.tapOn ? `release ${shortDate(b.tapOn)}` : null].filter(Boolean).join(" · ");
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="num w-16 shrink-0 text-sm font-medium">{b.plannedOn ? shortDate(b.plannedOn) : "—"}</div>
        <Link href={`/brewery/batches/${b.id}`} className="group flex min-w-0 flex-1 items-center gap-2">
          <BeerDot color={b.color} />
          <span className="min-w-0">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-sm font-medium group-hover:underline">{b.name}</span>
              {b.tapLocked && <Lock className="size-3.5 shrink-0 text-warn" aria-label="Release locked" />}
            </span>
            <span className="num block truncate text-xs text-muted">{b.code} · {bblText(b.bbl)}{path.length ? ` · ${path.map((p) => p.tankName).join(" → ")}` : ""}{late ? " · brew day passed" : ""}</span>
            {(dates || b.profile) && <span className="num block truncate text-xs text-muted">{profileLabel(b.profile)}{dates ? ` · ${dates}` : ""}{b.tapLocked && b.lockedReason ? ` · ${b.lockedReason}` : ""}{b.splitFrom ? ` · split from ${b.splitFrom.code}` : ""}</span>}
          </span>
        </Link>
        <div className="flex gap-1.5">
          <Link href={`/brewery/brew/new?batch=${b.id}`} className="inline-flex h-10 items-center rounded-lg px-2.5 text-sm font-medium text-ink-2 hover:bg-surface-2 hover:text-ink sm:h-8">Brew now</Link>
          <Button size="sm" variant={open ? "secondary" : "ghost"} className="h-10 sm:h-8" onClick={onOpen}>{open ? "Close" : "Move"}</Button>
          <Button
            size="sm"
            variant="danger"
            className="h-10 sm:h-8"
            disabled={pending}
            onClick={async () => {
              if (!(await confirm({ title: `Cancel ${b.code} ${b.name}?`, body: "It comes off the schedule and its tanks are free again.", confirmLabel: "Cancel brew", danger: true }))) return;
              start(async () => {
                const r = await cancelBrewAction(b.id);
                if ("error" in r) setError(r.error);
                else onDone(r.ok);
              });
            }}
          >
            Cancel
          </Button>
        </div>
      </div>
      {open && (
        <form className="mt-3 space-y-3 rounded-xl border border-border bg-surface-2/40 p-3" onSubmit={(e) => {
          e.preventDefault();
          if (!ok) return;
          start(async () => {
            const r = await moveBrewAction({ batchId: b.id, brewOn, bbl: Number(bbl), fermenterId: fermenterId || null });
            if ("error" in r) setError(r.error);
            else onDone(r.ok);
          });
        }}>
          {b.tapLocked && b.tapOn && <p className="flex items-center gap-1.5 text-xs text-warn"><Lock className="size-3.5" />Release locked on {shortDate(b.tapOn)}{b.lockedReason ? ` (${b.lockedReason})` : ""}: it stays put when the brew moves.</p>}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Field label="New brew day"><DatePicker value={brewOn} today={today} onChange={(e) => setBrewOn(e.target.value)} aria-label="New brew day" /></Field>
            <Field label="Size, bbl"><Input value={bbl} onChange={(e) => setBbl(e.target.value)} inputMode="decimal" aria-label="Size in barrels" /></Field>
            <Field label="Fermenter" className="col-span-2"><Select value={fermenterId} onChange={(e) => setFermenterId(e.target.value)} options={fermenterOptions(tanks)} aria-label="Fermenter" /></Field>
          </div>
          <ProposalView result={result} pending={thinking} onUseDate={setBrewOn} />
          <Button type="submit" variant="primary" disabled={!ok || pending} className="h-11 w-full sm:h-9 sm:w-auto">{pending ? "Saving…" : "Move it"}</Button>
        </form>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-bad">{error}</p>}
    </>
  );
}
