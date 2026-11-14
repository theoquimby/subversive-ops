"use client";

/**
 * Building blocks for Settings pages: a row (label, what it changes, the
 * default, a control) and controls that save by themselves — on blur/Enter
 * for text, on change for switches and choices — and say "Saved" or a
 * plain-English error. No Save buttons.
 */

import { HelpTip, HelpZone } from "@/components/help";
import { Switch } from "@/components/push-toggle";
import { Select } from "@/components/select";
import { cn } from "@/lib/cn";
import { Check } from "lucide-react";
import Link from "next/link";
import { ReactNode, useEffect, useId, useRef, useState, useTransition } from "react";

export type SaveResult = void | undefined | { error?: string };
type Status = "idle" | "saving" | "saved" | "error";

/** A small "Saved ✓" / "Saving…" that fades back to nothing. */
export function SaveStatus({ status, error, id }: { status: Status; error?: string | null; id?: string }) {
  return (
    <span id={id} aria-live="polite" className={cn("text-xs", status === "error" ? "text-bad" : "text-muted")}>
      {status === "saving" && "Saving…"}
      {status === "saved" && <span className="inline-flex animate-fade-in items-center gap-1 text-good"><Check className="size-3.5" strokeWidth={2.5} />Saved</span>}
      {status === "error" && error}
    </span>
  );
}

function useSaver() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const run = (fn: () => Promise<SaveResult>, onError?: () => void) => {
    setStatus("saving");
    start(async () => {
      const r = await fn();
      if (timer.current) clearTimeout(timer.current);
      if (r && r.error) {
        setError(r.error);
        setStatus("error");
        onError?.();
      } else {
        setError(null);
        setStatus("saved");
        timer.current = setTimeout(() => setStatus("idle"), 1800);
      }
    });
  };
  return { status, error, run };
}

/**
 * One setting. On phones the control drops under the text; on wider screens it
 * sits on the right. `defaultNote` reads e.g. "Default 30%".
 */
export function SettingRow({ id, label, what, help, defaultNote, children, wide }: { id?: string; label: ReactNode; what?: ReactNode; help?: string; defaultNote?: ReactNode; children: ReactNode; wide?: boolean }) {
  const row = (
    <div id={id} className={cn("scroll-mt-24 gap-x-6 gap-y-2.5 px-4 py-4 sm:px-5", wide ? "grid" : "grid sm:grid-cols-[1fr_auto] sm:items-center")}>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-sm font-medium text-ink">{label}{help && <HelpTip id={help} />}</div>
        {what && <p className="mt-0.5 text-[0.8rem] text-muted">{what}</p>}
        {defaultNote && <p className="mt-0.5 text-xs text-muted/80">{defaultNote}</p>}
      </div>
      <div className={cn("min-w-0", !wide && "sm:justify-self-end")}>{children}</div>
    </div>
  );
  return help ? <HelpZone id={help}>{row}</HelpZone> : row;
}

/** A titled card of rows. */
export function SettingGroup({ id, title, description, children, actions }: { id?: string; title: ReactNode; description?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section id={id} className="mb-8 scroll-mt-24">
      <div className="mb-2.5 flex items-end justify-between gap-3 px-1">
        <div>
          <h2 className="text-[0.95rem] font-semibold text-ink">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
        </div>
        {actions}
      </div>
      <div className="divide-y divide-border rounded-xl border border-border bg-surface">{children}</div>
    </section>
  );
}

/** Text or number that saves on blur / Enter. A rejected value stays so it can be fixed (Esc puts back the saved one). */
/** Under a control: "Saved" floats without taking space; an error pushes content down so it's readable. */
function StatusLine({ id, status, error }: { id?: string; status: Status; error?: string | null }) {
  return (
    <div className={cn(status === "error" ? "mt-1" : "pointer-events-none absolute top-full right-0 mt-0.5 sm:left-0 sm:right-auto")}>
      <SaveStatus id={id} status={status} error={error} />
    </div>
  );
}

export function AutoInput({ value, onSave, ariaLabel, prefix, suffix, placeholder, numeric, className, inputClassName, maxLength, autoComplete, type = "text" }: {
  value: string;
  onSave: (v: string) => Promise<SaveResult>;
  ariaLabel: string;
  prefix?: string;
  suffix?: string;
  placeholder?: string;
  numeric?: boolean;
  className?: string;
  inputClassName?: string;
  maxLength?: number;
  autoComplete?: string;
  type?: "text" | "email" | "url" | "tel";
}) {
  const [v, setV] = useState(value);
  const saved = useRef(value);
  const focused = useRef(false);
  const { status, error, run } = useSaver();
  const errId = useId();
  useEffect(() => {
    if (!focused.current && status !== "error") {
      setV(value);
      saved.current = value;
    }
  }, [value, status]);
  const commit = () => {
    const next = v.trim();
    if (next === saved.current && status !== "error") return;
    const prev = saved.current;
    saved.current = next;
    run(() => onSave(next), () => { saved.current = prev; });
  };
  return (
    <div className={cn("relative min-w-0", className)}>
      <div className="relative">
        {prefix && <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted">{prefix}</span>}
        <input
          type={type}
          value={v}
          aria-label={ariaLabel}
          aria-invalid={status === "error" || undefined}
          aria-describedby={errId}
          placeholder={placeholder}
          maxLength={maxLength}
          autoComplete={autoComplete ?? "off"}
          inputMode={numeric ? "decimal" : type === "tel" ? "tel" : type === "email" ? "email" : undefined}
          enterKeyHint="done"
          onChange={(e) => setV(e.target.value)}
          onFocus={(e) => { focused.current = true; if (numeric) e.target.select(); }}
          onBlur={() => { focused.current = false; commit(); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(); (e.target as HTMLInputElement).blur(); }
            if (e.key === "Escape") { setV(saved.current); (e.target as HTMLInputElement).blur(); }
          }}
          className={cn(
            "h-10 w-full rounded-lg border border-border-strong bg-surface px-3 text-base text-ink transition-[border-color,box-shadow] duration-120 ease-motion placeholder:text-muted/70 hover:border-ink-2/40 focus:border-ink-2 focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--ink)_7%,transparent)] focus:outline-none sm:h-9 sm:text-sm",
            numeric && "num text-right",
            prefix && "pl-6",
            suffix && "pr-9",
            status === "error" && "border-bad hover:border-bad",
            inputClassName,
          )}
        />
        {suffix && <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted">{suffix}</span>}
      </div>
      <StatusLine id={errId} status={status} error={error} />
    </div>
  );
}

/** On/off that saves the moment it's flipped. */
export function AutoSwitch({ on, onSave, label, onText = "On", offText = "Off" }: { on: boolean; onSave: (on: boolean) => Promise<SaveResult>; label: string; onText?: string; offText?: string }) {
  const [v, setV] = useState(on);
  const { status, error, run } = useSaver();
  useEffect(() => setV(on), [on]);
  return (
    <div className="flex items-center gap-2">
      <SaveStatus status={status} error={error} />
      <span className={cn("text-sm", v ? "text-ink" : "text-muted")}>{v ? onText : offText}</span>
      <Switch on={v} label={label} disabled={status === "saving"} onChange={(next) => { setV(next); run(() => onSave(next), () => setV(!next)); }} />
    </div>
  );
}

/** A choice (our own select, never the browser's) that saves on change. */
/**
 * `confirm` runs before saving and outside the save's transition: React holds
 * back renders made inside a transition until it ends, so a dialog opened from
 * inside onSave would never appear (and the save would wait forever).
 */
export function AutoChoice({ value, options, onSave, confirm, ariaLabel, className }: { value: string; options: { value: string; label: string; hint?: string }[]; onSave: (v: string) => Promise<SaveResult>; confirm?: (v: string) => Promise<boolean>; ariaLabel: string; className?: string }) {
  const [v, setV] = useState(value);
  const { status, error, run } = useSaver();
  useEffect(() => setV(value), [value]);
  return (
    <div className={cn("relative min-w-0", className)}>
      <Select value={v} options={options} aria-label={ariaLabel} disabled={status === "saving"} onChange={async (e) => {
        const prev = v;
        const next = e.target.value;
        setV(next);
        if (confirm && !(await confirm(next))) return setV(prev);
        run(() => onSave(next), () => setV(prev));
      }} />
      <StatusLine status={status} error={error} />
    </div>
  );
}

/** A row that opens another page: "Positions & pay rates · 6 positions ›". */
export function LinkRow({ href, label, what, value, help }: { href: string; label: ReactNode; what?: ReactNode; value?: ReactNode; help?: string }) {
  const row = (
    <Link href={href} className="group flex items-center justify-between gap-4 px-4 py-4 transition-colors duration-120 hover:bg-surface-2/60 sm:px-5">
      <div className="min-w-0">
        <div className="text-sm font-medium text-ink">{label}</div>
        {what && <p className="mt-0.5 text-[0.8rem] text-muted">{what}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2 text-sm text-muted">
        {value != null && <span className="num hidden text-ink-2 sm:inline">{value}</span>}
        <span aria-hidden className="text-lg leading-none group-hover:text-ink">›</span>
      </div>
    </Link>
  );
  return help ? <HelpZone id={help}>{row}</HelpZone> : row;
}
