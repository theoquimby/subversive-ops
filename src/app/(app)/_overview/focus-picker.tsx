"use client";

import { Check, Compass, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, Card, cx } from "@/components/ui";
import { FOCUS_IDS, FOCUS_INFO, type Focus } from "@/domain/focus";
import { notNowFocus, saveFocusFor, saveMyFocus } from "./focus-actions";

const toggle = (list: Focus[], f: Focus) => (list.includes(f) ? list.filter((x) => x !== f) : [...list, f]);

/**
 * "What I look after": the six areas with a line each. Tapping one saves
 * straight away; the order you pick them in is the order the Overview and
 * the briefs lead with. Your own (no `userId`) or, for managers on Team,
 * someone else's.
 */
export function FocusPicker({ initial, userId, name }: { initial: Focus[]; userId?: string; name?: string }) {
  const [focus, setFocus] = useState<Focus[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const pick = (f: Focus) => {
    const next = toggle(focus, f);
    setFocus(next);
    setError(null);
    start(async () => {
      const r = userId ? await saveFocusFor(userId, next) : await saveMyFocus(next);
      if (r.error) {
        setError(r.error);
        setFocus(focus);
      }
    });
  };
  const who = name ? name.split(" ")[0] : null;
  return (
    <div>
      <div className="grid gap-2 sm:grid-cols-2">
        {FOCUS_IDS.map((f) => {
          const at = focus.indexOf(f);
          const on = at >= 0;
          return (
            <button
              key={f}
              type="button"
              aria-pressed={on}
              onClick={() => pick(f)}
              className={cx(
                "flex min-h-14 items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors duration-120",
                on ? "border-ink bg-surface" : "border-border bg-surface hover:border-border-strong",
              )}
            >
              <span aria-hidden className={cx("num mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold", on ? "bg-ink text-bg" : "border border-border-strong text-transparent")}>
                {on ? at + 1 : ""}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink">{FOCUS_INFO[f].label}</span>
                <span className="block text-xs text-muted">{FOCUS_INFO[f].description}</span>
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-muted" aria-live="polite">
        {error ? (
          <span className="text-bad">{error}</span>
        ) : focus.length === 0 ? (
          `Nothing picked, so the Overview and the briefs show everything${who ? ` for ${who}` : ""}.`
        ) : (
          <>
            {pending ? "Saving… " : ""}The Overview and the briefs lead with {focus.map((f) => FOCUS_INFO[f].label).join(", then ")}. The rest sits under Elsewhere, and anything urgent always shows.
          </>
        )}
      </p>
    </div>
  );
}

/** The Overview's one-time nudge for a manager with nothing picked. */
export function FocusPrompt() {
  const router = useRouter();
  const [focus, setFocus] = useState<Focus[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      const r = await saveMyFocus(focus);
      if (r.error) setError(r.error);
      else router.refresh();
    });
  const notNow = () =>
    start(async () => {
      await notNowFocus();
      router.refresh();
    });
  return (
    <Card className="mb-6 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-ink-2"><Compass className="size-4" strokeWidth={1.75} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-sm font-medium text-ink">Pick what you look after so Overview leads with it</div>
              <p className="mt-0.5 text-xs text-muted">The morning and weekly briefs follow it too. Everything else stays one tap away, and urgent things always show.</p>
            </div>
            <button type="button" onClick={notNow} disabled={pending} aria-label="Not now" className="-mt-1 -mr-1 grid size-10 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink sm:size-8">
              <X className="size-4" />
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {FOCUS_IDS.map((f) => {
              const on = focus.includes(f);
              return (
                <button
                  key={f}
                  type="button"
                  aria-pressed={on}
                  title={FOCUS_INFO[f].description}
                  onClick={() => setFocus(toggle(focus, f))}
                  className={cx(
                    "inline-flex h-10 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors duration-120 sm:h-8",
                    on ? "border-ink bg-ink text-bg" : "border-border bg-surface text-ink-2 hover:border-border-strong hover:text-ink",
                  )}
                >
                  {on && <Check aria-hidden className="size-3.5" />}
                  {FOCUS_INFO[f].label}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="primary" size="sm" className="h-10 sm:h-8" disabled={pending || focus.length === 0} onClick={save}>{pending ? "Saving…" : "Use these"}</Button>
            <Button variant="ghost" size="sm" className="h-10 sm:h-8" disabled={pending} onClick={notNow}>Not now</Button>
            {error && <span className="text-xs text-bad">{error}</span>}
          </div>
        </div>
      </div>
    </Card>
  );
}
