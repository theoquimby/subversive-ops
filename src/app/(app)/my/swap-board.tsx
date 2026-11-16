"use client";

import { HelpTip, HelpZone } from "@/components/help";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, cx, Input, Select } from "@/components/ui";
import { shiftLabel } from "@/domain/schedule";
import { STAGE_LABEL, SWAP_KIND_LABEL, type Eligibility, type SwapKind, type SwapStage } from "@/domain/swaps";
import { shortDate } from "@/lib/format";
import { ArrowLeftRight, Check, ChevronDown, Hand, History, LogOut, X } from "lucide-react";
import { useState, useTransition } from "react";
import { cancelSwap, declineSwapAsk, offerToTake, pickUpShift, requestSwap } from "./actions";

export interface BShift {
  id: string;
  date: string;
  startMin: number;
  endMin: number;
  hours: number;
  position: string;
  positionId: string;
  color: string;
  notes: string | null;
}

type Trade = { id: string; label: string };

export interface SwapBoardProps {
  today: string;
  weekHours: number;
  allowDrop: boolean;
  mine: (BShift & { swap: { id: string; kind: SwapKind; stage: SwapStage; taker: string | null; offered: string | null } | null })[];
  open: (BShift & { check: Eligibility })[];
  posted: { swapId: string; kind: SwapKind; from: string; note: string | null; shift: BShift; check: Eligibility; trades: Trade[] }[];
  asks: { swapId: string; kind: SwapKind; from: string; note: string | null; shift: BShift; check: Eligibility; trades: Trade[] }[];
  waiting: { swapId: string; kind: SwapKind; from: string | null; shift: BShift; giving: string | null }[];
  history: { id: string; kind: SwapKind; stage: SwapStage; shift: string; position: string; other: string | null; direction: "in" | "out"; at: string; auto: boolean; log: { at: string; by: string; what: string }[] }[];
  team: { id: string; name: string; positionIds: string[] }[];
}

const fmtH = (h: number) => `${Number(h.toFixed(1))}h`;
type Res = { error?: string; ok?: string };

export function SwapBoard({ today, weekHours, allowDrop, mine, open, posted, asks, waiting, history, team }: SwapBoardProps) {
  const [pending, start] = useTransition();
  const [toast, show] = useToast();
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [offerFor, setOfferFor] = useState<string | null>(null);

  const run = (fn: () => Promise<Res>, opts: { hide?: string; after?: () => void } = {}) => {
    if (opts.hide) setGone((g) => new Set(g).add(opts.hide!));
    start(async () => {
      const r = await fn().catch(() => ({ error: "No signal — that didn't go through. Try again in a moment." }) as Res);
      if (r.error) {
        if (opts.hide) setGone((g) => { const n = new Set(g); n.delete(opts.hide!); return n; });
        show(r.error, "bad");
      } else {
        show(r.ok ?? "Done");
        opts.after?.();
      }
    });
  };

  const openShown = open.filter((s) => !gone.has(s.id));
  const postedShown = posted.filter((s) => !gone.has(s.swapId));
  const asksShown = asks.filter((s) => !gone.has(s.swapId));
  const canTake = [...openShown.filter((s) => s.check.eligible), ...postedShown.filter((p) => p.check.eligible)].length;

  return (
    <div className="flex flex-col gap-10">
      {toast}

      {asksShown.length > 0 && (
        <section aria-labelledby="asks-h" className="animate-rise-in motion-reduce:animate-none">
          <h2 id="asks-h" className="mb-3 text-[0.95rem] font-semibold">Asked of you</h2>
          <Card className="divide-y divide-border border-warn/40">
            {asksShown.map((a) => (
              <AskRow key={a.swapId} a={a} today={today} pending={pending} onYes={(tradeId) => run(() => offerToTake(a.swapId, tradeId), { hide: a.swapId })} onNo={() => run(() => declineSwapAsk(a.swapId), { hide: a.swapId })} />
            ))}
          </Card>
        </section>
      )}

      <HelpZone id="my.shifts"><section>
        <div className="mb-3 flex items-end justify-between">
          <h2 className="text-[0.95rem] font-semibold">Coming up</h2>
          <span className="num text-sm text-muted">{fmtH(weekHours)} in the next 7 days</span>
        </div>
        {mine.length === 0 ? (
          <Card className="px-4 py-6 text-center text-sm text-muted">Nothing on the schedule for you yet. Once a manager publishes the schedule your shifts show up here{open.length ? " — or pick up an open shift below" : ""}.</Card>
        ) : (
          <Card className="divide-y divide-border">
            {mine.map((s) => (
              <div key={s.id} className="px-4 py-3">
                <ShiftRow s={s} today={today}>
                  {s.swap ? (
                    <Badge tone={s.swap.stage === "claimed" ? "good" : "warn"}>{s.swap.kind === "DROP" ? "Drop asked" : s.swap.stage === "claimed" ? `${s.swap.taker?.split(" ")[0] ?? "Taken"} · ${STAGE_LABEL.claimed.toLowerCase()}` : s.swap.stage === "asked" ? `Asked ${s.swap.taker?.split(" ")[0]}` : SWAP_KIND_LABEL[s.swap.kind] === "Trade" ? "Up for trade" : "Up for grabs"}</Badge>
                  ) : (
                    <Button variant="ghost" size="sm" className="max-sm:h-11 max-sm:px-3" aria-expanded={offerFor === s.id} onClick={() => setOfferFor(offerFor === s.id ? null : s.id)}>
                      <ArrowLeftRight className="size-3.5" aria-hidden /> Swap
                    </Button>
                  )}
                </ShiftRow>
                {s.swap?.offered && <p className="mt-1.5 pl-15 text-xs text-muted">You&apos;d get {s.swap.offered} in return.</p>}
                {s.swap && (
                  <div className="mt-2 flex justify-end">
                    <Button variant="ghost" size="sm" className="max-sm:h-11" disabled={pending} onClick={() => run(() => cancelSwap(s.swap!.id))}>Withdraw</Button>
                  </div>
                )}
                {offerFor === s.id && !s.swap && (
                  <OfferForm
                    s={s}
                    allowDrop={allowDrop}
                    team={team.filter((t) => t.positionIds.includes(s.positionId))}
                    pending={pending}
                    onSend={(kind, ask, note) => run(() => requestSwap(s.id, ask || null, kind, note), { after: () => setOfferFor(null) })}
                    onClose={() => setOfferFor(null)}
                  />
                )}
              </div>
            ))}
          </Card>
        )}
      </section></HelpZone>

      <HelpZone id="my.openShifts" tour="my.open"><section id="open" className="scroll-mt-20">
        <span id="board" className="block scroll-mt-20" aria-hidden />
        <h2 className="mb-1 flex items-center gap-1.5 text-[0.95rem] font-semibold">Shifts you can pick up <HelpTip id="my.swapBoard" /></h2>
        <p className="mb-3 text-sm text-muted">{canTake ? `${canTake} you can take. ` : ""}Only shifts for your positions. We check hours, overtime and certificates for you.</p>
        {openShown.length === 0 && postedShown.length === 0 ? (
          <Card className="px-4 py-6 text-center text-sm text-muted">Nothing open right now. When a shift needs someone, it shows up here first.</Card>
        ) : (
          <Card className="divide-y divide-border">
            {openShown.map((s) => (
              <div key={s.id} className="px-4 py-3">
                <ShiftRow s={s} today={today} sub="Open shift">
                  <Button variant="primary" size="sm" className="max-sm:h-11 max-sm:px-3.5" disabled={pending || !s.check.eligible} onClick={() => run(() => pickUpShift(s.id), { hide: s.id })}>
                    <Hand className="size-3.5" aria-hidden /> Pick up
                  </Button>
                </ShiftRow>
                <CheckLine check={s.check} />
              </div>
            ))}
            {postedShown.map((p) => (
              <PostedRow key={p.swapId} p={p} today={today} pending={pending} onTake={(tradeId) => run(() => offerToTake(p.swapId, tradeId), { hide: p.swapId })} />
            ))}
          </Card>
        )}
      </section></HelpZone>

      {waiting.length > 0 && (
        <section>
          <h2 className="mb-3 text-[0.95rem] font-semibold">Waiting on a manager</h2>
          <Card className="divide-y divide-border">
            {waiting.filter((w) => !gone.has(w.swapId)).map((w) => (
              <div key={w.swapId} className="px-4 py-3">
                <ShiftRow s={w.shift} today={today} sub={w.kind === "PICKUP" ? "You asked to pick this up" : `Taking it from ${w.from?.split(" ")[0]}${w.giving ? ` · you give ${w.giving}` : ""}`}>
                  {w.kind === "PICKUP" ? <Button variant="ghost" size="sm" className="max-sm:h-11" disabled={pending} onClick={() => run(() => cancelSwap(w.swapId), { hide: w.swapId })}>Withdraw</Button> : <Badge tone="warn">Waiting</Badge>}
                </ShiftRow>
              </div>
            ))}
          </Card>
        </section>
      )}

      {history.length > 0 && <SwapHistory history={history} />}
    </div>
  );
}

function CheckLine({ check }: { check: Eligibility }) {
  if (!check.eligible) return <p className="mt-1.5 pl-15 text-xs text-bad">Can&apos;t take it: {check.reasons.join(" · ")}</p>;
  if (check.warnings.length) return <p className="mt-1.5 pl-15 text-xs text-warn">Heads up: {check.warnings.join(" · ")}</p>;
  return <p className="mt-1.5 pl-15 text-xs text-muted">You&apos;d be at {fmtH(check.hoursAfter)} that week.</p>;
}

function PostedRow({ p, today, pending, onTake }: { p: SwapBoardProps["posted"][number]; today: string; pending: boolean; onTake: (tradeId: string | null) => void }) {
  const [trade, setTrade] = useState("");
  const isTrade = p.kind === "SWAP";
  const first = p.from.split(" ")[0];
  return (
    <div className="px-4 py-3">
      <ShiftRow s={p.shift} today={today} sub={isTrade ? `${first} wants to trade` : `${first} is giving this away`}>
        {!isTrade && (
          <Button size="sm" variant="primary" className="max-sm:h-11" disabled={pending || !p.check.eligible} onClick={() => onTake(null)}>
            Take it
          </Button>
        )}
      </ShiftRow>
      {p.note && <p className="mt-1.5 pl-15 text-xs text-ink-2">“{p.note}”</p>}
      <CheckLine check={p.check} />
      {isTrade && p.check.eligible && (
        p.trades.length === 0 ? (
          <p className="mt-1.5 pl-15 text-xs text-muted">None of your upcoming shifts work for {first} in return.</p>
        ) : (
          <div className="mt-2 flex flex-col gap-2 pl-15 sm:flex-row sm:items-center">
            <div className="flex-1"><Select aria-label="Your shift to trade" value={trade} onChange={(e) => setTrade(e.target.value)} placeholder="Pick a shift of yours to give" options={p.trades.map((t) => ({ value: t.id, label: t.label }))} className="max-sm:h-12" /></div>
            <Button variant="primary" className="max-sm:h-12" disabled={pending || !trade} onClick={() => onTake(trade)}>Offer trade</Button>
          </div>
        )
      )}
    </div>
  );
}

function AskRow({ a, today, pending, onYes, onNo }: { a: SwapBoardProps["asks"][number]; today: string; pending: boolean; onYes: (tradeId: string | null) => void; onNo: () => void }) {
  const [trade, setTrade] = useState("");
  const first = a.from.split(" ")[0];
  const isTrade = a.kind === "SWAP";
  return (
    <div className="px-4 py-3">
      <ShiftRow s={a.shift} today={today} sub={isTrade ? `${first} asked to trade with you` : `${first} asked you to cover`} />
      {a.note && <p className="mt-1.5 pl-15 text-xs text-ink-2">“{a.note}”</p>}
      <CheckLine check={a.check} />
      {isTrade && a.check.eligible && a.trades.length > 0 && (
        <div className="mt-2 pl-15"><Select aria-label="Your shift to trade" value={trade} onChange={(e) => setTrade(e.target.value)} placeholder="Pick a shift of yours to give" options={a.trades.map((t) => ({ value: t.id, label: t.label }))} className="max-sm:h-12" /></div>
      )}
      <div className="mt-2.5 flex justify-end gap-2">
        <Button variant="ghost" className="max-sm:h-11" disabled={pending} onClick={onNo}><X className="size-4" aria-hidden /> Can&apos;t</Button>
        <Button variant="primary" className="max-sm:h-11" disabled={pending || !a.check.eligible || (isTrade && !trade)} onClick={() => onYes(isTrade ? trade : null)}><Check className="size-4" aria-hidden /> {isTrade ? "Trade" : "I'll take it"}</Button>
      </div>
    </div>
  );
}

const KINDS: { kind: "GIVE" | "SWAP" | "DROP"; label: string; hint: string }[] = [
  { kind: "GIVE", label: "Give away", hint: "Anyone who can work it takes it. You're off it once a manager approves." },
  { kind: "SWAP", label: "Trade", hint: "Someone takes this one and gives you one of theirs." },
  { kind: "DROP", label: "Drop", hint: "You can't work it and nobody's lined up. A manager decides; it becomes an open shift." },
];

function OfferForm({ s, allowDrop, team, pending, onSend, onClose }: { s: BShift; allowDrop: boolean; team: { id: string; name: string }[]; pending: boolean; onSend: (kind: "GIVE" | "SWAP" | "DROP", ask: string, note: string) => void; onClose: () => void }) {
  const [kind, setKind] = useState<"GIVE" | "SWAP" | "DROP">("GIVE");
  const [ask, setAsk] = useState("");
  const [note, setNote] = useState("");
  const kinds = KINDS.filter((k) => allowDrop || k.kind !== "DROP");
  return (
    <div className="mt-3 flex animate-rise-in flex-col gap-3 rounded-xl bg-surface-2/60 p-3 motion-reduce:animate-none">
      <div role="radiogroup" aria-label={`What to do with ${shortDate(s.date)}`} className={cx("grid gap-1 rounded-xl bg-surface-2 p-1", kinds.length === 3 ? "grid-cols-3" : "grid-cols-2")}>
        {kinds.map((k) => (
          <button key={k.kind} type="button" role="radio" aria-checked={kind === k.kind} onClick={() => setKind(k.kind)} className={cx("h-11 rounded-lg px-1 text-sm transition-[background-color,color,box-shadow] duration-120 sm:h-9", kind === k.kind ? "bg-surface font-medium text-ink shadow-sm" : "text-ink-2 active:bg-surface/60")}>
            {k.label}
          </button>
        ))}
      </div>
      <p className="-mt-1.5 text-xs text-muted">{KINDS.find((k) => k.kind === kind)?.hint}</p>
      {kind !== "DROP" && (
        <Select aria-label="Who to ask" value={ask} onChange={(e) => setAsk(e.target.value)} options={[{ value: "", label: "Anyone who can cover" }, ...team.map((t) => ({ value: t.id, label: `Ask ${t.name}` }))]} className="max-sm:h-12" />
      )}
      <Input aria-label="Note" placeholder={kind === "DROP" ? "Why (helps your manager decide)" : "Note (optional)"} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className="max-sm:h-12" />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" className="max-sm:h-11" onClick={onClose}>Cancel</Button>
        <Button variant="primary" className="max-sm:h-12" disabled={pending || (kind === "DROP" && !note.trim())} onClick={() => onSend(kind, ask, note)}>
          {kind === "DROP" ? <><LogOut className="size-4" aria-hidden /> Ask to drop</> : kind === "SWAP" ? <><ArrowLeftRight className="size-4" aria-hidden /> Offer trade</> : <><Hand className="size-4" aria-hidden /> Offer it</>}
        </Button>
      </div>
    </div>
  );
}

function SwapHistory({ history }: { history: SwapBoardProps["history"] }) {
  const [open, setOpen] = useState(false);
  const shown = open ? history : history.slice(0, 3);
  return (
    <section aria-labelledby="swap-history-h">
      <h2 id="swap-history-h" className="mb-3 flex items-center gap-1.5 text-[0.95rem] font-semibold"><History className="size-4 text-muted" aria-hidden /> Swap history</h2>
      <Card className="divide-y divide-border">
        {shown.map((h) => (
          <details key={h.id} className="group px-4 py-3">
            <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 text-sm">
              <span className="min-w-0">
                <span className="block truncate font-medium">{h.shift} <span className="font-normal text-muted">· {h.position}</span></span>
                <span className="block truncate text-xs text-muted">
                  {h.kind === "PICKUP" ? "Picked up an open shift" : h.kind === "DROP" ? "Asked to drop" : h.direction === "out" ? `${h.kind === "SWAP" ? "Traded" : "Gave"}${h.other ? ` to ${h.other}` : ""}` : `${h.kind === "SWAP" ? "Traded with" : "Took it from"} ${h.other ?? "a teammate"}`}
                  {h.auto ? " · approved automatically" : ""}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <Badge tone={h.stage === "approved" ? "good" : h.stage === "denied" ? "bad" : "neutral"}>{STAGE_LABEL[h.stage]}</Badge>
                <ChevronDown className="size-4 text-muted transition-transform group-open:rotate-180" aria-hidden />
              </span>
            </summary>
            <ol className="mt-2 space-y-1 border-l border-border pl-3 text-xs text-muted">
              {h.log.map((l, i) => <li key={i}><span className="num">{new Date(l.at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" })}</span> · {l.by ? `${l.by}: ` : ""}{l.what}</li>)}
            </ol>
          </details>
        ))}
      </Card>
      {history.length > 3 && <Button variant="ghost" size="sm" className="mt-2 max-sm:h-11" onClick={() => setOpen(!open)}>{open ? "Show less" : `Show all ${history.length}`}</Button>}
    </section>
  );
}

export function ShiftRow({ s, today, sub, children }: { s: BShift; today: string; sub?: string; children?: React.ReactNode }) {
  const d = new Date(`${s.date}T00:00:00Z`);
  return (
    <div className="flex items-center gap-3">
      <div className={cx("flex w-12 shrink-0 flex-col items-center rounded-lg py-1.5", s.date === today ? "bg-primary text-primary-ink" : "bg-surface-2")}>
        <span className="text-[11px] uppercase">{d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })}</span>
        <span className="num text-base leading-tight font-semibold">{d.getUTCDate()}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="num text-sm font-medium">{shiftLabel(s.startMin, s.endMin)} <span className="font-normal text-muted">· {fmtH(s.hours)}</span></div>
        <div className="flex items-center gap-1.5 truncate text-xs text-muted">
          <span className="size-2 shrink-0 rounded-full" style={{ background: s.color }} />
          {s.position}{s.date === today && " · today"}{!sub && s.notes ? ` · ${s.notes}` : ""}
        </div>
        {sub && <div className="text-xs text-muted">{sub}</div>}
      </div>
      {children && <div className="shrink-0">{children}</div>}
    </div>
  );
}
