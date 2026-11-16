"use client";

import { Button, Card, cx } from "@/components/ui";
import { STANDING_HINT, STANDING_LABEL, STANDINGS, type Standing } from "@/domain/beerStanding";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { dismissCoreHelper, saveStandings, setBeerField } from "./actions";
import { BeerDot } from "./bits";

/** Core / In rotation / Retired as one three-way control. */
export function StandingPicker({ value, onChange, disabled, label }: { value: Standing; onChange: (s: Standing) => void; disabled?: boolean; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex w-full rounded-xl bg-surface-2 p-1 sm:w-auto">
      {STANDINGS.map((s) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={value === s}
          title={STANDING_HINT[s]}
          disabled={disabled}
          onClick={() => onChange(s)}
          className={cx(
            "h-10 flex-1 rounded-lg px-3 text-sm whitespace-nowrap transition-colors duration-120 disabled:opacity-50 sm:h-8 sm:flex-none",
            value === s ? "bg-surface font-medium text-ink shadow-sm" : "text-muted hover:text-ink",
          )}
        >
          {STANDING_LABEL[s]}
        </button>
      ))}
    </div>
  );
}

/** The standing on a beer's own page: saves as soon as it's picked. */
export function StandingControl({ beerId, name, value }: { beerId: string; name: string; value: Standing }) {
  const router = useRouter();
  const [v, setV] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const pick = (s: Standing) => {
    if (s === v) return;
    const before = v;
    setV(s);
    setError(null);
    start(async () => {
      const r = await setBeerField(beerId, "standing", s);
      if (r.error) { setV(before); setError(r.error); }
      else router.refresh();
    });
  };
  return (
    <div>
      <StandingPicker value={v} onChange={pick} disabled={pending} label={`Standing of ${name}`} />
      <p className={cx("mt-1.5 text-xs", error ? "text-bad" : "text-muted")}>{error ?? STANDING_HINT[v]}</p>
    </div>
  );
}

export interface CoreHelperItem {
  id: string;
  name: string;
  color: string;
  suggested: Standing;
  reason: string;
}

/**
 * "Pick your core beers": shown until a beer is core or it is put away. Each
 * beer starts at its suggested standing; one Save sets them all.
 */
export function CoreHelper({ items }: { items: CoreHelperItem[] }) {
  const router = useRouter();
  const [picks, setPicks] = useState<Record<string, Standing>>(() => Object.fromEntries(items.map((i) => [i.id, i.suggested])));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const count = (s: Standing) => items.filter((i) => picks[i.id] === s).length;
  const save = () =>
    start(async () => {
      setError(null);
      const r = await saveStandings(items.map((i) => ({ id: i.id, standing: picks[i.id] })));
      if ("error" in r) setError(r.error);
      else router.refresh();
    });
  const later = () =>
    start(async () => {
      await dismissCoreHelper();
      router.refresh();
    });
  return (
    <Card className="mb-8 overflow-hidden" data-tour="kegs.core-helper">
      <div className="border-b border-border px-4 py-4 sm:px-5">
        <h2 className="text-base font-semibold">Pick your core beers</h2>
        <p className="mt-1 max-w-2xl text-sm text-ink-2">
          Core beers are the ones you never want to run out of. Only they get fill suggestions, run-out warnings and alerts. Beers in rotation still show in stock and on Demand, without the nagging. Retired beers are hidden, with their history kept.
        </p>
        <p className="mt-1 text-xs text-muted">Suggested from the keg history and the last 90 days of sales. Change any of them, then save.</p>
      </div>
      <ul className="divide-y divide-border">
        {items.map((i) => (
          <li key={i.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div className="min-w-0">
              <div className="flex items-center gap-2 font-medium"><BeerDot color={i.color} /><span className="truncate">{i.name}</span></div>
              <div className="num text-xs text-muted">{i.reason}</div>
            </div>
            <div className="shrink-0">
              <StandingPicker value={picks[i.id]} onChange={(s) => setPicks((p) => ({ ...p, [i.id]: s }))} disabled={pending} label={`Standing of ${i.name}`} />
            </div>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-2 border-t border-border bg-surface-2/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <span className="num text-sm text-ink-2">{count("core")} core · {count("rotation")} in rotation · {count("retired")} retired</span>
        <div className="flex gap-2">
          <Button variant="ghost" className="h-11 flex-1 sm:h-9 sm:flex-none" disabled={pending} onClick={later}>Hide this</Button>
          <Button variant="primary" className="h-11 flex-1 sm:h-9 sm:flex-none" disabled={pending} onClick={save}>Save</Button>
        </div>
      </div>
      {error && <p role="alert" className="px-5 pb-3 text-sm text-bad">{error}</p>}
    </Card>
  );
}
