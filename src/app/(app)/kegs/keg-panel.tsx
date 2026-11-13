"use client";

import { Button, Card, cx, DatePicker, Input, Select } from "@/components/ui";
import { ACTION_DONE, ACTION_LABEL, displayCode, kegSizeInfo, nextActions, OWNER_LABEL, sinceLabel, STATUS_META, UNDO_SECONDS, type KegActionId } from "@/domain/kegs";
import { businessDateTime, shortDate } from "@/lib/format";
import type { KegCard, PanelContext } from "@/server/services/kegs";
import { ArrowRight, Check, CloudOff, MapPin, Undo2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { replacementsFor, undoKegAction } from "./actions";
import { BeerDot, daysText, KegGauge, pctText, StatusBadge } from "./bits";
import { newClientId, sendOrQueue } from "./queue";

type Mode = null | "TAP" | "MOVE" | "STORE" | "OUT" | "FILL" | "UNTAP" | "RETURN";
type Replacement = Awaited<ReturnType<typeof replacementsFor>>[number];

interface UndoState {
  groupId: string;
  label: string;
  until: number;
}

/**
 * The keg card after a scan: what it is, where it is, and 2–4 big buttons
 * for what usually happens next. One tap for a kick; the rest ask one
 * question (which line, which spot, which account, which beer). Every
 * action can be undone for 10 seconds.
 */
export function KegPanel({ card: initial, ctx, role, onDone, compact }: { card: KegCard; ctx: PanelContext; role: "MANAGER" | "STAFF"; onDone?: () => void; compact?: boolean }) {
  const [card, setCard] = useState(initial);
  const [mode, setMode] = useState<Mode>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; queued?: boolean } | null>(null);
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [replace, setReplace] = useState<{ line: number; beerId: string; beer: string; options: Replacement[]; groupId: string } | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => setCard(initial), [initial]);

  const meta = STATUS_META[card.status];
  const size = kegSizeInfo(card.sizeId);
  const actions = nextActions(card.status);

  const run = (action: KegActionId, extra: Record<string, unknown> = {}, opts: { groupId?: string; kegId?: string; label?: string } = {}) =>
    new Promise<boolean>((resolve) =>
      start(async () => {
        setError(null);
        const groupId = opts.groupId ?? newClientId();
        const label = opts.label ?? `${ACTION_DONE[action]} · ${card.beer?.name ?? displayCode(card.code)}`;
        const r = await sendOrQueue({ kegId: opts.kegId ?? card.id, action, groupId, label, ...extra });
        if ("error" in r) { setError(r.error); resolve(false); return; }
        setMode(null);
        if (r.queued) {
          setNotice({ text: "Saved on this phone. It sends as soon as there's signal.", queued: true });
          resolve(true);
          return;
        }
        if (r.result && "card" in r.result && r.result.card && (opts.kegId ?? card.id) === card.id) setCard(r.result.card);
        setUndo({ groupId, label, until: Date.now() + UNDO_SECONDS * 1000 });
        setNotice({ text: label });
        resolve(true);
      }),
    );

  const kick = async () => {
    const line = card.tapLine;
    const beer = card.beer;
    const groupId = newClientId();
    const ok = await run("KICK", {}, { groupId, label: `Kicked · ${beer?.name ?? displayCode(card.code)}${line ? ` on tap ${line}` : ""}` });
    if (ok && beer && line) {
      const options = await replacementsFor(beer.id, card.id).catch(() => []);
      setReplace({ line, beerId: beer.id, beer: beer.name, options, groupId });
    }
  };

  const putOn = (r: Replacement) =>
    run("TAP", { tapLine: replace!.line }, { groupId: replace!.groupId, kegId: r.id, label: `Kicked and replaced · ${replace!.beer} on tap ${replace!.line}` }).then((ok) => ok && setReplace(null));

  const press = (a: KegActionId) => {
    if (a === "KICK") return void kick();
    if (a === "CLEANED" || a === "EMPTY") return void run(a, { area: card.area });
    if (a === "UNTAP" || a === "RETURN") return setMode(a);
    setMode(a as Mode);
  };

  return (
    <div className={cx("space-y-4", undo && "pb-24")}>
      <Card className="overflow-hidden">
        <div className="flex items-start gap-3 p-4">
          <span className="mt-1"><BeerDot color={card.beer?.color ?? "grey"} className="size-5" /></span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl leading-tight font-semibold tracking-tight">{card.beer?.name ?? (card.status === "EMPTY" || card.status === "CLEANING" ? "Empty keg" : "No beer set")}</h2>
              <StatusBadge status={card.status} />
            </div>
            <div className="num mt-0.5 text-sm text-muted">
              {displayCode(card.code)} · {size.short}
              {card.legacyCode ? ` · old sticker ${card.legacyCode}` : ""}
              {card.owner !== "OURS" ? ` · ${OWNER_LABEL[card.owner]}` : ""}
            </div>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-px border-t border-border bg-border text-sm">
          <div className="bg-surface px-4 py-3">
            <dt className="text-xs text-muted">Where</dt>
            <dd className="mt-0.5 flex items-start gap-1.5 font-medium"><MapPin className="mt-0.5 size-3.5 shrink-0 text-muted" />{card.place}</dd>
          </div>
          <div className="bg-surface px-4 py-3">
            <dt className="text-xs text-muted">{card.status === "ON_TAP" ? "On tap for" : meta.short === "Full" ? "In there for" : "Since"}</dt>
            <dd className="mt-0.5 font-medium">{sinceLabel(new Date(card.status === "ON_TAP" && card.fill?.tappedAt ? card.fill.tappedAt : card.statusAt))}</dd>
          </div>
          {card.status === "ON_TAP" && card.estimate && (
            <div className="col-span-2 flex items-center gap-3 bg-surface px-4 py-3">
              <KegGauge pct={card.estimate.pctLeft} color={card.beer?.color ?? "grey"} />
              <div>
                <div className="font-medium">{card.estimate.overdue ? "Should have kicked by now" : pctText(card.estimate.pctLeft)}</div>
                <div className="num text-xs text-muted">{[daysText(card.estimate.daysLeft), `about ${Math.round(card.estimate.pintsLeft)} pints`].filter(Boolean).join(" · ")}</div>
              </div>
            </div>
          )}
          {card.fill && (card.fill.filledOn || card.fill.batch || card.fill.bestBy) && (
            <div className="col-span-2 bg-surface px-4 py-3">
              <dt className="text-xs text-muted">Fill</dt>
              <dd className="num mt-0.5">{[card.fill.filledOn ? `Filled ${shortDate(card.fill.filledOn)}` : null, card.fill.batch ? `batch ${card.fill.batch}` : null, card.fill.bestBy ? `best by ${shortDate(card.fill.bestBy)}` : null].filter(Boolean).join(" · ")}</dd>
            </div>
          )}
        </dl>
      </Card>

      {!card.active ? (
        <p className="rounded-xl bg-surface-2 px-4 py-3 text-sm text-ink-2">This keg is retired.{role === "MANAGER" ? " Bring it back on the keg list." : " A manager can bring it back."}</p>
      ) : replace ? (
        <ReplaceStep replace={replace} pending={pending} onPick={putOn} onSkip={() => setReplace(null)} />
      ) : mode ? (
        <Step mode={mode} card={card} ctx={ctx} pending={pending} onCancel={() => { setMode(null); setError(null); }} onRun={(a, extra) => run(a, extra)} />
      ) : (
        <div data-tour="kegs.actions" className={cx("grid gap-2.5", actions.length > 2 ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2")}>
          {actions.map((a, i) => (
            <Button key={a} size="lg" variant={i === 0 ? "primary" : "secondary"} disabled={pending} onClick={() => press(a)} className={cx("h-16 w-full justify-between rounded-2xl px-5 text-lg", i === 0 && a === "KICK" && "h-20 text-xl")}>
              {a === "TAP" && card.status !== "ON_TAP" ? "Tapped on line…" : ACTION_LABEL[a]}
              <ArrowRight className="size-5 opacity-60" />
            </Button>
          ))}
        </div>
      )}

      {error && <p role="alert" className="rounded-xl bg-bad-bg px-4 py-3 text-sm font-medium text-bad">{error}</p>}
      {notice && !undo && (
        <p className={cx("flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium", notice.queued ? "bg-warn-bg text-warn" : "bg-good-bg text-good")}>
          {notice.queued ? <CloudOff className="size-4" /> : <Check className="size-4" />} {notice.text}
        </p>
      )}

      {undo && <UndoBar undo={undo} onExpire={() => setUndo(null)} onUndo={() => start(async () => {
        const r = await undoKegAction({ groupId: undo.groupId });
        setUndo(null);
        setReplace(null);
        if ("error" in r) setError(r.error);
        else {
          setNotice({ text: "Undone." });
          const { loadKegCard } = await import("./actions");
          const fresh = await loadKegCard(card.id);
          if (fresh) setCard(fresh);
        }
      })} />}

      {!compact && <History card={card} />}
      {onDone && (
        <div className="pt-1">
          <Button variant="ghost" className="h-11 w-full" onClick={onDone}>Scan another keg</Button>
        </div>
      )}
    </div>
  );
}

function ReplaceStep({ replace, pending, onPick, onSkip }: { replace: { line: number; beer: string; options: Replacement[] }; pending: boolean; onPick: (r: Replacement) => void; onSkip: () => void }) {
  return (
    <Card className="p-4" data-tour="kegs.replace">
      <div className="text-base font-semibold">Replace with another {replace.beer}?</div>
      {replace.options.length === 0 ? (
        <p className="mt-1 text-sm text-muted">There&apos;s no full keg of {replace.beer} in cold storage. Managers have been told. Scan whatever goes on tap {replace.line} next.</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted">Oldest first. Grab it from here, then tap it on line {replace.line}:</p>
          <div className="mt-3 flex flex-col gap-2">
            {replace.options.slice(0, 4).map((r, i) => (
              <button key={r.id} disabled={pending} onClick={() => onPick(r)} className={cx("flex min-h-16 items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors duration-120 active:scale-[0.99] disabled:opacity-50", i === 0 ? "border-ink bg-surface-2" : "border-border bg-surface hover:bg-surface-2")}>
                <MapPin className="size-5 shrink-0 text-area" />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{r.place}</div>
                  <div className="num text-xs text-muted">{displayCode(r.code)} · {kegSizeInfo(r.sizeId).short}{r.filledOn ? ` · filled ${shortDate(r.filledOn)}` : ""}{r.status === "FILLED" ? " · not cold yet" : ""}</div>
                </div>
                <span className="text-sm font-medium whitespace-nowrap">Tap {replace.line}</span>
              </button>
            ))}
          </div>
        </>
      )}
      <Button variant="ghost" className="mt-2 h-11 w-full" onClick={onSkip}>{replace.options.length ? "Not now" : "OK"}</Button>
    </Card>
  );
}

function Step({ mode, card, ctx, pending, onCancel, onRun }: { mode: Exclude<Mode, null>; card: KegCard; ctx: PanelContext; pending: boolean; onCancel: () => void; onRun: (a: KegActionId, extra: Record<string, unknown>) => void }) {
  const firstArea = mode === "STORE" || mode === "UNTAP" ? ctx.coldArea : mode === "RETURN" ? card.area ?? ctx.coldArea : card.area ?? ctx.coldArea;
  const [area, setArea] = useState<string>(ctx.areas.includes(firstArea) ? firstArea : ctx.areas[0] ?? ctx.coldArea);
  const [spotId, setSpotId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [accountId, setAccountId] = useState("");
  const [beerId, setBeerId] = useState(card.beer?.id ?? "");
  const [batch, setBatch] = useState("");
  const [bestBy, setBestBy] = useState("");
  const spots = ctx.spots.filter((s) => s.area === area);
  const title = { TAP: "Which tap line?", MOVE: "Where did it go?", STORE: "Where in cold storage?", UNTAP: "Back to where?", OUT: "Which account?", FILL: "Filled with…", RETURN: "Where is it now?" }[mode];

  return (
    <Card className="p-4">
      <div className="mb-3 text-base font-semibold">{title}</div>
      {mode === "TAP" && (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {Array.from({ length: ctx.tapLines }, (_, i) => i + 1).map((n) => {
            const busy = ctx.busy.find((b) => b.line === n && b.kegId !== card.id);
            return (
              <button key={n} disabled={pending || !!busy} onClick={() => onRun("TAP", { tapLine: n })} className={cx("flex h-16 flex-col items-center justify-center rounded-2xl border text-lg font-semibold transition-colors duration-120 active:scale-[0.97]", busy ? "border-border bg-surface-2 text-muted opacity-60" : "border-border-strong bg-surface hover:bg-surface-2")}>
                {n}
                <span className="max-w-full truncate px-1 text-[10px] font-normal">{busy ? busy.beer ?? "in use" : "free"}</span>
              </button>
            );
          })}
        </div>
      )}
      {(mode === "MOVE" || mode === "STORE" || mode === "UNTAP" || mode === "RETURN") && (
        <div className="space-y-3">
          <Chips options={ctx.areas.map((a) => ({ value: a, label: a }))} value={area} onChange={(v) => { setArea(v); setSpotId(null); }} />
          {spots.length > 0 && (
            <div>
              <div className="mb-1.5 text-xs font-medium text-muted">Spot</div>
              <Chips options={[{ value: "", label: "Anywhere" }, ...spots.map((s) => ({ value: s.id, label: s.name }))]} value={spotId ?? ""} onChange={(v) => setSpotId(v || null)} />
            </div>
          )}
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note, e.g. stack 2, bottom" aria-label="Where exactly (optional)" />
          <Button size="lg" variant="primary" className="h-14 w-full rounded-2xl text-base" disabled={pending || !area} onClick={() => onRun(mode === "STORE" ? "STORE" : mode === "UNTAP" ? "UNTAP" : mode === "RETURN" ? "RETURN" : "MOVE", { area, spotId, spotNote: note || null })}>
            {mode === "RETURN" ? "Came back" : mode === "UNTAP" ? "Taken off tap" : "Put it here"}
          </Button>
        </div>
      )}
      {mode === "OUT" && (
        <div className="space-y-3">
          {ctx.accounts.length ? (
            <Select value={accountId} onChange={(e) => setAccountId(e.target.value)} options={ctx.accounts.map((a) => ({ value: a.id, label: a.name }))} placeholder="Pick the account" aria-label="Account" searchable />
          ) : (
            <p className="text-sm text-muted">No accounts yet. A manager adds them on Kegs → Setup.</p>
          )}
          <Button size="lg" variant="primary" className="h-14 w-full rounded-2xl text-base" disabled={pending || !accountId} onClick={() => onRun("OUT", { accountId })}>Sent out</Button>
        </div>
      )}
      {mode === "FILL" && (
        <div className="space-y-3">
          {ctx.beers.length ? (
            <Chips options={ctx.beers.map((b) => ({ value: b.id, label: b.name, color: b.color }))} value={beerId} onChange={setBeerId} />
          ) : (
            <p className="text-sm text-muted">No beers yet. A manager adds them on Kegs → Setup.</p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Input value={batch} onChange={(e) => setBatch(e.target.value)} placeholder="Batch (optional)" aria-label="Batch" />
            <DatePicker value={bestBy} onChange={(e) => setBestBy(e.target.value)} aria-label="Best by (optional)" />
          </div>
          <Button size="lg" variant="primary" className="h-14 w-full rounded-2xl text-base" disabled={pending || !beerId} onClick={() => onRun("FILL", { beerId, batchCode: batch || null, bestBy: bestBy || null, area: card.area })}>Filled</Button>
        </div>
      )}
      <Button variant="ghost" className="mt-2 h-11 w-full" onClick={onCancel}>Cancel</Button>
    </Card>
  );
}

function Chips({ options, value, onChange }: { options: { value: string; label: string; color?: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button key={o.value || "_"} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)} className={cx("inline-flex min-h-11 items-center gap-2 rounded-xl border px-3.5 text-[0.95rem] transition-colors duration-120 active:scale-[0.98]", o.value === value ? "border-ink bg-ink text-bg" : "border-border-strong bg-surface text-ink hover:bg-surface-2")}>
          {o.color && <BeerDot color={o.color} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

function UndoBar({ undo, onUndo, onExpire }: { undo: UndoState; onUndo: () => void; onExpire: () => void }) {
  const [left, setLeft] = useState(Math.ceil((undo.until - Date.now()) / 1000));
  const expire = useRef(onExpire);
  expire.current = onExpire;
  useEffect(() => {
    const t = setInterval(() => {
      const s = Math.ceil((undo.until - Date.now()) / 1000);
      setLeft(s);
      if (s <= 0) { clearInterval(t); expire.current(); }
    }, 250);
    return () => clearInterval(t);
  }, [undo.until]);
  return (
    <div role="status" className="fixed inset-x-3 bottom-[calc(var(--tabbar)+0.75rem)] z-40 mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-ink px-4 py-3 text-bg shadow-2xl lg:bottom-6 lg:left-64">
      <Check className="size-5 shrink-0 text-good" />
      <span className="min-w-0 flex-1 text-sm font-medium">{undo.label}</span>
      <button onClick={onUndo} className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-bg/15 px-3 text-sm font-semibold active:scale-[0.97]">
        <Undo2 className="size-4" /> Undo <span className="num w-4 text-xs opacity-70">{Math.max(0, left)}</span>
      </button>
    </div>
  );
}

function History({ card }: { card: KegCard }) {
  if (!card.events.length) return null;
  return (
    <details className="group rounded-xl border border-border bg-surface">
      <summary className="flex h-12 cursor-pointer list-none items-center justify-between px-4 text-sm font-medium">History <span className="text-xs text-muted group-open:hidden">{card.events.length} {card.events.length === 1 ? "entry" : "entries"}</span></summary>
      <ul className="divide-y divide-border border-t border-border">
        {card.events.map((e) => (
          <li key={e.id} className={cx("px-4 py-2.5 text-sm", e.undone && "text-muted line-through")}>
            <div className="flex justify-between gap-3">
              <span className="font-medium">{ACTION_DONE[e.action] ?? e.action}{e.tapLine && e.action === "TAPPED" ? ` on tap ${e.tapLine}` : ""}{e.account && (e.action === "OUT" || e.action === "RETURNED") ? ` · ${e.account}` : ""}</span>
              <span className="num shrink-0 text-xs text-muted">{businessDateTime(e.at)}</span>
            </div>
            <div className="text-xs text-muted">{[e.toPlace && e.action !== "TAPPED" ? e.toPlace : null, e.userName, e.note].filter(Boolean).join(" · ")}</div>
          </li>
        ))}
      </ul>
      <div className="border-t border-border px-4 py-2 text-xs text-muted"><Link href="/kegs" className="hover:underline">All kegs</Link></div>
    </details>
  );
}
