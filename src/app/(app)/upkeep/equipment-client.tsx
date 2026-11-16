"use client";

import { useConfirm } from "@/components/dialog";
import { GridCell, GridSelect } from "@/components/grid";
import { Badge, Card, cx, DatePicker, Table, Td, Th, Tr } from "@/components/ui";
import { money, shortDate } from "@/lib/format";
import type { EquipmentView } from "@/server/services/upkeep";
import { Phone, Trash2 } from "lucide-react";
import { useTransition } from "react";
import { AddRow } from "../team/team-client";
import { addEquipment, deleteEquipment, setEquipmentField } from "./actions";

const ACTIVE = [{ value: "yes", label: "In use" }, { value: "no", label: "Retired" }];

/** One row per piece of equipment, every field editable in place. */
export function EquipmentGrid({ equipment, today }: { equipment: EquipmentView[]; today: string }) {
  return (
    <>
      <Table>
        <thead>
          <tr>
            <Th>Equipment</Th>
            <Th className="hidden md:table-cell">Area</Th>
            <Th className="hidden lg:table-cell">Make & model</Th>
            <Th className="hidden xl:table-cell">Serial</Th>
            <Th className="hidden sm:table-cell">Service contact</Th>
            <Th className="hidden md:table-cell">Warranty until</Th>
            <Th align="right">12 mo</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {equipment.map((e) => <Row key={e.id} e={e} today={today} />)}
        </tbody>
      </Table>
      <Card className="mt-2">
        <AddRow placeholder="Add equipment, e.g. Glass washer" label="Add equipment" onAdd={addEquipment} />
      </Card>
    </>
  );
}

function Row({ e, today }: { e: EquipmentView; today: string }) {
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const save = (f: Parameters<typeof setEquipmentField>[1]) => setEquipmentField.bind(null, e.id, f);
  return (
    <Tr className={cx(!e.active && "opacity-60", pending && "opacity-60")}>
      <Td className="min-w-[11rem] px-2 py-1.5">
        <GridCell grid="eq" col="name" value={e.name} onSave={save("name")} ariaLabel="Equipment name" className="font-medium" />
        <div className="flex flex-wrap items-center gap-1.5 px-2">
          {e.down && <Badge tone="bad">Down</Badge>}
          {e.warranty === "ending" && <Badge tone="warn">Warranty ends {shortDate(e.warrantyUntil!)}</Badge>}
          <span className="text-xs text-muted md:hidden">{e.area}</span>
          {e.vendorPhone && <a href={`tel:${e.vendorPhone.replace(/[^\d+]/g, "")}`} className="inline-flex min-h-8 items-center gap-1 text-xs text-ink-2 underline-offset-2 hover:underline sm:hidden"><Phone className="size-3" />{e.vendor ?? "Call"}</a>}
        </div>
      </Td>
      <Td className="hidden w-32 px-2 py-1.5 md:table-cell"><GridCell grid="eq" col="area" value={e.area} onSave={save("area")} ariaLabel={`${e.name} area`} /></Td>
      <Td className="hidden px-2 py-1.5 lg:table-cell">
        <GridCell grid="eq" col="make" value={e.make} placeholder="Make" onSave={save("make")} ariaLabel={`${e.name} make`} />
        <GridCell grid="eq" col="model" value={e.model} placeholder="Model" onSave={save("model")} ariaLabel={`${e.name} model`} className="text-muted [&_input]:h-8 [&_input]:text-xs" />
      </Td>
      <Td className="hidden px-2 py-1.5 xl:table-cell"><GridCell grid="eq" col="serial" value={e.serial} placeholder="—" onSave={save("serial")} ariaLabel={`${e.name} serial number`} /></Td>
      <Td className="hidden px-2 py-1.5 sm:table-cell">
        <GridCell grid="eq" col="vendor" value={e.vendor} placeholder="Company" onSave={save("vendor")} ariaLabel={`${e.name} service company`} />
        <GridCell grid="eq" col="phone" value={e.vendorPhone} placeholder="Phone" onSave={save("vendorPhone")} ariaLabel={`${e.name} service phone`} className="text-muted [&_input]:h-8 [&_input]:text-xs" />
      </Td>
      <Td className="hidden w-44 px-2 py-1.5 md:table-cell">
        <DatePicker value={e.warrantyUntil ?? ""} today={today} aria-label={`${e.name} warranty until`} onChange={(ev) => start(async () => { await setEquipmentField(e.id, "warrantyUntil", ev.target.value); })} />
      </Td>
      <Td align="right" className={cx("px-3", e.spend12 > 0 ? "text-ink" : "text-muted")}>{e.spend12 > 0 ? money(e.spend12, { whole: true }) : "—"}</Td>
      <Td className="w-10 px-1">
        <div className="flex items-center gap-1">
          <div className="hidden w-24 2xl:block"><GridSelect value={e.active ? "yes" : "no"} options={ACTIVE} onSave={save("active")} ariaLabel={`${e.name} in use`} /></div>
          <button
            type="button"
            aria-label={`Delete ${e.name}`}
            onClick={async () => {
              if (!(await confirm({ title: `Delete ${e.name}?`, body: e.tasks ? `Its ${e.tasks} job${e.tasks === 1 ? " stays" : "s stay"}, without equipment. The log keeps its history.` : "The log keeps its history.", confirmLabel: "Delete", danger: true }))) return;
              start(async () => { await deleteEquipment(e.id); });
            }}
            className="grid size-10 place-items-center rounded-md text-muted hover:bg-bad-bg hover:text-bad sm:size-8"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </Td>
    </Tr>
  );
}
