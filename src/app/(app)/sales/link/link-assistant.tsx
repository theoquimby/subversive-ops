"use client";

import { Checkbox } from "@/components/data-table";
import { useConfirm } from "@/components/dialog";
import { HelpTip, HelpZone } from "@/components/help";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, cx, EmptyState, Field, Input, Section, Select } from "@/components/ui";
import { KEG_SIZES, ML_PER_FL_OZ, ML_PER_GAL } from "@/domain/draftBeer";
import { bandOf, HIGH_PCT, linkEffect, LOW_PCT, unitCostEffect, UNLINKED, type Effect, type LinkState } from "@/domain/linking";
import { classLabel, REVENUE_CLASSES, type RevenueClass } from "@/domain/revenueClass";
import { fuzzyFilter } from "@/domain/search";
import { money, pct, qty, relativeTime } from "@/lib/format";
import type { AssistantRow, BeerGroupView, HistoryEntry, LinkAssistant } from "@/server/services/linking";
import { AlertTriangle, ArrowRight, Beer, Check, ChevronDown, Clock, Plus, Search, Sparkles, Undo2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { draftSquareItems } from "../../menu/drafts/actions";
import { applyLinks, confirmLinks, costBeerPours, createRecipeForItem, skipItems, undoLinks, unskipItems, type LinkResult } from "./actions";
import { rejectSuggestions } from "../square-menu/actions";

type Recipe = LinkAssistant["recipes"][number];
type Data = Pick<LinkAssistant, "coverage" | "plan" | "unlinked" | "skipped" | "beerGroups" | "flagged" | "recipes" | "history" | "neverSold">;
type Show = (text: string, tone?: "good" | "bad" | "queued", action?: { label: string; onClick: () => void }) => void;

const whole = (n: number) => money(n, { whole: true });
const conf = (c: number) => `${Math.round(c * 100)}%`;
const BAND: Record<ReturnType<typeof bandOf>, { label: string; tone: "good" | "warn" | "neutral" }> = { high: { label: "Sure", tone: "good" }, medium: { label: "Likely", tone: "warn" }, low: { label: "Maybe", tone: "neutral" } };
const KIND_LABEL: Record<AssistantRow["kind"], string> = { beer: "Draft beer", packaged: "Cans & bottles", notSales: "Not a sale", retail: "Merch", drink: "Drink", food: "Food" };

/** Run a save, then offer Undo in the toast. Undo itself reports back in a toast too. */
function useLinkRunner() {
  const router = useRouter();
  const [toast, show] = useToast();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<LinkResult>, after?: (r: LinkResult) => void) =>
    start(async () => {
      const r = await fn();
      if (r.error) return show(r.error, "bad");
      router.refresh();
      after?.(r);
      const batch = r.batch;
      show(r.message ?? "Saved.", "good", batch ? { label: "Undo", onClick: () => start(async () => { const u = await undoLinks(batch); router.refresh(); show(u.error ?? u.message ?? "Undone.", u.error ? "bad" : "good"); }) } : undefined);
    });
  return { toast, show: show as Show, pending, run };
}

const link = (recipeId: string): LinkState => ({ recipeId, ignored: false, unitCost: null, costClass: null });

export function LinkAssistantView({ data }: { data: Data }) {
  const { toast, pending, run, show } = useLinkRunner();
  const confirm = useConfirm();
  const recipeById = useMemo(() => new Map(data.recipes.map((r) => [r.id, r])), [data.recipes]);
  const beerIds = useMemo(() => new Set(data.beerGroups.flatMap((g) => g.pours.map((p) => p.squareId))), [data.beerGroups]);
  const list = data.unlinked.filter((r) => !beerIds.has(r.squareId));

  /** Ask first when a link looks wrong; the dialog runs before any transition starts. */
  const guarded = async (effect: Effect | null, what: string, fn: () => Promise<LinkResult>) => {
    const bad = effect?.flags.filter((f) => f.tone === "bad") ?? [];
    if (bad.length && !(await confirm({ title: `${what} looks off`, body: <ul className="list-disc space-y-1 pl-4">{bad.map((f) => <li key={f.code}>{f.text}</li>)}</ul>, confirmLabel: "Save anyway" }))) return;
    run(fn);
  };

  return (
    <div className={cx(pending && "cursor-progress")}>
      {toast}
      <CoverageCard c={data.coverage} plan={data.plan} unlinkedCount={data.unlinked.length} neverSold={data.neverSold} />

      {data.flagged.length > 0 && (
        <HelpZone id="sales.link.check">
          <div id="check" className="scroll-mt-24">
            <Section title={<span className="inline-flex items-center gap-1.5">Check these links <HelpTip id="sales.link.check" /></span>} description="Links whose names hardly agree, or whose cost looks wrong for the price. A wrong link is worse than none: fix it, or say it's right and it stops showing here.">
              <Card className="divide-y divide-border">
                {data.flagged.map((r) => <CheckRow key={r.squareId} r={r} recipes={data.recipes} recipeById={recipeById} guarded={guarded} run={run} pending={pending} />)}
              </Card>
            </Section>
          </div>
        </HelpZone>
      )}

      <div id="sure" className="scroll-mt-24">
        <SureMatches rows={list} run={run} pending={pending} />
      </div>
      {data.beerGroups.length > 0 && (
        <div id="beer" className="scroll-mt-24">
          <BeerSection groups={data.beerGroups} run={run} pending={pending} />
        </div>
      )}

      <HelpZone id="sales.link.items" tour="sales.link-items">
        <div id="items" className="scroll-mt-24">
          <ItemList rows={list} recipes={data.recipes} recipeById={recipeById} guarded={guarded} run={run} show={show} pending={pending} neverSold={data.neverSold} />
        </div>
      </HelpZone>

      {data.skipped.length > 0 && <SkippedList rows={data.skipped} run={run} pending={pending} />}

      <HelpZone id="sales.link.history">
        <History entries={data.history} run={run} pending={pending} />
      </HelpZone>
    </div>
  );
}

const describeLink = (s: LinkState) => (s.ignored ? "left out of sales" : s.unitCost != null ? `${money(s.unitCost)} each` : "not linked");

// ---- Coverage ---------------------------------------------------------------------------------

function CoverageCard({ c, plan, unlinkedCount, neverSold }: { c: LinkAssistant["coverage"]; plan: LinkAssistant["plan"]; unlinkedCount: number; neverSold: number }) {
  const share = c.share ?? 0;
  const skip = c.total > 0 ? c.skipped / c.total : 0;
  const done = c.share != null && share + skip >= c.target;
  return (
    <HelpZone id="sales.link.coverage" tour="sales.link-coverage" className="mb-8">
      <Card className="p-4 sm:p-5">
        <div className="text-sm text-ink-2">
          Linked: <span className={cx("num text-2xl font-semibold tracking-tight", done ? "text-good" : "text-ink")}>{c.share == null ? "—" : pct(share, 0)}</span> of last 30 days&apos; sales <span className="whitespace-nowrap text-muted">→ {pct(c.target, 0)} target <HelpTip id="sales.link.coverage" /></span>
        </div>
        <div className="relative mt-3 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)} aria-label="Share of sales linked">
          <div className={cx("h-full rounded-l-full transition-[width] duration-500 ease-motion", done ? "bg-good" : "bg-ink", skip <= 0 && "rounded-r-full")} style={{ width: `${Math.min(100, share * 100)}%` }} />
          {skip > 0 && <div className="h-full rounded-r-full bg-[repeating-linear-gradient(135deg,var(--ink-2)_0_1.5px,transparent_1.5px_5px)] opacity-60" style={{ width: `${Math.min(100, skip * 100)}%` }} title="Skipped for now" />}
          <div className="absolute top-0 h-full w-0.5 bg-ink-2/60" style={{ left: `${c.target * 100}%` }} aria-hidden />
        </div>
        <p className="mt-2 text-sm text-muted">
          {c.total <= 0 ? "No Square sales in the last 30 days yet." : done
            ? <>{whole(c.linked)} of {whole(c.total)} has a cost behind it{c.skipped > 0 ? `, and ${whole(c.skipped)} of specials are skipped for now` : ""}. Target reached{unlinkedCount ? ` — ${unlinkedCount} smaller item${unlinkedCount === 1 ? "" : "s"} left if you want them` : ""}.</>
            : <>{whole(c.linked)} of {whole(c.total)} has a cost behind it{c.skipped > 0 ? `, and ${whole(c.skipped)} of specials are skipped for now (shaded)` : ""}. About <span className="font-medium text-ink">{whole(c.toTarget)}</span> more reaches {pct(c.target, 0)}.</>}
        </p>

        {plan.steps.length > 0 && (
          <div className="mt-5 border-t border-border pt-4">
            <h2 className="text-sm font-semibold text-ink">What to do, in order</h2>
            <ol className="mt-2 divide-y divide-border">
              {plan.steps.map((s, i) => (
                <li key={s.key}>
                  <a href={s.href} className="group -mx-2 flex items-start gap-3 rounded-lg px-2 py-2.5 hover:bg-surface-2/60">
                    <span className={cx("num mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold", s.key === "check" ? "bg-warn-bg text-warn" : "bg-surface-2 text-ink-2")}>{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-ink">{s.title}</span>
                      <span className="block text-xs leading-relaxed text-muted">{s.detail}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="num block text-sm font-semibold text-ink">{whole(s.dollars)}</span>
                      <span className="num block text-[11px] text-muted">{s.key === "check" ? "to look at" : `${pct(s.share, 0)} of sales`}</span>
                    </span>
                    <ArrowRight className="mt-1 size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </a>
                </li>
              ))}
            </ol>
            <p className="mt-2 text-xs text-muted">All of it done: about {pct(plan.after, 0)} of sales with a cost behind it.</p>
          </div>
        )}
        {(neverSold > 0 || c.skipped > 0) && (
          <p className="mt-4 flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2.5 text-sm text-ink-2">
            <Clock className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
            <span>
              Specials you aren&apos;t running don&apos;t count: {neverSold > 0 ? `${qty(neverSold, 0)} Square item${neverSold === 1 ? " hasn't" : "s haven't"} sold in 30 days and stay out of the way here` : "anything that hasn't sold in 30 days stays out of the way here"}. Nothing to delete in Square. A special that is selling but you don&apos;t want to cost yet: press <b>Skip for now</b> on it. It counts at a typical cost, and comes back only if it starts selling most weeks.
            </span>
          </p>
        )}
      </Card>
    </HelpZone>
  );
}

// ---- Links to check --------------------------------------------------------------------------------

function CheckRow({ r, recipes, recipeById, guarded, run, pending }: { r: AssistantRow; recipes: Recipe[]; recipeById: Map<string, Recipe>; guarded: (e: Effect | null, what: string, fn: () => Promise<LinkResult>) => Promise<void>; run: (fn: () => Promise<LinkResult>) => void; pending: boolean }) {
  const [change, setChange] = useState(false);
  return (
    <div className="px-4 py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="text-sm font-medium break-words">{r.name} <span className="font-normal text-muted">→ {r.recipeName ?? describeLink(r.state)}</span></div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-warn">
            {r.checkReasons.map((x) => <span key={x} className="inline-flex items-center gap-1"><AlertTriangle className="size-3" />{x}</span>)}
          </div>
          {r.effect && <EffectLine effect={r.effect} price={r.price} />}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button size="sm" className="h-10 sm:h-8" disabled={pending} onClick={() => run(() => confirmLinks([{ squareId: r.squareId, recipeId: r.state.recipeId ?? "each" }]))}><Check className="size-3.5" />Looks right</Button>
          <Button size="sm" className={cx("h-10 sm:h-8", change && "bg-surface-2")} onClick={() => setChange((x) => !x)} aria-expanded={change}>Change</Button>
          {r.state.recipeId && <Link href={`/menu/${r.state.recipeId}`} className="inline-flex h-10 items-center rounded-lg px-3 text-sm font-medium text-ink-2 hover:bg-surface-2 hover:text-ink sm:h-8">Open recipe</Link>}
          <Button size="sm" variant="ghost" className="h-10 sm:h-8" disabled={pending} onClick={() => run(() => applyLinks([{ squareId: r.squareId, to: UNLINKED }]))}>Unlink</Button>
        </div>
      </div>
      {change && <PickPanel r={r} recipes={recipes} recipeById={recipeById} guarded={guarded} pending={pending} />}
    </div>
  );
}

// ---- Skipped for now -------------------------------------------------------------------------------

function SkippedList({ rows, run, pending }: { rows: AssistantRow[]; run: (fn: () => Promise<LinkResult>) => void; pending: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Section title="Skipped for now" description={`${rows.length} special${rows.length === 1 ? "" : "s"} you didn't want to cost yet, ${whole(rows.reduce((s, r) => s + r.sales30, 0))} of the last 30 days. They count at a typical cost and come back to the list if they start selling most weeks.`}>
      <Card className="overflow-hidden">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm font-medium hover:bg-surface-2/60" aria-expanded={open}>
          {open ? "Hide them" : `Show ${rows.length}`}
          <ChevronDown className={cx("size-4 shrink-0 text-muted transition-transform", open && "rotate-180")} />
        </button>
        {open && (
          <div className="divide-y divide-border border-t border-border">
            {rows.map((r) => (
              <div key={r.squareId} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <div className="text-sm break-words">{r.name}</div>
                  <div className="text-xs text-muted">{whole(r.sales30)} · sold on {r.days30} of the last 30 days</div>
                </div>
                <Button size="sm" variant="ghost" className="h-10 shrink-0 sm:h-8" disabled={pending} onClick={() => run(() => unskipItems([r.squareId]))}>Bring back</Button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </Section>
  );
}

// ---- Sure matches in bulk -----------------------------------------------------------------------

function SureMatches({ rows, run, pending }: { rows: AssistantRow[]; run: (fn: () => Promise<LinkResult>) => void; pending: boolean }) {
  const sure = rows.filter((r) => r.candidates[0]?.safe);
  const [open, setOpen] = useState(false);
  const [off, setOff] = useState<Set<string>>(new Set());
  if (!sure.length) return null;
  const picked = sure.filter((r) => !off.has(r.squareId));
  const dollars = picked.reduce((s, r) => s + r.sales30, 0);
  return (
    <HelpZone id="sales.link.bulk" tour="sales.link-bulk" className="mb-8">
      <Card className="overflow-hidden">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2/60" aria-expanded={open}>
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-good-bg text-good"><Check className="size-4" strokeWidth={2.5} /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">{sure.length} sure match{sure.length === 1 ? "" : "es"} · {whole(sure.reduce((s, r) => s + r.sales30, 0))} of sales</span>
            <span className="block text-xs text-muted">Same or nearly the same name, and nothing about the cost looks off. Review, then link them all at once.</span>
          </span>
          <ChevronDown className={cx("size-4 shrink-0 text-muted transition-transform", open && "rotate-180")} />
        </button>
        {open && (
          <>
            <div className="divide-y divide-border border-t border-border">
              {sure.map((r) => {
                const c = r.candidates[0];
                const on = !off.has(r.squareId);
                return (
                  <div key={r.squareId} className={cx("flex items-start gap-3 px-4 py-2.5", !on && "opacity-50")}>
                    <Checkbox checked={on} onChange={() => setOff((s) => { const n = new Set(s); if (n.has(r.squareId)) n.delete(r.squareId); else n.add(r.squareId); return n; })} label={`Link ${r.name} to ${c.recipeName}`} className="mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm break-words"><span className="font-medium">{r.name}</span> <span className="text-muted">→</span> {c.recipeName} <span className="num text-xs text-good">{conf(c.confidence)}</span></div>
                      <EffectLine effect={c.effect} price={r.price} compact />
                    </div>
                    <span className="num shrink-0 text-xs text-muted">{whole(r.sales30)}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface-2/50 px-4 py-3">
              <span className="text-xs text-muted">{picked.length} checked · {whole(dollars)} of last 30 days. You can undo it straight after.</span>
              <Button variant="primary" disabled={pending || !picked.length} onClick={() => run(() => applyLinks(picked.map((r) => ({ squareId: r.squareId, to: link(r.candidates[0].recipeId) }))))}><Check className="size-4" />Link {picked.length}</Button>
            </div>
          </>
        )}
      </Card>
    </HelpZone>
  );
}

// ---- Effect line ------------------------------------------------------------------------------------

function EffectLine({ effect, price, compact }: { effect: Effect; price: number | null; compact?: boolean }) {
  const p = effect.pct;
  const tone = p == null ? "text-muted" : p < LOW_PCT || p > HIGH_PCT ? "text-bad" : "text-ink-2";
  const flags = effect.flags.filter((f) => !(compact && f.code === "noSquarePrice"));
  return (
    <div className="mt-0.5 space-y-0.5 text-xs">
      <div className={tone}>
        {effect.cost == null ? "Cost unknown" : <>Cost {money(effect.cost)}{price ? <> on {money(price)} → <span className="num font-medium">{pct(p, 0)}</span> cost</> : null}</>}
      </div>
      {flags.map((f) => (
        <div key={f.code} className={cx("flex items-start gap-1", f.tone === "bad" ? "text-bad" : "text-warn")}><AlertTriangle className="mt-px size-3 shrink-0" />{f.text}</div>
      ))}
    </div>
  );
}

// ---- Items, biggest first ------------------------------------------------------------------------

const PAGE = 15;

function ItemList({ rows, recipes, recipeById, guarded, run, show, pending, neverSold }: {
  rows: AssistantRow[];
  recipes: Recipe[];
  recipeById: Map<string, Recipe>;
  guarded: (e: Effect | null, what: string, fn: () => Promise<LinkResult>) => Promise<void>;
  run: (fn: () => Promise<LinkResult>, after?: (r: LinkResult) => void) => void;
  show: Show;
  pending: boolean;
  neverSold: number;
}) {
  const [q, setQ] = useState("");
  const [n, setN] = useState(PAGE);
  const filtered = useMemo(() => (q.trim() ? fuzzyFilter(rows, q, (r) => `${r.name} ${r.category ?? ""} ${KIND_LABEL[r.kind]}`, 500) : rows), [rows, q]);
  const shown = filtered.slice(0, n);
  return (
    <Section
      title="Still to link"
      description={rows.length ? `Biggest sellers first. ${rows.length} item${rows.length === 1 ? "" : "s"} sold in the last 30 days with no cost behind them.` : undefined}
      actions={rows.length > 6 ? (
        <label className="relative block w-full sm:w-56">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => { setQ(e.target.value); setN(PAGE); }} placeholder="Find an item" aria-label="Find an item" className="pl-8" />
        </label>
      ) : undefined}
    >
      {rows.length === 0 ? (
        <EmptyState title="Everything that sold is linked">New Square items show up here when they first sell.{neverSold ? ` ${neverSold} item${neverSold === 1 ? "" : "s"} that haven't sold are on the Square items table.` : ""}</EmptyState>
      ) : (
        <>
          <div className="space-y-3">
            {shown.map((r) => <ItemCard key={r.squareId} r={r} recipes={recipes} recipeById={recipeById} guarded={guarded} run={run} show={show} pending={pending} />)}
            {filtered.length === 0 && <Card className="p-5 text-center text-sm text-muted">No items match “{q}”.</Card>}
          </div>
          {filtered.length > n && (
            <div className="mt-3 flex justify-center"><Button variant="ghost" onClick={() => setN((x) => x + PAGE)}>Show {Math.min(PAGE, filtered.length - n)} more · {whole(filtered.slice(n, n + PAGE).reduce((s, r) => s + r.sales30, 0))}</Button></div>
          )}
          {neverSold > 0 && <p className="mt-3 text-center text-xs text-muted">{neverSold} more Square item{neverSold === 1 ? "" : "s"} haven&apos;t sold in 30 days, so they don&apos;t change the numbers. They&apos;re on <Link href="/sales#sales-items" className="underline underline-offset-2 hover:text-ink">the Square items table</Link>.</p>}
        </>
      )}
    </Section>
  );
}

type Panel = null | "pick" | "create" | "other";

function ItemCard({ r, recipes, recipeById, guarded, run, show, pending }: {
  r: AssistantRow;
  recipes: Recipe[];
  recipeById: Map<string, Recipe>;
  guarded: (e: Effect | null, what: string, fn: () => Promise<LinkResult>) => Promise<void>;
  run: (fn: () => Promise<LinkResult>, after?: (r: LinkResult) => void) => void;
  show: Show;
  pending: boolean;
}) {
  const [panel, setPanel] = useState<Panel>(r.kind === "notSales" || r.kind === "retail" || r.kind === "packaged" ? "other" : null);
  const best = r.candidates[0];
  const toggle = (p: Panel) => setPanel((cur) => (cur === p ? null : p));
  const notRecipe = r.kind === "notSales" || r.kind === "retail" || r.kind === "packaged";
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium break-words">{r.name}</div>
          <div className="mt-0.5 text-xs text-muted">
            {r.modifier ? "Add-on" : KIND_LABEL[r.kind]}{r.category ? ` · ${r.category}` : ""} · {r.price != null ? money(r.price) : "price varies"} · {qty(r.qty30, 0)} sold{r.deleted ? " · removed from Square" : ""}
          </div>
          {r.backOnMenu && <div className="mt-1 text-xs font-medium text-warn">Skipped earlier, but it&apos;s sold on {r.days30} of the last 30 days: it looks like it&apos;s on the menu again.</div>}
        </div>
        <div className="shrink-0 text-right">
          <div className="num text-sm font-semibold">{whole(r.sales30)}</div>
          <div className="text-[11px] text-muted">of last 30 days</div>
        </div>
      </div>

      {best && !notRecipe && (
        <div className="mt-3 rounded-lg bg-surface-2/60 px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="text-muted">Suggested:</span>
            <span className="font-medium">{best.recipeName}</span>
            <Badge tone={BAND[bandOf(best.confidence)].tone}>{BAND[bandOf(best.confidence)].label} · {conf(best.confidence)}</Badge>
          </div>
          <div className="mt-0.5 text-xs text-muted">{best.reasons.join(" · ")}</div>
          <EffectLine effect={best.effect} price={r.price} />
        </div>
      )}
      {!best && r.kind === "beer" && <p className="mt-3 text-sm text-muted">A beer that isn&apos;t on the beer list. Give it a cost each below, or add the beer on <Link href="/kegs/beers" className="underline underline-offset-2 hover:text-ink">Beers</Link> to cost it from its keg.</p>}
      {!best && (r.kind === "food" || r.kind === "drink") && <p className="mt-3 text-sm text-muted">No recipe looks like this one. Create it, or pick one if it&apos;s called something else.</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        {best && !notRecipe && (
          <Button variant="primary" disabled={pending} className="h-10 sm:h-9" onClick={() => guarded(best.effect, `${r.name} → ${best.recipeName}`, () => applyLinks([{ squareId: r.squareId, to: link(best.recipeId) }]))}>
            <Check className="size-4" />Accept
          </Button>
        )}
        <Button className={cx("h-10 sm:h-9", panel === "pick" && "bg-surface-2")} onClick={() => toggle("pick")} aria-expanded={panel === "pick"}>{best ? "Pick another" : "Pick a recipe"}</Button>
        <Button className={cx("h-10 sm:h-9", panel === "create" && "bg-surface-2")} onClick={() => toggle("create")} aria-expanded={panel === "create"}><Plus className="size-4" />Create recipe</Button>
        <Button variant={notRecipe ? "secondary" : "ghost"} className={cx("h-10 sm:h-9", panel === "other" && "bg-surface-2")} onClick={() => toggle("other")} aria-expanded={panel === "other"}>Not a recipe</Button>
        {!notRecipe && (
          <Button variant="ghost" className="h-10 sm:h-9" disabled={pending} onClick={() => run(() => skipItems([r.squareId]))} title="A special you don't want to cost yet: it counts at a typical cost and comes back if it starts selling most weeks">
            <Clock className="size-4" />Skip for now
          </Button>
        )}
        {best && !notRecipe && bandOf(best.confidence) !== "high" && (
          <Button variant="ghost" className="h-10 sm:h-9" disabled={pending} onClick={() => run(async () => { const res = await rejectSuggestions([{ squareId: r.squareId, recipeId: best.recipeId }]); return { error: res.error, message: `Won't suggest ${best.recipeName} for this again.` }; })}>Not {best.recipeName}</Button>
        )}
      </div>

      {panel === "pick" && <PickPanel r={r} recipes={recipes} recipeById={recipeById} guarded={guarded} pending={pending} />}
      {panel === "create" && <CreatePanel r={r} run={run} show={show} pending={pending} />}
      {panel === "other" && <OtherPanel r={r} guarded={guarded} run={run} pending={pending} />}
    </Card>
  );
}

function PickPanel({ r, recipes, recipeById, guarded, pending }: { r: AssistantRow; recipes: Recipe[]; recipeById: Map<string, Recipe>; guarded: (e: Effect | null, what: string, fn: () => Promise<LinkResult>) => Promise<void>; pending: boolean }) {
  const [id, setId] = useState("");
  const options = useMemo(() => {
    const top = new Set(r.candidates.map((c) => c.recipeId));
    const opt = (x: Recipe, group: string) => {
      const p = r.price && x.cost != null ? x.cost / r.price : null;
      return { value: x.id, label: x.name, badge: x.kind === "MODIFIER" ? "Add-on" : "Menu", group, hint: x.lines === 0 ? "no ingredients yet" : x.cost == null ? "no cost" : `${money(x.cost)}${p != null ? ` · ${pct(p, 0)}` : ""}` };
    };
    return [...r.candidates.map((c) => opt(recipeById.get(c.recipeId)!, "Closest")), ...recipes.filter((x) => !top.has(x.id)).map((x) => opt(x, "All recipes"))];
  }, [r, recipes, recipeById]);
  const chosen = id ? recipeById.get(id) : null;
  const effect = chosen ? linkEffect(r, chosen) : null;
  return (
    <div className="mt-3 space-y-3 border-t border-border pt-3">
      <Field label="Recipe" hint="Type to search. Each shows its cost and what share of this item's price that is.">
        <Select value={id} onChange={(e) => setId(e.target.value)} options={options} searchable placeholder="Choose a recipe…" aria-label={`Recipe for ${r.name}`} />
      </Field>
      {chosen && effect && (
        <div className="rounded-lg bg-surface-2/60 px-3 py-2.5">
          <div className="text-sm"><span className="font-medium">{r.name}</span> <span className="text-muted">→</span> {chosen.name}</div>
          <EffectLine effect={effect} price={r.price} />
          <Button variant="primary" className="mt-2.5 h-10 sm:h-9" disabled={pending} onClick={() => guarded(effect, `${r.name} → ${chosen.name}`, () => applyLinks([{ squareId: r.squareId, to: link(chosen.id) }]))}><Check className="size-4" />Link to {chosen.name}</Button>
        </div>
      )}
    </div>
  );
}

function CreatePanel({ r, run, show, pending }: { r: AssistantRow; run: (fn: () => Promise<LinkResult>, after?: (r: LinkResult) => void) => void; show: Show; pending: boolean }) {
  const router = useRouter();
  const [name, setName] = useState(r.baseName.replace(/\s*\*+\s*/g, " ").trim());
  const [kind, setKind] = useState<"MENU" | "MODIFIER">(r.modifier ? "MODIFIER" : "MENU");
  const [category, setCategory] = useState(r.category ?? (r.modifier ? "Add-ons" : r.kind === "drink" ? "Drinks" : "Food"));
  const [price, setPrice] = useState(r.price != null ? r.price.toFixed(2) : "");
  const [drafting, startDraft] = useTransition();
  const n = Number(price);
  const valid = name.trim().length > 0 && (price.trim() === "" || (Number.isFinite(n) && n >= 0));
  return (
    <div className="mt-3 space-y-3 border-t border-border pt-3">
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_1fr]">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Type"><Select value={kind} onChange={(e) => setKind(e.target.value as "MENU" | "MODIFIER")} options={[{ value: "MENU", label: "Menu item" }, { value: "MODIFIER", label: "Add-on" }]} aria-label="Recipe type" /></Field>
        <Field label="Category"><Input value={category} onChange={(e) => setCategory(e.target.value)} /></Field>
        <Field label="Menu price"><Input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="0.00" className="num" /></Field>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" className="h-10 sm:h-9" disabled={pending || !valid} onClick={() => run(() => createRecipeForItem(r.squareId, { name: name.trim(), kind, category: category.trim(), menuPrice: price.trim() === "" ? null : n }), (res) => { const id = (res as { recipeId?: string }).recipeId; if (id) router.push(`/menu/${id}`); })}>
          <Plus className="size-4" />Create and add ingredients
        </Button>
        <Button className="h-10 sm:h-9" disabled={drafting} onClick={() => startDraft(async () => { const res = await draftSquareItems([r.squareId]); if (res.error) show(res.error, "bad"); else router.push("/menu/drafts"); })}>
          <Sparkles className="size-4" />{drafting ? "Drafting…" : "Draft ingredients for me"}
        </Button>
      </div>
      <p className="text-xs text-muted">Create links it now and opens the recipe so you can add ingredients; it counts at $0 until you do. A draft suggests the lines from your similar recipes and nothing is saved until you approve it.</p>
    </div>
  );
}

function OtherPanel({ r, guarded, run, pending }: { r: AssistantRow; guarded: (e: Effect | null, what: string, fn: () => Promise<LinkResult>) => Promise<void>; run: (fn: () => Promise<LinkResult>) => void; pending: boolean }) {
  const [cost, setCost] = useState("");
  const [cls, setCls] = useState<RevenueClass>(r.costClassHint);
  const n = Number(cost.replace(/[$\s]/g, ""));
  const ok = cost.trim() !== "" && Number.isFinite(n) && n >= 0;
  const effect = ok ? unitCostEffect(r, n) : null;
  const leaveOutFirst = r.kind === "notSales";
  const leaveOut = (
    <div key="out" className="rounded-lg border border-border p-3">
      <div className="text-sm font-medium">Leave out of sales</div>
      <p className="mt-0.5 text-xs text-muted">Gift cards, service fees, deposits, donations: money that isn&apos;t a sale. It&apos;s taken out of net sales entirely.</p>
      <Button variant={leaveOutFirst ? "primary" : "secondary"} className="mt-2 h-10 sm:h-9" disabled={pending} onClick={() => run(() => applyLinks([{ squareId: r.squareId, to: { recipeId: null, ignored: true, unitCost: null, costClass: null } }]))}>Leave out</Button>
    </div>
  );
  const costEach = (
    <div key="each" className="rounded-lg border border-border p-3">
      <div className="text-sm font-medium">Bought in — costs a set amount each</div>
      <p className="mt-0.5 text-xs text-muted">Cans, bottles, soda, merch: no recipe, just what one costs you. It still counts as a sale.</p>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:max-w-sm">
        <Field label="Cost of one"><Input value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" placeholder={r.unitCostHint != null ? r.unitCostHint.toFixed(2) : "0.00"} className="num" aria-label={`Cost of one ${r.name}`} /></Field>
        <Field label="Counts as"><Select value={cls} onChange={(e) => setCls(e.target.value as RevenueClass)} options={REVENUE_CLASSES.map((c) => ({ value: c.value, label: c.label }))} aria-label="Counts as" /></Field>
      </div>
      {r.unitCostHint != null && !cost && <button type="button" className="mt-1 text-xs text-muted underline underline-offset-2 hover:text-ink" onClick={() => setCost(r.unitCostHint!.toFixed(2))}>Use {money(r.unitCostHint)} (a typical {pct(r.unitCostHint / (r.price ?? 1), 0)}) as a start</button>}
      {effect && <EffectLine effect={effect} price={r.price} />}
      <Button variant={leaveOutFirst ? "secondary" : "primary"} className="mt-2 h-10 sm:h-9" disabled={pending || !ok} onClick={() => guarded(effect, `${money(n)} each for ${r.name}`, () => applyLinks([{ squareId: r.squareId, to: { recipeId: null, ignored: false, unitCost: n, costClass: cls } }]))}>Save {ok ? `${money(n)} each as ${classLabel(cls).toLowerCase()}` : "cost each"}</Button>
    </div>
  );
  return <div className="mt-3 grid gap-3 border-t border-border pt-3 sm:grid-cols-2">{leaveOutFirst ? [leaveOut, costEach] : [costEach, leaveOut]}</div>;
}

// ---- Draft beer ----------------------------------------------------------------------------------

function BeerSection({ groups, run, pending }: { groups: BeerGroupView[]; run: (fn: () => Promise<LinkResult>) => void; pending: boolean }) {
  const [n, setN] = useState(4);
  const total = groups.reduce((s, g) => s + g.sales30, 0);
  return (
    <HelpZone id="sales.link.beer" tour="sales.link-beer">
      <Section
        title={<span className="inline-flex items-center gap-1.5">Draft beer <HelpTip id="sales.link.beer" /></span>}
        description={`${whole(total)} of pours with no cost yet. Enter what a keg costs you once and every pour of that beer gets a cost from it.`}
        actions={<Link href="/menu/draft-beer" className="text-sm whitespace-nowrap text-ink-2 hover:text-ink">Draft beer →</Link>}
      >
        <div className="grid items-start gap-3 lg:grid-cols-2">
          {groups.slice(0, n).map((g) => <BeerCard key={g.key} g={g} run={run} pending={pending} />)}
        </div>
        {groups.length > n && <div className="mt-3 flex justify-center"><Button variant="ghost" onClick={() => setN((x) => x + 6)}>Show {Math.min(6, groups.length - n)} more beers</Button></div>}
      </Section>
    </HelpZone>
  );
}

interface PourRow { label: string; oz: string; price: string; squareIds: string[]; sales30: number }

function BeerCard({ g, run, pending }: { g: BeerGroupView; run: (fn: () => Promise<LinkResult>) => void; pending: boolean }) {
  // One recipe per pour size: two Square items called "Full Pour" share it.
  const [pours, setPours] = useState<PourRow[]>(() => {
    const by = new Map<string, PourRow>();
    for (const p of g.pours) {
      const k = p.label.toLowerCase();
      const cur = by.get(k);
      if (cur) { cur.squareIds.push(p.squareId); cur.sales30 += p.sales30; if (!cur.price && p.price != null) cur.price = p.price.toFixed(2); }
      else by.set(k, { label: p.label.slice(0, 40), oz: String(p.oz), price: p.price != null ? p.price.toFixed(2) : "", squareIds: [p.squareId], sales30: p.sales30 });
    }
    return [...by.values()].slice(0, 8);
  });
  const [kegCost, setKegCost] = useState(g.kegCost != null ? g.kegCost.toFixed(2) : "");
  const [size, setSize] = useState(g.kegSizeId);
  const [yieldPct, setYield] = useState(String(Math.round(g.yieldPct * 100)));
  const kc = Number(kegCost.replace(/[$,\s]/g, ""));
  const y = Number(yieldPct) / 100;
  const gal = KEG_SIZES.find((k) => k.id === size)?.gallons ?? 15.5;
  const perOz = kc > 0 && y > 0 && y <= 1 ? kc / ((gal * ML_PER_GAL) / ML_PER_FL_OZ * y) : null;
  const valid = perOz != null && pours.every((p) => Number(p.oz) > 0 && Number(p.oz) <= 128 && (p.price === "" || Number(p.price) >= 0));
  const set = (i: number, patch: Partial<PourRow>) => setPours((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2"><Beer className="size-4 shrink-0 text-muted" /><span className="font-medium break-words">{g.beer}</span>{!g.beerId && <Badge>not on Beers</Badge>}</div>
        <div className="shrink-0 text-right"><div className="num text-sm font-semibold">{whole(g.sales30)}</div><div className="text-[11px] text-muted">of last 30 days</div></div>
      </div>
      <div className="mt-3 grid grid-cols-[1fr_1.3fr_0.8fr] gap-2">
        <Field label="Keg cost"><Input value={kegCost} onChange={(e) => setKegCost(e.target.value)} inputMode="decimal" placeholder="0.00" className="num" aria-label={`Keg cost for ${g.beer}`} /></Field>
        <Field label="Keg"><Select value={size} onChange={(e) => setSize(e.target.value)} options={KEG_SIZES.map((k) => ({ value: k.id, label: k.label }))} aria-label="Keg size" /></Field>
        <Field label="Usable %"><Input value={yieldPct} onChange={(e) => setYield(e.target.value)} inputMode="numeric" className="num" aria-label="Usable after foam and line loss, percent" /></Field>
      </div>
      <div className="mt-3 divide-y divide-border rounded-lg border border-border">
        {pours.map((p, i) => {
          const oz = Number(p.oz);
          const price = p.price === "" ? null : Number(p.price);
          const cost = perOz != null && oz > 0 ? perOz * oz : null;
          const pc = cost != null && price ? cost / price : null;
          return (
            <div key={p.label} className="grid grid-cols-[1fr_4rem_4.5rem] items-center gap-2 px-3 py-2 sm:grid-cols-[1fr_4rem_4.5rem_7rem]">
              <div className="min-w-0 text-sm">
                <div className="truncate">{p.label}</div>
                <div className="text-[11px] text-muted">{p.squareIds.length > 1 ? `${p.squareIds.length} Square items · ` : ""}{whole(p.sales30)}</div>
              </div>
              <label className="relative"><Input value={p.oz} onChange={(e) => set(i, { oz: e.target.value })} inputMode="decimal" className="num pr-6 text-right" aria-label={`${p.label} ounces`} /><span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[11px] text-muted">oz</span></label>
              <Input value={p.price} onChange={(e) => set(i, { price: e.target.value })} inputMode="decimal" placeholder="price" className="num text-right" aria-label={`${p.label} price`} />
              <div className={cx("col-span-3 text-xs sm:col-span-1 sm:text-right", pc != null && (pc < LOW_PCT || pc > HIGH_PCT) ? "text-bad" : "text-ink-2")}>{cost == null ? <span className="text-muted">enter keg cost</span> : <>{money(cost)}{pc != null ? <span className="num"> · {pct(pc, 0)}</span> : null}</>}</div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted">{perOz != null ? `${money(perOz * 16)} a pint after ${pct(y, 0)} usable` : "A half-barrel of house beer often costs $60–$150 to brew; a guest keg is its invoice."}</span>
        <Button variant="primary" className="h-10 sm:h-9" disabled={pending || !valid} onClick={() => run(() => costBeerPours({ beer: g.beer, kegSizeId: size, kegCost: kc, yieldPct: y, pours: pours.map((p) => ({ label: p.label, oz: Number(p.oz), price: p.price === "" ? null : Number(p.price), squareIds: p.squareIds })) }))}>
          <Check className="size-4" />Cost {pours.length} pour{pours.length === 1 ? "" : "s"}
        </Button>
      </div>
    </Card>
  );
}

// ---- History ------------------------------------------------------------------------------------------

function History({ entries, run, pending }: { entries: HistoryEntry[]; run: (fn: () => Promise<LinkResult>) => void; pending: boolean }) {
  const batches = useMemo(() => {
    const out: { batch: string; at: string; userName: string | null; rows: HistoryEntry[]; undone: boolean }[] = [];
    for (const e of entries) {
      const last = out.at(-1);
      if (last && last.batch === e.batch) last.rows.push(e);
      else out.push({ batch: e.batch, at: e.at, userName: e.userName, rows: [e], undone: e.undone });
    }
    return out;
  }, [entries]);
  const [n, setN] = useState(8);
  return (
    <Section title={<span className="inline-flex items-center gap-1.5">Changes <HelpTip id="sales.link.history" /></span>} description="Every link change, newest first. Undo puts a change back as it was, unless the item has been changed again since.">
      {batches.length === 0 ? (
        <Card className="p-5 text-sm text-muted">No link changes yet. Every change you make here and on the Square items table shows up here.</Card>
      ) : (
        <Card className="divide-y divide-border">
          {batches.slice(0, n).map((b) => (
            <div key={b.batch} className={cx("flex items-start gap-3 px-4 py-3", b.undone && "opacity-60")}>
              <div className="min-w-0 flex-1 text-sm">
                {b.rows.slice(0, 3).map((e) => (
                  <div key={e.id} className="break-words"><span className="font-medium">{e.squareName}</span>: <span className="text-muted">{e.before}</span> → {e.after}</div>
                ))}
                {b.rows.length > 3 && <div className="text-muted">and {b.rows.length - 3} more</div>}
                <div className="mt-0.5 text-xs text-muted">{relativeTime(new Date(b.at))}{b.userName ? ` · ${b.userName}` : ""}{b.undone ? " · undone" : ""}</div>
              </div>
              {!b.undone && <Button size="sm" variant="ghost" className="h-10 shrink-0 sm:h-8" disabled={pending} onClick={() => run(() => undoLinks(b.batch))}><Undo2 className="size-3.5" />Undo</Button>}
            </div>
          ))}
          {batches.length > n && <div className="flex justify-center p-2"><Button variant="ghost" size="sm" onClick={() => setN((x) => x + 20)}>Show older</Button></div>}
        </Card>
      )}
    </Section>
  );
}
