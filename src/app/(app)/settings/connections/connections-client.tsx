"use client";

import { useConfirm } from "@/components/dialog";
import { HelpTip, HelpZone } from "@/components/help";
import { useReducedMotion } from "@/components/motion";
import { PushToggle } from "@/components/push-toggle";
import { Badge, Button, Card, cx, Field, Input, LinkButton, type Tone } from "@/components/ui";
import { validateSecret, type SecretName } from "@/domain/secretFormats";
import { checkAccessToken, SQUARE_WEBHOOK_EVENTS } from "@/domain/squareWebhooks";
import type { SecretStatus } from "@/domain/secrets";
import { areaStyle, type Area } from "@/lib/areas";
import { relativeTime } from "@/lib/format";
import { ArrowLeft, ArrowRight, BellRing, Check, ChevronRight, Copy, ExternalLink, Mail, Search, Sparkles, Star, Store, X, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, useTransition, type CSSProperties, type ReactNode } from "react";
import { Chips } from "../square/square-client";
import { findBusiness, forgetBusiness, pickBusiness, removeKey, saveKey, testAI, testEmail, testSquare, turnOnInstantUpdates, turnOnPush, type ServiceId, type TestResult } from "./actions";
import * as Art from "./illustrations";

export interface ConnectionsData {
  origin: string;
  local: boolean;
  redirectUrl: string;
  webhookUrl: string;
  squareVersion: string;
  secrets: Record<SecretName, SecretStatus>;
  square: { connected: boolean; merchantName: string | null; locations: number; source: "oauth" | "token" | "env" | null; sandbox: boolean; oauthReady: boolean; webhookSeen: string | null };
  email: { me: string | null };
  push: { devices: number };
  google: { placeId: string | null; placeName: string | null; businessName: string };
  tests: Record<ServiceId, TestResult | null>;
  open: ServiceId | null;
  flash: { error?: string; message?: string } | null;
}

export const SQUARE_EVENTS = SQUARE_WEBHOOK_EVENTS;

// ---- Status ---------------------------------------------------------------------------

interface ServiceMeta {
  id: ServiceId;
  title: string;
  icon: LucideIcon;
  area: Area;
  turnsOn: string;
  time: string;
  guide: string;
}

const SERVICES: ServiceMeta[] = [
  { id: "square", title: "Square", icon: Store, area: "numbers", turnsOn: "Brings in sales, the menu and timecards by itself, all day and every night.", time: "About 6 minutes", guide: "Connect Square" },
  { id: "email", title: "Email", icon: Mail, area: "today", turnsOn: "Sends orders to suppliers, schedules to staff and the weekly brief by email.", time: "About 10 minutes, plus a short wait", guide: "Set up email" },
  { id: "push", title: "Phone notifications", icon: BellRing, area: "people", turnsOn: "Pops up alerts on phones: new schedules, shift swaps, price spikes and more.", time: "1 minute per phone", guide: "Turn on phone notifications" },
  { id: "ai", title: "AI features", icon: Sparkles, area: "assist", turnsOn: "Reads invoices from a photo, drafts review replies and answers questions in Ask.", time: "About 3 minutes", guide: "Turn on AI features" },
  { id: "google", title: "Google reviews", icon: Star, area: "food", turnsOn: "Brings in new Google reviews every morning, with alerts for low ratings.", time: "About 5 minutes", guide: "Bring in Google reviews" },
];

type Status = { tone: Tone; label: string; detail: string };

function statusOf(id: ServiceId, d: ConnectionsData, pushReady: boolean): Status {
  const s = d.secrets;
  const test = d.tests[id];
  const failed = test && !test.ok ? " · last test failed" : "";
  switch (id) {
    case "square":
      if (d.square.connected) return { tone: "good", label: "Connected", detail: `${d.square.merchantName ?? "Square"} · ${d.square.locations} location${d.square.locations === 1 ? "" : "s"}${s.SQUARE_WEBHOOK_SIGNATURE_KEY.set ? " · instant updates on" : ""}` };
      if (d.square.oauthReady) return { tone: "warn", label: "Ready to connect", detail: "Part 1 is done. Part 2 takes a minute: sign in and press Allow." };
      if (s.SQUARE_APPLICATION_ID.set || s.SQUARE_APPLICATION_SECRET.set) return { tone: "warn", label: "Half done", detail: "One of the two Square codes is still missing." };
      return { tone: "neutral", label: "Not set up", detail: "Without it, sales and timecards aren't brought in." };
    case "email":
      if (s.RESEND_API_KEY.set && s.EMAIL_FROM.set) return { tone: test && !test.ok ? "bad" : "good", label: test && !test.ok ? "Needs attention" : "On", detail: `Sending from ${s.EMAIL_FROM.hint}${failed}` };
      if (s.RESEND_API_KEY.set || s.EMAIL_FROM.set) return { tone: "warn", label: "Half done", detail: s.RESEND_API_KEY.set ? "Choose the address emails come from." : "Paste the email service key." };
      return { tone: "neutral", label: "Not set up", detail: "Orders can still be copied, downloaded or opened in your mail app." };
    case "push":
      if (pushReady) return { tone: "good", label: "On", detail: d.push.devices ? `${d.push.devices} device${d.push.devices === 1 ? "" : "s"} getting alerts` : "No phones turned on yet" };
      return { tone: "neutral", label: "Off", detail: "One tap turns it on — no account needed." };
    case "ai":
      if (s.ANTHROPIC_API_KEY.set) return { tone: test && !test.ok ? "bad" : "good", label: test && !test.ok ? "Needs attention" : "On", detail: `Claude key ${s.ANTHROPIC_API_KEY.hint}${failed}` };
      return { tone: "neutral", label: "Not set up", detail: "Invoices are typed in by hand; reviews use simple keyword themes." };
    case "google":
      if (s.GOOGLE_PLACES_API_KEY.set && d.google.placeId) return { tone: test && !test.ok ? "bad" : "good", label: test && !test.ok ? "Needs attention" : "On", detail: d.google.placeName ?? "Business picked" };
      if (s.GOOGLE_PLACES_API_KEY.set) return { tone: "warn", label: "Pick your business", detail: "The key is saved. Now find your business on Google." };
      return { tone: "neutral", label: "Not set up", detail: "You can still paste reviews in on the Reviews page." };
  }
}

function StatusPill({ status }: { status: Status }) {
  const dot = { good: "bg-good", warn: "bg-warn", bad: "bg-bad", neutral: "bg-muted" }[status.tone];
  return (
    <Badge tone={status.tone} className="gap-1.5">
      <span className={cx("size-1.5 rounded-full", dot)} />
      {status.label}
    </Badge>
  );
}

// ---- Page -----------------------------------------------------------------------------

export function Connections({ data }: { data: ConnectionsData }) {
  const [open, setOpen] = useState<ServiceId | null>(data.open);
  // A finished connection opens on "manage" (what's connected, test, remove); the guide is one tap away.
  const [guide, setGuide] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const pushReady = data.secrets.VAPID_PUBLIC_KEY.set && data.secrets.VAPID_PRIVATE_KEY.set;

  const choose = (id: ServiceId | null) => {
    setOpen(id);
    setGuide(false);
    try {
      const u = new URL(window.location.href);
      if (id) u.searchParams.set("open", id);
      else u.searchParams.delete("open");
      u.searchParams.delete("error");
      u.searchParams.delete("connected");
      window.history.replaceState(null, "", u);
    } catch {
      /* not important */
    }
    if (id) requestAnimationFrame(() => panel.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" }));
  };

  useEffect(() => {
    if (data.open) panel.current?.scrollIntoView({ block: "start" });
    // Deep links (#square-instant) land on the right step after the panel mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const meta = SERVICES.find((s) => s.id === open);
  const managing = !!meta && !guide && meta.id !== "square" && statusOf(meta.id, data, pushReady).tone === "good";

  return (
    <>
      {data.flash && (
        <Card role="status" className={cx("mb-6 p-4 text-sm", data.flash.error ? "border-bad/40 text-bad" : "border-good/40 text-good")}>
          {data.flash.error ?? data.flash.message}
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SERVICES.map((s) => (
          <HelpZone key={s.id} id={`settings.connections.${s.id}`} className="h-full min-w-0">
            <ServiceTile meta={s} status={statusOf(s.id, data, pushReady)} selected={open === s.id} href={s.id === "square" && data.square.connected ? "/settings/square" : undefined} onOpen={() => choose(open === s.id ? null : s.id)} />
          </HelpZone>
        ))}
        <HelpZone id="settings.connections.more" className="h-full min-w-0">
          <Card className="flex h-full flex-col justify-between gap-4 border-dashed bg-transparent p-5">
            <div>
              <div className="text-sm font-semibold">Is this safe?</div>
              <p className="mt-1 text-sm text-muted">Every key is stored locked (encrypted) and never shown again — only its last four characters. Only managers can see this page.</p>
            </div>
            <LinkButton href="/settings/square" variant="ghost" className="self-start px-0 hover:bg-transparent">Square page: locations and history <ChevronRight className="size-4" /></LinkButton>
          </Card>
        </HelpZone>
      </div>

      <div ref={panel} className="scroll-mt-20">
        {meta && (
          <HelpZone id={`settings.connections.${meta.id}`} className="mt-6">
            <Card key={meta.id} className="animate-rise-in overflow-hidden" style={areaStyle(meta.area)}>
              <div className="flex items-start justify-between gap-3 border-b border-border p-5">
                <div className="flex min-w-0 items-center gap-3">
                  <IconChip icon={meta.icon} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold">{managing ? meta.title : meta.guide}</h2>
                      <StatusPill status={statusOf(meta.id, data, pushReady)} />
                    </div>
                    <p className="mt-0.5 text-sm text-muted">{meta.turnsOn}</p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" className="size-10 shrink-0 p-0 sm:size-8" aria-label="Close the guide" onClick={() => choose(null)}>
                  <X className="size-4" />
                </Button>
              </div>
              {managing ? (
                <Manage id={meta.id} d={data} pushReady={pushReady} onGuide={() => setGuide(true)} />
              ) : (
                <>
                  {meta.id === "square" && <SquareGuide d={data} />}
                  {meta.id === "email" && <EmailGuide d={data} />}
                  {meta.id === "push" && <PushGuide d={data} ready={pushReady} />}
                  {meta.id === "ai" && <AIGuide d={data} />}
                  {meta.id === "google" && <GoogleGuide d={data} />}
                </>
              )}
            </Card>
          </HelpZone>
        )}
      </div>
    </>
  );
}

function IconChip({ icon: Icon, area }: { icon: LucideIcon; area?: Area }) {
  return (
    <span aria-hidden style={area ? areaStyle(area) : undefined} className="grid size-9 shrink-0 place-items-center rounded-[0.65rem] bg-area/10 text-area ring-1 ring-area/15 ring-inset">
      <Icon className="size-[1.1rem]" strokeWidth={1.9} />
    </span>
  );
}

function ServiceTile({ meta, status, selected, onOpen, href }: { meta: ServiceMeta; status: Status; selected: boolean; onOpen: () => void; href?: string }) {
  const done = status.tone === "good";
  return (
    <Card className={cx("flex h-full flex-col p-5 transition-[border-color,box-shadow] duration-180", selected && "border-ink/50 shadow-[0_0_0_3px_color-mix(in_oklab,var(--ink)_7%,transparent)]")} data-tour={`connections.${meta.id}`}>
      <div className="flex items-start justify-between gap-3">
        <IconChip icon={meta.icon} area={meta.area} />
        <StatusPill status={status} />
      </div>
      <div className="mt-3 text-base font-semibold">{meta.title}</div>
      <p className="mt-1 text-sm text-ink-2">{meta.turnsOn}</p>
      <p className="mt-2 line-clamp-2 text-[0.8rem] text-muted">{status.detail}</p>
      <div className="mt-auto flex items-center justify-between gap-3 pt-4">
        <span className="text-xs text-muted">{done ? "" : meta.time}</span>
        {href ? (
          <LinkButton href={href} variant="secondary">Manage <ChevronRight className="size-4" /></LinkButton>
        ) : (
        <Button variant={done || selected ? "secondary" : "primary"} onClick={onOpen} aria-expanded={selected}>
          {selected ? "Close" : { good: "Manage", warn: "Continue", bad: "Fix", neutral: "Set up" }[status.tone]}
          {!selected && <ChevronRight className="size-4" />}
        </Button>
        )}
      </div>
    </Card>
  );
}

// ---- Manage ---------------------------------------------------------------------------

/** A connection that's working: what it's connected to, a test, and how to change or remove it. */
function Manage({ id, d, pushReady, onGuide }: { id: ServiceId; d: ConnectionsData; pushReady: boolean; onGuide: () => void }) {
  const s = d.secrets;
  const [pending, start] = useTransition();
  const router = useRouter();
  const confirm = useConfirm();
  const status = statusOf(id, d, pushReady);
  return (
    <div className="space-y-5 p-5">
      <div className="flex items-center gap-2.5 rounded-lg bg-good-bg/60 px-3.5 py-3 text-sm text-ink">
        <span className="grid size-5 shrink-0 place-items-center rounded-full bg-good text-white"><Check className="size-3" strokeWidth={3} /></span>
        <span className="min-w-0">{status.detail}</span>
      </div>

      {id === "email" && (
        <>
          <TestButton run={() => testEmail()} last={d.tests.email} label="Send a test email" />
          <div className="grid gap-4 sm:grid-cols-2">
            <SecretField name="EMAIL_FROM" status={s.EMAIL_FROM} label="Sending from" placeholder="Name <orders@yourrestaurant.com>" sensitive={false} />
            <SecretField name="RESEND_API_KEY" status={s.RESEND_API_KEY} label="Email service key" placeholder="re_…" hint="Starts with re_." />
          </div>
        </>
      )}
      {id === "ai" && (
        <>
          <TestButton run={testAI} last={d.tests.ai} />
          <SecretField name="ANTHROPIC_API_KEY" status={s.ANTHROPIC_API_KEY} label="Claude key" placeholder="sk-ant-…" hint="Starts with sk-ant-." />
        </>
      )}
      {id === "google" && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3.5 py-3 text-sm">
            <span className="min-w-0"><span className="text-muted">Business · </span><span className="font-medium">{d.google.placeName ?? "Picked"}</span></span>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={async () => {
                if (await confirm({ title: "Pick a different business?", body: "New reviews stop coming in until you pick one again. Reviews already brought in stay.", confirmLabel: "Unlink" })) {
                  start(async () => { await forgetBusiness(); router.refresh(); });
                }
              }}
            >
              Pick a different one
            </Button>
          </div>
          <SecretField name="GOOGLE_PLACES_API_KEY" status={s.GOOGLE_PLACES_API_KEY} label="Google key" placeholder="AIza…" hint="Starts with AIza, 39 characters." />
        </>
      )}
      {id === "push" && (
        <>
          <PushToggle variant="inline" />
          <p className="text-sm text-muted">Each person turns notifications on for their own phone — staff do it from My shifts. Choose which alerts you get under <Link href="/settings/notifications" className="text-ink underline underline-offset-2">Notifications</Link>.</p>
        </>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4 text-sm">
        <span className="text-muted">{id === "push" ? "Setting up a new phone?" : "Changing accounts, or need to set it up again?"}</span>
        <Button size="sm" variant="ghost" onClick={onGuide}>Show the setup steps <ChevronRight className="size-4" /></Button>
      </div>
    </div>
  );
}

// ---- Stepper --------------------------------------------------------------------------

interface Step {
  id: string;
  title: string;
  done?: boolean;
  part?: string;
  optional?: boolean;
  body: ReactNode;
  art?: ReactNode;
}

function Stepper({ steps, parts, startAt }: { steps: Step[]; parts?: { id: string; title: string; note: string; optional?: boolean }[]; startAt?: string }) {
  const [i, setI] = useState(() => {
    const at = steps.findIndex((s) => s.id === startAt);
    if (at >= 0) return at;
    const n = steps.findIndex((s) => !s.done && !s.optional);
    return n < 0 ? 0 : n;
  });
  const [showAll, setShowAll] = useState(false);
  // A link to a step (…#square-instant) opens on it.
  useEffect(() => {
    const n = steps.findIndex((s) => s.id === window.location.hash.slice(1));
    if (n >= 0) setI(n);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const step = steps[Math.min(i, steps.length - 1)];
  const top = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const go = (n: number) => {
    setI(n);
    setShowAll(false);
    const r = top.current?.getBoundingClientRect();
    if (r && r.top < 64) top.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  };

  // Progress counts only the steps of the part you're in, so it reads "Step 2 of 5", not "2 of 8".
  const part = parts?.find((p) => p.id === step.part);
  const inPart = steps.map((s, n) => ({ s, n })).filter(({ s }) => !parts || s.part === step.part);
  const pos = inPart.findIndex(({ n }) => n === i);
  const next = steps[i + 1];
  const nextPart = next && parts && next.part !== step.part ? parts.find((p) => p.id === next.part) : null;
  const requiredDone = steps.filter((s) => !s.optional).every((s) => s.done);

  return (
    <div ref={top} className="scroll-mt-20">
      {/* One quiet line of progress: where you are, how far along. */}
      <div className="px-5 pt-5">
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="min-w-0 truncate font-medium text-ink-2">
            {part ? <>{part.title}{part.optional && <span className="font-normal text-muted"> · optional</span>}</> : "Steps"}
          </span>
          <button type="button" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll} className="shrink-0 text-muted underline-offset-2 hover:text-ink hover:underline">
            Step {pos + 1} of {inPart.length}
          </button>
        </div>
        <div className="mt-2 flex gap-1" aria-hidden>
          {inPart.map(({ s, n }) => (
            <span key={s.id} className={cx("h-1 flex-1 rounded-full transition-colors duration-180", n === i ? "bg-ink" : s.done || n < i ? "bg-ink/35" : "bg-border")} />
          ))}
        </div>
        {showAll && (
          <ol className="mt-3 animate-fade-in space-y-0.5 rounded-xl border border-border bg-surface p-1.5 text-sm">
            {steps.map((s, n) => {
              const p = parts?.find((x) => x.id === s.part);
              const first = n === 0 || steps[n - 1].part !== s.part;
              return (
                <li key={s.id}>
                  {p && first && <div className="px-2.5 pt-2 pb-1 text-[11px] font-medium text-muted">{p.title}{p.optional && " · optional"}</div>}
                  <button type="button" onClick={() => go(n)} aria-current={n === i ? "step" : undefined} className={cx("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left", n === i ? "bg-surface-2 font-medium text-ink" : "text-ink-2 hover:bg-surface-2/70")}>
                    <span className={cx("grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold", s.done ? "bg-good-bg text-good" : "bg-surface-2 text-muted")}>{s.done ? <Check className="size-3" strokeWidth={3} /> : n + 1}</span>
                    {s.title}
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <div key={step.id} id={step.id} className="grid animate-fade-in gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start lg:gap-8">
        {step.art && <div className="min-w-0 rounded-xl bg-surface-2/60 p-3 sm:p-4 lg:order-2">{step.art}</div>}
        <div className="min-w-0 lg:order-1 lg:pt-1">
          <h3 className="flex flex-wrap items-center gap-2 text-lg font-semibold tracking-tight">
            {step.title}
            {step.done && <Badge tone="good">Done</Badge>}
          </h3>
          <div className="mt-2.5 space-y-4 text-[0.95rem] leading-relaxed text-ink-2">{step.body}</div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-4">
        <Button variant="ghost" disabled={i === 0} onClick={() => go(i - 1)}>
          <ArrowLeft className="size-4" /> Back
        </Button>
        {next && !(nextPart?.optional && !requiredDone) ? (
          nextPart?.optional ? (
            <Button variant="secondary" onClick={() => go(i + 1)}>
              Optional: {nextPart.title} <ArrowRight className="size-4" />
            </Button>
          ) : (
            <Button variant="primary" onClick={() => go(i + 1)}>
              {nextPart ? `Next: ${nextPart.title}` : "Next"} <ArrowRight className="size-4" />
            </Button>
          )
        ) : (
          <span className="text-sm text-muted">{requiredDone ? "All set." : "Finish this step to carry on."}</span>
        )}
      </div>
    </div>
  );
}

// ---- Building blocks -------------------------------------------------------------------

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers / plain http: fall back to a hidden textarea.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

/** Something to paste somewhere else: shows the value, copies it on tap. */
function CopyChip({ value, label, block }: { value: string; label: string; block?: boolean }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    setState((await copyText(value)) ? "copied" : "failed");
    setTimeout(() => setState("idle"), 1800);
  };
  return (
    <div>
      <div className="mb-1 text-[0.8rem] font-medium text-ink-2">{label}</div>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy ${label}`}
        className={cx(
          "group flex w-full min-w-0 items-start gap-2 rounded-lg border bg-surface px-3 py-2 text-left transition-colors",
          state === "copied" ? "border-good/50" : "border-border-strong hover:border-ink-2/40 hover:bg-surface-2/60",
        )}
      >
        <span className={cx("min-w-0 flex-1 font-mono text-[0.8rem] text-ink", block ? "whitespace-pre-wrap" : "truncate")}>{value}</span>
        <span className={cx("inline-flex shrink-0 items-center gap-1 text-xs font-medium", state === "copied" ? "text-good" : state === "failed" ? "text-bad" : "text-muted group-hover:text-ink")}>
          {state === "copied" ? <Check className="size-3.5" strokeWidth={2.5} /> : <Copy className="size-3.5" />}
          {state === "copied" ? "Copied" : state === "failed" ? "Select and copy" : "Copy"}
        </span>
      </button>
    </div>
  );
}

function Outbound({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-border-strong bg-surface px-3.5 text-sm font-medium text-ink transition-colors hover:bg-surface-2 sm:h-9">
      {children} <ExternalLink className="size-3.5 text-muted" />
    </a>
  );
}

function Note({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <div className={cx("rounded-lg px-3 py-2.5 text-sm", { good: "bg-good-bg text-good", warn: "bg-warn-bg text-warn", bad: "bg-bad-bg text-bad", neutral: "bg-surface-2 text-ink-2" }[tone])}>{children}</div>;
}

/**
 * A paste box for one key. Checks the value as you type (plain-English
 * errors), saves on a valid paste, then shows "Saved ✓ · ends in …ab12" with
 * Replace / Remove. The saved value itself never comes back to the browser.
 */
function SecretField({ name, status, label, placeholder, hint, sensitive = true }: { name: SecretName; status: SecretStatus; label: string; placeholder: string; hint?: ReactNode; sensitive?: boolean }) {
  const [editing, setEditing] = useState(!status.set);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const confirm = useConfirm();
  const id = useId();

  useEffect(() => {
    if (!status.set) setEditing(true);
  }, [status.set]);

  const check = useMemo(() => (value.trim() ? validateSecret(name, value) : null), [name, value]);

  const save = (raw: string) => {
    const v = validateSecret(name, raw);
    if (!v.ok) return setError(v.error);
    setError(null);
    start(async () => {
      const r = await saveKey(name, raw);
      if (r.error) return setError(r.error);
      setValue("");
      setSaved(r.hint ?? "saved");
      setEditing(false);
      router.refresh();
    });
  };

  // Just saved: show the saved state straight away, before the page refresh lands.
  const shown = saved && saved !== "saved" ? saved : status.hint;
  if (!editing && (status.set || saved)) {
    return (
      <div>
        <div className="mb-1 text-[0.8rem] font-medium text-ink-2">{label}</div>
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-good/35 bg-good-bg/50 px-3 py-2">
          <span className="flex min-w-0 items-center gap-2 text-sm text-ink">
            <span className="grid size-5 shrink-0 place-items-center rounded-full bg-good text-white"><Check className="size-3" strokeWidth={3} /></span>
            <span className="min-w-0 truncate">
              {status.source === "env" && !saved ? "Set by whoever hosts the app" : "Saved"}
              {shown && <span className="text-muted"> · {sensitive ? `ends in ${shown.replace("…", "")}` : shown}</span>}
            </span>
          </span>
          <span className="flex shrink-0 gap-1">
            <Button size="sm" variant="ghost" onClick={() => { setEditing(true); setSaved(null); }}>Replace</Button>
            {(status.source === "app" || saved) && (
              <Button
                size="sm"
                variant="danger"
                disabled={pending}
                onClick={async () => {
                  const ok = await confirm({ title: `Remove the ${label.toLowerCase()}?`, body: "The features that need it turn off until you paste it again.", confirmLabel: "Remove", danger: true });
                  if (ok) start(async () => { const r = await removeKey(name); if (r.error) return setError(r.error); setSaved(null); setEditing(true); router.refresh(); });
                }}
              >
                Remove
              </Button>
            )}
          </span>
        </div>
        {status.source === "env" && !saved && <p className="mt-1 text-xs text-muted">Pasting one here replaces it for this app.</p>}
        {error && <p role="alert" className="mt-1.5 text-sm text-bad">{error}</p>}
      </div>
    );
  }

  const showError = error ?? (check && !check.ok ? check.error : null);
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[0.8rem] font-medium text-ink-2">{label}</label>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          save(value);
        }}
      >
        <Input
          id={id}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text");
            if (text && validateSecret(name, text).ok) {
              e.preventDefault();
              setValue(text.trim());
              save(text);
            }
          }}
          placeholder={placeholder}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={!!showError}
          aria-describedby={`${id}-msg`}
          className={cx("min-w-0 flex-1", sensitive && "font-mono", showError && "border-bad/60 focus:border-bad")}
          style={sensitive && value ? ({ WebkitTextSecurity: "disc" } as CSSProperties) : undefined}
        />
        <Button type="submit" variant="primary" disabled={pending || !check?.ok}>{pending ? "Saving…" : "Save"}</Button>
        {(status.set || saved) && <Button type="button" variant="ghost" onClick={() => { setEditing(false); setValue(""); setError(null); }}>Cancel</Button>}
      </form>
      <p id={`${id}-msg`} role={showError ? "alert" : undefined} className={cx("mt-1.5 text-sm", showError ? "text-bad" : check?.ok ? "text-good" : "text-muted")}>
        {showError ?? (check?.ok ? "Looks right. Press Save." : hint ?? "Paste it here — it saves by itself when it looks right.")}
      </p>
    </div>
  );
}

function TestButton({ run, last, label = "Test connection", disabled, disabledNote }: { run: () => Promise<TestResult>; last: TestResult | null; label?: string; disabled?: boolean; disabledNote?: string }) {
  const [result, setResult] = useState<TestResult | null>(last);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" disabled={pending || disabled} onClick={() => start(async () => { setResult(await run()); router.refresh(); })}>
          {pending ? "Testing…" : label}
        </Button>
        {disabled && disabledNote && <span className="text-sm text-muted">{disabledNote}</span>}
      </div>
      {result && (
        <div role="status" className={cx("flex gap-2.5 rounded-lg px-3 py-2.5 text-sm", result.ok ? "bg-good-bg text-good" : "bg-bad-bg text-bad")}>
          <span className={cx("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-white", result.ok ? "bg-good" : "bg-bad")}>
            {result.ok ? <Check className="size-3" strokeWidth={3} /> : <X className="size-3" strokeWidth={3} />}
          </span>
          <span className="min-w-0">
            {result.message}
            <span className="ml-1 opacity-70">· {relativeTime(new Date(result.at))}</span>
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Instant updates in one paste: the access token from Square's Credentials page
 * is used once to subscribe the app to Square's events, and isn't kept.
 */
export function InstantUpdates({ on, lastSeen, local }: { on: boolean; lastSeen: string | null; local?: boolean }) {
  const [editing, setEditing] = useState(!on);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const id = useId();
  const check = value.trim() ? checkAccessToken(value) : null;

  const submit = (raw: string) => {
    const t = checkAccessToken(raw);
    if (!t.ok) return setError(t.error);
    setError(null);
    start(async () => {
      const r = await turnOnInstantUpdates(raw);
      if (r.error) return setError(r.error);
      setValue("");
      setEditing(false);
      router.refresh();
    });
  };

  if (on && !editing) {
    return (
      <div className="space-y-3">
        <Note tone="good">
          {lastSeen ? `Instant updates are on — the last one arrived ${relativeTime(new Date(lastSeen))}.` : "Instant updates are on. The first one arrives with the next sale or clock-in."}
        </Note>
        <Button size="sm" variant="ghost" className="px-0 hover:bg-transparent" onClick={() => setEditing(true)}>Set them up again</Button>
      </div>
    );
  }

  const showError = error ?? (check && !check.ok ? check.error : null);
  return (
    <>
      <p>New sales and clock-ins show up within seconds instead of every 15 minutes. On Square&apos;s site press <b>Credentials</b>, press <b>Show</b> next to <b>Access token</b>, copy it and paste it here.</p>
      <More>The app uses the token once, to ask Square to send it each sale and clock-in, and then throws it away. Without instant updates everything still works — numbers refresh every 15 minutes while the app is open and catch up overnight.</More>
      <div>
        <label htmlFor={id} className="mb-1 block text-[0.8rem] font-medium text-ink-2">Access token</label>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); submit(value); }}>
          <Input
            id={id}
            value={value}
            onChange={(e) => { setValue(e.target.value); setError(null); }}
            onPaste={(e) => {
              const text = e.clipboardData.getData("text");
              if (text && checkAccessToken(text).ok) { e.preventDefault(); setValue(text.trim()); submit(text); }
            }}
            placeholder="EAAA…"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={!!showError}
            aria-describedby={`${id}-msg`}
            className={cx("min-w-0 flex-1 font-mono", showError && "border-bad/60 focus:border-bad")}
            style={value ? ({ WebkitTextSecurity: "disc" } as CSSProperties) : undefined}
            disabled={local}
          />
          <Button type="submit" variant="primary" disabled={pending || !check?.ok || local}>{pending ? "Turning on…" : "Turn on"}</Button>
          {on && <Button type="button" variant="ghost" onClick={() => { setEditing(false); setValue(""); setError(null); }}>Cancel</Button>}
        </form>
        <p id={`${id}-msg`} role={showError ? "alert" : undefined} className={cx("mt-1.5 text-sm", showError ? "text-bad" : "text-muted")}>
          {local ? "Only works on the live app." : showError ?? (pending ? "Setting it up with Square…" : "Starts with EAAA. It turns on by itself when you paste it.")}
        </p>
      </div>
    </>
  );
}

/** Extra detail, hidden until asked for — keeps each step to one instruction. */
function More({ children }: { children: ReactNode }) {
  return (
    <details className="group text-sm text-muted">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 select-none hover:text-ink [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 transition-transform duration-180 group-open:rotate-90" /> More detail
      </summary>
      <div className="mt-1.5 pl-[1.125rem] leading-relaxed">{children}</div>
    </details>
  );
}

// ---- Square ---------------------------------------------------------------------------

function SquareGuide({ d }: { d: ConnectionsData }) {
  const s = d.secrets;
  const part1 = s.SQUARE_APPLICATION_ID.set && s.SQUARE_APPLICATION_SECRET.set;
  const localWarn = d.local && (
    <Note tone="warn">
      You&apos;re using the app at <b>{d.origin}</b>. Square only accepts the live app&apos;s <b>https://</b> address, so do this step while signed in to the live app (the address you normally use on your phone).
    </Note>
  );
  const steps: Step[] = [
    {
      id: "square-open",
      part: "p1",
      title: "Open Square's site",
      done: part1,
      art: <Art.SquareSignIn />,
      body: (
        <>
          <p>Open Square&apos;s site for apps and sign in with any Square login. Then press the big <b>+</b>.</p>
          <Outbound href="https://developer.squareup.com/apps">Open Square&apos;s site</Outbound>
          <More>This is free and only done once. It doesn&apos;t have to be Max — anyone with a Square login can do it. If you already have an app there, press the <b>+</b> next to Applications instead.</More>
        </>
      ),
    },
    {
      id: "square-name",
      part: "p1",
      title: "Name it",
      done: part1,
      art: <Art.SquareName />,
      body: (
        <>
          <p>Name it <b>Subversive Ops</b> and press <b>Save</b>.</p>
          <CopyChip label="Name" value="Subversive Ops" />
          <More>Max sees this name when he connects later. If Square asks what you&apos;re building, any answer is fine.</More>
        </>
      ),
    },
    {
      id: "square-production",
      part: "p1",
      title: "Switch to Production",
      done: part1,
      art: <Art.SquareProduction />,
      body: (
        <>
          <p>At the top of the page, switch to <b>Production</b>.</p>
          <More><b>Sandbox</b> is Square&apos;s practice mode with fake data. Keep <b>Production</b> on for the next two steps — the codes are different in Sandbox.</More>
        </>
      ),
    },
    {
      id: "square-redirect",
      part: "p1",
      title: "Add the return address",
      done: part1,
      art: <Art.SquareRedirect />,
      body: (
        <>
          <p>Press <b>OAuth</b> on the left. Paste this address into <b>Redirect URL</b>, then press <b>Save</b>.</p>
          <CopyChip label="Address to paste" value={d.redirectUrl} />
          <More>This tells Square where to send Max back after he connects.</More>
          {localWarn}
        </>
      ),
    },
    {
      id: "square-codes",
      part: "p1",
      title: "Copy the two codes",
      done: part1,
      art: <Art.SquareCredentials />,
      body: (
        <>
          <p>Copy the <b>Application ID</b> from <b>Credentials</b>, and the <b>Application secret</b> from <b>OAuth</b> (press <b>Show</b> first). Paste both here — they save by themselves.</p>
          <More>Ignore the <b>Access token</b> on the Credentials page — the app doesn&apos;t need it. The secret lives on the OAuth page, the same page as the return address from the step before.</More>
          <SecretField name="SQUARE_APPLICATION_ID" status={s.SQUARE_APPLICATION_ID} label="Application ID" placeholder="sq0idp-…" hint="On the Credentials page. Starts with sq0idp-." sensitive={false} />
          <SecretField name="SQUARE_APPLICATION_SECRET" status={s.SQUARE_APPLICATION_SECRET} label="Application secret" placeholder="sq0csp-…" hint="On the OAuth page — press Show next to it. Starts with sq0csp-." />
          {part1 && <Note tone="good">Done — this never needs doing again. Next, Max connects.</Note>}
        </>
      ),
    },
    {
      id: "square-connect",
      part: "p2",
      title: "Sign in, press Allow",
      done: d.square.connected,
      art: <Art.SquareAllow />,
      body: d.square.connected ? (
        <>
          <Note tone="good">
            Connected to <b>{d.square.merchantName ?? "your Square account"}</b> · {d.square.locations} location{d.square.locations === 1 ? "" : "s"}
            {d.square.sandbox && " · test account"}.
          </Note>
          <TestButton run={testSquare} last={d.tests.square} />
          <div className="flex flex-wrap gap-2">
            <LinkButton href="/settings/square#import">Bring in sales history</LinkButton>
            <LinkButton href="/settings/square" variant="ghost">Choose locations</LinkButton>
          </div>
        </>
      ) : (
        <>
          <p>Max presses the button, signs in to Square, and presses <b>Allow</b>. That&apos;s it.</p>
          {part1 || d.square.oauthReady ? (
            <a href="/api/square/oauth/start?back=/settings/connections" className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg bg-primary px-5 text-[0.95rem] font-medium text-primary-ink transition-opacity hover:opacity-90">
              Connect with Square <ArrowRight className="size-4" />
            </a>
          ) : (
            <Note tone="warn">The button appears once the two codes from the step before are saved.</Note>
          )}
          <More>The app can only <i>read</i> from Square — it never changes anything there. Already have an access code from Square? You can paste it on the <Link href="/settings/square" className="text-ink underline underline-offset-2">Square page</Link> instead.</More>
        </>
      ),
    },
    {
      id: "square-instant",
      part: "p3",
      title: "Turn on instant updates",
      done: s.SQUARE_WEBHOOK_SIGNATURE_KEY.set,
      art: <Art.SquareCredentials />,
      body: <InstantUpdates on={s.SQUARE_WEBHOOK_SIGNATURE_KEY.set} lastSeen={d.square.webhookSeen} local={d.local} />,
    },
  ];
  return (
    <Stepper
      steps={steps}
      parts={[
        { id: "p1", title: "Register the app · one time, for whoever set up the app", note: "" },
        { id: "p2", title: "Max connects", note: "" },
        { id: "p3", title: "Instant updates · recommended", note: "" },
      ]}
    />
  );
}

// ---- Email ----------------------------------------------------------------------------

function EmailGuide({ d }: { d: ConnectionsData }) {
  const s = d.secrets;
  const [to, setTo] = useState(d.email.me ?? "");
  const ready = s.RESEND_API_KEY.set && s.EMAIL_FROM.set;
  const steps: Step[] = [
    {
      id: "email-account",
      title: "Create an account",
      done: s.RESEND_API_KEY.set,
      art: <Art.ResendSignup />,
      body: (
        <>
          <p>Sign up for a free <b>Resend</b> account, then confirm the email they send you.</p>
          <More>Resend is the service that sends the app&apos;s emails. It&apos;s free for up to 3,000 emails a month — far more than a restaurant needs.</More>
          <Outbound href="https://resend.com/signup">Open resend.com</Outbound>
        </>
      ),
    },
    {
      id: "email-domain",
      title: "Add your domain",
      done: s.RESEND_API_KEY.set && d.tests.email?.ok,
      art: <Art.ResendDomain />,
      body: (
        <>
          <p>Press <b>Domains</b> → <b>Add domain</b> and type your website address (like <i>yourrestaurant.com</i>).</p>
          <More>
            This is so emails come from <b>you</b> and don&apos;t land in spam. Resend then shows three short records: copy them into wherever your website address is managed (GoDaddy, Squarespace, Wix, Google — look for &ldquo;DNS&rdquo;). Whoever built your website can do it in two minutes. Back in Resend, press <b>Verify</b> — it usually turns <b>Verified</b> within an hour.
          </More>
          <More>No website address? Skip email — everything still works. Orders can be copied, downloaded or opened in your own mail app.</More>
        </>
      ),
    },
    {
      id: "email-key",
      title: "Copy the key here",
      done: s.RESEND_API_KEY.set,
      art: <Art.ResendKey />,
      body: (
        <>
          <p>Press <b>API Keys</b> → <b>Create API key</b>. Name it <i>Subversive Ops</i>, press <b>Add</b>, then <b>Copy</b> and paste it here.</p>
          <SecretField name="RESEND_API_KEY" status={s.RESEND_API_KEY} label="Email service key" placeholder="re_…" hint="Starts with re_." />
        </>
      ),
    },
    {
      id: "email-from",
      title: "Choose the sender",
      done: s.EMAIL_FROM.set,
      body: (
        <>
          <p>Type the name and address people will see, like <i>Subversive &lt;orders@yourrestaurant.com&gt;</i>.</p>
          <More>It must use the website address you verified. It doesn&apos;t need to be a real inbox — replies go to each manager&apos;s own email.</More>
          <SecretField name="EMAIL_FROM" status={s.EMAIL_FROM} label="Send emails from" placeholder={`${d.google.businessName} <orders@yourrestaurant.com>`} hint={<>For example <span className="font-mono text-[0.8rem]">{d.google.businessName} &lt;orders@yourrestaurant.com&gt;</span></>} sensitive={false} />
        </>
      ),
      art: (
        <div className="space-y-2 rounded-lg border border-border bg-surface p-4 text-sm">
          <div className="text-xs text-muted">How it looks in a supplier&apos;s inbox</div>
          <div className="flex items-center gap-2.5 border-t border-border pt-2">
            <span className="grid size-8 place-items-center rounded-full bg-area/15 text-sm font-semibold text-area">{d.google.businessName.slice(0, 1)}</span>
            <div className="min-w-0">
              <div className="truncate font-semibold">{s.EMAIL_FROM.hint?.replace(/\s*<.*$/, "") || d.google.businessName}</div>
              <div className="truncate text-muted">Order for Thursday · 14 items</div>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "email-test",
      title: "Send a test",
      done: !!d.tests.email?.ok,
      body: (
        <>
          <p>We&apos;ll send one short email so you can see it arrive.</p>
          <Field label="Send the test to">
            <Input type="email" inputMode="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="you@yourrestaurant.com" autoComplete="email" />
          </Field>
          <TestButton run={() => testEmail(to)} last={d.tests.email} label="Send test email" disabled={!ready} disabledNote="Finish steps 3 and 4 first." />
        </>
      ),
    },
  ];
  return <Stepper steps={steps} />;
}

// ---- Phone notifications ----------------------------------------------------------------

type Device = "ios" | "android" | "computer";

function PushGuide({ d, ready }: { d: ConnectionsData; ready: boolean }) {
  const [device, setDevice] = useState<Device>("ios");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  useEffect(() => {
    const ua = navigator.userAgent;
    const ipadOS = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
    setDevice(/iPhone|iPad|iPod/.test(ua) || ipadOS ? "ios" : /Android/.test(ua) ? "android" : "computer");
  }, []);

  const appStep: Step = {
    id: "push-app",
    title: "Turn it on for the app",
    done: ready,
    body: ready ? (
      <Note tone="good">Phone notifications are on for the app{d.push.devices ? ` · ${d.push.devices} device${d.push.devices === 1 ? "" : "s"} getting alerts` : ""}. Now turn them on for each phone.</Note>
    ) : (
      <>
        <p>One tap. The app makes its own secure keys — there&apos;s no outside account or bill.</p>
        <Button variant="primary" size="lg" disabled={pending} onClick={() => start(async () => { const r = await turnOnPush(); if (r.error) setError(r.error); router.refresh(); })}>
          {pending ? "Turning on…" : "Turn on phone notifications"}
        </Button>
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      </>
    ),
    art: (
      <div className="mx-auto max-w-xs space-y-2">
        {["New schedule is out — you work Fri, Sat", "Price spike: butter +18%", "Line asked to swap Saturday"].map((t, n) => (
          <div key={t} className="flex items-center gap-2.5 rounded-xl border border-border bg-surface px-3 py-2.5 shadow-sm" style={{ opacity: 1 - n * 0.18 }}>
            <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-ink text-xs font-bold text-surface">S</span>
            <div className="min-w-0 text-xs">
              <div className="font-semibold">Subversive</div>
              <div className="truncate text-muted">{t}</div>
            </div>
          </div>
        ))}
      </div>
    ),
  };

  const toggle = ready ? <PushToggle variant="inline" /> : <Note tone="warn">Do step 1 first.</Note>;
  const deviceSteps: Record<Device, Step[]> = {
    ios: [
      { id: "push-ios-share", title: "Open in Safari, tap Share", art: <Art.IosShare />, body: <p>On the iPhone, open the app in <b>Safari</b> (not Chrome) and sign in. Tap <b>Share</b> (1) — the square with an arrow pointing up, at the bottom of the screen.</p> },
      { id: "push-ios-add", title: "Add to Home Screen", art: <Art.IosAdd />, body: <p>Scroll down the list and tap <b>Add to Home Screen</b> (2), then <b>Add</b> in the top corner.</p> },
      { id: "push-ios-open", title: "Open it from the Home Screen", art: <Art.IosHome />, body: <p>Close Safari and tap the new <b>Subversive</b> icon (3). iPhones only allow notifications for apps opened this way.</p> },
      { id: "push-ios-allow", title: "Allow notifications", art: <Art.IosAllow />, body: <><p>In the app, come back to this page (or <b>My shifts</b> for staff), tap <b>Turn on notifications</b>, then <b>Allow</b> (4).</p>{toggle}</> },
    ],
    android: [
      { id: "push-android-menu", title: "Open in Chrome, tap ⋮", art: <Art.AndroidMenu />, body: <p>On the Android phone, open the app in <b>Chrome</b> and sign in. Tap the <b>⋮</b> menu (1) in the top corner.</p> },
      { id: "push-android-install", title: "Add to Home screen", art: <Art.AndroidInstall />, body: <p>Tap <b>Add to Home screen</b> (2) — on some phones it says <b>Install app</b> — then <b>Install</b>.</p> },
      { id: "push-android-allow", title: "Allow notifications", art: <Art.AndroidAllow />, body: <><p>Open <b>Subversive</b> from its new icon, come back to this page (or <b>My shifts</b> for staff), tap <b>Turn on notifications</b>, then <b>Allow</b> (3).</p>{toggle}</> },
    ],
    computer: [
      { id: "push-computer", title: "Allow notifications", art: <Art.DesktopAllow />, body: <><p>Press <b>Turn on notifications</b> (1), then <b>Allow</b> (2) in the box your browser shows near the address bar.</p>{toggle}<p className="text-xs text-muted">To set up a phone, open this page on the phone — the steps change to match it.</p></> },
    ],
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
        <span className="text-sm text-ink-2">Steps for</span>
        <Chips value={device} onChange={setDevice} ariaLabel="Which device" options={[{ value: "ios", label: "iPhone" }, { value: "android", label: "Android" }, { value: "computer", label: "Computer" }]} />
      </div>
      <Stepper key={device} steps={[appStep, ...deviceSteps[device]]} />
      <p className="border-t border-border px-5 py-3 text-xs text-muted">Each person turns notifications on for their own phone — staff do it from My shifts. Choose which alerts you get under <Link href="/settings/notifications" className="text-ink underline underline-offset-2">Notifications</Link>.</p>
    </>
  );
}

// ---- AI (Claude) ------------------------------------------------------------------------

function AIGuide({ d }: { d: ConnectionsData }) {
  const s = d.secrets;
  const steps: Step[] = [
    {
      id: "ai-account",
      title: "Create an account",
      done: s.ANTHROPIC_API_KEY.set,
      art: <Art.ClaudeSignup />,
      body: (
        <>
          <p>Open the Claude Console and sign up with Google or your email.</p>
          <More>AI features run on Claude, made by Anthropic. You pay only for what you use — usually a few dollars a month. This is separate from a Claude chat subscription.</More>
          <Outbound href="https://console.anthropic.com">Open the Claude Console</Outbound>
        </>
      ),
    },
    {
      id: "ai-billing",
      title: "Add a little credit",
      done: s.ANTHROPIC_API_KEY.set && d.tests.ai?.ok,
      art: <Art.ClaudeBilling />,
      body: (
        <>
          <p>Go to <b>Settings</b> → <b>Billing</b> → <b>Buy credits</b>. <b>$5</b> is plenty to start.</p>
          <More>You can turn off auto-reload and top up by hand — AI features simply pause if credit runs out.</More>
        </>
      ),
    },
    {
      id: "ai-key",
      title: "Copy the key here",
      done: s.ANTHROPIC_API_KEY.set,
      art: <Art.ClaudeKey />,
      body: (
        <>
          <p>Go to <b>API keys</b> → <b>Create key</b>. Name it <i>Subversive Ops</i>, then <b>Copy</b> and paste it here.</p>
          <SecretField name="ANTHROPIC_API_KEY" status={s.ANTHROPIC_API_KEY} label="Claude key" placeholder="sk-ant-…" hint="Starts with sk-ant-." />
        </>
      ),
    },
    {
      id: "ai-test",
      title: "Test it",
      done: !!d.tests.ai?.ok,
      body: (
        <>
          <p>A quick check that the key works. It costs nothing.</p>
          <TestButton run={testAI} last={d.tests.ai} disabled={!s.ANTHROPIC_API_KEY.set} disabledNote="Paste the key in step 3 first." />
          <div className="text-sm">
            <div className="mb-1 font-medium text-ink">What turns on</div>
            <ul className="list-disc space-y-1 pl-5 marker:text-muted">
              <li>Invoices: snap a photo and the lines fill themselves in.</li>
              <li>Reviews: themes, root causes and reply drafts in your tone.</li>
              <li>Ask: any question about your numbers, in plain English.</li>
              <li>Documents: scanned PDFs become searchable.</li>
            </ul>
          </div>
        </>
      ),
    },
  ];
  return <Stepper steps={steps} />;
}

// ---- Google ---------------------------------------------------------------------------

function GoogleGuide({ d }: { d: ConnectionsData }) {
  const s = d.secrets;
  const steps: Step[] = [
    {
      id: "google-project",
      title: "Create a project",
      done: s.GOOGLE_PLACES_API_KEY.set,
      art: <Art.GoogleProject />,
      body: (
        <>
          <p>Open Google Cloud, sign in with any Google account, and create a project called <i>Subversive Ops</i>.</p>
          <More>Google Cloud is how Google lets apps read your reviews. Use the project picker at the top → <b>New project</b> → <b>Create</b>.</More>
          <Outbound href="https://console.cloud.google.com/projectcreate">Open Google Cloud</Outbound>
        </>
      ),
    },
    {
      id: "google-enable",
      title: "Turn on Places",
      done: s.GOOGLE_PLACES_API_KEY.set && d.tests.google?.ok,
      art: <Art.GoogleEnable />,
      body: (
        <>
          <p>Search the top bar for <b>Places API (New)</b> (1), open it and press <b>Enable</b> (2).</p>
          <More>Google asks for a card the first time. Reading reviews once a day stays inside Google&apos;s free allowance, so it costs nothing in practice.</More>
          <Outbound href="https://console.cloud.google.com/apis/library/places.googleapis.com">Open Places API (New)</Outbound>
        </>
      ),
    },
    {
      id: "google-key",
      title: "Copy the key here",
      done: s.GOOGLE_PLACES_API_KEY.set,
      art: <Art.GoogleKey />,
      body: (
        <>
          <p>Go to <b>Credentials</b> → <b>Create credentials</b> → <b>API key</b>. Copy it and paste it here.</p>
          <SecretField name="GOOGLE_PLACES_API_KEY" status={s.GOOGLE_PLACES_API_KEY} label="Google key" placeholder="AIza…" hint="Starts with AIza, 39 characters." />
        </>
      ),
    },
    {
      id: "google-find",
      title: "Find your business",
      done: !!d.google.placeId,
      body: <FindBusiness d={d} />,
    },
  ];
  return <Stepper steps={steps} />;
}

function FindBusiness({ d }: { d: ConnectionsData }) {
  const [q, setQ] = useState(d.google.businessName);
  const [places, setPlaces] = useState<{ id: string; name: string; address: string; rating: number | null; reviews: number | null }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const ready = d.secrets.GOOGLE_PLACES_API_KEY.set;

  if (d.google.placeId && !places) {
    return (
      <>
        <Note tone="good">
          Linked to <b>{d.google.placeName ?? "your business"}</b>. New Google reviews come in every morning.
        </Note>
        <div className="flex flex-wrap gap-2">
          <LinkButton href="/reviews">See reviews</LinkButton>
          <Button variant="ghost" onClick={() => setPlaces([])}>Pick a different business</Button>
          <Button variant="danger" disabled={pending} onClick={() => start(async () => { await forgetBusiness(); router.refresh(); })}>Unlink</Button>
        </div>
      </>
    );
  }

  const search = () =>
    start(async () => {
      setError(null);
      const r = await findBusiness(q);
      if (r.error) {
        setError(r.error);
        setPlaces([]);
      } else setPlaces(r.places ?? []);
      router.refresh();
    });

  return (
    <>
      <p>Search for your restaurant the way you would on Google Maps — the name and town. Then tap the right one.</p>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); search(); }}>
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Business name and town" className="pl-9" aria-label="Business name and town" disabled={!ready} />
        </div>
        <Button type="submit" variant="primary" disabled={pending || !ready || q.trim().length < 3}>{pending ? "Searching…" : "Find"}</Button>
      </form>
      {!ready && <p className="text-sm text-muted">Paste the Google key in step 3 first.</p>}
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      {places && places.length > 0 && (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {places.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                disabled={pending}
                onClick={() => start(async () => { const r = await pickBusiness(p); if (r.error) setError(r.error); else { setPlaces(null); router.refresh(); } })}
                className="flex w-full items-center justify-between gap-3 bg-surface px-3 py-3 text-left transition-colors hover:bg-surface-2"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-ink">{p.name}</span>
                  <span className="block truncate text-xs text-muted">{p.address}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-muted">
                  {p.rating != null && <span className="num">★ {p.rating.toFixed(1)}{p.reviews != null && ` · ${p.reviews}`}</span>}
                  <span className="rounded-md border border-border-strong px-2 py-1 font-medium text-ink">This one</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted">The search doubles as the connection test: if Google answers, the key works.<HelpTip id="settings.connections.google" className="ml-1 align-middle" /></p>
    </>
  );
}
