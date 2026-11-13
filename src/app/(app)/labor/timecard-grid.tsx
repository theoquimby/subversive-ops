"use client";

import { useConfirm } from "@/components/dialog";
import { GridCell, GridSelect } from "@/components/grid";
import { Badge, Button, cx, DatePicker, Input, Select } from "@/components/ui";
import { addDays } from "@/domain/dates";
import { money } from "@/lib/format";
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addTimecard, deleteTimecard, setTimecardField } from "./actions";

export interface CardRow {
  id: string;
  employeeId: string;
  positionId: string | null;
  date: string;
  inLabel: string;
  outLabel: string | null;
  breakMinutes: number;
  ownRate: number | null;
  rate: number | null;
  hours: number;
  cost: number;
  source: "SQUARE" | "MANUAL";
  open: boolean;
}

type Opt = { value: string; label: string };

const td = "border-b border-border px-0.5 py-1 sm:px-1.5 align-middle [tr:last-child_&]:border-b-0";
const th = "border-b border-border px-3 py-2.5 text-[0.75rem] font-medium whitespace-nowrap text-muted";

export function WeekPicker({ week, label }: { week: string; label: string }) {
  const router = useRouter();
  const go = (w: string) => router.push(`/labor?week=${w}`);
  const monday = (d: string) => {
    const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
    return addDays(d, -((wd + 6) % 7));
  };
  return (
    <div className="flex items-center gap-1">
      <Button className="size-10 px-0 sm:size-9" aria-label="Previous week" onClick={() => go(addDays(week, -7))}><ChevronLeft className="size-4" /></Button>
      <div className="w-56">
        <DatePicker value={week} onChange={(e) => go(monday(e.target.value))} aria-label={`Week of ${label}`} />
      </div>
      <Button className="size-10 px-0 sm:size-9" aria-label="Next week" onClick={() => go(addDays(week, 7))}><ChevronRight className="size-4" /></Button>
    </div>
  );
}

export function TimecardGrid({ cards, employees, positions, days, defaultDay }: { cards: CardRow[]; employees: Opt[]; positions: Opt[]; days: Opt[]; defaultDay: string }) {
  const confirm = useConfirm();
  const [, start] = useTransition();
  const posOptions = [{ value: "", label: "—" }, ...positions];
  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed border-collapse text-sm sm:table-auto">
        <thead>
          <tr>
            <th className={cx(th, "text-left")}>Person</th>
            <th className={cx(th, "hidden text-left lg:table-cell")}>Position</th>
            <th className={cx(th, "hidden text-left sm:table-cell")}>Day</th>
            <th className={cx(th, "w-[5.25rem] px-2 text-left sm:w-24")}>In</th>
            <th className={cx(th, "w-[5.25rem] px-2 text-left sm:w-24")}>Out</th>
            <th className={cx(th, "hidden w-20 text-right md:table-cell")}>Break</th>
            <th className={cx(th, "w-11 px-1 text-right sm:w-16 sm:px-3")}>Hours</th>
            <th className={cx(th, "hidden w-24 text-right md:table-cell")}>Rate</th>
            <th className={cx(th, "hidden w-24 text-right sm:table-cell")}>Cost</th>
            <th className={cx(th, "w-10 sm:w-12")} />
          </tr>
        </thead>
        <tbody>
          {cards.map((c) => (
            <tr key={c.id} className="transition-colors hover:bg-surface-2/60">
              <td className={td}>
                <div className="flex items-center gap-1">
                  <div className="min-w-0 flex-1 sm:min-w-32">
                    <GridSelect value={c.employeeId} options={employees} onSave={setTimecardField.bind(null, c.id, "employeeId")} ariaLabel="Person" />
                  </div>
                  {c.source === "SQUARE" && <Badge className="hidden xl:inline-flex" tone="neutral">Square</Badge>}
                </div>
                <div className="px-2 text-xs text-muted sm:hidden">{days.find((d) => d.value === c.date)?.label}</div>
              </td>
              <td className={cx(td, "hidden lg:table-cell")}>
                <GridSelect value={c.positionId ?? ""} options={posOptions} onSave={setTimecardField.bind(null, c.id, "positionId")} ariaLabel="Position" />
              </td>
              <td className={cx(td, "hidden sm:table-cell")}>
                <GridSelect value={c.date} options={days} onSave={setTimecardField.bind(null, c.id, "date")} ariaLabel="Day" />
              </td>
              <td className={td}>
                <GridCell grid="tc" col="in" value={c.inLabel} onSave={setTimecardField.bind(null, c.id, "clockIn")} ariaLabel="Clock in" />
              </td>
              <td className={td}>
                <GridCell grid="tc" col="out" value={c.outLabel} placeholder="On shift" onSave={setTimecardField.bind(null, c.id, "clockOut")} ariaLabel="Clock out" className={c.open ? "[&_input]:placeholder:text-good" : undefined} />
              </td>
              <td className={cx(td, "hidden md:table-cell")}>
                <GridCell grid="tc" col="break" type="number" suffix="m" value={c.breakMinutes} onSave={setTimecardField.bind(null, c.id, "breakMinutes")} ariaLabel="Unpaid break minutes" />
              </td>
              <td className={cx(td, "num px-1 text-right sm:px-3")}>{c.hours.toFixed(2)}</td>
              <td className={cx(td, "hidden md:table-cell")}>
                <GridCell grid="tc" col="rate" type="number" prefix="$" decimals={2} value={c.ownRate} placeholder={c.rate != null ? c.rate.toFixed(2) : "none"} onSave={setTimecardField.bind(null, c.id, "hourlyRate")} ariaLabel="Rate override" />
              </td>
              <td className={cx(td, "num hidden px-3 text-right sm:table-cell", c.rate == null && "text-warn")}>{c.rate == null ? "No rate" : money(c.cost)}</td>
              <td className={cx(td, "text-right")}>
                <button
                  type="button"
                  aria-label="Delete timecard"
                  className="grid size-10 place-items-center rounded-md text-muted hover:bg-bad-bg hover:text-bad sm:size-8"
                  onClick={async () => {
                    if (await confirm({ title: "Delete this timecard?", body: c.source === "SQUARE" ? "It came from Square and will come back on the next sync unless it's removed there too." : undefined, confirmLabel: "Delete", danger: true })) start(async () => { await deleteTimecard(c.id); });
                  }}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <AddTimecard employees={employees} positions={positions} days={days} defaultDay={defaultDay} />
    </div>
  );
}

function AddTimecard({ employees, positions, days, defaultDay }: { employees: Opt[]; positions: Opt[]; days: Opt[]; defaultDay: string }) {
  const [v, setV] = useState({ employeeId: "", positionId: "", date: defaultDay, clockIn: "", clockOut: "", breakMinutes: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  const submit = () =>
    start(async () => {
      const r = await addTimecard({ ...v, breakMinutes: v.breakMinutes || 0 });
      if (r.error) setError(r.error);
      else {
        setError(null);
        setV((s) => ({ ...s, employeeId: "", clockIn: "", clockOut: "", breakMinutes: "" }));
      }
    });
  return (
    <div className="border-t border-border bg-surface-2/40 p-3">
      <div className="mb-2 text-xs font-medium text-ink-2">Add a timecard</div>
      <form
        onSubmit={(e) => { e.preventDefault(); submit(); }}
        className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(9rem,1fr)_minmax(8rem,1fr)_minmax(9rem,1fr)_5.5rem_5.5rem_5rem_auto] sm:items-center"
      >
        <Select value={v.employeeId} onChange={set("employeeId")} options={employees} placeholder="Person" aria-label="Person" />
        <Select value={v.positionId} onChange={set("positionId")} options={[{ value: "", label: "Usual position" }, ...positions]} placeholder="Position" aria-label="Position" />
        <Select value={v.date} onChange={set("date")} options={days} aria-label="Day" className="col-span-2 sm:col-span-1" />
        <Input value={v.clockIn} onChange={set("clockIn")} placeholder="In (4p)" aria-label="Clock in" />
        <Input value={v.clockOut} onChange={set("clockOut")} placeholder="Out" aria-label="Clock out (blank if still on shift)" />
        <Input value={v.breakMinutes} onChange={set("breakMinutes")} placeholder="Break m" inputMode="numeric" aria-label="Break minutes" className="num" />
        <Button variant="primary" disabled={pending} className="col-span-2 sm:col-span-1">{pending ? "Adding…" : "Add"}</Button>
      </form>
      {error && <p className="mt-2 text-sm text-bad">{error}</p>}
    </div>
  );
}
