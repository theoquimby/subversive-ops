"use client";

import { GridCell, GridSelect } from "@/components/grid";
import { useConfirm } from "@/components/dialog";
import { Badge, Button, cx, Input, Select } from "@/components/ui";
import { formatWindows, toMinutes } from "@/domain/timecards";
import { KeyRound, Plus, RefreshCw, Trash2, UserPlus, X } from "lucide-react";
import { useMemo, useRef, useState, useTransition } from "react";
import { BulkPick, DataTable, type Column, type Filter, type GroupBy } from "@/components/data-table";
import {
  addEmployee,
  addEmployeePosition,
  addPosition,
  bulkActive,
  bulkPosition,
  deletePosition,
  inviteEmployee,
  removeEmployeePosition,
  resetAvailability,
  setAvailabilityDay,
  setEmployeeField,
  syncTeamFromSquare,
} from "./actions";
import type { CertStatus } from "@/domain/certs";
import { CertChip } from "./training/cert-chip";

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
  /** Paid sick leave available this year, in hours. */
  sickAvailable: number | null;
  /** e.g. "under $16.00 minimum" when their base rate is below the legal floor. */
  rateWarning: string | null;
  /** Worst required certificate status, linking to /team/training. */
  certs?: { status: CertStatus; label: string } | null;
}

export interface PositionOption {
  id: string;
  name: string;
  color: string;
}

const YES_NO = [{ value: "no", label: "No" }, { value: "yes", label: "Yes" }];
const DISPLAY_DAYS = [1, 2, 3, 4, 5, 6, 0];
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];


export function EmployeeGrid({ employees, positions, users, openingHours }: { employees: EmployeeRow[]; positions: PositionOption[]; users: { id: string; name: string }[]; openingHours: Record<number, [number, number]> }) {
  const userOptions = useMemo(() => [{ value: "", label: "None" }, ...users.map((u) => ({ value: u.id, label: u.name }))], [users]);
  const posName = useMemo(() => new Map(positions.map((p) => [p.id, p.name])), [positions]);
  const columns = useMemo<Column<EmployeeRow>[]>(() => [
    {
      id: "name",
      header: "Name",
      edit: true,
      width: 220,
      sort: (e) => e.name,
      csv: (e) => e.name,
      cell: (e) => (
        <>
          <GridCell grid="emp" col="name" value={e.name} onSave={setEmployeeField.bind(null, e.id, "name")} ariaLabel={`Name of ${e.name}`} className="min-w-28 font-medium" />
          {((e.certs && e.certs.status !== "not-required") || e.isMinor) && (
            <div className="flex flex-wrap gap-1 px-2 pb-1">
              {e.certs && e.certs.status !== "not-required" && <CertChip employeeId={e.id} chip={e.certs} />}
              {e.isMinor && <Badge tone="warn">Minor</Badge>}
            </div>
          )}
        </>
      ),
    },
    { id: "positions", header: "Positions", edit: true, width: 300, sort: (e) => e.positionIds.map((id) => posName.get(id)).join(", "), csv: (e) => e.positionIds.map((id) => posName.get(id)).join("; "), cell: (e) => <div className="px-1.5"><PositionChips employeeId={e.id} assigned={e.positionIds} positions={positions} /></div> },
    {
      id: "rate",
      header: "Rate",
      align: "right",
      edit: true,
      width: 112,
      firstDir: "desc",
      sort: (e) => e.hourlyRate,
      csv: (e) => e.hourlyRate,
      cell: (e) => (
        <>
          <GridCell grid="emp" col="rate" type="number" prefix="$" decimals={2} value={e.hourlyRate} placeholder="—" onSave={setEmployeeField.bind(null, e.id, "hourlyRate")} ariaLabel={`${e.name} hourly rate`} className={e.rateWarning ? "[&_input]:text-bad" : undefined} />
          {e.rateWarning && <div className="px-2 pb-1 text-right text-[11px] text-bad">{e.rateWarning}</div>}
        </>
      ),
    },
    { id: "minor", header: "Minor", edit: true, width: 88, sort: (e) => e.isMinor, csv: (e) => (e.isMinor ? "yes" : "no"), cell: (e) => <GridSelect value={e.isMinor ? "yes" : "no"} options={YES_NO} onSave={setEmployeeField.bind(null, e.id, "isMinor")} ariaLabel={`${e.name} is a minor`} /> },
    { id: "max", header: "Max h/wk", align: "right", edit: true, width: 96, sort: (e) => e.maxHoursWeek, csv: (e) => e.maxHoursWeek, cell: (e) => <GridCell grid="emp" col="max" type="number" value={e.maxHoursWeek} placeholder="—" onSave={setEmployeeField.bind(null, e.id, "maxHoursWeek")} ariaLabel={`${e.name} max hours per week`} /> },
    { id: "sick", header: "Sick", label: "Sick leave available", align: "right", firstDir: "desc", sort: (e) => e.sickAvailable, csv: (e) => e.sickAvailable, cell: (e) => <span className="text-muted">{e.sickAvailable == null ? "—" : `${e.sickAvailable.toFixed(1)}h`}</span> },
    { id: "active", header: "Active", edit: true, width: 88, sort: (e) => e.active, csv: (e) => (e.active ? "yes" : "no"), cell: (e) => <GridSelect value={e.active ? "yes" : "no"} options={YES_NO} onSave={setEmployeeField.bind(null, e.id, "active")} ariaLabel={`${e.name} active`} /> },
    {
      id: "login",
      header: "Login",
      edit: true,
      width: 140,
      sort: (e) => (e.userId ? users.find((u) => u.id === e.userId)?.name ?? "yes" : null),
      csv: (e) => (e.userId ? users.find((u) => u.id === e.userId)?.name : ""),
      cell: (e) => (e.userId ? <GridSelect value={e.userId} options={userOptions} onSave={setEmployeeField.bind(null, e.id, "userId")} ariaLabel={`${e.name} login`} /> : <span className="inline-flex h-8 items-center gap-1.5 px-2 text-xs text-muted"><UserPlus className="size-3.5" /> Invite from the row</span>),
    },
    { id: "avail", header: "Availability", sort: (e) => (e.availability ? 1 : 0), csv: (e) => (e.availability ? "set" : "always"), cell: (e) => (e.availability ? <WeekDots availability={e.availability} /> : <span className="text-xs text-muted">Always available</span>) },
    { id: "square", header: "Square", defaultHidden: true, sort: (e) => e.squareTeamMemberId, csv: (e) => e.squareTeamMemberId, cell: (e) => (e.squareTeamMemberId ? <span className="block max-w-28 truncate font-mono text-xs text-muted" title={e.squareTeamMemberId}>{e.squareTeamMemberId}</span> : <span className="text-muted">—</span>) },
  ], [positions, posName, userOptions, users]);

  const filters = useMemo<Filter<EmployeeRow>[]>(() => [
    { id: "position", label: "Position", kind: "facet", values: (e) => (e.positionIds.length ? e.positionIds : ["none"]), options: [...positions.map((p) => ({ value: p.id, label: p.name })), { value: "none", label: "No position" }], param: "position" },
    { id: "status", label: "Status", kind: "facet", values: (e) => (e.active ? "active" : "inactive"), options: [{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }], single: true, param: "status" },
    { id: "nologin", label: "No login", kind: "toggle", test: (e) => !e.userId },
    { id: "minor", label: "Minors", kind: "toggle", test: (e) => e.isMinor, tone: "warn" },
    { id: "rate", label: "Rate below minimum", kind: "toggle", test: (e) => !!e.rateWarning, tone: "bad" },
    { id: "norate", label: "No rate", kind: "toggle", test: (e) => e.hourlyRate == null },
    { id: "certs", label: "Certificate due", kind: "toggle", test: (e) => !!e.certs && e.certs.status !== "valid" && e.certs.status !== "not-required", tone: "warn" },
  ], [positions]);

  const groups = useMemo<GroupBy<EmployeeRow>[]>(() => [
    { id: "position", label: "First position", key: (e) => posName.get(e.positionIds[0]) ?? null, title: (k) => k || "No position" },
    { id: "status", label: "Active or not", key: (e) => (e.active ? "Active" : "Inactive") },
  ], [posName]);

  return (
    <DataTable
      id="team-people"
      rows={employees}
      rowKey={(e) => e.id}
      columns={columns}
      noun={["person", "people"]}
      searchText={(e) => `${e.name} ${e.positionIds.map((id) => posName.get(id)).join(" ")} ${e.squareTeamMemberId ?? ""}`}
      filters={filters}
      groups={groups}
      defaultView={{ filters: { status: ["active"] } }}
      rowClassName={(e) => (e.active ? undefined : "opacity-60")}
      csvName="team"
      footer={<AddEmployeeRow />}
      summary={(vis) => [
        { value: vis.length, label: vis.length === 1 ? "person" : "people" },
        { value: vis.filter((e) => !e.userId).length, label: "without a login", filter: { id: "nologin" } },
        { value: vis.filter((e) => !!e.rateWarning).length, label: "under minimum wage", tone: "bad", filter: { id: "rate" } },
        { value: vis.filter((e) => e.isMinor).length, label: "minors", tone: "warn", filter: { id: "minor" } },
      ]}
      card={(e) => ({
        title: <>{e.name}{!e.active && <span className="font-normal text-muted"> · inactive</span>}</>,
        subtitle: e.positionIds.map((id) => posName.get(id)).join(", ") || "No position",
        value: e.hourlyRate == null ? "—" : `$${e.hourlyRate.toFixed(2)}`,
        sub: e.rateWarning ? <span className="text-bad">{e.rateWarning}</span> : e.userId ? "has login" : "no login",
      })}
      drawerTitle={(e) => e.name}
      drawer={(e) => (
        <div className="space-y-5">
          <div className="md:hidden"><PositionChips employeeId={e.id} assigned={e.positionIds} positions={positions} /></div>
          {!e.userId && <InviteBox employee={e} />}
          <AvailabilityEditor employee={e} openingHours={openingHours} users={userOptions} />
        </div>
      )}
      bulkActions={(api) => (
        <>
          <BulkPick label="Add position" options={positions.map((p) => ({ value: p.id, label: p.name }))} disabled={api.pending} onPick={(pid) => api.run(() => bulkPosition(api.keys, pid, true))} />
          <BulkPick label="Remove position" options={positions.map((p) => ({ value: p.id, label: p.name }))} disabled={api.pending} onPick={(pid) => api.run(() => bulkPosition(api.keys, pid, false))} />
          <Button size="sm" disabled={api.pending} onClick={() => api.run(() => bulkActive(api.keys, true))}>Active</Button>
          <Button size="sm" variant="ghost" disabled={api.pending} onClick={() => api.run(() => bulkActive(api.keys, false))}>Inactive</Button>
        </>
      )}
    />
  );
}

/** Seven tiny bars, Mon–Sun: which days someone is available. */
function WeekDots({ availability }: { availability: Record<string, [string, string][]> }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`Available ${DISPLAY_DAYS.filter((d) => availability[String(d)]?.length).map((d) => DAY_NAMES[d]).join(", ") || "no days"}`}>
      {DISPLAY_DAYS.map((d) => <span key={d} title={DAY_NAMES[d]} className={cx("h-3 w-1.5 rounded-sm", availability[String(d)]?.length ? "bg-ink-2" : "bg-border")} />)}
    </span>
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
            className="relative grid size-6 place-items-center rounded text-muted after:absolute after:-inset-2 after:content-[''] hover:bg-surface hover:text-ink"
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
        {e.squareTeamMemberId && <span className="2xl:hidden">Square ID <span className="font-mono">{e.squareTeamMemberId}</span></span>}
        {e.sickAvailable != null && <span className="xl:hidden">Sick leave <span className="num">{e.sickAvailable.toFixed(1)}h</span> available</span>}
      </div>
    </div>
  );
}

/** Create a staff login with a PIN and link it, in one step. Shows the PIN once. */
function InviteBox({ employee: e }: { employee: EmployeeRow }) {
  const [name, setName] = useState(e.name.split(" ")[0] ?? e.name);
  const [pin, setPin] = useState("");
  const [result, setResult] = useState<{ error?: string; name?: string; pin?: string } | null>(null);
  const [pending, start] = useTransition();
  if (result?.pin) {
    return (
      <div className="mb-4 flex items-start gap-3 rounded-lg bg-good-bg px-3 py-2.5 text-sm text-good">
        <KeyRound className="mt-0.5 size-4 shrink-0" />
        <div>
          <div className="font-medium">Login ready: {result.name} · PIN <span className="num tracking-widest">{result.pin}</span></div>
          <div className="text-xs">Share it with {e.name.split(" ")[0]}. They sign in on their phone and land on My shifts. The PIN isn&apos;t shown again (reset it in Settings).</div>
        </div>
      </div>
    );
  }
  return (
    <div className="mb-4 rounded-lg border border-border bg-surface px-3 py-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium"><UserPlus className="size-4" /> Give {e.name.split(" ")[0]} a login</div>
      <form
        className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(8rem,12rem)_8rem_auto] sm:items-center"
        onSubmit={(ev) => {
          ev.preventDefault();
          start(async () => setResult(await inviteEmployee(e.id, name, pin)));
        }}
      >
        <Input aria-label="Login name" value={name} onChange={(ev) => setName(ev.target.value)} placeholder="Login name" />
        <Input aria-label="PIN (blank for a random one)" value={pin} onChange={(ev) => setPin(ev.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="PIN (random)" inputMode="numeric" className="num" />
        <Button variant="primary" disabled={pending || !name.trim()} className="col-span-2 sm:col-span-1">{pending ? "Creating…" : "Create login"}</Button>
      </form>
      <p className="mt-1.5 text-xs text-muted">{result?.error ? <span className="text-bad">{result.error}</span> : "Staff logins only see My shifts, counts and waste."}</p>
    </div>
  );
}
