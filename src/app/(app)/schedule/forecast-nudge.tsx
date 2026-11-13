"use client";

import { Button, Input } from "@/components/ui";
import { money, shortDate } from "@/lib/format";
import { SlidersHorizontal, Sparkles } from "lucide-react";
import { useState, useTransition } from "react";
import { nudgeForecast } from "./actions";

export interface Nudge {
  /** Manual multiplier, e.g. 1.15; null = none. */
  multiplier: number | null;
  reason: string | null;
}

const toPct = (m: number | null) => (m == null ? "" : `${m >= 1 ? "+" : ""}${Math.round((m - 1) * 100)}`);

/** Forecast for the selected day with a quick manual nudge, then regenerate the draft. */
export function ForecastNudge({ date, sales, nudge, past, onRegenerate }: { date: string; sales: number; nudge?: Nudge; past: boolean; onRegenerate: () => void }) {
  const [open, setOpen] = useState(false);
  const [pct, setPct] = useState(toPct(nudge?.multiplier ?? null));
  const [reason, setReason] = useState(nudge?.reason ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const save = (p: string, r: string) =>
    start(async () => {
      const res = await nudgeForecast({ date, pct: p, reason: r });
      if (res.error) setError(res.error);
      else { setError(null); setSaved(true); setOpen(false); }
    });
  return (
    <div className="mb-3 rounded-lg bg-surface-2/70 px-3 py-2.5 text-sm" data-tour="schedule.nudge">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span>
          <span className="text-muted">{shortDate(date)} forecast </span>
          <span className="num font-medium">{money(sales, { whole: true })}</span>
          {nudge?.multiplier != null && <span className="text-muted"> · adjusted {toPct(nudge.multiplier)}%{nudge.reason ? ` (${nudge.reason})` : ""}</span>}
        </span>
        {!past && !open && (
          <Button size="sm" variant="ghost" className="max-sm:h-10" onClick={() => { setOpen(true); setSaved(false); }}>
            <SlidersHorizontal className="size-3.5" /> Adjust
          </Button>
        )}
        {saved && !open && (
          <Button size="sm" className="max-sm:h-10" onClick={onRegenerate}>
            <Sparkles className="size-3.5" /> Regenerate draft
          </Button>
        )}
      </div>
      {open && (
        <form className="mt-2 grid grid-cols-[6rem_1fr] gap-2 sm:grid-cols-[6rem_1fr_auto_auto]" onSubmit={(e) => { e.preventDefault(); save(pct, reason); }}>
          <Input value={pct} onChange={(e) => setPct(e.target.value)} placeholder="+15" inputMode="text" aria-label="Change in percent" className="num text-right" autoFocus />
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why — e.g. festival, private party" aria-label="Reason" maxLength={200} />
          <Button variant="primary" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
          <Button type="button" variant="ghost" disabled={pending} onClick={() => { if (nudge?.multiplier != null) { setPct(""); setReason(""); save("", ""); } else setOpen(false); }}>
            {nudge?.multiplier != null ? "Remove" : "Cancel"}
          </Button>
          <p className="col-span-2 text-xs text-muted sm:col-span-4">Percent up or down from the forecast. Staffing needs and labor % update right away; regenerate to rebuild draft shifts.</p>
        </form>
      )}
      {error && <p className="mt-1 text-xs text-bad" role="alert">{error}</p>}
    </div>
  );
}
