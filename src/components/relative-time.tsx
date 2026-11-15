"use client";

import { useSyncExternalStore } from "react";
import { businessDateTime, relativeTime } from "@/lib/format";

/**
 * "5 min ago" in a client component without a hydration mismatch. The server
 * (and the first client render while hydrating) shows the business-local date
 * and time, which is the same string everywhere; once mounted it switches to the
 * relative wording against the phone's clock and keeps it fresh every minute.
 * Server components can keep calling relativeTime() directly.
 */
const minute = () => Math.floor(Date.now() / 60_000);
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
function subscribe(cb: () => void) {
  listeners.add(cb);
  if (!timer) timer = setInterval(() => listeners.forEach((l) => l()), 30_000);
  return () => {
    listeners.delete(cb);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** The current minute on the client, null while rendering on the server or hydrating. */
export function useClientMinute(): number | null {
  return useSyncExternalStore(subscribe, minute, () => null);
}

export function RelativeTime({ at, className }: { at: string | Date | null | undefined; className?: string }) {
  const now = useClientMinute();
  if (!at) return null;
  const d = new Date(at);
  if (!Number.isFinite(d.getTime())) return null;
  const abs = businessDateTime(d);
  return (
    <time dateTime={d.toISOString()} title={abs} className={className}>
      {now == null ? abs : relativeTime(d)}
    </time>
  );
}

/** Text form for places that need a string: the absolute time until mounted, then "5 min ago". */
export function useRelativeTime(at: string | Date | null | undefined): string {
  const now = useClientMinute();
  if (!at) return "";
  const d = new Date(at);
  if (!Number.isFinite(d.getTime())) return "";
  return now == null ? businessDateTime(d) : relativeTime(d);
}
