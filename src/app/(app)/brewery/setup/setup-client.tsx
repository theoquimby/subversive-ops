"use client";

import { useConfirm } from "@/components/dialog";
import { GridCell, GridSelect } from "@/components/grid";
import { useToast } from "@/components/toast";
import { Button, Card, cx, Field, Input, Select, Table, Td, Th, Tr } from "@/components/ui";
import type { TankKind } from "@/domain/tankPlan";
import type { TankView } from "@/server/services/brewery";
import { Plus, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { KIND_LABEL } from "../bits";
import { addTankAction, deleteTankAction, setDefaultDaysAction, setTankFieldAction } from "./actions";

const KINDS = (["FERMENTER", "BRITE", "OTHER"] as TankKind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }));
const ACTIVE = [{ value: "yes", label: "In use" }, { value: "no", label: "Not in use" }];

/** Every tank, editable in place, with a row to add one. */
export function TankGrid({ tanks }: { tanks: TankView[] }) {
  return (
    <>
      {tanks.length > 0 && (
        <Table>
          <thead>
            <tr>
              <Th>Tank</Th>
              <Th className="hidden sm:table-cell">Kind</Th>
              <Th align="right">Size</Th>
              <Th align="right" className="hidden md:table-cell">Order</Th>
              <Th className="hidden sm:table-cell">In use</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {tanks.map((t) => <Row key={t.id} t={t} />)}
          </tbody>
        </Table>
      )}
      <AddTank first={!tanks.length} />
    </>
  );
}

function Row({ t }: { t: TankView }) {
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [toast, show] = useToast();
  const save = (f: Parameters<typeof setTankFieldAction>[1]) => setTankFieldAction.bind(null, t.id, f);
  return (
    <Tr className={cx(!t.active && "opacity-60", pending && "opacity-60")}>
      {toast}
      <Td className="min-w-[9rem] px-2 py-1.5">
        <GridCell grid="tank" col="name" value={t.name} onSave={save("name")} ariaLabel="Tank name" className="font-medium" />
        <div className="grid grid-cols-2 gap-1 px-2 pb-1 sm:hidden">
          <GridSelect value={t.kind} options={KINDS} onSave={save("kind")} ariaLabel={`${t.name} kind`} />
          <GridSelect value={t.active ? "yes" : "no"} options={ACTIVE} onSave={save("active")} ariaLabel={`${t.name} in use`} />
        </div>
      </Td>
      <Td className="hidden w-40 px-2 py-1.5 sm:table-cell"><GridSelect value={t.kind} options={KINDS} onSave={save("kind")} ariaLabel={`${t.name} kind`} /></Td>
      <Td className="w-28 px-2 py-1.5"><GridCell grid="tank" col="cap" value={t.capacityBbl} type="number" suffix="bbl" onSave={save("capacityBbl")} ariaLabel={`${t.name} size in barrels`} /></Td>
      <Td className="hidden w-20 px-2 py-1.5 md:table-cell"><GridCell grid="tank" col="sort" value={t.sort} type="number" onSave={save("sort")} ariaLabel={`${t.name} order`} /></Td>
      <Td className="hidden w-36 px-2 py-1.5 sm:table-cell"><GridSelect value={t.active ? "yes" : "no"} options={ACTIVE} onSave={save("active")} ariaLabel={`${t.name} in use`} /></Td>
      <Td className="w-10 px-1">
        <button
          type="button"
          aria-label={`Delete ${t.name}`}
          onClick={async () => {
            if (!(await confirm({ title: `Delete ${t.name}?`, body: "Only a tank with no brews in its history can be deleted. Otherwise set it to not in use.", confirmLabel: "Delete", danger: true }))) return;
            start(async () => {
              const r = await deleteTankAction(t.id);
              if (r.error) show(r.error, "bad");
            });
          }}
          className="grid size-10 place-items-center rounded-md text-muted hover:bg-bad-bg hover:text-bad sm:size-8"
        >
          <Trash2 className="size-3.5" />
        </button>
      </Td>
    </Tr>
  );
}

function AddTank({ first }: { first: boolean }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<TankKind>("FERMENTER");
  const [cap, setCap] = useState("7");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Card className={cx("p-4", !first && "mt-2")}>
      {first && <p className="mb-3 text-sm text-muted">Add each fermenter and brite tank. You can change any of it later.</p>}
      <form
        className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[1fr_10rem_7rem_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await addTankAction({ name, kind, capacityBbl: cap });
            if (r.error) setError(r.error);
            else {
              setError(null);
              setName("");
            }
          });
        }}
      >
        <Field label="Name" className="col-span-2 sm:col-span-1"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. FV3" aria-label="New tank name" autoComplete="off" /></Field>
        <Field label="Kind"><Select value={kind} onChange={(e) => setKind(e.target.value as TankKind)} options={KINDS} aria-label="New tank kind" /></Field>
        <Field label="Size, bbl"><Input value={cap} onChange={(e) => setCap(e.target.value)} inputMode="decimal" aria-label="New tank size in barrels" /></Field>
        <Button type="submit" variant="primary" disabled={pending || !name.trim()} className="col-span-2 h-11 sm:col-span-1 sm:h-9"><Plus className="size-4" />Add tank</Button>
        {error && <p role="alert" className="col-span-full text-sm text-bad">{error}</p>}
      </form>
    </Card>
  );
}

/** The two default day counts, each saved as you leave it. */
export function DefaultDays({ fermentDays, conditionDays }: { fermentDays: number; conditionDays: number }) {
  return (
    <Card className="grid max-w-xl grid-cols-2 divide-x divide-border">
      <div className="p-3">
        <div className="px-2 text-[0.8rem] font-medium text-muted">Fermenting, in a fermenter</div>
        <GridCell grid="days" col="ferment" value={fermentDays} type="number" suffix="days" onSave={setDefaultDaysAction.bind(null, "ferment")} ariaLabel="Usual days fermenting" />
      </div>
      <div className="p-3">
        <div className="px-2 text-[0.8rem] font-medium text-muted">Conditioning, in a brite</div>
        <GridCell grid="days" col="condition" value={conditionDays} type="number" suffix="days" onSave={setDefaultDaysAction.bind(null, "condition")} ariaLabel="Usual days conditioning" />
      </div>
    </Card>
  );
}
