"use client";

import { Badge, Button, Card, cx, Field, Input, LinkButton, Select } from "@/components/ui";
import { useTour } from "@/components/tour";
import { Check, ClipboardList, Copy, FileSpreadsheet, Plug, Receipt, Scale, ShoppingCart, Smartphone } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { addSupplier, addTeamMember, loadDemo, moveStep, saveBasics, setSupplierDays } from "./actions";

const STEPS = [
  { id: "welcome", label: "Welcome" },
  { id: "basics", label: "Business basics" },
  { id: "suppliers", label: "Suppliers" },
  { id: "data", label: "Your data" },
  { id: "square", label: "Square" },
  { id: "team", label: "Team logins" },
  { id: "phone", label: "First count" },
  { id: "done", label: "Done" },
] as const;
type StepId = (typeof STEPS)[number]["id"];
type Status = "done" | "skipped" | "todo";

const DAYS_SHORT = ["S", "M", "T", "W", "T", "F", "S"];
const DAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

interface Props {
  initialStep: StepId;
  status: Record<string, Status>;
  me: string;
  profile: { name: string; timezone: string };
  hours: Record<string, [number, number]>;
  targetPct: number;
  suppliers: { id: string; name: string; kind: "DISTRIBUTOR" | "LOCAL"; deliveryDays: number[] }[];
  users: { id: string; name: string; role: "MANAGER" | "STAFF"; me: boolean }[];
  data: { ingredients: number; recipes: number };
  square: boolean;
  counts: number;
}

export function Wizard(props: Props) {
  const router = useRouter();
  const tour = useTour();
  const [step, setStep] = useState<StepId>(props.initialStep);
  const [status, setStatus] = useState<Record<string, Status>>(props.status);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const index = STEPS.findIndex((s) => s.id === step);

  // Keep the URL in step so a reload (or coming back from /import) lands here.
  useEffect(() => {
    router.replace(`/welcome?step=${step}`, { scroll: false });
    window.scrollTo({ top: 0 });
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const go = (to: StepId, how: "done" | "skipped" | "visit") =>
    start(async () => {
      const res = await moveStep(step, how, to);
      if (res.error) return setError(res.error);
      if (how !== "visit") setStatus((s) => ({ ...s, [step]: how === "done" ? "done" : s[step] === "done" ? "done" : "skipped" }));
      setStep(to);
    });
  const next = STEPS[index + 1]?.id ?? "done";
  const prev = STEPS[index - 1]?.id;
  const run = (fn: () => Promise<{ error?: string } | void>, then?: () => void) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (res && res.error) return setError(res.error);
      then?.();
    });

  // Per-step "Continue": what it saves and whether it counts as done.
  const basicsRef = useRef<BasicsValue | null>(null);
  const hasData = props.data.ingredients + props.data.recipes > 0;
  const continueStep = () => {
    if (step === "basics" && basicsRef.current) {
      const v = basicsRef.current;
      return run(() => saveBasics(v), () => { setStatus((s) => ({ ...s, basics: "done" })); setStep("suppliers"); });
    }
    const done =
      step === "suppliers" ? props.suppliers.length > 0 :
      step === "data" ? hasData :
      step === "square" ? props.square :
      step === "phone" ? true :
      true;
    go(next, done ? "done" : "skipped");
  };

  const finish = (withTour: boolean) =>
    start(async () => {
      await moveStep("done", "done", "done");
      if (withTour) tour.start("overview");
      else router.push("/");
    });

  return (
    <div className="mx-auto max-w-2xl pb-10">
      <style>{`@keyframes wz-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}`}</style>

      {/* Progress */}
      <div className="mb-8">
        <div className="mb-3 flex items-baseline justify-between gap-4">
          <div className="text-sm text-muted">
            <span className="font-medium text-ink">Setup</span> · Step <span className="num">{index + 1}</span> of <span className="num">{STEPS.length}</span>
          </div>
          <Link href="/" className="text-sm text-muted hover:text-ink">Finish later</Link>
        </div>
        <ol className="grid grid-cols-8 gap-1.5" aria-label="Setup steps">
          {STEPS.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => i !== index && go(s.id, "visit")}
                aria-current={i === index ? "step" : undefined}
                aria-label={`${s.label}${status[s.id] === "done" ? " (done)" : status[s.id] === "skipped" ? " (skipped)" : ""}`}
                className="group block w-full py-2"
              >
                <span className={cx(
                  "block h-1.5 rounded-full transition-colors",
                  i === index ? "bg-ink" : status[s.id] === "done" ? "bg-good/70" : status[s.id] === "skipped" ? "bg-border-strong" : "bg-border",
                  i !== index && "group-hover:bg-ink-2/40",
                )} />
                <span className={cx("mt-2 hidden truncate text-left text-[11px] sm:block", i === index ? "font-medium text-ink" : "text-muted")}>{s.label}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>

      <div key={step} className="motion-safe:animate-[wz-in_260ms_cubic-bezier(.2,.8,.2,1)]">
        {step === "welcome" && <WelcomeStep me={props.me} />}
        {step === "basics" && <BasicsStep profile={props.profile} hours={props.hours} targetPct={props.targetPct} onChange={(v) => (basicsRef.current = v)} />}
        {step === "suppliers" && <SuppliersStep suppliers={props.suppliers} run={run} pending={pending} />}
        {step === "data" && <DataStep data={props.data} run={run} pending={pending} onLoaded={() => { setStatus((s) => ({ ...s, data: "done" })); router.refresh(); }} />}
        {step === "square" && <SquareStep connected={props.square} />}
        {step === "team" && <TeamStep users={props.users} run={run} pending={pending} />}
        {step === "phone" && <PhoneStep counts={props.counts} />}
        {step === "done" && <DoneStep status={status} onVisit={(id) => go(id, "visit")} />}
      </div>

      {error && <p className="mt-4 text-sm text-bad" role="alert">{error}</p>}

      {/* Footer */}
      <div className="mt-8 flex flex-wrap-reverse items-center justify-between gap-3">
        <div>{prev && <Button variant="ghost" onClick={() => go(prev, "visit")} disabled={pending}>Back</Button>}</div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {step === "done" ? (
            <>
              <Button variant="ghost" onClick={() => finish(false)} disabled={pending}>Go to overview</Button>
              <Button variant="primary" size="lg" onClick={() => finish(true)} disabled={pending}>Take the 1-minute tour</Button>
            </>
          ) : step === "welcome" ? (
            <Button variant="primary" size="lg" onClick={() => go("basics", "done")} disabled={pending}>Get started</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => go(next, "skipped")} disabled={pending}>Skip</Button>
              <Button variant="primary" size="lg" onClick={continueStep} disabled={pending}>{pending ? "Saving…" : "Continue"}</Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Shared bits ----------------------------------------------------------------------

function StepHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="mb-6">
      <h1 className="text-[1.6rem] font-semibold tracking-tight text-balance text-ink">{title}</h1>
      {children && <p className="mt-2 max-w-xl text-[0.95rem] leading-relaxed text-muted">{children}</p>}
    </header>
  );
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-border-strong bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx("h-9 rounded-md px-3 text-sm transition-colors sm:h-8", o.value === value ? "bg-primary font-medium text-primary-ink" : "text-ink-2 hover:text-ink")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function DayPicker({ value, onChange, label }: { value: number[]; onChange: (days: number[]) => void; label: string }) {
  return (
    <div className="flex gap-1" role="group" aria-label={label}>
      {DAYS_SHORT.map((d, i) => {
        const on = value.includes(i);
        return (
          <button
            key={i}
            type="button"
            aria-pressed={on}
            aria-label={DAYS_LONG[i]}
            onClick={() => onChange(on ? value.filter((x) => x !== i) : [...value, i].sort())}
            className={cx("size-10 rounded-full text-sm font-medium transition-colors sm:size-8 sm:text-xs", on ? "bg-primary text-primary-ink" : "border border-border-strong text-ink-2 hover:border-ink-2/50")}
          >
            {d}
          </button>
        );
      })}
    </div>
  );
}

// ---- (a) Welcome ---------------------------------------------------------------------

function WelcomeStep({ me }: { me: string }) {
  const points = [
    { icon: Receipt, title: "Live menu costs", text: "Every plate re-costs itself when a supplier price changes." },
    { icon: ShoppingCart, title: "Orders that write themselves", text: "Forecast sales × recipes − what's on the shelf, in whole cases." },
    { icon: ClipboardList, title: "Counts and waste on a phone", text: "Staff count and log as they go. Everything saves as they type." },
    { icon: Scale, title: "See where margin leaks", text: "What recipes say you used vs what really left the shelves." },
  ];
  return (
    <>
      <StepHeader title={`Welcome, ${me}.`}>
        Subversive Ops is the back-of-house side of the restaurant. Let's get it set up — about ten minutes. Every step can be skipped, and you can leave any time; your place is saved.
      </StepHeader>
      <div className="grid gap-3 sm:grid-cols-2">
        {points.map(({ icon: Icon, title, text }) => (
          <Card key={title} className="p-5">
            <Icon className="size-5 text-ink-2" strokeWidth={1.75} />
            <div className="mt-3 text-sm font-semibold">{title}</div>
            <div className="mt-1 text-sm leading-relaxed text-muted">{text}</div>
          </Card>
        ))}
      </div>
    </>
  );
}

// ---- (b) Basics ------------------------------------------------------------------------

interface BasicsValue {
  name: string;
  timezone: string;
  hours: Record<string, [number, number]>;
  targetPct: number;
}

const hourLabel = (h: number) => (h === 0 || h === 24 ? "Midnight" : h === 12 ? "Noon" : h < 12 ? `${h} am` : `${h - 12} pm`);
const OPEN_OPTIONS = Array.from({ length: 19 }, (_, i) => i + 5).map((h) => ({ value: String(h), label: hourLabel(h) }));
const CLOSE_OPTIONS = Array.from({ length: 19 }, (_, i) => i + 6).map((h) => ({ value: String(h), label: hourLabel(h) }));
const US_ZONES = [
  ["America/New_York", "Eastern — New York"],
  ["America/Chicago", "Central — Chicago"],
  ["America/Denver", "Mountain — Denver"],
  ["America/Phoenix", "Arizona — Phoenix"],
  ["America/Los_Angeles", "Pacific — Los Angeles"],
  ["America/Anchorage", "Alaska — Anchorage"],
  ["Pacific/Honolulu", "Hawaii — Honolulu"],
];

function BasicsStep({ profile, hours: initialHours, targetPct, onChange }: { profile: Props["profile"]; hours: Props["hours"]; targetPct: number; onChange: (v: BasicsValue) => void }) {
  const [name, setName] = useState(profile.name);
  const [timezone, setTimezone] = useState(profile.timezone);
  const [hours, setHours] = useState<Record<string, [number, number]>>(initialHours);
  const [lastHours, setLastHours] = useState<Record<string, [number, number]>>(initialHours);
  const [target, setTarget] = useState(String(targetPct));

  const zones = useMemo(() => {
    const us = US_ZONES.map(([value, label]) => ({ value, label, group: "United States" }));
    let all: string[] = [];
    try {
      all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
    } catch {}
    const rest = all.filter((z) => !US_ZONES.some(([v]) => v === z)).map((z) => ({ value: z, label: z.replace(/_/g, " "), group: "Everywhere else" }));
    if (!us.some((z) => z.value === timezone) && !rest.some((z) => z.value === timezone)) rest.unshift({ value: timezone, label: timezone, group: "Everywhere else" });
    return [...us, ...rest];
  }, [timezone]);

  useEffect(() => {
    onChange({ name, timezone, hours, targetPct: Number(target) });
  }, [name, timezone, hours, target, onChange]);

  const setDay = (d: number, h: [number, number] | null) =>
    setHours((cur) => {
      const next = { ...cur };
      if (h) next[d] = h;
      else delete next[d];
      return next;
    });

  return (
    <>
      <StepHeader title="Business basics">The name and time zone set what "today" means for sales and counts. Opening hours shape the forecast and the schedule.</StepHeader>
      <Card className="divide-y divide-border">
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Business name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Subversive" autoComplete="organization" /></Field>
          <Field label="Time zone">
            <Select value={timezone} onChange={(e) => setTimezone(e.target.value)} options={zones} searchable aria-label="Time zone" />
          </Field>
        </div>

        <div className="p-5">
          <div className="mb-3 text-[0.8rem] font-medium text-ink-2">Opening hours</div>
          <div className="space-y-2">
            {WEEK_ORDER.map((d) => {
              const h = hours[d];
              return (
                <div key={d} className="grid grid-cols-[6.5rem_auto] items-center gap-x-3 gap-y-2 sm:grid-cols-[7rem_6.5rem_1fr]">
                  <div className="text-sm font-medium">{DAYS_LONG[d]}</div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={!!h}
                    aria-label={`${DAYS_LONG[d]} open`}
                    onClick={() => {
                      if (h) { setLastHours((l) => ({ ...l, [d]: h })); setDay(d, null); }
                      else setDay(d, lastHours[d] ?? [16, 21]);
                    }}
                    className="flex h-10 items-center gap-2 justify-self-start text-sm sm:h-9"
                  >
                    <span className={cx("relative h-5 w-9 rounded-full transition-colors", h ? "bg-ink" : "bg-border-strong")}>
                      <span className={cx("absolute top-0.5 size-4 rounded-full bg-surface shadow transition-all", h ? "left-[1.125rem]" : "left-0.5")} />
                    </span>
                    <span className={h ? "text-ink" : "text-muted"}>{h ? "Open" : "Closed"}</span>
                  </button>
                  {h ? (
                    <div className="col-span-2 flex items-center gap-2 sm:col-span-1">
                      <Select value={String(h[0])} options={OPEN_OPTIONS} onChange={(e) => setDay(d, [Number(e.target.value), Math.max(h[1], Number(e.target.value) + 1)])} className="w-32" aria-label={`${DAYS_LONG[d]} opens`} />
                      <span className="text-sm text-muted">to</span>
                      <Select value={String(h[1])} options={CLOSE_OPTIONS.filter((o) => Number(o.value) > h[0])} onChange={(e) => setDay(d, [h[0], Number(e.target.value)])} className="w-32" aria-label={`${DAYS_LONG[d]} closes`} />
                    </div>
                  ) : <div className="hidden sm:block" />}
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-4 p-5">
          <Field label="Food cost target" hint="The default for every menu item. Most restaurants aim for 28–32%." className="max-w-xs">
            <div className="relative w-28">
              <Input type="number" inputMode="decimal" min={1} max={99} step="0.5" value={target} onChange={(e) => setTarget(e.target.value)} className="num pr-7 text-right" />
              <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted">%</span>
            </div>
          </Field>
        </div>
      </Card>
    </>
  );
}

// ---- (c) Suppliers -----------------------------------------------------------------------

type Run = (fn: () => Promise<{ error?: string } | void>, then?: () => void) => void;

function SuppliersStep({ suppliers, run, pending }: { suppliers: Props["suppliers"]; run: Run; pending: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"DISTRIBUTOR" | "LOCAL">("DISTRIBUTOR");
  const [days, setDays] = useState<number[]>([]);
  const [rowDays, setRowDays] = useState<Record<string, number[]>>({});
  const nameRef = useRef<HTMLInputElement>(null);

  const add = () =>
    run(() => addSupplier({ name, kind, deliveryDays: days }), () => {
      setName("");
      setDays([]);
      router.refresh();
      nameRef.current?.focus();
    });

  return (
    <>
      <StepHeader title="Who delivers?">Add the people you buy from and the days their trucks come. Delivery days decide when each order is due and how long it has to last.</StepHeader>
      <Card className="divide-y divide-border">
        {suppliers.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{s.name}</div>
              <div className="text-xs text-muted">{s.kind === "LOCAL" ? "Local" : "Distributor"}</div>
            </div>
            <DayPicker
              label={`${s.name} delivery days`}
              value={rowDays[s.id] ?? s.deliveryDays}
              onChange={(d) => { setRowDays((r) => ({ ...r, [s.id]: d })); run(() => setSupplierDays(s.id, d)); }}
            />
          </div>
        ))}
        <form
          className="space-y-4 bg-surface-2/40 p-5"
          onSubmit={(e) => { e.preventDefault(); if (name.trim()) add(); }}
        >
          <div className="text-sm font-medium">{suppliers.length ? "Add another" : "Add your first supplier"}</div>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Name" className="min-w-48 flex-1"><Input ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sysco, Hudson Valley Farm" /></Field>
            <Field label="Type">
              <Segmented label="Supplier type" value={kind} onChange={setKind} options={[{ value: "DISTRIBUTOR", label: "Distributor" }, { value: "LOCAL", label: "Local" }]} />
            </Field>
          </div>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <span className="mb-1.5 block text-[0.8rem] font-medium text-ink-2">Delivers on</span>
              <DayPicker label="Delivery days" value={days} onChange={setDays} />
            </div>
            <Button type="submit" disabled={pending || !name.trim()}>Add supplier</Button>
          </div>
        </form>
      </Card>
      <p className="mt-3 text-sm text-muted">Email, lead time and minimum order can be added later in <Link href="/settings" className="text-ink underline-offset-2 hover:underline">Settings</Link>.</p>
    </>
  );
}

// ---- (d) Data ------------------------------------------------------------------------------

function DataStep({ data, run, pending, onLoaded }: { data: Props["data"]; run: Run; pending: boolean; onLoaded: () => void }) {
  const has = data.ingredients + data.recipes > 0;
  return (
    <>
      <StepHeader title="Bring in your data">Your ingredients, prices and recipes are what everything else is built on. Bring in the spreadsheet you already use, or load demo data to look around first.</StepHeader>
      {has && (
        <Card className="mb-4 flex items-center gap-3 border-good/30 bg-good-bg p-4 text-sm text-good">
          <Check className="size-4 shrink-0" strokeWidth={2.5} />
          <span>You have <b className="num">{data.ingredients}</b> ingredients and <b className="num">{data.recipes}</b> recipes.</span>
        </Card>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="flex flex-col p-5">
          <FileSpreadsheet className="size-5 text-ink-2" strokeWidth={1.75} />
          <div className="mt-3 text-sm font-semibold">Import your spreadsheets</div>
          <p className="mt-1 flex-1 text-sm leading-relaxed text-muted">
            Upload Excel, paste from Google Sheets, or share a link. You'll check what each tab is before anything is saved. When you're done, come back here with the back button.
          </p>
          <LinkButton href="/import" variant={has ? "secondary" : "primary"} className="mt-4 self-start">{has ? "Import more" : "Import sheets"}</LinkButton>
        </Card>
        <Card className="flex flex-col p-5">
          <ClipboardList className="size-5 text-ink-2" strokeWidth={1.75} />
          <div className="mt-3 text-sm font-semibold">Load demo data</div>
          <p className="mt-1 flex-1 text-sm leading-relaxed text-muted">
            A realistic menu, suppliers, prices and sales so you can try everything. Clear it any time in Settings — logins are kept.
          </p>
          <Button className="mt-4 self-start" disabled={pending || has} onClick={() => run(loadDemo, onLoaded)}>{has ? "You already have data" : pending ? "Loading…" : "Load demo data"}</Button>
        </Card>
      </div>
      <p className="mt-4 text-sm text-muted">Distributor price sheets (Sysco, US Foods…) have their own importer under <Link href="/prices/import" className="text-ink underline-offset-2 hover:underline">Prices</Link>.</p>
    </>
  );
}

// ---- (e) Square -----------------------------------------------------------------------------

function CopyCode({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch {} }}
      className="group inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2/60 px-2 py-1 font-mono text-[0.8rem] text-ink hover:border-border-strong"
      aria-label={`Copy ${text}`}
    >
      {text}
      {copied ? <Check className="size-3.5 text-good" strokeWidth={2.5} /> : <Copy className="size-3.5 text-muted group-hover:text-ink" />}
    </button>
  );
}

function SquareStep({ connected }: { connected: boolean }) {
  return (
    <>
      <StepHeader title="Connect Square">Square sales drive the food cost numbers and the forecast behind every order. It syncs on its own every night once connected.</StepHeader>
      <Card className="mb-4 flex items-center justify-between gap-3 p-5">
        <div className="flex items-center gap-3">
          <Plug className="size-5 text-ink-2" strokeWidth={1.75} />
          <div>
            <div className="text-sm font-semibold">{connected ? "Square is connected" : "Not connected yet"}</div>
            <div className="text-sm text-muted">{connected ? "Next: import past sales and link Square items to recipes." : "This part needs whoever manages the app's hosting."}</div>
          </div>
        </div>
        <Badge tone={connected ? "good" : "warn"}>{connected ? "Live" : "Setup needed"}</Badge>
      </Card>
      {connected ? (
        <Card className="p-5 text-sm leading-relaxed text-ink-2">
          <ol className="list-decimal space-y-1.5 pl-5">
            <li>On <Link href="/sales" className="text-ink underline-offset-2 hover:underline">Sales</Link>, press <b>Import last 6 months</b> so the forecast has history.</li>
            <li>Link each Square item to its recipe. Mark drinks, merch and gift cards as <b>Ignore</b>.</li>
          </ol>
        </Card>
      ) : (
        <Card className="p-5 text-sm leading-relaxed text-ink-2">
          <ol className="list-decimal space-y-3 pl-5">
            <li>At <b>developer.squareup.com</b>, sign in with the restaurant's Square account and create an app.</li>
            <li>Under <b>Production</b> credentials, copy the <b>access token</b>. On the <b>Locations</b> tab, copy Subversive's <b>location ID</b>.</li>
            <li>
              In the hosting project (Vercel → Settings → Environment Variables), add:
              <div className="mt-2 flex flex-wrap gap-2"><CopyCode text="SQUARE_ACCESS_TOKEN" /><CopyCode text="SQUARE_LOCATION_ID" /></div>
              <div className="mt-2 text-xs text-muted">Optional: <span className="font-mono">SQUARE_ENVIRONMENT</span> = sandbox for testing. <span className="font-mono">CRON_SECRET</span> protects the nightly sync.</div>
            </li>
            <li>Redeploy. This page will show <b>Live</b>.</li>
          </ol>
          <p className="mt-4 border-t border-border pt-4 text-xs text-muted">The access token is a password to your sales data. Paste it only into the hosting settings — never into email or chat.</p>
        </Card>
      )}
    </>
  );
}

// ---- (f) Team ------------------------------------------------------------------------------

function TeamStep({ users, run, pending }: { users: Props["users"]; run: Run; pending: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [role, setRole] = useState<"STAFF" | "MANAGER">("STAFF");
  const [added, setAdded] = useState<string | null>(null);
  const add = () =>
    run(() => addTeamMember({ name, pin, role }), () => {
      setAdded(`${name.trim()} can sign in now.`);
      setName("");
      setPin("");
      router.refresh();
    });
  return (
    <>
      <StepHeader title="Team logins">Everyone signs in with their name and a PIN. Staff only see counts and waste; managers see everything.</StepHeader>
      <Card className="divide-y divide-border">
        {users.map((u) => (
          <div key={u.id} className="flex items-center justify-between px-5 py-3 text-sm">
            <span className="font-medium">{u.name}{u.me && <span className="ml-1.5 font-normal text-muted">(you)</span>}</span>
            <Badge>{u.role === "MANAGER" ? "Manager" : "Staff"}</Badge>
          </div>
        ))}
        <form className="space-y-4 bg-surface-2/40 p-5" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <div className="text-sm font-medium">Add someone</div>
          <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
            <Field label="Name"><Input value={name} onChange={(e) => { setName(e.target.value); setAdded(null); }} placeholder="First name is fine" autoComplete="off" /></Field>
            <Field label="PIN" hint="4–8 digits"><Input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))} inputMode="numeric" autoComplete="off" placeholder="••••" className="num tracking-widest" /></Field>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Segmented label="Role" value={role} onChange={setRole} options={[{ value: "STAFF", label: "Staff" }, { value: "MANAGER", label: "Manager" }]} />
            <div className="flex items-center gap-3">
              {added && <span className="text-sm text-good">{added}</span>}
              <Button type="submit" disabled={pending || !name.trim() || pin.length < 4}>Add login</Button>
            </div>
          </div>
        </form>
      </Card>
      <p className="mt-3 text-sm text-muted">Tell each person their PIN in person. PINs can be reset in Settings.</p>
    </>
  );
}

// ---- (g) First count + phone -------------------------------------------------------------------

function PhoneStep({ counts }: { counts: number }) {
  const [os, setOs] = useState<"ios" | "android">("ios");
  useEffect(() => {
    if (/android/i.test(navigator.userAgent)) setOs("android");
  }, []);
  return (
    <>
      <StepHeader title="First count, and the app on your phone">One count gives ordering a starting point — until an item is counted, it won't be ordered automatically. Counting is easiest on a phone.</StepHeader>
      <Card className="mb-4 flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex items-start gap-3">
          <ClipboardList className="mt-0.5 size-5 text-ink-2" strokeWidth={1.75} />
          <div>
            <div className="text-sm font-semibold">Take your first count</div>
            <div className="text-sm text-muted">{counts > 0 ? `${counts} finished count${counts === 1 ? "" : "s"} so far.` : "Start with one area — the walk-in is a good first one."}</div>
          </div>
        </div>
        {counts > 0 ? <Badge tone="good">Done</Badge> : <LinkButton href="/count">Start a count</LinkButton>}
      </Card>
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Smartphone className="size-5 text-ink-2" strokeWidth={1.75} />
            <div className="text-sm font-semibold">Add it to your home screen</div>
          </div>
          <Segmented label="Phone" value={os} onChange={setOs} options={[{ value: "ios", label: "iPhone" }, { value: "android", label: "Android" }]} />
        </div>
        <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-ink-2">
          {os === "ios" ? (
            <>
              <li>Open this app in <b>Safari</b> on the phone and sign in.</li>
              <li>Tap <b>Share</b> — the square with an arrow pointing up.</li>
              <li>Scroll down, tap <b>Add to Home Screen</b>, then <b>Add</b>.</li>
            </>
          ) : (
            <>
              <li>Open this app in <b>Chrome</b> on the phone and sign in.</li>
              <li>Tap the <b>⋮</b> menu in the top corner.</li>
              <li>Tap <b>Add to Home screen</b> (or <b>Install app</b>), then <b>Add</b>.</li>
            </>
          )}
        </ol>
        <p className="mt-4 text-xs text-muted">Sign-ins last two weeks, so a shared kitchen tablet stays signed in.</p>
      </Card>
    </>
  );
}

// ---- (h) Done -------------------------------------------------------------------------------

function DoneStep({ status, onVisit }: { status: Record<string, Status>; onVisit: (id: StepId) => void }) {
  const rest = STEPS.filter((s) => s.id !== "welcome" && s.id !== "done");
  const skipped = rest.filter((s) => status[s.id] !== "done");
  return (
    <>
      <div className="mb-6 grid size-12 place-items-center rounded-full bg-good-bg text-good">
        <Check className="size-6" strokeWidth={2.5} />
      </div>
      <StepHeader title="You're set up.">
        {skipped.length ? "A few steps are waiting for later — pick them up from here, or from the Overview any time." : "Everything's in place. A one-minute tour shows you around."}
      </StepHeader>
      <Card className="divide-y divide-border">
        {rest.map((s) => (
          <div key={s.id} className="flex items-center justify-between px-5 py-3 text-sm">
            <span className="flex items-center gap-2.5">
              <span className={cx("grid size-5 place-items-center rounded-full", status[s.id] === "done" ? "bg-good text-white" : "border border-border-strong")}>
                {status[s.id] === "done" && <Check className="size-3" strokeWidth={3} />}
              </span>
              {s.label}
            </span>
            {status[s.id] === "done" ? <span className="text-xs text-muted">Done</span> : (
              <button type="button" onClick={() => onVisit(s.id)} className="text-sm text-ink underline-offset-2 hover:underline">Set up</button>
            )}
          </div>
        ))}
      </Card>
    </>
  );
}
