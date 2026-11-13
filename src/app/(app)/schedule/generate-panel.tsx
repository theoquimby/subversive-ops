"use client";

import { Badge, Button, cx } from "@/components/ui";
import { shiftLabel } from "@/domain/schedule";
import { dayDate, money, pct } from "@/lib/format";
import type { PlanPreview, PositionView } from "@/server/services/scheduling";
import { Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { applySchedule, previewSchedule } from "./actions";
import { IntensitySlider } from "./intensity-slider";

const fmtH = (h: number) => `${h.toFixed(h % 1 ? 1 : 0)}h`;

export function GeneratePanel({ monday, positions, onClose, onDone }: { monday: string; positions: PositionView[]; onClose: () => void; onDone: (msg: string) => void }) {
  const [slider, setSlider] = useState(50);
  const [plan, setPlan] = useState<PlanPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, start] = useTransition();
  const req = useRef(0);
  const pos = new Map(positions.map((p) => [p.id, p]));

  const load = (v: number) => {
    const id = ++req.current;
    setLoading(true);
    previewSchedule(monday, v).then((r) => {
      if (id !== req.current) return;
      if ("plan" in r && r.plan) setPlan(r.plan);
      setLoading(false);
    });
  };
  useEffect(() => {
    load(50);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const s = plan?.summary;
  const open = plan?.planned.filter((p) => !p.employeeId) ?? [];

  return createPortal(
    <div className="fixed inset-0 z-[55] flex items-end justify-center bg-black/30 backdrop-blur-[2px] sm:items-center sm:p-6" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Generate schedule"
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-border bg-surface shadow-2xl sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <div className="flex items-center gap-2 text-base font-semibold"><Sparkles className="size-4" strokeWidth={1.75} /> Generate schedule</div>
            <p className="mt-1 text-sm text-muted">
              Built from the sales forecast, each position&apos;s staffing ratio, availability, approved time off and max hours. Published shifts stay as they are.
            </p>
          </div>
          <button onClick={onClose} className="-m-1 rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Close"><X className="size-4" /></button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          <IntensitySlider value={slider} onChange={setSlider} onCommit={load} />

          <div className={cx("mt-5 grid grid-cols-2 gap-2.5 transition-opacity sm:grid-cols-4", loading && "opacity-50")}>
            <Mini label="Planned hours" value={s ? fmtH(s.hours) : "—"} hint={s ? `${fmtH(s.requiredHours)} needed` : undefined} />
            <Mini label="Labor cost" value={s ? money(s.cost, { whole: true }) : "—"} hint={s && s.overtimeHours > 0 ? `incl. ${fmtH(s.overtimeHours)} overtime` : "incl. employer taxes"} />
            <Mini label="Labor %" value={s ? pct(s.laborPct) : "—"} hint={s ? `of ${money(s.sales, { whole: true })} forecast` : undefined} />
            <Mini label="Unfilled" value={s ? String(s.openShifts) : "—"} hint={s && s.openShifts ? `${fmtH(s.openHours)} as open shifts` : "every shift has someone"} tone={s && s.openShifts ? "warn" : undefined} />
          </div>

          {plan && (
            <>
              <div className="mt-5 overflow-hidden rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[0.75rem] text-muted">
                      <th className="border-b border-border px-3 py-2 text-left font-medium">Day</th>
                      <th className="border-b border-border px-3 py-2 text-right font-medium">Forecast</th>
                      <th className="border-b border-border px-3 py-2 text-right font-medium">Hours</th>
                      <th className="hidden border-b border-border px-3 py-2 text-right font-medium sm:table-cell">Cost</th>
                      <th className="border-b border-border px-3 py-2 text-right font-medium">Labor %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.summary.days.map((d) => (
                      <tr key={d.date} className="[&:last-child>td]:border-b-0">
                        <td className="border-b border-border px-3 py-2">{dayDate(d.date)}</td>
                        <td className="num border-b border-border px-3 py-2 text-right">{d.sales ? money(d.sales, { whole: true }) : "Closed"}</td>
                        <td className="num border-b border-border px-3 py-2 text-right">{fmtH(d.hours)}</td>
                        <td className="num hidden border-b border-border px-3 py-2 text-right sm:table-cell">{money(d.cost, { whole: true })}</td>
                        <td className="num border-b border-border px-3 py-2 text-right">{pct(d.laborPct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {open.length > 0 && (
                <div className="mt-4">
                  <div className="mb-1.5 text-[0.8rem] font-medium text-ink-2">Couldn&apos;t fill — these become open shifts</div>
                  <div className="flex flex-wrap gap-1.5">
                    {open.map((o, i) => (
                      <Badge key={i} tone="warn">{dayDate(o.date).split(",")[0]} · {pos.get(o.positionId)?.name} · {shiftLabel(o.startMin, o.endMin)}</Badge>
                    ))}
                  </div>
                </div>
              )}
              {s && s.missingRates > 0 && <p className="mt-3 text-xs text-warn">{s.missingRates} shift{s.missingRates === 1 ? "" : "s"} have no pay rate set, so cost is understated.</p>}
            </>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-border px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-muted">
            {plan ? <>Creates {plan.planned.length} draft shifts{plan.replaces ? `, replacing ${plan.replaces} existing draft${plan.replaces === 1 ? "" : "s"}` : ""}{plan.keeps ? ` · keeps ${plan.keeps} published` : ""}.</> : "Working it out…"}
          </div>
          <div className="flex gap-2 max-sm:[&>button]:h-11 max-sm:[&>button]:flex-1">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!plan || loading || applying}
              onClick={() =>
                start(async () => {
                  const r = await applySchedule(monday, slider);
                  if (r.error) onDone(r.error);
                  else onDone(`Drafted ${r.created} shifts. Review, then publish.`);
                  onClose();
                })
              }
            >
              {applying ? "Applying…" : "Apply as draft"}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Mini({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "warn" }) {
  return (
    <div className="rounded-xl border border-border px-3 py-2.5">
      <div className="text-[0.75rem] text-muted">{label}</div>
      <div className={cx("num mt-1 text-lg font-semibold", tone === "warn" && "text-warn")}>{value}</div>
      {hint && <div className="mt-0.5 truncate text-[0.7rem] text-muted">{hint}</div>}
    </div>
  );
}
