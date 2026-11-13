"use client";

import { GridCell, GridSelect } from "@/components/grid";
import { useConfirm } from "@/components/dialog";
import { Badge, Button, cx, Select } from "@/components/ui";
import { formatWindows, toMinutes } from "@/domain/timecards";
import { CalendarClock, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { Fragment, useRef, useState, useTransition } from "react";
import {
  addEmployee,
  addEmployeePosition,
  addPosition,
  deletePosition,
  removeEmployeePosition,
  resetAvailability,
  setAvailabilityDay,
  setEmployeeField,
  syncTeamFromSquare,
} from "./actions";

type Result = void | { error?: string } | undefined;

/** "Type a name, press Enter" row under a grid. */
export function AddRow({ placeholder, onAdd, label }: { placeholder: string; onAdd: (name: string) => Promise<Result>; label: string }) {
  const [v, setV] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLInputElement>(null);
  const submit = () => {
    const name = v.trim();
    if (!name) return;
    start(async () => {
      const r = await onAdd(name);
      if (r && r.error) setError(r.error);
      else {
        setV("");
        setError(null);
        ref.current?.focus();
      }
    });
  };
  return (
    <div className="flex items-center gap-2 border-t border-border px-2 py-1.5">
      <Plus className="ml-1.5 size-4 shrink-0 text-muted" />
      <input
        ref={ref}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
        placeholder={placeholder}
        aria-label={label}
        disabled={pending}
        enterKeyHint="done"
        className="h-10 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 text-base text-ink placeholder:text-muted hover:border-border focus:border-ink-2 focus:bg-surface focus:outline-none sm:h-8 sm:text-sm"
      />
      {error && <span className="text-xs text-bad">{error}</span>}
      {v.trim() && <Button size="sm" variant="ghost" onClick={submit} disabled={pending}>Add</Button>}
    </div>
  );
}

export const AddPositionRow = () => <AddRow placeholder="Add a position — type a name, press Enter" label="New position name" onAdd={addPosition} />;
export const AddEmployeeRow = () => <AddRow placeholder="Add a person — type a name, press Enter" label="New employee name" onAdd={addEmployee} />;

export function DeletePositionButton({ id, name }: { id: string; name: string }) {
  const confirm = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <span className="inline-flex items-center gap-1" title={error ?? undefined}>
      <button
        type="button"
        disabled={pending}
        aria-label={`Delete ${name}`}
        onClick={async () => {
          if (!(await confirm({ title: `Delete ${name}?`, body: "People lose this position. Positions used on shifts or timecards can't be deleted.", confirmLabel: "Delete", danger: true }))) return;
          start(async () => {
            const r = await deletePosition(id);
            setError(r && r.error ? r.error : null);
          });
        }}
        className={cx("grid size-10 place-items-center rounded-md text-muted hover:bg-bad-bg hover:text-bad sm:size-8", error && "text-bad")}
      >
        <Trash2 className="size-3.5" />
      </button>
    </span>
  );
}

export function SyncTeamButton({ configured }: { configured: boolean }) {
  const [msg, setMsg] = useState<{ error?: string; message?: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {msg && <span className={cx("text-sm", msg.error ? "text-bad" : "text-good")}>{msg.error ?? msg.message}</span>}
      <Button
        onClick={() => start(async () => setMsg(await syncTeamFromSquare()))}
        disabled={pending}
        title={configured ? "Team members, wages and the last two weeks of timecards" : "Square isn't connected yet"}
      >
        <RefreshCw className={cx("size-3.5", pending && "animate-spin")} />
        {pending ? "Syncing…" : "Sync from Square"}
      </Button>
    </div>
  );
}

// ---- Employees grid -----------------------------------------------------------

export interface EmployeeRow {
  id: string;
  name: string;
  hourlyRate: number | null;
  isMinor: boolean;
  maxHoursWeek: number | null;
  active: boolean;
  userId: string | null;
  squareTeamMemberId: string | null;
  positionIds: string[];
  availability: Record<string, [string, string][]> | null;
}

export interface PositionOption {
  id: string;
  name: string;
  color: string;
}

const YES_NO = [{ value: "no", label: "No" }, { value: "yes", label: "Yes" }];
const DISPLAY_DAYS = [1, 2, 3, 4, 5, 6, 0];
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const tdCell = "border-b border-border px-2 py-1 align-middle [tr:last-child_&]:border-b-0";

export function EmployeeGrid({ employees, positions, users, openingHours }: { employees: EmployeeRow[]; positions: PositionOption[]; users: { id: string; name: string }[]; openingHours: Record<number, [number, number]> }) {
  const [open, setOpen] = useState<string | null>(null);
  const userOptions = [{ value: "", label: "None" }, ...users.map((u) => ({ value: u.id, label: u.name }))];
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr>
          <th className="border-b border-border px-4 py-2.5 text-left text-[0.75rem] font-medium text-muted">Name</th>
          <th className="hidden border-b border-border px-4 py-2.5 text-left text-[0.75rem] font-medium text-muted md:table-cell">Positions</th>
          <th className="w-24 border-b border-border px-4 py-2.5 text-right text-[0.75rem] font-medium text-muted">Rate</th>
          <th className="hidden w-20 border-b border-border px-4 py-2.5 text-left text-[0.75rem] font-medium text-muted lg:table-cell">Minor</th>
          <th className="hidden w-20 border-b border-border px-4 py-2.5 text-right text-[0.75rem] font-medium whitespace-nowrap text-muted sm:table-cell">Max h/wk</th>
          <th className="hidden w-20 border-b border-border px-4 py-2.5 text-left text-[0.75rem] font-medium text-muted lg:table-cell">Active</th>
          <th className="hidden w-32 border-b border-border px-4 py-2.5 text-left text-[0.75rem] font-medium text-muted xl:table-cell">Login</th>
          <th className="hidden w-28 border-b border-border px-4 py-2.5 text-left text-[0.75rem] font-medium text-muted xl:table-cell">Square</th>
          <th className="w-12 border-b border-border" aria-label="Availability" />
        </tr>
      </thead>
      <tbody>
        {employees.map((e) => (
          <Fragment key={e.id}>
            <tr className={cx("transition-colors hover:bg-surface-2/60", !e.active && "opacity-55")}>
              <td className={tdCell}>
                <div className="flex items-center gap-1.5">
                  <GridCell grid="emp" col="name" value={e.name} onSave={setEmployeeField.bind(null, e.id, "name")} ariaLabel="Name" className="min-w-0 flex-1 font-medium" />
                  {e.isMinor && <Badge tone="warn">Minor</Badge>}
                </div>
                <div className="px-2 pb-1 md:hidden">
                  <PositionChips employeeId={e.id} assigned={e.positionIds} positions={positions} />
                </div>
              </td>
              <td className={cx(tdCell, "hidden min-w-[19rem] md:table-cell")}>
                <PositionChips employeeId={e.id} assigned={e.positionIds} positions={positions} />
              </td>
              <td className={tdCell}>
                <GridCell grid="emp" col="rate" type="number" prefix="$" decimals={2} value={e.hourlyRate} placeholder="—" onSave={setEmployeeField.bind(null, e.id, "hourlyRate")} ariaLabel={`${e.name} hourly rate`} />
              </td>
              <td className={cx(tdCell, "hidden lg:table-cell")}>
                <GridSelect value={e.isMinor ? "yes" : "no"} options={YES_NO} onSave={setEmployeeField.bind(null, e.id, "isMinor")} ariaLabel={`${e.name} is a minor`} />
              </td>
              <td className={cx(tdCell, "hidden sm:table-cell")}>
                <GridCell grid="emp" col="max" type="number" value={e.maxHoursWeek} placeholder="—" onSave={setEmployeeField.bind(null, e.id, "maxHoursWeek")} ariaLabel={`${e.name} max hours per week`} />
              </td>
              <td className={cx(tdCell, "hidden lg:table-cell")}>
                <GridSelect value={e.active ? "yes" : "no"} options={YES_NO} onSave={setEmployeeField.bind(null, e.id, "active")} ariaLabel={`${e.name} active`} />
              </td>
              <td className={cx(tdCell, "hidden xl:table-cell")}>
                <GridSelect value={e.userId ?? ""} options={userOptions} onSave={setEmployeeField.bind(null, e.id, "userId")} ariaLabel={`${e.name} login`} />
              </td>
              <td className={cx(tdCell, "hidden xl:table-cell")}>
                {e.squareTeamMemberId ? (
                  <span className="block max-w-28 truncate px-2 font-mono text-xs text-muted" title={e.squareTeamMemberId}>{e.squareTeamMemberId}</span>
                ) : (
                  <span className="px-2 text-muted">—</span>
                )}
              </td>
              <td className={cx(tdCell, "text-right")}>
                <button
                  type="button"
                  onClick={() => setOpen(open === e.id ? null : e.id)}
                  aria-expanded={open === e.id}
                  aria-label={`${e.name} availability`}
                  title="Availability"
                  className={cx("grid size-10 place-items-center rounded-md hover:bg-surface-2 sm:size-8", open === e.id ? "bg-surface-2 text-ink" : e.availability ? "text-ink-2" : "text-muted")}
                >
                  <CalendarClock className="size-4" />
                </button>
              </td>
            </tr>
            {open === e.id && (
              <tr>
                <td colSpan={9} className="border-b border-border bg-surface-2/40 px-3 py-3 sm:px-4">
                  <AvailabilityEditor employee={e} openingHours={openingHours} users={userOptions} />
                </td>
              </tr>
            )}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

function PositionChips({ employeeId, assigned, positions }: { employeeId: string; assigned: string[]; positions: PositionOption[] }) {
  const [pending, start] = useTransition();
  const has = positions.filter((p) => assigned.includes(p.id));
  const rest = positions.filter((p) => !assigned.includes(p.id));
  return (
    <div className={cx("flex flex-wrap items-center gap-1", pending && "opacity-60")}>
      {has.map((p) => (
        <span key={p.id} className="inline-flex h-7 items-center gap-1.5 rounded-md bg-surface-2 pr-0.5 pl-2 text-xs text-ink-2">
          <span className="size-1.5 rounded-full" style={{ background: p.color }} />
          {p.name}
          <button
            type="button"
            aria-label={`Remove ${p.name}`}
            disabled={pending}
            onClick={() => start(async () => { await removeEmployeePosition(employeeId, p.id); })}
            className="grid size-6 place-items-center rounded text-muted hover:bg-surface hover:text-ink"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      {rest.length > 0 && (
        <div className="w-[4.75rem]">
          <Select
            variant="cell"
            value=""
            placeholder="+ Add"
            aria-label="Add position"
            options={rest.map((p) => ({ value: p.id, label: p.name }))}
            disabled={pending}
            className="text-xs text-muted"
            onChange={(ev) => start(async () => { await addEmployeePosition(employeeId, ev.target.value); })}
          />
        </div>
      )}
    </div>
  );
}

function DayBar({ windows, opening }: { windows: [string, string][] | undefined; opening?: [number, number] }) {
  const pct = (m: number) => `${(m / 1440) * 100}%`;
  return (
    <div className="relative h-2 w-full overflow-hidden rounded-full bg-border/60" aria-hidden>
      {opening && <div className="absolute inset-y-0 bg-border-strong/60" style={{ left: pct(opening[0] * 60), width: pct((opening[1] - opening[0]) * 60) }} />}
      {(windows ?? []).map(([a, b], i) => (
        <div key={i} className="absolute inset-y-0 rounded-full bg-ink" style={{ left: pct(toMinutes(a)), width: pct(toMinutes(b) - toMinutes(a)) }} />
      ))}
    </div>
  );
}

function AvailabilityEditor({ employee: e, openingHours, users }: { employee: EmployeeRow; openingHours: Record<number, [number, number]>; users: { value: string; label: string }[] }) {
  const [pending, start] = useTransition();
  const notSet = e.availability == null;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm">
          <span className="font-medium">{e.name}&rsquo;s availability</span>
          <span className="ml-2 text-muted">{notSet ? "Not set — scheduling treats them as always available." : "Type ranges like 4p-10p, 11-2 or all day. Blank = unavailable."}</span>
        </div>
        <div className="flex gap-1">
          {notSet ? (
            <Button size="sm" disabled={pending} onClick={() => start(async () => { await resetAvailability(e.id, "all"); })}>Set availability</Button>
          ) : (
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => { await resetAvailability(e.id, "clear"); })}>Clear (always available)</Button>
          )}
        </div>
      </div>
      {!notSet && (
        <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {DISPLAY_DAYS.map((d) => {
            const windows = e.availability?.[String(d)];
            return (
              <div key={d} className="grid grid-cols-[2.5rem_1fr] items-center gap-2 sm:grid-cols-[2.5rem_11rem_1fr]">
                <span className="text-xs font-medium text-ink-2">{DAY_NAMES[d]}</span>
                <GridCell grid={`avail-${e.id}`} col="day" value={formatWindows(windows)} placeholder="Unavailable" onSave={setAvailabilityDay.bind(null, e.id, d)} ariaLabel={`${DAY_NAMES[d]} availability`} />
                <div className="col-span-2 pb-1 sm:col-span-1 sm:pb-0">
                  <DayBar windows={windows} opening={openingHours[d]} />
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
        {!notSet && (
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-4 rounded-full bg-ink" /> available <span className="ml-2 h-2 w-4 rounded-full bg-border-strong/60" /> open hours</span>
        )}
        {/* Phones don't show the login/max-hours columns, so offer them here. */}
        <span className="inline-flex items-center gap-2 xl:hidden">
          Login
          <span className="w-36"><GridSelect value={e.userId ?? ""} options={users} onSave={setEmployeeField.bind(null, e.id, "userId")} ariaLabel={`${e.name} login`} /></span>
        </span>
        <span className="inline-flex items-center gap-2 sm:hidden">
          Max h/wk
          <span className="w-20"><GridCell grid={`emp-m-${e.id}`} col="max" type="number" value={e.maxHoursWeek} placeholder="—" onSave={setEmployeeField.bind(null, e.id, "maxHoursWeek")} ariaLabel={`${e.name} max hours per week`} /></span>
        </span>
        <span className="inline-flex items-center gap-2 lg:hidden">
          Active
          <span className="w-24"><GridSelect value={e.active ? "yes" : "no"} options={YES_NO} onSave={setEmployeeField.bind(null, e.id, "active")} ariaLabel={`${e.name} active`} /></span>
        </span>
        <span className="inline-flex items-center gap-2 lg:hidden">
          Minor
          <span className="w-24"><GridSelect value={e.isMinor ? "yes" : "no"} options={YES_NO} onSave={setEmployeeField.bind(null, e.id, "isMinor")} ariaLabel={`${e.name} is a minor`} /></span>
        </span>
        {e.squareTeamMemberId && <span className="xl:hidden">Square ID <span className="font-mono">{e.squareTeamMemberId}</span></span>}
      </div>
    </div>
  );
}
