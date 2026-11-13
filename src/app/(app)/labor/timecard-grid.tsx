"use client";

import { useConfirm } from "@/components/dialog";
import { GridCell, GridSelect } from "@/components/grid";
import { Badge, Button, cx, Input, Select } from "@/components/ui";
import { money } from "@/lib/format";
import { Trash2 } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
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
  /** Changed in Ops; the Square sync keeps our version. */
  edited: boolean;
}

type Opt = { value: string; label: string };

const td = "border-b border-border px-0.5 py-1 sm:px-1.5 align-middle [tbody:last-of-type_tr:last-child_&]:border-b-0";
const th = "border-b border-border px-3 py-2.5 text-[0.75rem] font-medium whitespace-nowrap text-muted";

export function TimecardGrid({ cards, employees, positions, days, defaultDay, locked = false }: { cards: CardRow[]; employees: Opt[]; positions: Opt[]; days: Opt[]; defaultDay: string; locked?: boolean }) {
  const confirm = useConfirm();
  const [, start] = useTransition();
  const posOptions = [{ value: "", label: "—" }, ...positions];
  if (locked) return <LockedCards cards={cards} employees={employees} positions={positions} days={days} />;
  const nameOf = (id: string) => employees.find((e) => e.value === id)?.label ?? "Unknown";
  const dayOf = (d: string) => days.find((x) => x.value === d)?.label ?? d;
  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed border-collapse text-sm sm:table-auto">
        <thead>
          <tr>
            <th className={cx(th, "hidden text-left sm:table-cell")}>Person</th>
            <th className={cx(th, "hidden text-left lg:table-cell")}>Position</th>
            <th className={cx(th, "hidden text-left sm:table-cell")}>Day</th>
            <th className={cx(th, "px-2 text-left sm:w-24")}>In</th>
            <th className={cx(th, "px-2 text-left sm:w-24")}>Out</th>
            <th className={cx(th, "hidden w-20 text-right md:table-cell")}>Break</th>
            <th className={cx(th, "w-14 px-1 text-right sm:w-16 sm:px-3")}>Hours</th>
            <th className={cx(th, "hidden w-24 text-right md:table-cell")}>Rate</th>
            <th className={cx(th, "hidden w-24 text-right sm:table-cell")}>Cost</th>
            <th className={cx(th, "w-11 sm:w-12")} />
          </tr>
        </thead>
        {cards.map((c) => {
          const who = `${nameOf(c.employeeId)}, ${dayOf(c.date)}`;
          const person = (
            <PersonCell
              value={c.employeeId}
              options={employees}
              ariaLabel={`Person on timecard: ${who}`}
              ask={(next) =>
                confirm({
                  title: `Move this timecard to ${nameOf(next)}?`,
                  body: `${nameOf(c.employeeId)}'s ${c.inLabel}–${c.outLabel ?? "now"} shift on ${dayOf(c.date)} will count toward ${nameOf(next)}'s hours and pay instead.`,
                  confirmLabel: "Move timecard",
                })
              }
              save={(next) => setTimecardField(c.id, "employeeId", next)}
            />
          );
          return (
            <tbody key={c.id} className="transition-colors hover:bg-surface-2/60">
              {/* Phone: name and day get their own line so they aren't cut off. */}
              <tr className="sm:hidden">
                <td colSpan={4} className="px-0.5 pt-2">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">{person}</div>
                    <span className="shrink-0 pr-2 text-xs text-muted">{dayOf(c.date)}</span>
                  </div>
                </td>
              </tr>
              <tr>
                <td className={cx(td, "hidden sm:table-cell")}>
                  <div className="flex items-center gap-1">
                    <div className="min-w-32 flex-1">{person}</div>
                    {c.source === "SQUARE" && <Badge className="hidden xl:inline-flex" tone="neutral">{c.edited ? "Square · edited" : "Square"}</Badge>}
                  </div>
                </td>
                <td className={cx(td, "hidden lg:table-cell")}>
                  <GridSelect value={c.positionId ?? ""} options={posOptions} onSave={setTimecardField.bind(null, c.id, "positionId")} ariaLabel={`Position on timecard: ${who}`} />
                </td>
                <td className={cx(td, "hidden sm:table-cell")}>
                  <GridSelect value={c.date} options={days} onSave={setTimecardField.bind(null, c.id, "date")} ariaLabel={`Day on timecard: ${who}`} />
                </td>
                <td className={td}>
                  <GridCell grid="tc" col="in" value={c.inLabel} onSave={setTimecardField.bind(null, c.id, "clockIn")} ariaLabel={`Clock in: ${who}`} />
                </td>
                <td className={td}>
                  <GridCell grid="tc" col="out" value={c.outLabel} placeholder="On shift" onSave={setTimecardField.bind(null, c.id, "clockOut")} ariaLabel={`Clock out: ${who}`} className={c.open ? "[&_input]:placeholder:text-good" : undefined} />
                </td>
                <td className={cx(td, "hidden md:table-cell")}>
                  <GridCell grid="tc" col="break" type="number" suffix="m" value={c.breakMinutes} onSave={setTimecardField.bind(null, c.id, "breakMinutes")} ariaLabel={`Unpaid break minutes: ${who}`} />
                </td>
                <td className={cx(td, "num px-1 text-right sm:px-3")}>{c.hours.toFixed(2)}</td>
                <td className={cx(td, "hidden md:table-cell")}>
                  <GridCell grid="tc" col="rate" type="number" prefix="$" decimals={2} value={c.ownRate} placeholder={c.rate != null ? c.rate.toFixed(2) : "none"} onSave={setTimecardField.bind(null, c.id, "hourlyRate")} ariaLabel={`Rate override: ${who}`} />
                </td>
                <td className={cx(td, "num hidden px-3 text-right sm:table-cell", c.rate == null && "text-warn")}>{c.rate == null ? "No rate" : money(c.cost)}</td>
                <td className={cx(td, "text-right")}>
                  <button
                    type="button"
                    aria-label={`Delete timecard: ${who}`}
                    className="grid size-10 place-items-center rounded-md text-muted hover:bg-bad-bg hover:text-bad sm:size-8"
                    onClick={async () => {
                      if (await confirm({ title: "Delete this timecard?", body: c.source === "SQUARE" ? "It came from Square and will come back on the next sync unless it's removed there too. To fix it instead, edit the times: edited cards are kept." : undefined, confirmLabel: "Delete", danger: true })) start(async () => { await deleteTimecard(c.id); });
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </td>
              </tr>
            </tbody>
          );
        })}
      </table>
      <AddTimecard employees={employees} positions={positions} days={days} defaultDay={defaultDay} />
    </div>
  );
}

/**
 * Person picker that asks before moving a card to someone else. The question
 * is asked outside the save transition so the dialog can render.
 */
function PersonCell({ value, options, ariaLabel, ask, save }: { value: string; options: Opt[]; ariaLabel: string; ask: (next: string) => Promise<boolean>; save: (next: string) => Promise<void | { error?: string }> }) {
  const [v, setV] = useState(value);
  const [pending, start] = useTransition();
  useEffect(() => setV(value), [value]);
  return (
    <Select
      variant="cell"
      aria-label={ariaLabel}
      value={v}
      options={options}
      disabled={pending}
      className={cx(pending && "opacity-60")}
      onChange={async (e) => {
        const next = e.target.value;
        if (next === v) return;
        const prev = v;
        setV(next);
        if (!(await ask(next))) return setV(prev);
        start(async () => {
          const r = await save(next);
          if (r && r.error) setV(prev);
        });
      }}
    />
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
        <Select value={v.employeeId} onChange={set("employeeId")} options={employees} placeholder="Person" aria-label="New timecard: person" />
        <Select value={v.positionId} onChange={set("positionId")} options={[{ value: "", label: "Usual position" }, ...positions]} placeholder="Position" aria-label="New timecard: position" />
        <Select value={v.date} onChange={set("date")} options={days} aria-label="New timecard: day" className="col-span-2 sm:col-span-1" />
        <Input value={v.clockIn} onChange={set("clockIn")} placeholder="In (4p)" aria-label="New timecard: clock in" />
        <Input value={v.clockOut} onChange={set("clockOut")} placeholder="Out" aria-label="New timecard: clock out (blank if still on shift)" />
        <Input value={v.breakMinutes} onChange={set("breakMinutes")} placeholder="Break m" inputMode="numeric" aria-label="New timecard: break minutes" className="num" />
        <Button variant="primary" disabled={pending} className="col-span-2 sm:col-span-1">{pending ? "Adding…" : "Add"}</Button>
      </form>
      {error && <p className="mt-2 text-sm text-bad">{error}</p>}
    </div>
  );
}

/** Read-only view for an approved pay period. */
function LockedCards({ cards, employees, positions, days }: { cards: CardRow[]; employees: Opt[]; positions: Opt[]; days: Opt[] }) {
  const label = (opts: Opt[], v: string | null) => opts.find((o) => o.value === v)?.label ?? "—";
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className={cx(th, "text-left")}>Person</th>
            <th className={cx(th, "hidden text-left lg:table-cell")}>Position</th>
            <th className={cx(th, "hidden text-left sm:table-cell")}>Day</th>
            <th className={cx(th, "text-left")}>In</th>
            <th className={cx(th, "text-left")}>Out</th>
            <th className={cx(th, "hidden text-right md:table-cell")}>Break</th>
            <th className={cx(th, "text-right")}>Hours</th>
            <th className={cx(th, "hidden text-right sm:table-cell")}>Cost</th>
          </tr>
        </thead>
        <tbody>
          {cards.map((c) => (
            <tr key={c.id}>
              <td className={cx(td, "px-3 py-2.5")}>
                <span className="font-medium">{label(employees, c.employeeId)}</span>
                {c.edited && <Badge className="ml-2 hidden sm:inline-flex">Edited</Badge>}
                <div className="text-xs text-muted sm:hidden">{label(days, c.date)}</div>
              </td>
              <td className={cx(td, "hidden px-3 lg:table-cell")}>{label(positions, c.positionId)}</td>
              <td className={cx(td, "hidden px-3 sm:table-cell")}>{label(days, c.date)}</td>
              <td className={cx(td, "num px-3")}>{c.inLabel}</td>
              <td className={cx(td, "num px-3", !c.outLabel && "text-warn")}>{c.outLabel ?? "Open"}</td>
              <td className={cx(td, "num hidden px-3 text-right md:table-cell")}>{c.breakMinutes}m</td>
              <td className={cx(td, "num px-3 text-right")}>{c.hours.toFixed(2)}</td>
              <td className={cx(td, "num hidden px-3 text-right sm:table-cell", c.rate == null && "text-warn")}>{c.rate == null ? "No rate" : money(c.cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
