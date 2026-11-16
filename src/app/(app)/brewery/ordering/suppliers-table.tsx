"use client";

import { DataTable, type Column } from "@/components/data-table";
import { useConfirm } from "@/components/dialog";
import { GridCell, GridSelect } from "@/components/grid";
import { useToast } from "@/components/toast";
import { Button, cx, Input, Select } from "@/components/ui";
import { LEAD_REF_LABEL, LEAD_REFS, type LeadRef } from "@/domain/brewOrdering";
import { WEEKDAYS } from "@/domain/dates";
import type { BrewerySupplierRow } from "@/server/services/brewOrdering";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { addSupplierAction, moveSupplierHereAction, moveSupplierToKitchenAction, setSupplierFieldAction } from "./actions";

const REFS = LEAD_REFS.map((r) => ({ value: r, label: LEAD_REF_LABEL[r] }));
const ACTIVE = [{ value: "yes", label: "In use" }, { value: "no", label: "Not in use" }];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** Seven small toggles: the days a delivery can arrive. None on = any day. */
function DeliveryDays({ s }: { s: BrewerySupplierRow }) {
  const router = useRouter();
  const [days, setDays] = useState(s.deliveryDays);
  const [pending, start] = useTransition();
  const flip = (d: number) => {
    const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d];
    setDays(next);
    start(async () => { await setSupplierFieldAction(s.id, "deliveryDays", next.join(",")); router.refresh(); });
  };
  return (
    <div role="group" aria-label={`Days ${s.name} can deliver`} className={cx("flex gap-0.5 px-1", pending && "opacity-70")}>
      {DAY_ORDER.map((d) => (
        <button
          key={d}
          type="button"
          aria-pressed={days.includes(d)}
          onClick={() => flip(d)}
          className={cx("h-8 w-7 rounded-md text-[0.7rem] font-medium transition-colors duration-120", days.includes(d) ? "bg-ink text-surface" : "text-muted hover:bg-surface-2 hover:text-ink")}
        >
          {WEEKDAYS[d].slice(0, 2)}
        </button>
      ))}
    </div>
  );
}

function MoveBack({ s }: { s: BrewerySupplierRow }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  return (
    <Button size="sm" variant="ghost" disabled={pending} onClick={async () => {
      if (!(await confirm({ title: `Move ${s.name} to the kitchen side?`, body: "It leaves brewery ordering and shows in kitchen ordering instead.", confirmLabel: "Move to kitchen" }))) return;
      start(async () => { await moveSupplierToKitchenAction(s.id); router.refresh(); });
    }}>To kitchen</Button>
  );
}

const save = (id: string, f: Parameters<typeof setSupplierFieldAction>[1]) => (v: string) => setSupplierFieldAction(id, f, v);

export function SuppliersTable({ suppliers, kitchen }: { suppliers: BrewerySupplierRow[]; kitchen: { id: string; name: string }[] }) {
  const columns = useMemo<Column<BrewerySupplierRow>[]>(() => [
    { id: "name", header: "Supplier", width: 190, edit: true, hideable: false, sort: (s) => s.name, csv: (s) => s.name, cell: (s) => <GridCell grid="bsup" col="name" value={s.name} ariaLabel={`Name of ${s.name}`} onSave={save(s.id, "name")} className="font-medium" /> },
    { id: "lead", header: "Lead time", width: 110, edit: true, align: "right", help: "brewery.ordering.lead", sort: (s) => s.leadDays, csv: (s) => s.leadDays, cell: (s) => <GridCell grid="bsup" col="lead" type="number" suffix="days" value={s.leadDays} ariaLabel={`${s.name} lead time in days`} onSave={save(s.id, "leadDays")} /> },
    { id: "ref", header: "Before", width: 150, edit: true, sort: (s) => s.ref, csv: (s) => LEAD_REF_LABEL[s.ref], cell: (s) => <GridSelect value={s.ref} options={REFS} ariaLabel={`${s.name}: lead time counts back from`} onSave={save(s.id, "ref")} /> },
    { id: "days", header: "Arrives", width: 230, help: "brewery.ordering.days", csv: (s) => s.deliveryDays.map((d) => WEEKDAYS[d]).join(" "), cell: (s) => <DeliveryDays key={s.deliveryDays.join(",")} s={s} /> },
    { id: "email", header: "Email", width: 190, edit: true, defaultHidden: true, sort: (s) => s.email, csv: (s) => s.email, cell: (s) => <GridCell grid="bsup" col="email" value={s.email} placeholder="orders@…" ariaLabel={`${s.name} email`} onSave={save(s.id, "email")} /> },
    { id: "active", header: "In use", width: 120, edit: true, sort: (s) => (s.active ? 0 : 1), csv: (s) => (s.active ? "yes" : "no"), cell: (s) => <GridSelect value={s.active ? "yes" : "no"} options={ACTIVE} ariaLabel={`${s.name} in use`} onSave={save(s.id, "active")} /> },
    { id: "move", header: <span className="sr-only">Move</span>, label: "Move", width: 110, align: "right", csv: () => undefined, cell: (s) => <MoveBack s={s} /> },
  ], []);
  return (
    <DataTable
      id="brewery-suppliers"
      help="brewery.ordering.suppliers"
      rows={suppliers}
      rowKey={(s) => s.id}
      columns={columns}
      noun={["supplier", "suppliers"]}
      searchText={(s) => s.name}
      searchPlaceholder="Search suppliers"
      defaultView={{ sort: [{ id: "name", dir: "asc" }] }}
      urlSearch={false}
      rowClassName={(s) => (s.active ? undefined : "opacity-60")}
      card={(s) => ({ title: s.name, subtitle: `${s.leadDays} days before ${LEAD_REF_LABEL[s.ref].toLowerCase()}`, sub: s.deliveryDays.length ? `Arrives ${s.deliveryDays.map((d) => WEEKDAYS[d]).join(", ")}` : undefined })}
      empty={<span>No brewing suppliers yet. Add Hudson Valley Malt, your hop and yeast suppliers and Labels below.</span>}
      footer={<AddSupplier kitchen={kitchen} />}
    />
  );
}

function AddSupplier({ kitchen }: { kitchen: { id: string; name: string }[] }) {
  const router = useRouter();
  const [toast, show] = useToast();
  const [name, setName] = useState("");
  const [lead, setLead] = useState("14");
  const [ref, setRef] = useState<LeadRef>("brew");
  const [pick, setPick] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-4 px-4 py-3">
      {toast}
      <form
        className="flex flex-wrap items-start gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            setError(null);
            const r = await addSupplierAction({ name, leadDays: lead, ref });
            if (r.error) setError(r.error);
            else { setName(""); show("Supplier added.", "good"); router.refresh(); }
          });
        }}
      >
        <div className="min-w-0 flex-1 sm:max-w-xs">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New supplier, e.g. Omega Yeast" aria-label="New brewing supplier name" />
          {error && <p className="mt-1 text-xs text-bad">{error}</p>}
        </div>
        <Input value={lead} onChange={(e) => setLead(e.target.value)} inputMode="numeric" aria-label="Lead time in days" className="w-20 text-right" />
        <Select value={ref} onChange={(e) => setRef(e.target.value as LeadRef)} options={REFS.map((r) => ({ ...r, label: `days before ${r.label.toLowerCase()}` }))} aria-label="Counted back from" className="w-52" />
        <Button type="submit" variant="primary" disabled={pending || !name.trim()}><Plus className="size-4" /> Add</Button>
      </form>
      {kitchen.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted">Or move a kitchen supplier here:</span>
          <Select value={pick} onChange={(e) => setPick(e.target.value)} options={kitchen.map((k) => ({ value: k.id, label: k.name }))} placeholder="Pick a supplier" searchable aria-label="Kitchen supplier to move to the brewery side" className="min-w-0 flex-1 sm:max-w-xs" />
          <Button disabled={pending || !pick} onClick={() => start(async () => {
            const r = await moveSupplierHereAction(pick);
            if (r.error) show(r.error, "bad");
            else { setPick(""); show("Moved to the brewery side. It no longer shows in kitchen ordering.", "good"); router.refresh(); }
          })}>Move here</Button>
        </div>
      )}
    </div>
  );
}
