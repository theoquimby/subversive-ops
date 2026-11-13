"use client";

import { useConfirm } from "@/components/dialog";
import { GridCell, GridSelect } from "@/components/grid";
import { Badge, Button, Card, cx, DatePicker, Input, Select } from "@/components/ui";
import { ADJUSTMENT_KINDS, ADJUSTMENT_LABELS } from "@/domain/payroll";
import { dayDate, money } from "@/lib/format";
import { CheckCircle2, ChevronLeft, ChevronRight, Lock, LockOpen, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addAdjustment, approvePeriod, deleteAdjustment, setAdjustmentField, unlockPeriod } from "./actions";

type Opt = { value: string; label: string };

/** Previous/next pay period plus a date picker that jumps to the period containing the day. */
export function PeriodPicker({ start, prev, next, label }: { start: string; prev: string; next: string; label: string }) {
  const router = useRouter();
  const go = (d: string) => router.push(`/labor?start=${d}`);
  return (
    <div className="flex items-center gap-1">
      <Button variant="secondary" className="size-11 shrink-0 px-0 sm:size-10" aria-label="Previous pay period" onClick={() => go(prev)}><ChevronLeft className="size-5" /></Button>
      <div className="w-56">
        <DatePicker value={start} onChange={(e) => go(e.target.value)} aria-label={`Pay period ${label}`} />
      </div>
      <Button variant="secondary" className="size-11 shrink-0 px-0 sm:size-10" aria-label="Next pay period" onClick={() => go(next)}><ChevronRight className="size-5" /></Button>
    </div>
  );
}

/** Approve (lock + snapshot) or unlock the period on screen. */
export function ApprovalBar({ start, label, approved, approvedBy, approvedAt, blocks, warns }: { start: string; label: string; approved: boolean; approvedBy: string | null; approvedAt: string | null; blocks: number; warns: number }) {
  const confirm = useConfirm();
  const [pending, run] = useTransition();
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const act = (fn: () => Promise<{ error?: string; ok?: string }>) =>
    run(async () => {
      const r = await fn();
      setMsg(r.error ? { text: r.error, bad: true } : { text: r.ok ?? "Done" });
    });
  return (
    <Card className={cx("mb-8 flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center", approved && "border-good/40 bg-good-bg/40")}>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {approved ? <Lock className="mt-0.5 size-4 shrink-0 text-good" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-muted" />}
        <div className="min-w-0 text-sm">
          {approved ? (
            <>
              <div className="font-medium">Approved{approvedBy ? ` by ${approvedBy}` : ""}{approvedAt ? ` on ${new Date(approvedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" })}` : ""}</div>
              <div className="text-muted">Timecards are locked and the payroll file is frozen as approved.</div>
            </>
          ) : (
            <>
              <div className="font-medium">Not approved yet</div>
              <div className="text-muted">
                {blocks ? <span className="text-bad">{blocks} must fix</span> : "Nothing must be fixed"}
                {warns ? <> · <span className="text-warn">{warns} to check</span></> : null} · approving locks {label}&rsquo;s timecards and freezes the export.
              </div>
            </>
          )}
          {msg && <div className={cx("mt-1", msg.bad ? "text-bad" : "text-good")}>{msg.text}</div>}
        </div>
      </div>
      {approved ? (
        <Button
          className="max-sm:h-11"
          disabled={pending}
          onClick={async () => {
            if (await confirm({ title: "Unlock this pay period?", body: "Timecards and adjustments become editable again and the approved payroll file is discarded. Approve again when you're done.", confirmLabel: "Unlock" })) act(() => unlockPeriod(start));
          }}
        >
          <LockOpen className="size-3.5" /> Unlock
        </Button>
      ) : (
        <Button
          variant="primary"
          className="max-sm:h-11"
          disabled={pending}
          onClick={async () => {
            if (blocks && !(await confirm({ title: `Approve with ${blocks} must-fix problem${blocks === 1 ? "" : "s"}?`, body: "Things like a missing clock-out or pay rate will be wrong in the payroll file. Fix them first unless you've checked.", confirmLabel: "Approve anyway", danger: true }))) return;
            act(() => approvePeriod(start));
          }}
        >
          <Lock className="size-3.5" /> {pending ? "Approving…" : "Approve period"}
        </Button>
      )}
    </Card>
  );
}

export interface AdjustmentRow {
  id: string;
  employeeId: string;
  date: string;
  kind: string;
  amount: number;
  note: string | null;
}

const KIND_OPTIONS = ADJUSTMENT_KINDS.map((k) => ({ value: k, label: ADJUSTMENT_LABELS[k] }));
const td = "border-b border-border px-0.5 py-1 sm:px-1.5 align-middle [tr:last-child_&]:border-b-0";
const th = "border-b border-border px-3 py-2.5 text-[0.75rem] font-medium whitespace-nowrap text-muted";

/** Bonuses, corrections, deductions and reimbursements for the period, edited inline. */
export function AdjustmentsGrid({ rows, employees, days, defaultDay, locked }: { rows: AdjustmentRow[]; employees: Opt[]; days: Opt[]; defaultDay: string; locked: boolean }) {
  const [, start] = useTransition();
  const name = new Map(employees.map((e) => [e.value, e.label]));
  return (
    <div className="overflow-x-auto">
      {rows.length > 0 && (
        <table className="w-full table-fixed border-collapse text-sm sm:table-auto">
          <thead>
            <tr>
              <th className={cx(th, "text-left")}>Person</th>
              <th className={cx(th, "w-36 text-left")}>Kind</th>
              <th className={cx(th, "w-28 text-right")}>Amount</th>
              <th className={cx(th, "hidden text-left sm:table-cell")}>Note</th>
              <th className={cx(th, "hidden w-28 text-left md:table-cell")}>Day</th>
              {!locked && <th className={cx(th, "w-12")} />}
            </tr>
          </thead>
          <tbody>
            {rows.map((a) =>
              locked ? (
                <tr key={a.id}>
                  <td className={cx(td, "px-3")}>{name.get(a.employeeId)}</td>
                  <td className={cx(td, "px-3")}>{ADJUSTMENT_LABELS[a.kind as keyof typeof ADJUSTMENT_LABELS] ?? a.kind}</td>
                  <td className={cx(td, "num px-3 text-right", a.amount < 0 && "text-bad")}>{money(a.amount)}</td>
                  <td className={cx(td, "hidden px-3 text-muted sm:table-cell")}>{a.note}</td>
                  <td className={cx(td, "hidden px-3 text-muted md:table-cell")}>{dayDate(a.date)}</td>
                </tr>
              ) : (
                <tr key={a.id} className="hover:bg-surface-2/60">
                  <td className={td}><GridSelect value={a.employeeId} options={employees} onSave={setAdjustmentField.bind(null, a.id, "employeeId")} ariaLabel="Person" /></td>
                  <td className={td}><GridSelect value={a.kind} options={KIND_OPTIONS} onSave={setAdjustmentField.bind(null, a.id, "kind")} ariaLabel="Kind" /></td>
                  <td className={td}><GridCell grid="adj" col="amount" type="number" prefix="$" decimals={2} value={a.amount} onSave={setAdjustmentField.bind(null, a.id, "amount")} ariaLabel="Amount" /></td>
                  <td className={cx(td, "hidden sm:table-cell")}><GridCell grid="adj" col="note" value={a.note} placeholder="Note" onSave={setAdjustmentField.bind(null, a.id, "note")} ariaLabel="Note" /></td>
                  <td className={cx(td, "hidden px-3 text-muted md:table-cell")}>{dayDate(a.date)}</td>
                  <td className={cx(td, "text-right")}>
                    <button type="button" aria-label="Delete adjustment" className="grid size-10 place-items-center rounded-md text-muted hover:bg-bad-bg hover:text-bad sm:size-8" onClick={() => start(async () => { await deleteAdjustment(a.id); })}>
                      <Trash2 className="size-3.5" />
                    </button>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      )}
      {rows.length === 0 && <div className="px-4 pt-5 pb-2 text-center text-sm text-muted">{locked ? "No adjustments this period." : "No bonuses, corrections or deductions yet."}</div>}
      {!locked && <AddAdjustment employees={employees} days={days} defaultDay={defaultDay} />}
    </div>
  );
}

function AddAdjustment({ employees, days, defaultDay }: { employees: Opt[]; days: Opt[]; defaultDay: string }) {
  const [v, setV] = useState({ employeeId: "", kind: "BONUS", amount: "", note: "", date: defaultDay });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  return (
    <div className="border-t border-border bg-surface-2/40 p-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await addAdjustment({ ...v, kind: v.kind as (typeof ADJUSTMENT_KINDS)[number] });
            if (r.error) setError(r.error);
            else {
              setError(null);
              setV((s) => ({ ...s, employeeId: "", amount: "", note: "" }));
            }
          });
        }}
        className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(9rem,1fr)_9rem_7rem_minmax(8rem,1fr)_10rem_auto] sm:items-center"
      >
        <Select value={v.employeeId} onChange={set("employeeId")} options={employees} placeholder="Person" aria-label="Person" />
        <Select value={v.kind} onChange={set("kind")} options={KIND_OPTIONS} aria-label="Kind" />
        <Input value={v.amount} onChange={set("amount")} placeholder="$ amount" inputMode="decimal" aria-label="Amount" className="num" />
        <Input value={v.note} onChange={set("note")} placeholder="Note (optional)" aria-label="Note" />
        <Select value={v.date} onChange={set("date")} options={days} aria-label="Day" className="col-span-2 sm:col-span-1" />
        <Button variant="primary" disabled={pending} className="col-span-2 sm:col-span-1">{pending ? "Adding…" : "Add"}</Button>
      </form>
      {error && <p className="mt-2 text-sm text-bad">{error}</p>}
    </div>
  );
}

export function LevelBadge({ level }: { level: "block" | "warn" | "info" }) {
  return <Badge tone={level === "block" ? "bad" : level === "warn" ? "warn" : "neutral"} className="mt-px w-[4.6rem] justify-center">{level === "block" ? "Must fix" : level === "warn" ? "Check" : "FYI"}</Badge>;
}
