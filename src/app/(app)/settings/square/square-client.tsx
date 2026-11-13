"use client";

import { useConfirm } from "@/components/dialog";
import { Button, Card, cx, Field, Input, LinkButton } from "@/components/ui";
import { addDays } from "@/domain/dates";
import { shortDate } from "@/lib/format";
import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { ReactNode, useRef, useState, useTransition } from "react";
import type { BackfillState } from "@/server/services/square-sync";
import { clearLog, disconnect, importStep, pasteToken, resetImport, saveLocations, startImport, testConnection } from "./actions";

type Msg = { error?: string; message?: string } | null;

function Note({ msg }: { msg: Msg }) {
  if (!msg || (!msg.error && !msg.message)) return null;
  return <p role="status" className={cx("text-sm", msg.error ? "text-bad" : "text-good")}>{msg.error ?? msg.message}</p>;
}

/** Two-or-more option toggle built from buttons (no native select). */
export function Chips<T extends string | number>({ value, options, onChange, ariaLabel, disabled }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; ariaLabel: string; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={cx(
            "h-10 rounded-lg border px-3.5 text-sm font-medium transition-colors disabled:opacity-50 sm:h-9",
            o.value === value ? "border-ink bg-ink text-surface" : "border-border-strong bg-surface text-ink-2 hover:bg-surface-2 hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---- Connection -----------------------------------------------------------------------

export function ConnectionActions({ connected, source, oauthAvailable }: { connected: boolean; source: "oauth" | "token" | "env" | null; oauthAvailable: boolean }) {
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, setPending] = useState(false);
  const start = async (fn: () => Promise<void>) => {
    setPending(true);
    try {
      await fn();
    } finally {
      setPending(false);
    }
  };
  const [showToken, setShowToken] = useState(false);
  const confirm = useConfirm();
  const router = useRouter();

  if (connected) {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button disabled={pending} onClick={() => start(async () => setMsg(await testConnection()))}>{pending ? "Checking…" : "Test connection"}</Button>
          {source !== "env" && oauthAvailable && <a href="/api/square/oauth/start" className="inline-flex h-9 items-center rounded-lg px-3.5 text-sm font-medium text-ink-2 hover:bg-surface-2 hover:text-ink">Reconnect</a>}
          {source !== "env" && (
            <Button
              variant="danger"
              disabled={pending}
              onClick={async () => {
                const ok = await confirm({
                  title: "Disconnect Square?",
                  body: "Syncing stops until you connect again. Sales, timecards and item links already imported stay.",
                  confirmLabel: "Disconnect",
                  danger: true,
                });
                if (ok) start(async () => { setMsg(await disconnect()); router.refresh(); });
              }}
            >
              Disconnect
            </Button>
          )}
        </div>
        <Note msg={msg} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {oauthAvailable ? (
          <a href="/api/square/oauth/start" className="inline-flex h-11 items-center justify-center rounded-lg bg-primary px-5 text-[0.95rem] font-medium text-primary-ink hover:opacity-90">Connect with Square</a>
        ) : (
          <Button variant="primary" size="lg" disabled title="Needs SQUARE_APPLICATION_ID and SQUARE_APPLICATION_SECRET">Connect with Square</Button>
        )}
        <Button variant="ghost" size="lg" onClick={() => setShowToken((v) => !v)} aria-expanded={showToken}>
          {showToken ? "Hide" : "Paste an access token instead"}
        </Button>
      </div>
      {!oauthAvailable && (
        <p className="text-sm text-muted">
          One-click connect needs the Square app&apos;s ID and secret set where Subversive Ops is hosted (see Help → Connecting Square). Until then, paste an access token.
        </p>
      )}
      {showToken && <TokenForm onDone={() => router.refresh()} />}
    </div>
  );
}

function TokenForm({ onDone }: { onDone: () => void }) {
  const [token, setToken] = useState("");
  const [environment, setEnvironment] = useState<"production" | "sandbox">("production");
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, setPending] = useState(false);
  const start = async (fn: () => Promise<void>) => {
    setPending(true);
    try {
      await fn();
    } finally {
      setPending(false);
    }
  };
  return (
    <Card className="space-y-4 bg-surface-2/40 p-4">
      <p className="text-sm text-ink-2">
        In the <b>Square Developer Dashboard</b>, open your app → <b>Credentials</b>, switch to <b>Production</b> and copy the <b>Access token</b>. We check it with Square before saving, and store it encrypted.
      </p>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await pasteToken({ token, environment });
            setMsg(r);
            if (!r.error) {
              setToken("");
              onDone();
            }
          });
        }}
      >
        <Field label="Access token">
          <Input type="password" autoComplete="off" spellCheck={false} value={token} onChange={(e) => setToken(e.target.value)} placeholder="EAAA…" className="font-mono" />
        </Field>
        <div>
          <div className="mb-1.5 text-[0.8rem] font-medium text-ink-2">Environment</div>
          <Chips value={environment} onChange={setEnvironment} ariaLabel="Square environment" options={[{ value: "production", label: "Production" }, { value: "sandbox", label: "Sandbox (testing)" }]} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" disabled={pending || !token.trim()}>{pending ? "Checking with Square…" : "Check and save"}</Button>
          <Note msg={msg} />
        </div>
      </form>
    </Card>
  );
}

// ---- Locations ---------------------------------------------------------------------------

export function LocationPicker({ locations, editable }: { locations: { id: string; name: string; active: boolean; selected: boolean }[]; editable: boolean }) {
  const [selected, setSelected] = useState(() => new Set(locations.filter((l) => l.selected).map((l) => l.id)));
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    if (!next.size) {
      setMsg({ error: "Keep at least one location." });
      return;
    }
    const prev = selected;
    setSelected(next);
    start(async () => {
      const r = await saveLocations([...next]);
      if (r.error) setSelected(prev);
      setMsg(r.error ? r : { message: "Saved." });
    });
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {locations.map((l) => {
          const on = selected.has(l.id);
          return (
            <button
              key={l.id}
              type="button"
              role="checkbox"
              aria-checked={on}
              disabled={!editable || pending}
              onClick={() => toggle(l.id)}
              className={cx(
                "inline-flex h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm transition-colors disabled:cursor-default sm:h-9",
                on ? "border-ink bg-ink text-surface" : "border-border-strong bg-surface text-ink-2 hover:bg-surface-2",
                !editable && "opacity-80",
              )}
            >
              {on && <Check className="size-3.5" strokeWidth={2.5} />}
              {l.name}
              {!l.active && <span className={on ? "text-surface/70" : "text-muted"}>· inactive</span>}
            </button>
          );
        })}
      </div>
      <Note msg={msg} />
    </div>
  );
}

// ---- First import --------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function BackfillPanel({ initial, connected }: { initial: BackfillState | null; connected: boolean }) {
  const [state, setState] = useState<BackfillState | null>(initial);
  const [months, setMonths] = useState<3 | 6 | 12>((initial?.months as 3 | 6 | 12) ?? 6);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(initial?.lastError ?? null);
  const stop = useRef(false);
  const confirm = useConfirm();
  const router = useRouter();

  const run = async (fresh: boolean) => {
    setError(null);
    setRunning(true);
    stop.current = false;
    try {
      if (fresh) {
        const r = await startImport(months);
        if (r.error || !r.state) return setError(r.error ?? "Couldn't start the import.");
        setState(r.state);
      }
      let busyTries = 0;
      while (!stop.current) {
        const r = await importStep();
        if (r.busy) {
          if (++busyTries > 20) return setError("Another Square sync is running. Try again in a minute.");
          await sleep(3000);
          continue;
        }
        busyTries = 0;
        if (r.state) setState(r.state);
        if (r.error) return setError(r.error);
        if (!r.state || r.state.phase === "done") break;
      }
      router.refresh();
    } catch {
      setError("Lost contact with the server. Press Resume to carry on from where it stopped.");
    } finally {
      setRunning(false);
    }
  };

  if (!connected) {
    return (
      <Card className="p-5 text-sm text-muted">
        Connect Square above first. Then import 3, 6 or 12 months of sales and timecards here — it runs a week at a time and you can leave and resume.
      </Card>
    );
  }

  const done = state?.phase === "done";
  const steps = state ? state.totalChunks + 1 : 1;
  const completed = state ? (state.phase === "catalog" ? 0 : 1) + state.nextIndex : 0;
  const pctDone = done ? 1 : Math.min(1, completed / steps);
  const unfinished = state && !done;

  return (
    <Card className="space-y-5 p-5">
      {!running && !unfinished && (
        <div className="space-y-3">
          <div className="text-sm text-ink-2">{done ? "Import finished. Run it again any time — days already imported are simply replaced." : "How far back should we go? More history makes the forecast better."}</div>
          <div className="flex flex-wrap items-center gap-3">
            <Chips value={months} onChange={setMonths} ariaLabel="Months of history" options={[{ value: 3, label: "3 months" }, { value: 6, label: "6 months" }, { value: 12, label: "12 months" }]} />
            <Button variant={done ? "secondary" : "primary"} onClick={() => run(true)}>{done ? "Import again" : "Start import"}</Button>
          </div>
        </div>
      )}

      {state && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span className="font-medium text-ink">
              {done
                ? `Imported ${shortDate(state.from)} – today`
                : running
                  ? state.phase === "catalog"
                    ? "Reading the Square menu and team…"
                    : state.current
                      ? `Importing ${shortDate(state.current.from)} – ${shortDate(addDays(state.current.toExclusive, -1))}`
                      : "Importing…"
                  : `Paused · ${state.months} months from ${shortDate(state.from)}`}
            </span>
            <span className="num text-muted">{Math.round(pctDone * 100)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pctDone * 100)} aria-label="Import progress">
            <div className={cx("h-full rounded-full transition-[width] duration-500", done ? "bg-good" : "bg-ink")} style={{ width: `${Math.max(2, pctDone * 100)}%` }} />
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Total label="Weeks" value={`${state.nextIndex} of ${state.totalChunks}`} />
            <Total label="Orders" value={state.totals.orders.toLocaleString("en-US")} />
            <Total label="Timecards" value={state.totals.timecards.toLocaleString("en-US")} />
            <Total label="Menu items" value={state.totals.catalog.toLocaleString("en-US")} />
          </dl>
        </div>
      )}

      {error && <p role="alert" className="text-sm text-bad">{error}</p>}

      {(running || unfinished) && (
        <div className="flex flex-wrap gap-2">
          {running ? (
            <Button onClick={() => { stop.current = true; }}>Pause</Button>
          ) : (
            <>
              <Button variant="primary" onClick={() => run(false)}>Resume</Button>
              <Button
                variant="ghost"
                onClick={async () => {
                  if (await confirm({ title: "Start over?", body: "Progress is forgotten; data already imported stays and is replaced as the new import reaches it.", confirmLabel: "Start over" })) {
                    await resetImport();
                    setState(null);
                    setError(null);
                  }
                }}
              >
                Start over
              </Button>
            </>
          )}
          {running && <span className="self-center text-sm text-muted">You can leave this page; press Resume when you come back.</span>}
        </div>
      )}

      {done && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4 text-sm">
          <span className="text-ink-2">Next: tell us which recipe each Square item is.</span>
          <LinkButton href="/sales/square-menu" size="sm">Menu from Square →</LinkButton>
        </div>
      )}
    </Card>
  );
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="num font-medium text-ink">{value}</dd>
    </div>
  );
}

export function ClearLogButton() {
  const [pending, start] = useTransition();
  return <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => { await clearLog(); })}>Clear</Button>;
}
