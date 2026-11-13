"use client";

import { useConfirm } from "@/components/dialog";
import { Badge, Button, Card, cx, DatePicker, Input, LinkButton } from "@/components/ui";
import { perHour, splitPool, TipMethod } from "@/domain/tips";
import { money, shortDate } from "@/lib/format";
import type { TipShareRow } from "@/server/services/tips";
import { Download, Lock, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { deleteTipPeriod, finalizeTipPeriod, saveTipPeriod } from "./actions";

interface Props {
  from: string;
  to: string;
  shares: TipShareRow[];
  excludedHours: number;
  synced: { total: number; days: number; ofDays: number };
  saved: { id: string; total: number; method: TipMethod; finalized: boolean } | null;
  periods: { id: string; start: string; end: string; total: number; method: TipMethod; finalized: boolean; people: number }[];
}

const fmtH = (h: number) => Number(h.toFixed(2)).toLocaleString("en-US");

export function TipPool({ from, to, shares, excludedHours, synced, saved, periods }: Props) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [total, setTotal] = useState(String(saved?.total ?? synced.total));
  const [method, setMethod] = useState<TipMethod>(saved?.method ?? "POINTS");
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const locked = !!saved?.finalized;
  const amount = Math.max(0, Number(total) || 0);

  const names = useMemo(() => new Map(shares.map((s) => [s.employeeId, s.name])), [shares]);
  const roles = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const s of shares) m.set(s.employeeId, [...(m.get(s.employeeId) ?? []), s.position]);
    return m;
  }, [shares]);
  const split = useMemo(() => splitPool(amount, shares, method).sort((a, b) => b.amount - a.amount), [amount, shares, method]);
  const totalHours = split.reduce((a, s) => a + s.hours, 0);
  const dirty = !saved || saved.total !== amount || saved.method !== method;

  const go = (f: string, t: string) => router.push(`/tips?from=${f}&to=${t < f ? f : t}`);

  return (
    <div className="flex flex-col gap-8">
      <Card className="p-4 sm:p-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="mb-1.5 text-[0.8rem] font-medium text-ink-2">From</div>
            <DatePicker aria-label="Period start" value={from} onChange={(e) => go(e.target.value, to)} className="max-sm:h-11" />
          </div>
          <div>
            <div className="mb-1.5 text-[0.8rem] font-medium text-ink-2">To</div>
            <DatePicker aria-label="Period end" value={to} min={from} onChange={(e) => go(from, e.target.value)} className="max-sm:h-11" />
          </div>
          <div>
            <div className="mb-1.5 text-[0.8rem] font-medium text-ink-2">Tips to share</div>
            <div className="relative">
              <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted">$</span>
              <Input aria-label="Total tips" inputMode="decimal" value={total} disabled={locked} onChange={(e) => setTotal(e.target.value.replace(/[^\d.]/g, ""))} className="num pl-6" />
            </div>
            <div className="mt-1 text-xs text-muted">
              {synced.days ? <>Square: {money(synced.total)} from {synced.days} of {synced.ofDays} days{amount !== synced.total && !locked && <button className="ml-1 underline" onClick={() => setTotal(String(synced.total))}>use</button>}</> : "No card tips synced for these days"}
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-[0.8rem] font-medium text-ink-2">Split by</div>
            <div role="radiogroup" aria-label="Split method" className="grid h-10 grid-cols-2 rounded-lg border border-border-strong p-0.5 sm:h-9">
              {(["HOURS", "POINTS"] as const).map((m) => (
                <button
                  key={m}
                  role="radio"
                  aria-checked={method === m}
                  disabled={locked}
                  onClick={() => setMethod(m)}
                  className={cx("rounded-md text-sm transition-colors", method === m ? "bg-primary text-primary-ink" : "text-ink-2 hover:bg-surface-2")}
                >
                  {m === "HOURS" ? "Hours" : "Points"}
                </button>
              ))}
            </div>
            <div className="mt-1 text-xs text-muted">{method === "HOURS" ? "Everyone earns the same per hour." : "Hours × each position's tip points."}</div>
          </div>
        </div>
      </Card>

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-[0.95rem] font-semibold">
              {shortDate(from)} – {shortDate(to)} {saved ? saved.finalized ? <Badge tone="good">Finalized</Badge> : <Badge>Saved{dirty ? " · unsaved changes" : ""}</Badge> : <Badge tone="warn">Preview</Badge>}
            </h2>
            <p className="num mt-0.5 text-sm text-muted">
              {split.length} people · {fmtH(totalHours)} tipped hours{totalHours > 0 && <> · {money(amount / totalHours)}/h average</>}
              {excludedHours > 0.01 && <> · {fmtH(excludedHours)}h in non-tipped roles left out</>}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {saved && !dirty && <LinkButton href={`/tips/${saved.id}/csv`} prefetch={false} size="sm" className="max-sm:h-10"><Download className="size-3.5" /> CSV</LinkButton>}
            {!locked && (
              <Button
                size="sm"
                className="max-sm:h-10"
                variant={saved && !dirty ? "secondary" : "primary"}
                disabled={pending || !dirty || split.length === 0}
                onClick={() =>
                  start(async () => {
                    const r = await saveTipPeriod({ from, to, total: amount, method });
                    setMsg(r.error ? { text: r.error, bad: true } : { text: "Saved." });
                  })
                }
              >
                {saved ? "Save changes" : "Save period"}
              </Button>
            )}
            {saved && !locked && !dirty && (
              <Button
                size="sm"
                variant="primary"
                className="max-sm:h-10"
                disabled={pending}
                onClick={async () => {
                  if (!(await confirm({ title: "Finalize this tip period?", body: `${money(amount)} split between ${split.length} people. Finalized periods can't be edited.`, confirmLabel: "Finalize" }))) return;
                  start(async () => {
                    await finalizeTipPeriod(saved.id);
                    setMsg({ text: "Finalized. Download the CSV for payroll." });
                  });
                }}
              >
                <Lock className="size-3.5" /> Finalize
              </Button>
            )}
          </div>
        </div>
        {msg && <div role="status" className={cx("mb-3 rounded-xl px-4 py-2.5 text-sm", msg.bad ? "bg-bad-bg text-bad" : "bg-good-bg text-good")}>{msg.text}</div>}
        {split.length === 0 ? (
          <Card className="px-4 py-8 text-center text-sm text-muted">No timecards in tip-eligible positions for these dates.</Card>
        ) : (
          <Card className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[0.75rem] text-muted">
                  <th className="border-b border-border px-4 py-2.5 text-left font-medium">Person</th>
                  <th className="border-b border-border px-4 py-2.5 text-right font-medium">Hours</th>
                  {method === "POINTS" && <th className="hidden border-b border-border px-4 py-2.5 text-right font-medium sm:table-cell">Points</th>}
                  <th className="hidden border-b border-border px-4 py-2.5 text-right font-medium sm:table-cell">Per hour</th>
                  <th className="border-b border-border px-4 py-2.5 text-right font-medium">Tips</th>
                </tr>
              </thead>
              <tbody>
                {split.map((s) => (
                  <tr key={s.employeeId} className="[&:last-child>td]:border-b-0">
                    <td className="border-b border-border px-4 py-3">
                      <div className="font-medium">{names.get(s.employeeId)}</div>
                      <div className="text-xs text-muted">{roles.get(s.employeeId)?.join(", ")}</div>
                    </td>
                    <td className="num border-b border-border px-4 py-3 text-right">{fmtH(s.hours)}</td>
                    {method === "POINTS" && <td className="num hidden border-b border-border px-4 py-3 text-right sm:table-cell">{fmtH(s.weightedPoints)}</td>}
                    <td className="num hidden border-b border-border px-4 py-3 text-right text-muted sm:table-cell">{money(perHour(s))}</td>
                    <td className="num border-b border-border px-4 py-3 text-right font-medium">{money(s.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-surface-2/50 font-medium">
                  <td className="border-t border-border px-4 py-2.5">Total</td>
                  <td className="num border-t border-border px-4 py-2.5 text-right">{fmtH(totalHours)}</td>
                  {method === "POINTS" && <td className="hidden border-t border-border sm:table-cell" />}
                  <td className="hidden border-t border-border sm:table-cell" />
                  <td className="num border-t border-border px-4 py-2.5 text-right">{money(split.reduce((a, s) => a + s.amount, 0))}</td>
                </tr>
              </tfoot>
            </table>
          </Card>
        )}
      </section>

      {periods.length > 0 && (
        <section>
          <h2 className="mb-3 text-[0.95rem] font-semibold">Saved periods</h2>
          <Card className="divide-y divide-border">
            {periods.map((p) => (
              <div key={p.id} className={cx("flex items-center gap-3 px-4 py-3 text-sm", p.start === from && p.end === to && "bg-surface-2/50")}>
                <button className="min-w-0 flex-1 text-left" onClick={() => go(p.start, p.end)}>
                  <div className="font-medium">{shortDate(p.start)} – {shortDate(p.end)}</div>
                  <div className="num text-xs text-muted">{money(p.total)} · {p.people} people · by {p.method === "HOURS" ? "hours" : "points"}</div>
                </button>
                {p.finalized ? <Badge tone="good">Finalized</Badge> : <Badge>Draft</Badge>}
                <LinkButton href={`/tips/${p.id}/csv`} prefetch={false} variant="ghost" size="sm" aria-label="Download CSV" className="max-sm:size-10"><Download className="size-3.5" /></LinkButton>
                {!p.finalized && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Delete period"
                    className="text-muted hover:text-bad max-sm:size-10"
                    onClick={async () => {
                      if (!(await confirm({ title: "Delete this saved period?", confirmLabel: "Delete", danger: true }))) return;
                      start(async () => { await deleteTipPeriod(p.id); });
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </Card>
        </section>
      )}
    </div>
  );
}
