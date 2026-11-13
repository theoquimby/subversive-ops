"use client";

import { Button, cx, Select } from "@/components/ui";
import type { CutoffRule } from "@/domain/ordering";
import { CalendarClock, Sparkles, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { saveDeliverySchedule } from "./actions";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// Week shown Monday first.
const ORDER = [1, 2, 3, 4, 5, 6, 0];

const clock = (t: string) => {
  const h = Number(t.slice(0, 2));
  const m = t.slice(3);
  return `${h % 12 === 0 ? 12 : h % 12}${m === "00" ? "" : `:${m}`} ${h < 12 ? "am" : "pm"}`;
};
const TIMES = Array.from({ length: 40 }, (_, i) => {
  const mins = 4 * 60 + i * 30; // 4:00 am … 11:30 pm
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
});

/** What the deadline is for a delivery day before anything is set: the old "days before at time" rule. */
function fallback(rule: CutoffRule, wd: number) {
  return { day: (wd - rule.daysBefore + 70) % 7, time: rule.time };
}

/**
 * "Edit" on a supplier card: tick the days the truck comes, and for each one
 * pick when the order has to be in — "Friday delivery → order by Wednesday 5pm".
 */
/** `learned`: what invoices and past orders suggest; offered as a one-tap fill (still saved with Save). */
export function DeadlineEditor({ supplierId, name, deliveryDays, rule, learned }: { supplierId: string; name: string; deliveryDays: number[]; rule: CutoffRule; learned?: { days?: number[]; perDay?: Record<number, { day: number; time: string }>; note: string } }) {
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState<number[]>(deliveryDays);
  const [per, setPer] = useState<Record<number, { day: number; time: string }>>(() =>
    Object.fromEntries(deliveryDays.map((wd) => [wd, rule.perDay?.[wd] ?? fallback(rule, wd)])),
  );
  const [auto, setAuto] = useState(rule.autoDraft);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const [usedLearned, setUsedLearned] = useState(false);
  const fillLearned = () => {
    if (!learned) return;
    const next = learned.days ?? days;
    setDays(next);
    setPer((cur) => {
      const out = { ...cur };
      for (const wd of next) out[wd] = learned.perDay?.[wd] ? { day: learned.perDay[wd].day, time: learned.perDay[wd].time } : cur[wd] ?? fallback(rule, wd);
      return out;
    });
    setUsedLearned(true);
  };
  const toggle = (wd: number) => {
    setDays((cur) => (cur.includes(wd) ? cur.filter((d) => d !== wd) : [...cur, wd]));
    setPer((cur) => (cur[wd] ? cur : { ...cur, [wd]: fallback(rule, wd) }));
  };
  const save = () =>
    start(async () => {
      const perDay = Object.fromEntries(days.map((wd) => [String(wd), per[wd] ?? fallback(rule, wd)]));
      const r = await saveDeliverySchedule(supplierId, { deliveryDays: days, perDay, autoDraft: auto });
      if (r.error) return setError(r.error);
      setOpen(false);
      router.refresh();
    });

  return (
    <>
      <Button size="sm" variant="ghost" className="relative z-10 -mr-2 px-2" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}>
        <CalendarClock className="size-4" /> Edit deadlines
      </Button>
      {open &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center" onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label={`${name} deliveries and order deadlines`}>
            <div className="max-h-[88dvh] w-full max-w-lg animate-rise-in overflow-y-auto rounded-t-2xl bg-bg p-5 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold">{name}</h2>
                  <p className="text-sm text-muted">When does the truck come, and when does the order have to be in?</p>
                </div>
                <Button variant="ghost" size="sm" className="size-10 shrink-0 p-0" onClick={() => setOpen(false)} aria-label="Close"><X className="size-4" /></Button>
              </div>

              {learned && (
                <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-border-strong bg-surface p-3 text-sm">
                  <Sparkles aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-2" />
                  <div className="min-w-0 flex-1">
                    <div className="text-ink">{learned.note}</div>
                    <div className="text-xs text-muted">{usedLearned ? "Filled in below. Check it, then Save." : "Fills in the days and deadlines below; nothing changes until you press Save."}</div>
                  </div>
                  {!usedLearned && <Button size="sm" variant="primary" className="h-10 shrink-0 sm:h-8" onClick={fillLearned}>Use these</Button>}
                </div>
              )}

              <div className="text-[0.8rem] font-medium text-ink-2">Delivers on</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label="Delivery days">
                {ORDER.map((wd) => (
                  <button key={wd} type="button" aria-pressed={days.includes(wd)} onClick={() => toggle(wd)}
                    className={cx("h-10 min-w-12 rounded-lg border px-3 text-sm font-medium transition-colors", days.includes(wd) ? "border-ink bg-ink text-surface" : "border-border text-ink-2 hover:border-border-strong")}>
                    {SHORT[wd]}
                  </button>
                ))}
              </div>

              {days.length > 0 && (
                <div className="mt-5 space-y-3">
                  <div className="text-[0.8rem] font-medium text-ink-2">Order deadline for each delivery</div>
                  {ORDER.filter((wd) => days.includes(wd)).map((wd) => {
                    const d = per[wd] ?? fallback(rule, wd);
                    const before = (wd - d.day + 7) % 7;
                    return (
                      <div key={wd} className="rounded-xl border border-border bg-surface p-3">
                        <div className="text-sm font-medium">{DAYS[wd]} delivery</div>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                          <span className="text-muted">order by</span>
                          <Select value={String(d.day)} onChange={(e) => setPer((cur) => ({ ...cur, [wd]: { ...d, day: Number(e.target.value) } }))} aria-label={`Deadline day for ${DAYS[wd]} delivery`} className="w-40"
                            options={ORDER.map((x) => ({ value: String(x), label: x === wd ? `${DAYS[x]} (same day)` : DAYS[x] }))} />
                          <span className="text-muted">at</span>
                          <Select value={d.time} onChange={(e) => setPer((cur) => ({ ...cur, [wd]: { ...d, time: e.target.value } }))} aria-label={`Deadline time for ${DAYS[wd]} delivery`} className="w-32"
                            options={TIMES.map((t) => ({ value: t, label: clock(t) }))} />
                        </div>
                        <div className="mt-1.5 text-xs text-muted">{before === 0 ? "Same day as the delivery." : `${before} day${before === 1 ? "" : "s"} before the delivery.`}</div>
                      </div>
                    );
                  })}
                </div>
              )}

              <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-surface p-3">
                <button type="button" role="switch" aria-checked={auto} onClick={() => setAuto((a) => !a)} className={cx("relative mt-0.5 h-6 w-10 shrink-0 rounded-full transition-colors", auto ? "bg-good" : "bg-border-strong")}>
                  <span className={cx("absolute top-0.5 left-0 size-5 rounded-full bg-white shadow transition-transform", auto ? "translate-x-[1.125rem]" : "translate-x-0.5")} />
                </button>
                <span className="text-sm"><span className="font-medium">Draft the order for me</span><span className="block text-muted">A suggested order is waiting in Ordering about a day before each deadline, with a reminder. Nothing is sent until you press Send.</span></span>
              </label>

              {error && <p role="alert" className="mt-3 text-sm text-bad">{error}</p>}
              <div className="mt-5 flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                <Button variant="primary" onClick={save} disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
