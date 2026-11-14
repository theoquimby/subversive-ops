"use client";

import { cx } from "@/components/ui";
import { countdownLabel, countdownTone } from "@/domain/orderingBoard";
import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";

/**
 * One shared clock for every countdown on the page (ticks every 30 s). Before the
 * first tick it reads the server's "now", so the first render matches the HTML.
 */
let nowMs = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();
const tick = () => { nowMs = Date.now(); listeners.forEach((l) => l()); };
function subscribe(cb: () => void) {
  listeners.add(cb);
  if (!timer) { timer = setInterval(tick, 30_000); queueMicrotask(tick); }
  return () => {
    listeners.delete(cb);
    if (!listeners.size && timer) { clearInterval(timer); timer = null; }
  };
}

const ServerNow = createContext(0);
export function NowProvider({ now, children }: { now: number; children: ReactNode }) {
  return <ServerNow.Provider value={now}>{children}</ServerNow.Provider>;
}

export function useNow() {
  const server = useContext(ServerNow);
  return useSyncExternalStore(subscribe, () => nowMs || server, () => server);
}

/** "3h 20m" — red under 6 hours, amber under a day. */
export function Countdown({ at, className, quiet }: { at: number | null; className?: string; quiet?: boolean }) {
  const now = useNow();
  if (at == null) return null;
  const left = at - now;
  const tone = left <= 0 ? "neutral" : countdownTone(left);
  return (
    <span
      className={cx(
        "num inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap",
        tone === "bad" ? "bg-bad-bg text-bad" : tone === "warn" ? "bg-warn-bg text-warn" : quiet ? "text-muted" : "bg-surface-2 text-ink-2",
        className,
      )}
      title={left > 0 ? `${countdownLabel(left)} left to order` : "Deadline passed"}
    >
      {left > 0 ? `${countdownLabel(left)} left` : "passed"}
    </span>
  );
}
