"use client";

import { useConfirm } from "@/components/dialog";
import { HelpTip, HelpZone } from "@/components/help";
import { useReducedMotion } from "@/components/motion";
import { PushToggle } from "@/components/push-toggle";
import { Badge, Button, Card, cx, Field, Input, LinkButton, type Tone } from "@/components/ui";
import { validateSecret, type SecretName } from "@/domain/secretFormats";
import type { SecretStatus } from "@/domain/secrets";
import { areaStyle, type Area } from "@/lib/areas";
import { relativeTime } from "@/lib/format";
import { ArrowLeft, ArrowRight, BellRing, Check, ChevronRight, Copy, ExternalLink, Mail, Search, Sparkles, Star, Store, X, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, useTransition, type CSSProperties, type ReactNode } from "react";
import { Chips } from "../square/square-client";
import { findBusiness, forgetBusiness, pickBusiness, removeKey, saveKey, testAI, testEmail, testSquare, turnOnPush, type ServiceId, type TestResult } from "./actions";
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

export const SQUARE_EVENTS = [
  "order.created",
  "order.updated",
  "payment.created",
  "payment.updated",
  "refund.created",
  "refund.updated",
  "labor.timecard.created",
  "labor.timecard.updated",
  "labor.timecard.deleted",
  "catalog.version.updated",
];

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
  const panel = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const pushReady = data.secrets.VAPID_PUBLIC_KEY.set && data.secrets.VAPID_PRIVATE_KEY.set;

  const choose = (id: ServiceId | null) => {
    setOpen(id);
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
            <ServiceTile meta={s} status={statusOf(s.id, data, pushReady)} selected={open === s.id} onOpen={() => choose(open === s.id ? null : s.id)} />
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
                      <h2 className="text-base font-semibold">{meta.guide}</h2>
                      <StatusPill status={statusOf(meta.id, data, pushReady)} />
                    </div>
                    <p className="mt-0.5 text-sm text-muted">{meta.turnsOn}</p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" className="size-10 shrink-0 p-0 sm:size-8" aria-label="Close the guide" onClick={() => choose(null)}>
                  <X className="size-4" />
                </Button>
              </div>
              {meta.id === "square" && <SquareGuide d={data} />}
              {meta.id === "email" && <EmailGuide d={data} />}
              {meta.id === "push" && <PushGuide d={data} ready={pushReady} />}
              {meta.id === "ai" && <AIGuide d={data} />}
              {meta.id === "google" && <GoogleGuide d={data} />}
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

function ServiceTile({ meta, status, selected, onOpen }: { meta: ServiceMeta; status: Status; selected: boolean; onOpen: () => void }) {
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
        <Button variant={done || selected ? "secondary" : "primary"} onClick={onOpen} aria-expanded={selected}>
          {selected ? "Close" : { good: "Manage", warn: "Continue", bad: "Fix", neutral: "Set up" }[status.tone]}
          {!selected && <ChevronRight className="size-4" />}
        </Button>
      </div>
    </Card>
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
    const r = top.current?.getBoundingClientRect();
    if (r && r.top < 64) top.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  };
  const groups = parts ?? [{ id: "", title: "", note: "" }];
  const part = parts?.find((p) => p.id === step.part);

  return (
    <div ref={top} className="scroll-mt-20">
      {/* Step list: grouped by part, each a numbered chip. */}
      <nav aria-label="Steps" className="border-b border-border bg-surface-2/50 px-5 py-4">
        <div className={cx("grid gap-4", parts && parts.length > 1 && "lg:grid-cols-[auto_auto_auto] lg:justify-start lg:gap-8")}>
          {groups.map((g) => {
            const items = steps.map((s, n) => ({ s, n })).filter(({ s }) => !parts || s.part === g.id);
            if (!items.length) return null;
            return (
              <div key={g.id} className="min-w-0">
                {g.title && (
                  <div className="mb-2 flex flex-wrap items-baseline gap-x-2 text-xs">
                    <span className="font-semibold text-ink">{g.title}</span>
                    <span className="text-muted">{g.note}</span>
                  </div>
                )}
                <ol className="-mx-5 flex gap-1.5 overflow-x-auto px-5 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
                  {items.map(({ s, n }) => (
                    <li key={s.id} className="shrink-0">
                      <button
                        ref={n === i ? centerInRow : undefined}
                        type="button"
                        onClick={() => go(n)}
                        aria-current={n === i ? "step" : undefined}
                        title={s.title}
                        className={cx(
                          "inline-flex h-10 items-center gap-1.5 rounded-full border pr-3 pl-1.5 text-sm transition-colors sm:h-8",
                          n === i ? "border-ink bg-ink text-surface" : "border-border-strong bg-surface text-ink-2 hover:bg-surface-2 hover:text-ink",
                        )}
                      >
                        <span className={cx("grid size-6 place-items-center rounded-full text-xs font-semibold sm:size-5", n === i ? "bg-surface/15" : s.done ? "bg-good-bg text-good" : "bg-surface-2")}>
                          {s.done ? <Check className="size-3.5" strokeWidth={3} /> : n + 1}
                        </span>
                        <span className="max-w-[11rem] truncate">{s.title}</span>
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            );
          })}
        </div>
      </nav>

      <div key={step.id} id={step.id} className="grid animate-fade-in gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-8">
        <div className="min-w-0">
          {part && (
            <div className="mb-1 text-xs font-medium text-muted">
              {part.title}
              {part.optional && " · optional"}
            </div>
          )}
          <h3 className="flex items-center gap-2 text-[1.05rem] font-semibold">
            <span className="text-muted">Step {i + 1}.</span> {step.title}
            {step.done && <Badge tone="good">Done</Badge>}
          </h3>
          <div className="mt-3 space-y-4 text-sm leading-relaxed text-ink-2">{step.body}</div>
        </div>
        {step.art && <div className="min-w-0 self-start rounded-xl bg-surface-2/60 p-3 sm:p-4">{step.art}</div>}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-4">
        <Button variant="ghost" disabled={i === 0} onClick={() => go(i - 1)}>
          <ArrowLeft className="size-4" /> Back
        </Button>
        {i < steps.length - 1 ? (
          <Button variant={step.done || !step.optional ? "primary" : "secondary"} onClick={() => go(i + 1)} className="min-w-0">
            <span className="truncate">Next: {steps[i + 1].title}</span> <ArrowRight className="size-4 shrink-0" />
          </Button>
        ) : (
          <span className="text-sm text-muted">{steps.every((s) => s.done || s.optional) ? "All done." : "That's the last step."}</span>
        )}
      </div>
    </div>
  );
}

/** Keep the current step's chip visible in the sideways-scrolling row on phones (never scrolls the page). */
function centerInRow(el: HTMLButtonElement | null) {
  const row = el?.closest("ol");
  if (!el || !row || row.scrollWidth <= row.clientWidth) return;
  const r = el.getBoundingClientRect();
  const o = row.getBoundingClientRect();
  row.scrollLeft += r.left - o.left - (o.width - r.width) / 2;
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

const Ol = ({ children }: { children: ReactNode }) => <ol className="list-decimal space-y-1.5 pl-5 marker:text-muted">{children}</ol>;

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
          <p>Square calls apps like this one &ldquo;applications&rdquo;. Registering one is free and takes a few minutes — anyone with a Square login can do it, not just Max.</p>
          <Ol>
            <li>Open Square&apos;s developer site and press <b>Sign in</b> (1). Use your normal Square login.</li>
            <li>Press the big <b>+</b> tile (2), &ldquo;Create your first application&rdquo;. If you already have one, press <b>+</b> next to Applications.</li>
          </Ol>
          <Outbound href="https://developer.squareup.com/apps">Open developer.squareup.com</Outbound>
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
          <p>Type a name (1) — this is what Max sees when he approves it later — then press <b>Save</b> (2). If Square asks what you&apos;re building, any answer is fine.</p>
          <CopyChip label="Name to type" value="Subversive Ops" />
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
          <p>At the top of your new app&apos;s page there&apos;s a switch between <b>Sandbox</b> (Square&apos;s practice mode with fake data) and <b>Production</b> (your real restaurant). Pick <b>Production</b> (1).</p>
          <Note>Everything in the next two steps must be done with Production selected — the codes are different in Sandbox.</Note>
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
          <p>This tells Square where to send Max back after he presses Allow.</p>
          <Ol>
            <li>In the left menu, press <b>OAuth</b> (1).</li>
            <li>Copy the address below and paste it into <b>Redirect URL</b> (2).</li>
            <li>Press <b>Save</b> (3).</li>
          </Ol>
          <CopyChip label="Return address (Redirect URL)" value={d.redirectUrl} />
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
          <p>In the left menu press <b>Credentials</b> (1), with <b>Production</b> still selected. Copy each code and paste it below — each one checks itself and saves.</p>
          <SecretField name="SQUARE_APPLICATION_ID" status={s.SQUARE_APPLICATION_ID} label="Application ID" placeholder="sq0idp-…" hint="At the top of the Credentials page (2). Starts with sq0idp-." sensitive={false} />
          <SecretField name="SQUARE_APPLICATION_SECRET" status={s.SQUARE_APPLICATION_SECRET} label="Application secret" placeholder="sq0csp-…" hint="Press Show next to it first (3). Starts with sq0csp-. Treat it like a password." />
          {part1 && <Note tone="good">Part 1 is done — it never needs doing again. Next, Max connects his Square.</Note>}
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
          <p>This part is for whoever owns the restaurant&apos;s Square account. It takes a minute:</p>
          <Ol>
            <li>Press <b>Connect with Square</b> below.</li>
            <li>Sign in with the restaurant&apos;s Square login (1).</li>
            <li>Press <b>Allow</b> (2). The app can only <i>read</i> — it never changes anything in Square.</li>
          </Ol>
          {part1 || d.square.oauthReady ? (
            <a href="/api/square/oauth/start?back=/settings/connections" className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg bg-primary px-5 text-[0.95rem] font-medium text-primary-ink transition-opacity hover:opacity-90">
              Connect with Square <ArrowRight className="size-4" />
            </a>
          ) : (
            <Note tone="warn">Finish Part 1 first — the Connect button appears once both codes are saved.</Note>
          )}
          <p className="text-xs text-muted">Already have an access code from Square? You can paste it on the <Link href="/settings/square" className="text-ink underline underline-offset-2">Square page</Link> instead.</p>
        </>
      ),
    },
    {
      id: "square-instant",
      part: "p3",
      optional: true,
      title: "Add instant updates",
      done: s.SQUARE_WEBHOOK_SIGNATURE_KEY.set,
      art: <Art.SquareWebhook />,
      body: (
        <>
          <p>Without this, today&apos;s numbers refresh every 15 minutes while someone has the app open, and everything catches up overnight. With it, Square tells the app about each sale and clock-in within seconds.</p>
          <Ol>
            <li>Back on Square&apos;s developer site, with <b>Production</b> selected, press <b>Webhooks</b> → <b>Subscriptions</b> (1) → <b>Add subscription</b>.</li>
            <li>Paste the address below into <b>Notification URL</b> (2), and pick the API version shown.</li>
            <li>Tick the events listed below (3) — you can search for each one.</li>
            <li>Press <b>Save</b> (4).</li>
          </Ol>
          <CopyChip label="Notification URL" value={d.webhookUrl} />
          <div className="grid gap-3 sm:grid-cols-[11rem_1fr]">
            <CopyChip label="API version" value={d.squareVersion} />
            <CopyChip label="Name" value="Subversive Ops" />
          </div>
          <CopyChip label="Events to tick (10)" value={SQUARE_EVENTS.join("\n")} block />
          {localWarn}
        </>
      ),
    },
    {
      id: "square-signature",
      part: "p3",
      optional: true,
      title: "Copy the signature key",
      done: s.SQUARE_WEBHOOK_SIGNATURE_KEY.set,
      art: <Art.SquareSignatureKey />,
      body: (
        <>
          <p>Open the subscription you just saved and press <b>Show</b> next to <b>Signature key</b> (1). Paste it here — the app uses it to check each update really came from Square.</p>
          <SecretField name="SQUARE_WEBHOOK_SIGNATURE_KEY" status={s.SQUARE_WEBHOOK_SIGNATURE_KEY} label="Signature key" placeholder="Paste the signature key" hint="About 22 letters and numbers." />
          {s.SQUARE_WEBHOOK_SIGNATURE_KEY.set && (
            <Note tone={d.square.webhookSeen ? "good" : "neutral"}>
              {d.square.webhookSeen ? `Working — the last instant update arrived ${relativeTime(new Date(d.square.webhookSeen))}.` : "Saved. The first instant update arrives with your next sale or clock-in. On Square's page you can also press Send test event."}
            </Note>
          )}
        </>
      ),
    },
  ];
  return (
    <Stepper
      steps={steps}
      parts={[
        { id: "p1", title: "Part 1 — Register the app", note: "one time · anyone with a Square login · ~5 min" },
        { id: "p2", title: "Part 2 — Connect", note: "Max · 1 minute" },
        { id: "p3", title: "Instant updates", note: "optional · ~3 min", optional: true },
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
          <p>The app sends email through <b>Resend</b>, a sending service. It&apos;s free for up to 3,000 emails a month — far more than a restaurant needs.</p>
          <p>Sign up with your email and a password (1), then confirm the email Resend sends you.</p>
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
          <p>So suppliers see emails from <b>you</b> (and they don&apos;t land in spam), Resend checks you own your website&apos;s address — the part after the @ in your work email, like <i>yourrestaurant.com</i>.</p>
          <Ol>
            <li>Press <b>Domains</b> (1) → <b>Add domain</b> (2) and type your domain.</li>
            <li>Resend shows three short records (3). Copy each one into wherever your domain is managed — GoDaddy, Squarespace, Wix, Google… (look for &ldquo;DNS&rdquo; settings). Whoever built your website can do this in two minutes.</li>
            <li>Back in Resend, press <b>Verify</b>. It turns from Pending to <b>Verified</b> (4), usually within an hour.</li>
          </Ol>
          <Note>No website domain? Email stays off and everything still works — orders can be copied, downloaded or opened in your own mail app.</Note>
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
          <Ol>
            <li>Press <b>API Keys</b> (1) → <b>Create API key</b> (2).</li>
            <li>Name it <i>Subversive Ops</i>, choose <b>Sending access</b>, press <b>Add</b>.</li>
            <li>Press <b>Copy</b> (3) — the key is only shown once — and paste it below.</li>
          </Ol>
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
          <p>The name and address suppliers and staff see. It must be at the domain you verified. It doesn&apos;t need to be a real inbox — replies go to each manager&apos;s own email.</p>
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
          <p>AI features run on <b>Claude</b>, made by Anthropic. You pay only for what you use — typically a few dollars a month for a restaurant.</p>
          <p>Open the Claude Console and sign up (1) with Google or your email. This is separate from a Claude chat subscription.</p>
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
          <Ol>
            <li>Open <b>Settings</b> → <b>Billing</b> (1).</li>
            <li>Press <b>Buy credits</b> (2), add a card and choose an amount (3). <b>$5</b> is plenty to start.</li>
          </Ol>
          <Note>Tip: turn off auto-reload if you&apos;d rather top up by hand — features simply pause if credit runs out.</Note>
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
          <Ol>
            <li>Open <b>API keys</b> (1) → <b>Create key</b> (2).</li>
            <li>Name it <i>Subversive Ops</i>, press <b>Add</b>, then <b>Copy</b> (3) — it&apos;s only shown once.</li>
          </Ol>
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
          <p>Google lets apps read reviews through <b>Google Cloud</b>. Sign in with any Google account.</p>
          <Ol>
            <li>Open the project picker at the top (1).</li>
            <li>Press <b>New project</b> (2), name it <i>Subversive Ops</i>, press <b>Create</b> (3).</li>
          </Ol>
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
          <Note>Google asks for a billing card the first time. Reading reviews once a day costs nothing in practice — it&apos;s well inside Google&apos;s free monthly allowance.</Note>
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
          <Ol>
            <li>In the left menu open <b>Credentials</b> (1).</li>
            <li>Press <b>Create credentials</b> → <b>API key</b> (2).</li>
            <li>Copy the key (3) and paste it below.</li>
          </Ol>
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
