"use client";

import { useConfirm } from "@/components/dialog";
import { GridCell } from "@/components/grid";
import { HelpTip, HelpZone } from "@/components/help";
import { Badge, Button, Card, cx, DatePicker, LinkButton, Stat } from "@/components/ui";
import { planTips, PoolWarning, TipInputs, TipKind, TipMode, TipValue } from "@/domain/tipSources";
import { perHour, TipMethod } from "@/domain/tips";
import { money, relativeTime, shortDate } from "@/lib/format";
import type { TipShareRow } from "@/server/services/tips";
import { Download, Lock, RotateCcw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { deleteTipPeriod, finalizeTipPeriod, saveTipPeriod, setTipValue } from "./actions";

interface Props {
  from: string;
  to: string;
  shares: TipShareRow[];
  excludedHours: number;
  inputs: TipInputs;
  names: Record<string, string>;
  coverage: { cardDays: number; cashDays: number; fallbackDays: number; ofDays: number };
  warnings: PoolWarning[];
  saved: { id: string; total: number; method: TipMethod; cardMode: TipMode; cashMode: TipMode; finalized: boolean; legacy: boolean } | null;
  periods: { id: string; start: string; end: string; total: number; method: TipMethod; finalized: boolean; people: number }[];
  lastSync: string | null;
}

const fmtH = (h: number) => Number(h.toFixed(2)).toLocaleString("en-US");
const th = "border-b border-border px-4 py-2.5 font-medium";
const td = "border-b border-border px-4 py-3";

/** A two-option switch (role=radiogroup), same look as Hours | Points. */
function Toggle<T extends string>({ label, value, options, onChange, disabled }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid h-10 grid-cols-2 rounded-lg border border-border-strong p-0.5 sm:h-9">
      {options.map(([v, text]) => (
        <button key={v} role="radio" aria-checked={value === v} disabled={disabled} onClick={() => onChange(v)} className={cx("rounded-md px-2 text-sm transition-colors", value === v ? "bg-primary text-primary-ink" : "text-ink-2 hover:bg-surface-2")}>
          {text}
        </button>
      ))}
    </div>
  );
}

export function TipPool({ from, to, shares, excludedHours, inputs, names, coverage, warnings, saved, periods, lastSync }: Props) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [method, setMethod] = useState<TipMethod>(saved?.method ?? "POINTS");
  const [cardMode, setCardMode] = useState<TipMode>(saved?.cardMode ?? "POOL");
  const [cashMode, setCashMode] = useState<TipMode>(saved?.cashMode ?? "POOL");
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const locked = !!saved?.finalized;

  const name = (id: string) => names[id] ?? "Unknown";
  const roles = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const s of shares) m.set(s.employeeId, [...(m.get(s.employeeId) ?? []), s.position]);
    return m;
  }, [shares]);
  const plan = useMemo(() => planTips(inputs, shares, method, cardMode, cashMode), [inputs, shares, method, cardMode, cashMode]);
  const people = useMemo(() => [...plan.people].sort((a, b) => b.amount - a.amount || name(a.employeeId).localeCompare(name(b.employeeId))), [plan]); // eslint-disable-line react-hooks/exhaustive-deps
  const lines = useMemo(() => [...inputs.lines].sort((a, b) => Number(roles.has(b.employeeId)) - Number(roles.has(a.employeeId)) || name(a.employeeId).localeCompare(name(b.employeeId))), [inputs, roles]); // eslint-disable-line react-hooks/exhaustive-deps
  const poolHours = plan.people.reduce((a, s) => a + s.hours, 0);
  const dirty = !saved || saved.total !== plan.total || saved.method !== method || saved.cardMode !== cardMode || saved.cashMode !== cashMode;
  const edited = inputs.lines.reduce((a, l) => a + Number(l.card.manual) + Number(l.cash.manual), 0) + Number(inputs.pooledCard.manual) + Number(inputs.pooledCash.manual);

  const go = (f: string, t: string) => router.push(`/tips?from=${f}&to=${t < f ? f : t}`);
  const saveValue = (kind: TipKind, employeeId: string | null) => async (value: string) => {
    const r = await setTipValue({ from, to, method, cardMode, cashMode, kind, employeeId, value });
    if (!r.error) setMsg(null);
    return r;
  };

  /** An editable tip amount with where it came from underneath. */
  const cell = (v: TipValue, kind: TipKind, employeeId: string | null, label: string) => (
    <td className={cx(td, "w-[34%] py-2 sm:w-40")}>
      {locked ? (
        <div className="num text-right">{money(v.value)}</div>
      ) : (
        <GridCell grid="tips" col={kind} type="number" prefix="$" decimals={2} value={v.value} placeholder={v.square.toFixed(2)} onSave={saveValue(kind, employeeId)} ariaLabel={label} />
      )}
      <div className="mt-0.5 flex min-h-5 items-center justify-end gap-1 text-[0.72rem] text-muted">
        {v.manual ? (
          <>
            <span className="text-warn">Edited</span>
            <span className="num">· Square {money(v.square)}</span>
            {!locked && (
              <button type="button" aria-label={`Use Square's number for ${label}`} title="Use Square's number" className="-my-2 grid size-8 place-items-center rounded-md hover:bg-surface-2 max-sm:size-10" onClick={() => start(async () => { await saveValue(kind, employeeId)(""); })}>
                <RotateCcw className="size-3" />
              </button>
            )}
          </>
        ) : v.value ? (
          <span>Square</span>
        ) : null}
      </div>
    </td>
  );

  const cardDaysText = coverage.cardDays + coverage.fallbackDays >= coverage.ofDays ? `all ${coverage.ofDays} days` : `${coverage.cardDays + coverage.fallbackDays} of ${coverage.ofDays} days`;
  const splitText = method === "HOURS" ? "by hours" : "by hours × position points";

  return (
    <div className="flex flex-col gap-8">
      <HelpZone id="tips.period"><Card className="p-4 sm:p-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <div className="mb-1.5 text-[0.8rem] font-medium text-ink-2">From</div>
            <DatePicker aria-label="Period start" value={from} onChange={(e) => go(e.target.value, to)} className="max-sm:h-11" />
          </div>
          <div>
            <div className="mb-1.5 text-[0.8rem] font-medium text-ink-2">To</div>
            <DatePicker aria-label="Period end" value={to} min={from} onChange={(e) => go(from, e.target.value)} className="max-sm:h-11" />
          </div>
          <div>
            <div className="mb-1.5 text-[0.8rem] font-medium text-ink-2">Split by</div>
            <Toggle label="Split method" value={method} options={[["HOURS", "Hours"], ["POINTS", "Points"]]} onChange={setMethod} disabled={locked} />
            <div className="mt-1 text-xs text-muted">{method === "HOURS" ? "Everyone earns the same per hour." : "Hours × each position's tip points."}</div>
          </div>
        </div>
      </Card></HelpZone>

      <HelpZone id="tips.summary"><section>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Card tips" value={money(plan.cardTotal)} hint={coverage.cardDays + coverage.fallbackDays ? `From Square, ${cardDaysText}` : "Nothing synced for these days"} />
          <Stat label="Cash tips" value={money(plan.cashTotal)} hint={coverage.cashDays ? (plan.cashTotal ? "Declared at clock-out" : "None declared in Square") : "Nothing synced for these days"} />
          <div className="col-span-2 sm:col-span-1">
            <Stat label="To share" value={money(plan.total)} hint={poolHours > 0 ? `${fmtH(poolHours)} tipped hours · ${money(plan.total / poolHours)}/h` : "No tipped hours yet"} />
          </div>
        </div>
        <Card className="mt-3 p-4 text-sm leading-relaxed sm:p-5">
          <p>
            <span className="num">{money(plan.cardTotal)}</span> in card tips and <span className="num">{money(plan.cashTotal)}</span> in cash tips make <strong className="num">{money(plan.total)}</strong> for {shortDate(from)} – {shortDate(to)}.{" "}
            {cardMode === "POOL" && cashMode === "POOL" ? (
              <>All of it goes into one pool, split {splitText} between {plan.people.length} {plan.people.length === 1 ? "person" : "people"}.</>
            ) : (
              <>
                {cardMode === "KEEP" ? "Each person keeps the card tips Square credits to them" : "Card tips go into the pool"}
                {cashMode === "KEEP" ? " and keeps the cash they declared" : cardMode === "KEEP" ? "; cash goes into the pool" : " and each person keeps the cash they declared"}. The pool (<span className="num">{money(plan.cardPool + plan.cashPool)}</span>) is split {splitText}.
              </>
            )}
          </p>
          <p className="mt-2 text-ink-2">Card tips are paid through payroll; cash tips are handed out (or were already kept).</p>
          {plan.movedToPool.length > 0 && (
            <p className="mt-2 text-ink-2">
              {plan.movedToPool.map((m) => `${name(m.employeeId)} (${money(m.card + m.cash)})`).join(", ")}: tips Square credits to {plan.movedToPool.length === 1 ? "someone" : "people"} with no hours in a tipped role went into the pool.
            </p>
          )}
          {plan.unshared > 0.005 && <p className="mt-2 text-bad">{money(plan.unshared)} isn&apos;t going to anyone: nobody has hours in a tipped role for these dates.</p>}
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <div className="mb-1.5 text-[0.8rem] font-medium text-ink-2">Card tips</div>
              <Toggle label="Card tips" value={cardMode} options={[["POOL", "Pool all"], ["KEEP", "Each keeps own"]]} onChange={setCardMode} disabled={locked} />
            </div>
            <div>
              <div className="mb-1.5 text-[0.8rem] font-medium text-ink-2">Cash tips</div>
              <Toggle label="Cash tips" value={cashMode} options={[["POOL", "Pool all"], ["KEEP", "Each keeps own"]]} onChange={setCashMode} disabled={locked} />
            </div>
          </div>
        </Card>
      </section></HelpZone>

      <HelpZone id="tips.sources"><section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 text-[0.95rem] font-semibold">Tips by person <Badge>From Square</Badge></h2>
            <p className="mt-0.5 text-sm text-muted">
              {locked ? "As finalized." : <>Type over any number to correct it; clear it to go back to Square&apos;s.{edited > 0 && <> {edited} edited — the Square sync never changes them.</>}</>}
              {lastSync && !locked && <> Last synced {relativeTime(new Date(lastSync))}.</>}
            </p>
          </div>
        </div>
        {coverage.fallbackDays > 0 && !locked && (
          <div className="mb-3 rounded-xl bg-warn-bg px-4 py-2.5 text-sm text-warn">
            {coverage.fallbackDays} {coverage.fallbackDays === 1 ? "day was" : "days were"} synced before Ops read card tips by person, so {coverage.fallbackDays === 1 ? "its" : "their"} card tips sit in &ldquo;Not linked to anyone&rdquo;. Totals are right; re-run the history import under Settings → Square to fill in who took them.
          </div>
        )}
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[0.75rem] text-muted">
                <th className={cx(th, "text-left")}>Person</th>
                <th className={cx(th, "text-right")}><span className="inline-flex items-center gap-1">Card <HelpTip id="tips.card" /></span></th>
                <th className={cx(th, "text-right")}><span className="inline-flex items-center gap-1">Cash <HelpTip id="tips.cash" /></span></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.employeeId}>
                  <td className={td}>
                    <div className="font-medium">{name(l.employeeId)}</div>
                    <div className="text-xs text-muted">{roles.get(l.employeeId)?.join(", ") || "Not in the pool"}</div>
                  </td>
                  {cell(l.card, "CARD", l.employeeId, `${name(l.employeeId)} card tips`)}
                  {cell(l.cash, "CASH", l.employeeId, `${name(l.employeeId)} cash tips`)}
                </tr>
              ))}
              <tr className="[&>td]:border-b-0">
                <td className={td}>
                  <div className="font-medium">Not linked to anyone</div>
                  <div className="text-xs text-muted">Card: no team member on the payment. Cash: tip jar or other cash.</div>
                </td>
                {cell(inputs.pooledCard, "CARD", null, "Card tips not linked to anyone")}
                {cell(inputs.pooledCash, "CASH", null, "Cash tips not linked to anyone")}
              </tr>
            </tbody>
            <tfoot>
              <tr className="bg-surface-2/50 font-medium">
                <td className="border-t border-border px-4 py-2.5">Total</td>
                <td className="num border-t border-border px-4 py-2.5 text-right">{money(plan.cardTotal)}</td>
                <td className="num border-t border-border px-4 py-2.5 text-right">{money(plan.cashTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </Card>
      </section></HelpZone>

      <HelpZone id="tips.shares"><section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-[0.95rem] font-semibold">
              Who gets what {saved ? saved.finalized ? <Badge tone="good">Finalized</Badge> : <Badge>Saved{dirty ? " · unsaved changes" : ""}</Badge> : <Badge tone="warn">Preview</Badge>}
            </h2>
            <p className="num mt-0.5 text-sm text-muted">
              {plan.people.length} people · {fmtH(poolHours)} tipped hours{poolHours > 0 && <> · {money(plan.total / poolHours)}/h average</>}
              {excludedHours > 0.01 && <> · {fmtH(excludedHours)}h in non-tipped roles left out</>}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {saved && !dirty && <LinkButton href={`/tips/${saved.id}/csv`} prefetch={false} size="sm" className="max-sm:h-10"><Download className="size-3.5" /> Spreadsheet</LinkButton>}
            {!locked && (
              <Button
                size="sm"
                className="max-sm:h-10"
                variant={saved && !dirty ? "secondary" : "primary"}
                disabled={pending || !dirty || plan.people.length === 0}
                onClick={() =>
                  start(async () => {
                    const r = await saveTipPeriod({ from, to, method, cardMode, cashMode });
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
                  if (!(await confirm({ title: "Finalize this tip period?", body: `${money(plan.total)} (${money(plan.cardTotal)} card, ${money(plan.cashTotal)} cash) split between ${plan.people.length} people. Finalized periods can't be edited, and their tips go into the payroll export on Timecards.`, confirmLabel: "Finalize" }))) return;
                  start(async () => {
                    const r = await finalizeTipPeriod(saved.id);
                    setMsg(r.error ? { text: r.error, bad: true } : { text: "Finalized. These tips now show in the payroll export on Timecards." });
                  });
                }}
              >
                <Lock className="size-3.5" /> Finalize
              </Button>
            )}
          </div>
        </div>
        {saved?.legacy && !locked && <div className="mb-3 rounded-xl bg-warn-bg px-4 py-2.5 text-sm text-warn">Saved before tips came from Square (it had {money(saved.total)} typed in). Check the numbers above and save again.</div>}
        {msg && <div role="status" className={cx("mb-3 rounded-xl px-4 py-2.5 text-sm", msg.bad ? "bg-bad-bg text-bad" : "bg-good-bg text-good")}>{msg.text}</div>}
        {people.length === 0 ? (
          <Card className="px-4 py-8 text-center text-sm text-muted">No timecards in tip-eligible positions for these dates.</Card>
        ) : (
          <Card className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[0.75rem] text-muted">
                  <th className={cx(th, "text-left")}>Person</th>
                  <th className={cx(th, "text-right")}>Hours</th>
                  {method === "POINTS" && <th className={cx(th, "hidden text-right sm:table-cell")}>Points</th>}
                  <th className={cx(th, "hidden text-right md:table-cell")}>Per hour</th>
                  <th className={cx(th, "hidden text-right sm:table-cell")}>Card</th>
                  <th className={cx(th, "hidden text-right sm:table-cell")}>Cash</th>
                  <th className={cx(th, "text-right")}>Tips</th>
                </tr>
              </thead>
              <tbody>
                {people.map((s) => (
                  <tr key={s.employeeId} className="[&:last-child>td]:border-b-0">
                    <td className={td}>
                      <div className="font-medium">{name(s.employeeId)}</div>
                      <div className="text-xs text-muted">{roles.get(s.employeeId)?.join(", ")}</div>
                    </td>
                    <td className={cx(td, "num text-right")}>{fmtH(s.hours)}</td>
                    {method === "POINTS" && <td className={cx(td, "num hidden text-right sm:table-cell")}>{fmtH(s.weightedPoints)}</td>}
                    <td className={cx(td, "num hidden text-right text-muted md:table-cell")}>{money(perHour(s))}</td>
                    <td className={cx(td, "num hidden text-right sm:table-cell")}>{money(s.card)}</td>
                    <td className={cx(td, "num hidden text-right sm:table-cell")}>{money(s.cash)}</td>
                    <td className={cx(td, "text-right")}>
                      <div className="num font-medium">{money(s.amount)}</div>
                      <div className="num text-xs text-muted sm:hidden">{money(s.card)} card · {money(s.cash)} cash</div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-surface-2/50 font-medium">
                  <td className="border-t border-border px-4 py-2.5">Total</td>
                  <td className="num border-t border-border px-4 py-2.5 text-right">{fmtH(poolHours)}</td>
                  {method === "POINTS" && <td className="hidden border-t border-border sm:table-cell" />}
                  <td className="hidden border-t border-border md:table-cell" />
                  <td className="num hidden border-t border-border px-4 py-2.5 text-right sm:table-cell">{money(plan.people.reduce((a, s) => a + s.card, 0))}</td>
                  <td className="num hidden border-t border-border px-4 py-2.5 text-right sm:table-cell">{money(plan.people.reduce((a, s) => a + s.cash, 0))}</td>
                  <td className="num border-t border-border px-4 py-2.5 text-right">{money(plan.people.reduce((a, s) => a + s.amount, 0))}</td>
                </tr>
              </tfoot>
            </table>
          </Card>
        )}
      </section></HelpZone>

      <HelpZone id="tips.ny"><section>
        <h2 className="mb-3 text-[0.95rem] font-semibold">New York tip rules</h2>
        <Card className="p-4 text-sm leading-relaxed sm:p-5">
          {warnings.map((w) => (
            <p key={w.kind} className="mb-3 rounded-lg bg-warn-bg px-3 py-2 text-warn">
              {w.kind === "managerial" ? (
                <><strong>{w.positions.join(", ")}</strong> {w.positions.length === 1 ? "has" : "have"} hours in this pool. Owners and managers can&apos;t share in tips. </>
              ) : (
                <><strong>{w.positions.join(", ")}</strong> {w.positions.length === 1 ? "is" : "are"} in this pool. Check that {w.positions.length === 1 ? "this role serves" : "these roles serve"} guests. </>
              )}
              <Link href="/team" className="underline">Change tipped roles on Team</Link>
            </p>
          ))}
          <ul className="list-disc space-y-1.5 pl-5 text-ink-2">
            <li>Tips belong to the staff. Owners and managers can&apos;t keep any part of them or share in the pool (NY Labor Law §196-d).</li>
            <li>A required pool can only include staff who serve guests, like bartenders, servers, bussers, runners and hosts. Cooks and dishwashers can&apos;t be in it.</li>
            <li>Anyone paid the lower tipped wage (tip credit) must still reach the full minimum wage with tips.</li>
          </ul>
          <p className="mt-3 text-xs text-muted">A summary, not legal advice. Check with your accountant or payroll provider.</p>
        </Card>
      </section></HelpZone>

      {periods.length > 0 && (
        <HelpZone id="tips.saved"><section>
          <h2 className="mb-3 text-[0.95rem] font-semibold">Saved periods</h2>
          <Card className="divide-y divide-border">
            {periods.map((p) => (
              <div key={p.id} className={cx("flex items-center gap-3 px-4 py-3 text-sm", p.start === from && p.end === to && "bg-surface-2/50")}>
                <button className="min-w-0 flex-1 text-left" onClick={() => go(p.start, p.end)}>
                  <div className="font-medium">{shortDate(p.start)} – {shortDate(p.end)}</div>
                  <div className="num text-xs text-muted">{money(p.total)} · {p.people} people · by {p.method === "HOURS" ? "hours" : "points"}</div>
                </button>
                {p.finalized ? <Badge tone="good">Finalized</Badge> : <Badge>Draft</Badge>}
                <LinkButton href={`/tips/${p.id}/csv`} prefetch={false} variant="ghost" size="sm" aria-label="Download spreadsheet" className="max-sm:size-10"><Download className="size-3.5" /></LinkButton>
                {!p.finalized && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Delete period"
                    className="text-muted hover:text-bad max-sm:size-10"
                    onClick={async () => {
                      if (!(await confirm({ title: "Delete this saved period?", body: "Numbers you typed over Square's for these dates go with it.", confirmLabel: "Delete", danger: true }))) return;
                      start(async () => { await deleteTipPeriod(p.id); });
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </Card>
        </section></HelpZone>
      )}
    </div>
  );
}
