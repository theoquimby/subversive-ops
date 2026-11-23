"use client";

import { shiftCountdown } from "@/domain/staffHome";
import { cn } from "@/lib/cn";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * The live "starts in 2h 15m" on the next-shift card. Starts from the
 * server's clock (so the first paint matches) and ticks every 20 seconds.
 * When the shift ends it refreshes the page so the next one moves up.
 */
export function ShiftCountdown({ startAt, endAt, serverNow, className }: { startAt: number; endAt: number; serverNow: number; className?: string }) {
  const [now, setNow] = useState(serverNow);
  const router = useRouter();
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 20_000);
    const onVisible = () => document.visibilityState === "visible" && setNow(Date.now());
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVisible); };
  }, []);
  const c = shiftCountdown(now, startAt, endAt);
  useEffect(() => {
    if (c.state === "over") router.refresh();
  }, [c.state, router]);
  const pct = c.state === "now" ? Math.min(100, Math.max(0, ((now - startAt) / (endAt - startAt)) * 100)) : 0;
  return (
    <div className={cn("text-right", className)}>
      <div className={cn("num flex items-center justify-end gap-2 text-[1.6rem] leading-none font-semibold tracking-tight", c.state === "soon" && "text-warn")}>
        {c.state === "now" && <span className="relative flex size-2.5" aria-hidden><span className="absolute inset-0 animate-ping rounded-full bg-good opacity-60 motion-reduce:animate-none" /><span className="relative size-2.5 rounded-full bg-good" /></span>}
        {c.big}
      </div>
      <div className="mt-1 text-xs opacity-70">{c.small}</div>
      {c.state === "now" && (
        <div className="mt-2 ml-auto h-1 w-24 overflow-hidden rounded-full bg-current/15" role="progressbar" aria-label="Shift progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
          <div className="h-full rounded-full bg-good transition-[width] duration-700" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}
