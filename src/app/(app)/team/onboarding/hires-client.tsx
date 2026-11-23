"use client";

import { HelpTip, HelpZone } from "@/components/help";
import { useConfirm } from "@/components/dialog";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, cx, DatePicker, Input, Section, Select } from "@/components/ui";
import { KIND_LABEL, PROVIDERS, type HireState, type OnboardingKind, type PayrollProvider, type Progress } from "@/domain/onboarding";
import { shortDate } from "@/lib/format";
import { Check, ChevronDown, Copy, KeyRound, Plus, UserPlus } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { inviteEmployee } from "../actions";
import { addNewHire, savePayrollProviderAction, setHireItem, setHireStatus, startChecklist } from "../workforce-actions";

interface Item {
  id: string;
  kind: OnboardingKind;
  title: string;
  detail: string | null;
  required: boolean;
  done: boolean;
  doneBy: string | null;
  href: string | null;
}

export interface Hire {
  id: string;
  employeeId: string;
  name: string;
  hasLogin: boolean;
  positions: string[];
  template: string | null;
  startDate: string;
  dueOn: string | null;
  source: string;
  seenAt: string | null;
  completedAt: string | null;
  emergency: { name: string | null; phone: string | null; relation: string | null };
  items: Item[];
  progress: Progress;
  state: HireState | "done";
}

type Res = { error?: string; ok?: string } | void;
const STATE: Record<Hire["state"], { label: string; tone: "good" | "warn" | "bad" | "neutral" }> = {
  done: { label: "Done", tone: "good" },
  overdue: { label: "Behind", tone: "bad" },
  "on-track": { label: "Going", tone: "neutral" },
  "not-started": { label: "Not started", tone: "warn" },
};

export function HiresBoard({ today, active, done, suggest, positions, templates, provider }: { today: string; active: Hire[]; done: Hire[]; suggest: { id: string; name: string; fromSquare: boolean; added: string }[]; positions: { id: string; name: string }[]; templates: { id: string; name: string }[]; provider: PayrollProvider }) {
  const [pending, start] = useTransition();
  const [toast, show] = useToast();
  const [adding, setAdding] = useState(false);
  const run = (fn: () => Promise<Res>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (r && "error" in r && r.error) show(r.error, "bad");
      else {
        if (r && "ok" in r && r.ok) show(r.ok);
        after?.();
      }
    });

  return (
    <>
      {toast}
      <Section
        help="team.onboarding.hires"
        title={<span className="inline-flex items-center gap-1.5">New hires <HelpTip id="team.onboarding.hires" /></span>}
        actions={<Button variant="primary" size="sm" className="max-sm:h-10" onClick={() => setAdding(!adding)}><UserPlus className="size-4" aria-hidden /> Add a new hire</Button>}
      >
        {adding && <AddHire positions={positions} templates={templates} today={today} pending={pending} onDone={() => setAdding(false)} run={run} />}

        {suggest.length > 0 && (
          <HelpZone id="team.onboarding.suggest" className="mb-4">
            <Card className="border-warn/40 bg-warn-bg/40 px-4 py-3">
              <div className="text-sm font-medium text-warn">New on the team, no checklist yet</div>
              <ul className="mt-2 divide-y divide-warn/15">
                {suggest.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="min-w-0"><span className="font-medium">{s.name}</span> <span className="text-muted">· added {shortDate(s.added)}{s.fromSquare ? " from Square" : ""}</span></span>
                    <Button size="sm" className="shrink-0 max-sm:h-10" disabled={pending} onClick={() => run(() => startChecklist(s.id, { fromSquare: s.fromSquare }))}>Start checklist</Button>
                  </li>
                ))}
              </ul>
            </Card>
          </HelpZone>
        )}

        {active.length === 0 ? (
          <Card className="px-4 py-6 text-center text-sm text-muted">Nobody onboarding right now. Add a new hire and they&apos;ll see their checklist the first time they log in.</Card>
        ) : (
          <div className="flex flex-col gap-3">
            {active.map((h) => <HireCard key={h.id} h={h} pending={pending} run={run} />)}
          </div>
        )}

        {done.length > 0 && (
          <div className="mt-4">
            <h3 className="mb-2 text-sm font-medium text-muted">Finished recently</h3>
            <Card className="divide-y divide-border">
              {done.map((h) => (
                <div key={h.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <span className="min-w-0 truncate"><span className="font-medium">{h.name}</span> <span className="text-muted">· started {shortDate(h.startDate)}{h.completedAt ? ` · done ${new Date(h.completedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}</span></span>
                  <Badge tone="good">Done</Badge>
                </div>
              ))}
            </Card>
          </div>
        )}
      </Section>

      <ProviderCard provider={provider} pending={pending} run={run} />
    </>
  );
}

/** The new login, shown once, big enough to read out, with a copy button. */
function PinReveal({ name, pin, onDone }: { name: string; pin: string; onDone?: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`Login: ${name}\nPIN: ${pin}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* the browser won't copy here: they can read it off the screen */
    }
  };
  return (
    <div className="rounded-xl border border-good/30 bg-good-bg/50 px-4 py-3" role="status">
      <div className="text-xs font-medium text-good">Login made. It&apos;s shown once: give it to them now.</div>
      <div className="mt-2 flex flex-wrap items-end gap-x-6 gap-y-2">
        <div>
          <div className="text-xs text-muted">Login</div>
          <div className="text-base font-medium">{name}</div>
        </div>
        <div>
          <div className="text-xs text-muted">PIN</div>
          <div className="num text-2xl font-semibold tracking-[0.2em]">{pin}</div>
        </div>
        <div className="ml-auto flex gap-2">
          <Button size="sm" className="max-sm:h-10" onClick={copy}>{copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />} {copied ? "Copied" : "Copy"}</Button>
          {onDone && <Button size="sm" variant="primary" className="max-sm:h-10" onClick={onDone}>Done</Button>}
        </div>
      </div>
    </div>
  );
}

function HireCard({ h, pending, run }: { h: Hire; pending: boolean; run: (fn: () => Promise<Res>, after?: () => void) => void }) {
  const confirm = useConfirm();
  const [open, setOpen] = useState(h.state === "overdue");
  const [login, setLogin] = useState<{ name: string; pin: string } | null>(null);
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  const pct = Math.round(h.progress.pct * 100);
  const st = STATE[h.state];
  const isDone = (i: Item) => ticks[i.id] ?? i.done;
  return (
    <Card className="overflow-hidden">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[0.95rem] font-medium">{h.name}</span>
            <Badge tone={st.tone}>{st.label}</Badge>
            {!h.seenAt && <Badge>{h.hasLogin ? "Hasn't opened it" : "No login yet"}</Badge>}
          </span>
          <span className="mt-0.5 block text-xs text-muted">{h.positions.join(", ") || "No position"} · started {shortDate(h.startDate)}{h.dueOn ? ` · due ${shortDate(h.dueOn)}` : ""}{h.source === "SQUARE" ? " · from Square" : ""}</span>
          <span className="mt-2 flex items-center gap-2">
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2"><span className={cx("block h-full rounded-full", h.state === "overdue" ? "bg-bad" : "bg-good")} style={{ width: `${pct}%` }} /></span>
            <span className="num shrink-0 text-xs text-muted">{h.progress.requiredDone}/{h.progress.requiredTotal}</span>
          </span>
        </span>
        <ChevronDown className={cx("size-4 shrink-0 text-muted transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div className="border-t border-border">
          <ul className="divide-y divide-border">
            {h.items.map((i) => {
              const d = isDone(i);
              const manual = i.kind === "TASK" || i.kind === "PAYROLL";
              return (
                <li key={i.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  {manual ? (
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={d}
                      aria-label={i.title}
                      disabled={pending}
                      onClick={() => {
                        setTicks((t) => ({ ...t, [i.id]: !d }));
                        run(() => setHireItem(i.id, !d));
                      }}
                      className={cx("grid size-7 shrink-0 place-items-center rounded-full border", d ? "border-good bg-good text-white" : "border-border-strong text-transparent")}
                    >
                      <Check className="size-4" strokeWidth={2.5} aria-hidden />
                    </button>
                  ) : (
                    <span className={cx("grid size-7 shrink-0 place-items-center rounded-full border", d ? "border-good bg-good text-white" : "border-dashed border-border-strong text-transparent")} aria-hidden><Check className="size-4" strokeWidth={2.5} /></span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className={cx("block", d && "text-muted")}>{i.title}{!i.required && <span className="text-muted"> · optional</span>}</span>
                    <span className="block text-xs text-muted">{KIND_LABEL[i.kind]}{d && i.doneBy ? ` · ticked by ${i.doneBy}` : !manual ? " · ticks itself when it's done" : ""}{i.kind === "EMERGENCY" && h.emergency.name ? ` · ${h.emergency.name}${h.emergency.relation ? ` (${h.emergency.relation})` : ""} ${h.emergency.phone ?? ""}` : ""}</span>
                  </span>
                  {i.href && !d && <Link href={i.href} className="shrink-0 text-xs font-medium text-ink-2 underline underline-offset-2">Open</Link>}
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface-2/40 px-4 py-2.5">
            {!h.hasLogin && !login ? (
              <Button size="sm" className="max-sm:h-10" disabled={pending} onClick={() => run(async () => { const r = await inviteEmployee(h.employeeId, h.name); if (r.pin && r.name) setLogin({ name: r.name, pin: r.pin }); return r.error ? { error: r.error } : { ok: "Login made." }; })}>
                <KeyRound className="size-3.5" aria-hidden /> Make a login
              </Button>
            ) : login ? (
              <div className="w-full"><PinReveal name={login.name} pin={login.pin} /></div>
            ) : <span />}
            <span className="flex gap-1.5">
              <Button size="sm" variant="ghost" className="max-sm:h-10" disabled={pending} onClick={() => run(() => setHireStatus(h.id, "DONE"))}>Mark done</Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-bad max-sm:h-10"
                disabled={pending}
                onClick={async () => {
                  if (!(await confirm({ title: `Remove ${h.name}'s checklist?`, body: "They stay on the team. Their onboarding checklist and its progress go.", confirmLabel: "Remove", danger: true }))) return;
                  run(() => setHireStatus(h.id, "CANCELLED"));
                }}
              >
                Remove
              </Button>
            </span>
          </div>
        </div>
      )}
    </Card>
  );
}

function AddHire({ positions, templates, today, pending, onDone, run }: { positions: { id: string; name: string }[]; templates: { id: string; name: string }[]; today: string; pending: boolean; onDone: () => void; run: (fn: () => Promise<Res>, after?: () => void) => void }) {
  const [f, setF] = useState({ name: "", email: "", phone: "", positionIds: [] as string[], startDate: today, templateId: "", hourlyRate: "" });
  const [makeLogin, setMakeLogin] = useState(true);
  const [loginName, setLoginName] = useState("");
  const [login, setLogin] = useState<{ name: string; pin: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, start] = useTransition();
  const busy = pending || saving;
  const add = () =>
    start(async () => {
      setError(null);
      const r = await addNewHire(f);
      if (r.error || !r.id) return setError(r.error ?? "That didn't save. Try again.");
      if (!makeLogin) return run(async () => ({ ok: r.ok }), onDone);
      const l = await inviteEmployee(r.id, (loginName || f.name).trim());
      if (l.error || !l.pin || !l.name) {
        run(async () => ({ ok: `${f.name.trim()} added. The login wasn't made (${l.error ?? "try again"}): use Make a login on their card.` }), onDone);
        return;
      }
      setLogin({ name: l.name, pin: l.pin });
    });
  if (login) {
    return (
      <div className="mb-4 animate-rise-in motion-reduce:animate-none">
        <PinReveal name={login.name} pin={login.pin} onDone={onDone} />
      </div>
    );
  }
  return (
    <Card className="mb-4 animate-rise-in p-4 motion-reduce:animate-none">
      <div className="grid gap-3 sm:grid-cols-2">
        <Input aria-label="Name" placeholder="Full name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className="max-sm:h-12" />
        <DatePicker aria-label="Start date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} className="max-sm:h-12" />
        <Input aria-label="Email" placeholder="Email (for notifications)" inputMode="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} className="max-sm:h-12" />
        <Input aria-label="Phone" placeholder="Phone (optional)" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} className="max-sm:h-12" />
        <div className="relative">
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted">$</span>
          <Input aria-label="Pay rate per hour" placeholder="Pay rate / hour (optional)" inputMode="decimal" value={f.hourlyRate} onChange={(e) => setF({ ...f, hourlyRate: e.target.value })} className="num pl-6 max-sm:h-12" />
        </div>
      </div>
      <div className="mt-3">
        <div className="mb-1.5 text-[0.8rem] font-medium text-ink-2">Positions</div>
        <div className="flex flex-wrap gap-1.5">
          {positions.map((p) => {
            const on = f.positionIds.includes(p.id);
            return (
              <button key={p.id} type="button" role="checkbox" aria-checked={on} onClick={() => setF({ ...f, positionIds: on ? f.positionIds.filter((x) => x !== p.id) : [...f.positionIds, p.id] })} className={cx("min-h-10 rounded-full border px-3 text-sm transition-colors duration-120", on ? "border-ink bg-ink text-surface" : "border-border text-ink-2")}>
                {p.name}
              </button>
            );
          })}
        </div>
      </div>
      {templates.length > 1 && (
        <div className="mt-3 max-w-xs"><Select aria-label="Checklist" value={f.templateId} onChange={(e) => setF({ ...f, templateId: e.target.value })} options={[{ value: "", label: "Best match for their position" }, ...templates.map((t) => ({ value: t.id, label: t.name }))]} className="max-sm:h-12" /></div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" role="switch" aria-checked={makeLogin} onClick={() => setMakeLogin((v) => !v)} className="flex min-h-10 items-center gap-2.5 text-sm">
          <span className={cx("relative h-6 w-10 shrink-0 rounded-full transition-colors duration-120", makeLogin ? "bg-good" : "bg-border-strong")}><span className={cx("absolute top-0.5 size-5 rounded-full bg-white shadow transition-[left] duration-120", makeLogin ? "left-[1.1rem]" : "left-0.5")} /></span>
          <span><span className="font-medium text-ink">Make a login now</span><span className="block text-xs text-muted">A staff login with a PIN, shown once, so they can open their checklist.</span></span>
        </button>
        {makeLogin && <Input aria-label="Login name" placeholder={f.name.trim() ? `Login name: ${f.name.trim()}` : "Login name (their name)"} value={loginName} onChange={(e) => setLoginName(e.target.value)} autoComplete="off" className="max-sm:h-12 sm:w-56" />}
      </div>
      <p className="mt-3 text-xs text-muted">Don&apos;t put SSNs, bank details or tax IDs here. Those go straight into your payroll provider.</p>
      {error && <p role="alert" className="mt-2 text-sm text-bad">{error}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" className="max-sm:h-11" onClick={onDone}>Cancel</Button>
        <Button variant="primary" className="max-sm:h-12" pending={saving} disabled={busy || !f.name.trim()} onClick={add}><Plus className="size-4" aria-hidden /> Add and start checklist</Button>
      </div>
    </Card>
  );
}

const PROVIDER_OPTIONS = [
  { value: "SQUARE_PAYROLL", label: "Square Payroll" },
  { value: "GUSTO", label: "Gusto" },
  { value: "OTHER", label: "Something else" },
];

function ProviderCard({ provider, pending, run }: { provider: PayrollProvider; pending: boolean; run: (fn: () => Promise<Res>, after?: () => void) => void }) {
  const [id, setId] = useState<string>(provider.id);
  const [name, setName] = useState(provider.id === "OTHER" ? provider.name : "");
  const [url, setUrl] = useState(provider.url);
  return (
    <Section help="team.onboarding.provider" title="Payroll provider" description="Where new hires fill in their W-4, I-9 and direct deposit; the checklist links there. Also names the payroll file on Payroll hand-off.">
      <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
        <div className="sm:w-56"><Select aria-label="Payroll provider" value={id} onChange={(e) => { setId(e.target.value); setUrl(PROVIDERS[e.target.value as PayrollProvider["id"]]?.url ?? ""); }} options={PROVIDER_OPTIONS} className="max-sm:h-12" /></div>
        {id === "OTHER" && <Input aria-label="Provider name" placeholder="Name (ADP, Paychex…)" value={name} onChange={(e) => setName(e.target.value)} className="max-sm:h-12 sm:w-48" />}
        <Input aria-label="Link for staff" placeholder="https:// link for staff" value={url} onChange={(e) => setUrl(e.target.value)} className="max-sm:h-12 sm:flex-1" />
        <Button variant="primary" className="max-sm:h-12" disabled={pending} onClick={() => run(() => savePayrollProviderAction(id, name, url))}>Save</Button>
      </Card>
    </Section>
  );
}
