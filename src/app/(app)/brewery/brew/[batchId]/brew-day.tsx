"use client";

import { Badge, Button, Card, cx, DatePicker, Field, Input, Select, Textarea } from "@/components/ui";
import {
  cleanFieldValue,
  formatFieldValue,
  hopAdditions,
  hopsDue,
  newBrewLog,
  newerLog,
  pauseTimer,
  readBrewLog,
  resetTimer,
  STAGE_FIELDS,
  stageProgress,
  STAGES,
  startTimer,
  timerRunning,
  timerView,
  type BrewLog,
  type FieldValue,
  type StageField,
  type StageId,
  type TargetKey,
} from "@/domain/brewDay";
import { formatGravity, sgToPlato, type GravityUnit } from "@/domain/gravity";
import { qty, shortDate } from "@/lib/format";
import type { BrewDayData, BrewDayLine } from "@/server/services/brewDay";
import { Check, CloudOff, Pause, Play, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { finishBrewDayAction, packageFromBrewDayAction, saveBrewLogAction } from "../actions";
import { GravityInput } from "../gravity-bits";

type SaveState = "saved" | "waiting" | "saving" | "offline" | "error";

/**
 * The log, kept on this phone first and sent to the server a moment after each
 * change. With no signal it stays queued on the phone (and survives a reload)
 * and is sent when the connection is back.
 */
function useBrewLog(batchId: string, server: BrewLog | null) {
  const key = `ops.brewlog.${batchId}`;
  const [log, setLog] = useState<BrewLog>(() => server ?? newBrewLog(new Date()));
  const [state, setState] = useState<SaveState>("saved");
  const [message, setMessage] = useState<string | null>(null);
  const current = useRef(log);
  const pending = useRef(false);
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoff = useRef(2000);

  const persist = useCallback(
    (l: BrewLog, isPending: boolean) => {
      try {
        localStorage.setItem(key, JSON.stringify({ log: l, pending: isPending }));
      } catch {
        // Private mode or full storage: the server copy is all there is.
      }
    },
    [key],
  );

  const send = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (busy.current || !pending.current) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return setState("offline");
    busy.current = true;
    const sent = current.current;
    setState("saving");
    try {
      const res = await saveBrewLogAction(batchId, sent);
      if (res.error) {
        setState("error");
        setMessage(res.error);
        pending.current = false;
        return;
      }
      backoff.current = 2000;
      if (res.kept === "stored" && res.log) {
        current.current = res.log;
        setLog(res.log);
        setMessage("Another phone saved newer readings, so those are shown.");
        pending.current = false;
      } else if (current.current.savedAt === sent.savedAt) pending.current = false;
      persist(current.current, pending.current);
      setState(pending.current ? "waiting" : "saved");
    } catch {
      // No connection (or the server didn't answer): keep it here and try again.
      setState("offline");
      timer.current = setTimeout(() => void send(), backoff.current);
      backoff.current = Math.min(backoff.current * 2, 60_000);
    } finally {
      busy.current = false;
    }
    if (pending.current && !timer.current) timer.current = setTimeout(() => void send(), 400);
  }, [batchId, persist]);

  const schedule = useCallback(
    (ms: number) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void send(), ms);
    },
    [send],
  );

  // A copy on this phone that never reached the server, and is newer, wins.
  useEffect(() => {
    let local: { log?: unknown; pending?: boolean } | null = null;
    try {
      local = JSON.parse(localStorage.getItem(key) ?? "null");
    } catch {
      local = null;
    }
    const l = local?.pending ? readBrewLog(local.log) : null;
    if (l && newerLog(server, l) === l && l.savedAt !== server?.savedAt) {
      current.current = l;
      setLog(l);
      pending.current = true;
      setState("waiting");
      schedule(0);
    }
    // Only on first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A newer copy from the server (after finishing, or a reload of the page's data) is taken when nothing here is waiting to go.
  useEffect(() => {
    if (!server || pending.current || busy.current) return;
    if (newerLog(current.current, server) === server && server.savedAt !== current.current.savedAt) {
      current.current = server;
      setLog(server);
    }
  }, [server]);

  useEffect(() => {
    const online = () => pending.current && schedule(0);
    const hide = () => document.visibilityState === "hidden" && pending.current && void send();
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", hide);
    return () => {
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", hide);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [schedule, send]);

  const update = useCallback(
    (fn: (draft: BrewLog) => void, delay = 800) => {
      const next = structuredClone(current.current);
      fn(next);
      next.savedAt = new Date().toISOString();
      current.current = next;
      pending.current = true;
      setLog(next);
      persist(next, true);
      setState("waiting");
      setMessage(null);
      schedule(delay);
    },
    [persist, schedule],
  );

  return { log, update, state, message };
}

/** Re-render every second while a timer runs. */
function useNow(running: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  return running ? now : Date.now();
}

export function BrewDay({ data }: { data: BrewDayData }) {
  const { log, update, state, message } = useBrewLog(data.batch.id, data.log);
  const unit = data.unit;
  const r = data.recipe;
  const stage = log.stage;
  const progress = stageProgress(log);
  const anyRunning = STAGES.some((s) => timerRunning(log.timers[s.id]));
  const now = useNow(anyRunning);

  const targets: Record<TargetKey, number | null> = {
    strikeF: r?.strikeF ?? null,
    mashF: r?.mashF ?? null,
    targetMt: r?.targetMt ?? null,
    targetBk: r?.targetBk ?? null,
    targetKo: r?.targetKo ?? null,
    targetOg: r?.targetOg ?? null,
    targetFg: r?.targetFg ?? null,
    batchBbl: data.batch.bbl ?? r?.batchBbl ?? null,
  };
  const timerTarget: Partial<Record<StageId, number | null>> = { mash: r?.mashMinutes ?? 60, lauter: null, boil: r?.boilMinutes ?? 60 };

  const setValue = (s: StageId, f: StageField, v: FieldValue) =>
    update((d) => {
      if (v == null || v === "") delete d.values[s][f.key];
      else d.values[s][f.key] = v;
    });

  return (
    <div className="pb-16">
      <SaveLine state={state} message={message} finished={!!log.finishedAt} brewedOn={data.batch.brewedOn} />

      {/* Stage tabs: thumb-sized, and they stay at the top while scrolling. */}
      <nav aria-label="Stages" className="sticky top-0 z-20 -mx-4 mb-4 bg-bg/95 px-4 py-2 backdrop-blur sm:mx-0 sm:px-0">
        <div className="grid grid-cols-5 gap-1 rounded-xl bg-surface-2 p-1">
          {STAGES.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-current={stage === s.id ? "step" : undefined}
              onClick={() => update((d) => void (d.stage = s.id), 1500)}
              className={cx("relative flex h-12 flex-col items-center justify-center rounded-lg px-1 text-[0.8rem] font-medium leading-tight transition-colors sm:text-sm", stage === s.id ? "bg-surface text-ink shadow-sm" : "text-ink-2 hover:text-ink")}
            >
              <span className="sm:hidden">{s.short}</span>
              <span className="hidden sm:inline">{s.label}</span>
              {progress[s.id] > 0 && <span aria-label={`${progress[s.id]} written down`} className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-good" />}
              {timerRunning(log.timers[s.id]) && <span className="num text-[0.65rem] text-muted">{timerView(log.timers[s.id], now).text}</span>}
            </button>
          ))}
        </div>
      </nav>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-4">
          <Card className="p-4">
            <h2 className="mb-3 text-base font-semibold">{STAGES.find((s) => s.id === stage)!.label}</h2>
            <div className="grid grid-cols-2 gap-x-3 gap-y-4">
              {STAGE_FIELDS[stage].map((f) => (
                <Reading key={`${stage}.${f.key}`} field={f} value={log.values[stage][f.key] ?? null} target={f.target ? targets[f.target] : null} unit={unit} onChange={(v) => setValue(stage, f, v)} />
              ))}
            </div>
            <Field label="Notes" className="mt-4">
              <Textarea value={log.notes[stage]} rows={3} onChange={(e) => update((d) => void (d.notes[stage] = e.target.value.slice(0, 4000)), 1200)} placeholder={stage === "mash" ? "Water, salts, anything off…" : stage === "boil" ? "Boil-overs, additions, anything off…" : "Anything worth remembering"} />
            </Field>
          </Card>

          {stage === "boil" && r && <HopChecklist lines={r.lines} boilMinutes={r.boilMinutes} dryHopDay={r.dryHopDay} log={log} now={now} onTick={(k, on) => update((d) => (on ? (d.hops[k] = new Date().toISOString()) : delete d.hops[k]), 300)} />}
          {stage === "ferment" && <FinishCard data={data} log={log} />}
          {stage === "package" && <PackageCard data={data} />}
        </div>

        <div className="space-y-4">
          {(stage === "mash" || stage === "lauter" || stage === "boil") && (
            <TimerCard
              label={stage === "mash" ? "Mash timer" : stage === "boil" ? "Boil timer" : "Runoff timer"}
              t={log.timers[stage]}
              targetMin={timerTarget[stage] ?? null}
              now={now}
              onStart={() => update((d) => void (d.timers[stage] = startTimer(d.timers[stage], Date.now(), timerTarget[stage] ?? null)), 0)}
              onPause={() => update((d) => void (d.timers[stage] = pauseTimer(d.timers[stage], Date.now())), 0)}
              onReset={() => update((d) => void (d.timers[stage] = resetTimer(d.timers[stage], timerTarget[stage] ?? null)), 0)}
              onTarget={(m) => update((d) => void (d.timers[stage] = { ...(d.timers[stage] ?? resetTimer(undefined, null)), targetMin: m }), 600)}
            />
          )}
          {r && stage === "mash" && <LineList title="Grain bill" lines={r.lines.filter((l) => l.kind === "grain")} />}
          {r && (stage === "lauter" || stage === "boil") && <LineList title="In the kettle" lines={r.lines.filter((l) => l.kind === "adjunct" || l.kind === "water" || l.kind === "other")} />}
          {r && stage === "ferment" && <LineList title="Yeast" lines={r.lines.filter((l) => l.kind === "yeast")} />}
          {r?.notes && (
            <Card className="p-4">
              <h3 className="text-sm font-semibold">Recipe notes</h3>
              <p className="mt-1 text-sm whitespace-pre-line text-ink-2">{r.notes}</p>
            </Card>
          )}
          {!r && <Card className="p-4 text-sm text-muted">No recipe on this brew, so there are no targets. Readings still save.</Card>}
        </div>
      </div>
    </div>
  );
}

function SaveLine({ state, message, finished, brewedOn }: { state: SaveState; message: string | null; finished: boolean; brewedOn: string | null }) {
  const text = state === "saved" ? "Saved" : state === "saving" ? "Saving…" : state === "waiting" ? "Saving…" : state === "offline" ? "No connection: kept on this phone, sent when it's back" : "Couldn't save";
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span role="status" className={cx("inline-flex items-center gap-1.5", state === "offline" ? "text-warn" : state === "error" ? "text-bad" : "text-muted")}>
        {state === "offline" ? <CloudOff className="size-4" /> : state === "saved" ? <Check className="size-4" /> : null}
        {text}
      </span>
      {finished && <Badge tone="good">Brewed{brewedOn ? ` ${shortDate(brewedOn)}` : ""}</Badge>}
      {message && <span className="text-muted">{message}</span>}
    </div>
  );
}

// ---- One reading ------------------------------------------------------------------------------

const UNIT_SUFFIX: Partial<Record<StageField["kind"], string>> = { temp: "°F", bbl: "bbl", minutes: "min", co2: "vols" };

function diffText(f: StageField, v: number, t: number, unit: GravityUnit): { text: string; ok: boolean } {
  if (f.kind === "gravity") {
    if (unit === "plato") {
      const d = sgToPlato(v) - sgToPlato(t);
      return { text: `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(1)} °P`, ok: Math.abs(d) <= 0.5 };
    }
    const d = (v - t) * 1000;
    return { text: `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(1)} pts`, ok: Math.abs(d) <= 2 };
  }
  const d = v - t;
  const tol = f.kind === "temp" ? 2 : f.kind === "bbl" ? 0.25 : 0;
  return { text: `${d >= 0 ? "+" : "−"}${Number(Math.abs(d).toFixed(2))} ${UNIT_SUFFIX[f.kind] ?? ""}`.trim(), ok: Math.abs(d) <= tol };
}

function Reading({ field: f, value, target, unit, onChange }: { field: StageField; value: FieldValue; target: number | null; unit: GravityUnit; onChange: (v: FieldValue) => void }) {
  const targetText = target != null ? formatFieldValue(f.kind, target, unit) : null;
  const diff = typeof value === "number" && target != null ? diffText(f, value, target, unit) : null;
  return (
    <div className="min-w-0">
      <span className="mb-1.5 block text-[0.8rem] font-medium text-ink-2">{f.label}</span>
      {f.kind === "gravity" ? (
        <GravityInput big unit={unit} label={f.label} value={typeof value === "number" ? value : null} onChange={(sg) => onChange(sg)} placeholder={targetText ? formatGravity(target, unit, { label: false }) : undefined} />
      ) : (
        <TextReading field={f} value={value} onChange={onChange} placeholder={target != null ? String(Number(target.toFixed(2))) : f.kind === "time" ? "07:30" : undefined} />
      )}
      <span className="mt-1 block min-h-4 text-xs text-muted">
        {targetText && <>Target {targetText}</>}
        {diff && <span className={cx("ml-1.5 num", diff.ok ? "text-good" : "text-warn")}>{diff.text}</span>}
      </span>
    </div>
  );
}

function TextReading({ field: f, value, onChange, placeholder }: { field: StageField; value: FieldValue; onChange: (v: FieldValue) => void; placeholder?: string }) {
  const shown = (v: FieldValue) => (v == null ? "" : String(v));
  const [text, setText] = useState(shown(value));
  const last = useRef<FieldValue>(value);
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setText(shown(value));
    }
  }, [value]);
  const bad = text.trim() !== "" && cleanFieldValue(f.kind, text) == null;
  const set = (t: string) => {
    setText(t);
    const v = t.trim() === "" ? null : cleanFieldValue(f.kind, t);
    if (t.trim() === "" || v != null) {
      last.current = v;
      onChange(v);
    }
  };
  const nowTime = () => {
    const d = new Date();
    set(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
  };
  return (
    <div className="relative flex gap-1.5">
      <div className="relative min-w-0 flex-1">
        <Input
          inputMode={f.kind === "time" ? "numeric" : "decimal"}
          autoComplete="off"
          aria-label={f.label}
          aria-invalid={bad || undefined}
          value={text}
          placeholder={placeholder}
          onChange={(e) => set(e.target.value)}
          className={cx("num h-12 text-right text-lg sm:h-11 sm:text-base", UNIT_SUFFIX[f.kind] && "pr-11", bad && "border-bad")}
        />
        {UNIT_SUFFIX[f.kind] && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted">{UNIT_SUFFIX[f.kind]}</span>}
      </div>
      {f.kind === "time" && (
        <Button type="button" className="h-12 shrink-0 px-3 sm:h-11" onClick={nowTime}>Now</Button>
      )}
    </div>
  );
}

// ---- Timer ------------------------------------------------------------------------------------

function TimerCard({ label, t, targetMin, now, onStart, onPause, onReset, onTarget }: { label: string; t: BrewLog["timers"][StageId]; targetMin: number | null; now: number; onStart: () => void; onPause: () => void; onReset: () => void; onTarget: (m: number | null) => void }) {
  const running = timerRunning(t);
  const v = timerView(t ?? (targetMin ? { startedAt: null, elapsedMs: 0, targetMin } : undefined), now);
  const target = t ? t.targetMin : targetMin;
  return (
    <Card className={cx("p-4", v.over && "border-warn/60")}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{label}</h3>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          {target ? "Counts down" : "Counts up"}
          <Input
            aria-label={`${label} minutes`}
            inputMode="numeric"
            className="num h-9 w-16 text-right"
            placeholder="min"
            value={target ?? ""}
            onChange={(e) => {
              const n = Number(e.target.value);
              onTarget(e.target.value.trim() === "" ? null : Number.isFinite(n) && n > 0 && n <= 1440 ? Math.round(n) : target ?? null);
            }}
          />
          min
        </label>
      </div>
      <div className={cx("num my-3 text-center text-5xl font-semibold tracking-tight", v.over ? "text-warn" : "text-ink")} aria-live="off">{v.text}</div>
      {v.over && <p className="-mt-2 mb-2 text-center text-xs text-warn">Time&apos;s up</p>}
      <div className="grid grid-cols-[1fr_auto] gap-2">
        {running ? (
          <Button type="button" size="lg" className="h-14 text-base" onClick={onPause}><Pause className="size-5" />Pause</Button>
        ) : (
          <Button type="button" variant="primary" size="lg" className="h-14 text-base" onClick={onStart}><Play className="size-5" />{t && t.elapsedMs > 0 ? "Carry on" : "Start"}</Button>
        )}
        <Button type="button" size="lg" variant="ghost" className="h-14" onClick={onReset} aria-label="Reset timer"><RotateCcw className="size-5" /></Button>
      </div>
      <p className="mt-2 text-xs text-muted">Keeps running if the phone locks or the page reloads.</p>
    </Card>
  );
}

// ---- Hops -------------------------------------------------------------------------------------

function HopChecklist({ lines, boilMinutes, dryHopDay, log, now, onTick }: { lines: BrewDayLine[]; boilMinutes: number; dryHopDay: number | null; log: BrewLog; now: number; onTick: (key: string, on: boolean) => void }) {
  const additions = useMemo(() => hopAdditions(lines, boilMinutes, dryHopDay), [lines, boilMinutes, dryHopDay]);
  const boil = log.timers.boil;
  const boilMin = boil ? timerView(boil, now).elapsedMin : -1;
  const due = new Set(boil && (boil.startedAt != null || boil.elapsedMs > 0) ? hopsDue(additions, log.hops, boilMin).map((h) => h.key) : []);
  if (!additions.length) return null;
  const done = additions.filter((h) => log.hops[h.key]).length;
  return (
    <Card>
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">Hop additions</h3>
        <span className="num text-xs text-muted">{done} of {additions.length} in</span>
      </div>
      <ul className="divide-y divide-border">
        {additions.map((h) => {
          const at = log.hops[h.key];
          return (
            <li key={h.key}>
              <button
                type="button"
                aria-pressed={!!at}
                onClick={() => onTick(h.key, !at)}
                className={cx("flex min-h-16 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors", at ? "bg-surface-2/60" : due.has(h.key) ? "bg-warn-bg" : "hover:bg-surface-2/50")}
              >
                <span className={cx("inline-flex size-8 shrink-0 items-center justify-center rounded-lg border-2", at ? "border-good bg-good text-white" : "border-border-strong")}>{at && <Check className="size-5" strokeWidth={3} />}</span>
                <span className="min-w-0 flex-1">
                  <span className={cx("block font-medium", at && "text-muted line-through decoration-1")}>{h.name}</span>
                  <span className="num block text-sm text-ink-2">{qty(h.qty, 2)} {h.unit} · {h.when}</span>
                </span>
                <span className="shrink-0 text-xs text-muted">{at ? `in ${new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : due.has(h.key) ? <span className="font-medium text-warn">Due now</span> : h.atBoilMinute != null ? `at ${h.atBoilMinute} min` : ""}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="px-4 py-2.5 text-xs text-muted">Amounts are for this brew&apos;s size. With the boil timer running, boil hops turn amber when they&apos;re due.</p>
    </Card>
  );
}

function LineList({ title, lines }: { title: string; lines: BrewDayLine[] }) {
  if (!lines.length) return null;
  return (
    <Card>
      <h3 className="border-b border-border px-4 py-3 text-sm font-semibold">{title}</h3>
      <ul className="divide-y divide-border text-sm">
        {lines.map((l, i) => (
          <li key={i} className="flex items-baseline justify-between gap-3 px-4 py-2">
            <span className="min-w-0">{l.name}</span>
            <span className="num shrink-0 text-ink-2">{l.qty > 0 ? `${qty(l.qty, 2)} ${l.unit}` : "—"}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ---- Finish: into a fermenter -----------------------------------------------------------------

function FinishCard({ data, log }: { data: BrewDayData; log: BrewLog }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const unit = data.unit;
  const boil = log.values.boil;
  const ogFromLog = typeof boil.ogSg === "number" ? boil.ogSg : typeof boil.koSg === "number" ? boil.koSg : null;
  const bblFromLog = typeof boil.postboilBbl === "number" ? boil.postboilBbl : null;
  const [tankId, setTank] = useState(data.finish.tankId ?? "");
  const [brewedOn, setOn] = useState(data.today);
  const [bbl, setBbl] = useState<string>(String(bblFromLog ?? data.finish.bbl ?? ""));
  const [og, setOg] = useState<number | null>(ogFromLog ?? data.finish.og);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (data.batch.status !== "PLANNED") {
    const current = data.batch.tanks.filter((t) => !t.planned);
    return (
      <Card className="p-4">
        <h3 className="text-sm font-semibold">Brewed</h3>
        <p className="mt-1 text-sm text-ink-2">
          {data.batch.brewedOn ? `On ${shortDate(data.batch.brewedOn)}` : "Brewed"}
          {current.length ? `, into ${current.map((t) => t.name).join(" → ")}` : ""}
          {data.batch.og ? `, OG ${formatGravity(data.batch.og, unit)}` : ""}.
        </p>
        <p className="mt-2 text-sm text-muted">Transfers, gravity readings and packaging are on <Link href="/brewery" className="underline underline-offset-2">the tanks page</Link> and <Link href={`/brewery/batches/${data.batch.id}`} className="underline underline-offset-2">the brew&apos;s page</Link>.</p>
      </Card>
    );
  }

  const finish = () =>
    start(async () => {
      setError(null);
      const n = bbl.trim() === "" ? null : Number(bbl);
      if (n != null && !(Number.isFinite(n) && n > 0)) return setError("How many barrels went into the fermenter?");
      const res = await finishBrewDayAction(data.batch.id, { tankId: tankId || null, brewedOn, bbl: n, og });
      if (res.error) return setError(res.error);
      setDone(res.ok ?? "Brewed.");
      router.refresh();
    });

  return (
    <Card className="space-y-4 p-4">
      <div>
        <h3 className="text-base font-semibold">Finish brew day</h3>
        <p className="text-sm text-muted">Into a fermenter. The brew moves to fermenting, its cost is worked out from today&apos;s prices, and what it used comes out of brewing stock.</p>
      </div>
      <Field label="Fermenter">
        <Select
          value={tankId}
          onChange={(e) => setTank(e.target.value)}
          placeholder="Pick the fermenter"
          options={data.fermenters.map((t) => ({ value: t.id, label: t.name, hint: t.busyWith ? `has ${t.busyWith}` : `${t.capacityBbl} bbl, empty`, disabled: !!t.busyWith }))}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Brew day"><DatePicker value={brewedOn} onChange={(e) => setOn(e.target.value)} max={data.today} today={data.today} /></Field>
        <Field label="Into the fermenter, bbl"><Input inputMode="decimal" className="num h-12 text-right text-lg sm:h-11" value={bbl} onChange={(e) => setBbl(e.target.value)} /></Field>
      </div>
      <Field label="OG" hint={ogFromLog != null ? "From the boil readings." : "Type it here, or in the boil readings."}>
        <GravityInput big unit={unit} label="OG" value={og} onChange={setOg} />
      </Field>
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      {done && <p role="status" className="text-sm text-good">{done}</p>}
      <Button type="button" variant="primary" size="lg" className="h-14 w-full text-base" disabled={pending || !tankId} onClick={finish}>
        {pending ? "Finishing…" : "Finish brew day → into the fermenter"}
      </Button>
    </Card>
  );
}

// ---- Packaging ----------------------------------------------------------------------------------

function PackageCard({ data }: { data: BrewDayData }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [on, setOn] = useState(data.today);
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const inTank = data.batch.status === "FERMENTING" || data.batch.status === "CONDITIONING";
  let body: ReactNode;
  if (data.batch.status === "PLANNED") body = <p className="text-sm text-muted">Write down what packaging made once the beer is packaged. Finish the brew day first (on Fermentation).</p>;
  else if (data.batch.status === "PACKAGED") body = <p className="text-sm text-muted">Packaged. Keg and case counts above are saved on the brew.</p>;
  else if (inTank)
    body = (
      <div className="space-y-3">
        <p className="text-sm text-muted">The counts above save on the brew as you type. When it&apos;s all in kegs, mark it packaged: the tank is freed and a keg batch with this brew&apos;s code is made.</p>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
          <Field label="Packaged on"><DatePicker value={on} onChange={(e) => setOn(e.target.value)} max={data.today} today={data.today} /></Field>
          <Button
            type="button"
            variant="primary"
            className="h-10 sm:h-9"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await packageFromBrewDayAction(data.batch.id, on);
                setMsg(res);
                if (res.ok) router.refresh();
              })
            }
          >
            Mark packaged
          </Button>
        </div>
      </div>
    );
  return (
    <Card className="p-4">
      <h3 className="mb-2 text-sm font-semibold">Packaging</h3>
      {body}
      {msg?.error && <p role="alert" className="mt-2 text-sm text-bad">{msg.error}</p>}
      {msg?.ok && <p role="status" className="mt-2 text-sm text-good">{msg.ok}</p>}
    </Card>
  );
}
