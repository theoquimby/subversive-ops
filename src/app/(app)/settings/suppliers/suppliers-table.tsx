"use client";

import { DataTable, type Column, type Filter } from "@/components/data-table";
import { GridCell, GridSelect } from "@/components/grid";
import { Badge, Button, Input } from "@/components/ui";
import { WEEKDAYS } from "@/domain/dates";
import { cn } from "@/lib/cn";
import { useMemo, useState, useTransition } from "react";
import { AutoSwitch, SaveStatus } from "../controls";
import { DeadlineEditor } from "../../ordering/deadline-editor";
import { deadlineFor, type CutoffRule } from "@/domain/ordering";
import { addSupplier, saveDeliveryDays, saveSupplierCutoff, saveSupplierField, setSupplierActive } from "../setting-actions";

export interface SupplierRow {
  id: string;
  name: string;
  kind: "DISTRIBUTOR" | "LOCAL";
  email: string | null;
  leadTimeDays: number;
  minOrder: number | null;
  deliveryDays: number[];
  active: boolean;
  notes: string | null;
  products: number;
  cutoff: CutoffRule;
}

const KINDS = [{ value: "DISTRIBUTOR", label: "Distributor" }, { value: "LOCAL", label: "Local" }];
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const clock = (t: string) => {
  const h = Number(t.slice(0, 2));
  const m = t.slice(3);
  return `${h % 12 === 0 ? 12 : h % 12}${m === "00" ? "" : `:${m}`}${h < 12 ? "am" : "pm"}`;
};
const days = (d: number[]) => (d.length ? WEEK.filter((x) => d.includes(x)).map((x) => WEEKDAYS[x]).join(", ") : "No delivery days");

/** Tap a day to switch it on or off; saves straight away. */
function DayChips({ id, value, name }: { id: string; value: number[]; name: string }) {
  const [v, setV] = useState(value);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const toggle = (d: number) => {
    const next = v.includes(d) ? v.filter((x) => x !== d) : [...v, d];
    const prev = v;
    setV(next);
    setStatus("saving");
    start(async () => {
      const r = await saveDeliveryDays(id, next);
      if (r.error) { setV(prev); setError(r.error); setStatus("error"); } else { setStatus("saved"); setTimeout(() => setStatus("idle"), 1500); }
    });
  };
  return (
    <div className="px-1.5 py-1">
      <div className="flex gap-1" role="group" aria-label={`${name} delivers on`}>
        {WEEK.map((d) => (
          <button key={d} type="button" aria-pressed={v.includes(d)} onClick={() => toggle(d)} title={WEEKDAYS[d]} aria-label={WEEKDAYS[d]} className={cn("h-9 w-10 rounded-md border text-xs transition-colors sm:h-7 sm:w-8", v.includes(d) ? "border-ink bg-primary text-primary-ink" : "border-border-strong text-ink-2 hover:bg-surface-2")}>
            <span className="sm:hidden">{WEEKDAYS[d]}</span><span aria-hidden className="hidden sm:inline">{WEEKDAYS[d].slice(0, 2)}</span>
          </button>
        ))}
      </div>
      {status !== "idle" && <SaveStatus status={status} error={error} />}
    </div>
  );
}

function AddSupplierRow() {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form className="flex flex-wrap items-start gap-2 px-4 py-3" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await addSupplier(name); if (r.error) setError(r.error); else { setName(""); setError(null); } }); }}>
      <div className="min-w-0 flex-1 sm:max-w-xs">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New supplier, like Sysco or Price Chopper" aria-label="New supplier name" />
        {error && <p className="mt-1 text-xs text-bad">{error}</p>}
      </div>
      <Button type="submit" variant="primary" disabled={pending || !name.trim()}>Add supplier</Button>
    </form>
  );
}

function SupplierDrawer({ s }: { s: SupplierRow }) {
  const [pending, start] = useTransition();
  const f = (label: string, hint: string, el: React.ReactNode) => (
    <div className="grid grid-cols-[1fr_9rem] items-center gap-3 py-2">
      <div><div className="text-sm font-medium text-ink">{label}</div><div className="text-xs text-muted">{hint}</div></div>
      {el}
    </div>
  );
  return (
    <div className="space-y-5">
      <div>
        <div className="mb-1 text-[0.8rem] font-medium text-ink-2">Delivers on</div>
        <DayChips id={s.id} value={s.deliveryDays} name={s.name} />
      </div>
      <div className="divide-y divide-border">
        {f("Type", "Just a label — Distributor sends a price sheet; Local is a farm, bakery or store.", <GridSelect value={s.kind} options={KINDS} ariaLabel="Type" onSave={(v) => saveSupplierField(s.id, "kind", v)} />)}
        {f("Order email", "Lets you email orders in one tap.", <GridCell grid="sup-d" col="email" value={s.email} placeholder="none" ariaLabel="Order email" onSave={(v) => saveSupplierField(s.id, "email", v)} />)}
        {f("Lead time", "Days before delivery the order must be in.", <GridCell grid="sup-d" col="lead" type="number" suffix="d" value={s.leadTimeDays} ariaLabel="Lead time days" onSave={(v) => saveSupplierField(s.id, "leadTimeDays", v)} />)}
        {f("Order deadlines", "When each delivery's order has to be in — every delivery day can have its own.", <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm">{deadlineSummary(s) || "No delivery days"}</span><DeadlineEditor supplierId={s.id} name={s.name} deliveryDays={s.deliveryDays} rule={s.cutoff} /></div>)}
        {f("Minimum order", "The order builder warns when you're under it.", <GridCell grid="sup-d" col="min" type="number" prefix="$" value={s.minOrder} placeholder="none" ariaLabel="Minimum order" onSave={(v) => saveSupplierField(s.id, "minOrder", v)} />)}
      </div>
      <div className="flex items-center justify-between gap-3">
        <div><div className="text-sm font-medium text-ink">Draft orders before the cutoff</div><div className="text-xs text-muted">A suggested order is saved as a draft ahead of each cutoff.</div></div>
        <AutoSwitch on={s.cutoff.autoDraft} label="Draft orders before the cutoff" onSave={(on) => saveSupplierCutoff(s.id, "autoDraft", on ? "on" : "off")} />
      </div>
      <div>
        <div className="mb-1 text-[0.8rem] font-medium text-ink-2">Notes</div>
        <GridCell grid="sup-d" col="notes" value={s.notes} placeholder="Rep's name, account number, delivery door…" ariaLabel="Notes" onSave={(v) => saveSupplierField(s.id, "notes", v)} className="rounded-md border border-border" />
      </div>
      <div className="border-t border-border pt-4">
        <Button variant={s.active ? "danger" : "secondary"} disabled={pending} onClick={() => start(async () => { await setSupplierActive(s.id, !s.active); })}>{s.active ? "Archive supplier" : "Restore supplier"}</Button>
        <p className="mt-1.5 text-xs text-muted">{s.active ? "Archived suppliers leave ordering; their prices and invoices are kept." : "Brings it back to ordering with everything it had."}</p>
      </div>
    </div>
  );
}

export function SuppliersTable({ rows }: { rows: SupplierRow[] }) {
  const columns = useMemo<Column<SupplierRow>[]>(() => [
    { id: "name", header: "Supplier", edit: true, width: 200, sort: (s) => s.name, csv: (s) => s.name, cell: (s) => <GridCell grid="sup" col="name" value={s.name} ariaLabel={`Name of ${s.name}`} onSave={(v) => saveSupplierField(s.id, "name", v)} className="min-w-32 font-medium" /> },
    { id: "kind", header: "Type", edit: true, width: 130, sort: (s) => s.kind, csv: (s) => s.kind, cell: (s) => <GridSelect value={s.kind} options={KINDS} ariaLabel={`${s.name} type`} onSave={(v) => saveSupplierField(s.id, "kind", v)} /> },
    { id: "days", header: "Delivers on", edit: true, width: 270, sort: (s) => s.deliveryDays.length, csv: (s) => days(s.deliveryDays), cell: (s) => <DayChips id={s.id} value={s.deliveryDays} name={s.name} /> },
    { id: "lead", header: "Lead", help: "settings.suppliers", align: "right", edit: true, width: 80, sort: (s) => s.leadTimeDays, csv: (s) => s.leadTimeDays, cell: (s) => <GridCell grid="sup" col="lead" type="number" suffix="d" value={s.leadTimeDays} ariaLabel={`${s.name} lead time in days`} onSave={(v) => saveSupplierField(s.id, "leadTimeDays", v)} /> },
    { id: "cutoff", header: "Order deadlines", width: 220, sort: (s) => deadlineSummary(s), csv: (s) => deadlineSummary(s), cell: (s) => <span className="text-sm">{deadlineSummary(s) || <span className="text-muted">—</span>}</span> },
    { id: "min", header: "Minimum", align: "right", edit: true, width: 104, firstDir: "desc", sort: (s) => s.minOrder, csv: (s) => s.minOrder, cell: (s) => <GridCell grid="sup" col="min" type="number" prefix="$" value={s.minOrder} placeholder="—" ariaLabel={`${s.name} minimum order`} onSave={(v) => saveSupplierField(s.id, "minOrder", v)} /> },
    { id: "email", header: "Order email", edit: true, width: 220, sort: (s) => s.email, csv: (s) => s.email, cell: (s) => <GridCell grid="sup" col="email" value={s.email} placeholder="—" ariaLabel={`${s.name} order email`} onSave={(v) => saveSupplierField(s.id, "email", v)} /> },
    { id: "products", header: "Items", align: "right", width: 72, defaultHidden: true, firstDir: "desc", sort: (s) => s.products, csv: (s) => s.products, cell: (s) => <span className="text-muted">{s.products}</span> },
  ], []);

  const filters = useMemo<Filter<SupplierRow>[]>(() => [
    { id: "status", label: "Status", kind: "facet", single: true, display: "segmented", allLabel: "All", values: (s) => (s.active ? "active" : "archived"), options: [{ value: "active", label: "Active" }, { value: "archived", label: "Archived" }] },
    { id: "kind", label: "Type", kind: "facet", values: (s) => s.kind, options: KINDS },
    { id: "noemail", label: "No order email", kind: "toggle", test: (s) => s.active && !s.email, tone: "warn" },
  ], []);

  return (
    <DataTable
      id="settings-suppliers"
      rows={rows}
      rowKey={(s) => s.id}
      columns={columns}
      noun={["supplier", "suppliers"]}
      searchText={(s) => `${s.name} ${s.email ?? ""} ${s.notes ?? ""} ${days(s.deliveryDays)}`}
      searchPlaceholder="Search suppliers"
      filters={filters}
      defaultView={{ filters: { status: ["active"] } }}
      rowClassName={(s) => (s.active ? undefined : "opacity-60")}
      csvName="suppliers"
      urlSearch={false}
      help="settings.suppliers"
      footer={<AddSupplierRow />}
      summary={(vis) => [
        { value: vis.length, label: vis.length === 1 ? "supplier" : "suppliers" },
        { value: vis.filter((s) => s.active && !s.email).length, label: "without an order email", tone: "warn", filter: { id: "noemail" } },
      ]}
      card={(s) => ({
        title: <>{s.name}{!s.active && <span className="font-normal text-muted"> · archived</span>}</>,
        subtitle: days(s.deliveryDays),
        value: `${s.leadTimeDays}d lead`,
        sub: s.email ? deadlineSummary(s) || "no delivery days" : <Badge tone="warn">no email</Badge>,
      })}
      drawerTitle={(s) => s.name}
      drawer={(s) => <SupplierDrawer s={s} />}
      bulkActions={(api) => (
        <>
          <Button size="sm" disabled={api.pending} onClick={() => api.run(async () => { for (const k of api.keys) await setSupplierActive(k, false); return { message: `Archived ${api.keys.length}` }; })}>Archive</Button>
          <Button size="sm" variant="ghost" disabled={api.pending} onClick={() => api.run(async () => { for (const k of api.keys) await setSupplierActive(k, true); return { message: `Restored ${api.keys.length}` }; })}>Restore</Button>
        </>
      )}
    />
  );
}

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** "Fri ← Wed 5pm · Tue ← Mon 2pm" */
function deadlineSummary(s: { deliveryDays: number[]; cutoff: CutoffRule }) {
  return [...s.deliveryDays]
    .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
    .map((wd) => {
      const d = deadlineFor(s.cutoff, wd);
      return `${WD[wd]} ← ${WD[(wd - d.daysBefore + 70) % 7]} ${clock(d.time)}`;
    })
    .join(" · ");
}
