"use client";

import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { Button, cx } from "@/components/ui";
import { RANGE_PRESETS, type RangePreset } from "@/domain/lab";
import { refreshInsights, setRange } from "./actions";

/**
 * How much history every model learns from. Changing it saves the setting and
 * works everything out again (a few seconds); the page refreshes on its own.
 */
export function RangeControl({ preset, span }: { preset: RangePreset; span: string | null }) {
  const [value, setValue] = useState(preset);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const pick = (p: RangePreset) => {
    if (p === value || pending) return;
    setValue(p);
    setMsg(null);
    start(async () => {
      const r = await setRange(p);
      setMsg(r.error ?? null);
    });
  };
  return (
    <div className="flex w-full flex-col gap-1.5 sm:w-auto sm:items-end" data-tour="insights.range">
      <div className="flex items-center gap-2 text-xs text-muted">
        <span>Learning from</span>
        <span className="font-medium text-ink-2">{pending ? "working it out…" : span ?? RANGE_PRESETS.find((r) => r.id === value)?.label}</span>
      </div>
      <div role="radiogroup" aria-label="How much history to learn from" className="grid w-full grid-cols-5 gap-0.5 rounded-lg border border-border-strong bg-surface p-0.5 sm:inline-flex sm:w-auto">
        {RANGE_PRESETS.map((r) => (
          <button
            key={r.id}
            type="button"
            role="radio"
            aria-checked={value === r.id}
            aria-label={r.label}
            disabled={pending}
            onClick={() => pick(r.id)}
            className={cx("h-10 rounded-md px-2.5 text-sm whitespace-nowrap transition-colors sm:h-8", value === r.id ? "bg-primary text-primary-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink", pending && value === r.id && "animate-pulse")}
          >
            {r.short}
          </button>
        ))}
      </div>
      {msg && <span className="text-xs text-warn" aria-live="polite">{msg}</span>}
    </div>
  );
}

export function RefreshLink() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        className="h-10 sm:h-8"
        onClick={() =>
          start(async () => {
            const r = await refreshInsights();
            setMsg(r.error ?? `Updated in ${r.seconds}s`);
          })
        }
      >
        <RefreshCw className={cx("size-3.5", pending && "animate-spin")} strokeWidth={1.75} />
        {pending ? "Working it out…" : "Work it out again"}
      </Button>
      {msg && <span className="text-xs text-muted" aria-live="polite">{msg}</span>}
    </span>
  );
}
