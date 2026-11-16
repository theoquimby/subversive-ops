"use client";

import { useConfirm } from "@/components/dialog";
import { GridCell, GridSelect } from "@/components/grid";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, cx, Field, Input, Select, Table, Td, Th, Tr } from "@/components/ui";
import { weekdaysText } from "@/domain/brewProfiles";
import { WEEKDAYS } from "@/domain/dates";
import { STARTER_TANKS, type TankKind } from "@/domain/tankPlan";
import { equipmentHref } from "@/domain/tankUpkeep";
import type { TankView } from "@/server/services/brewery";
import { Plus, Trash2, Wrench, X } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { KIND_LABEL } from "../bits";
import { addStarterTanksAction, addTankAction, deleteTankAction, openTankUpkeepAction, setDefaultDaysAction, setSnapDaysAction, setTankFieldAction } from "./actions";

/** Each tank's Upkeep record, by tank id: its equipment and whether a repair has it down. */
export type TankUpkeep = Record<string, { equipmentId: string; down: boolean }>;

const KINDS = (["FERMENTER", "BRITE", "OTHER"] as TankKind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }));
const ACTIVE = [{ value: "yes", label: "In use" }, { value: "no", label: "Not in use" }];

/** Every tank, editable in place, with a row to add one. Tanks not in use wait behind a link; with no tanks yet, Brew Manager's tanks to start from. */
export function TankGrid({ tanks, upkeep = {} }: { tanks: TankView[]; upkeep?: TankUpkeep }) {
  const [showOld, setShowOld] = useState(false);
  const idle = tanks.filter((t) => !t.active).length;
  const shown = showOld ? tanks : tanks.filter((t) => t.active);
  return (
    <>
      {tanks.length > 0 ? (
        <Table>
          <thead>
            <tr>
              <Th>Tank</Th>
              <Th className="hidden sm:table-cell">Kind</Th>
              <Th align="right">Size</Th>
              <Th className="hidden md:table-cell">Zone</Th>
              <Th align="right" className="hidden md:table-cell">Row</Th>
              <Th align="right" className="hidden md:table-cell">Column</Th>
              <Th align="right" className="hidden lg:table-cell">Order</Th>
              <Th className="hidden sm:table-cell">In use</Th>
              <Th><span className="sr-only">Upkeep</span></Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {shown.map((t) => <Row key={t.id} t={t} upkeep={upkeep[t.id] ?? null} />)}
          </tbody>
        </Table>
      ) : (
        <StarterTanks />
      )}
      {idle > 0 && (
        <button type="button" onClick={() => setShowOld((s) => !s)} className="mt-1.5 inline-flex min-h-10 items-center rounded-lg px-2 text-sm text-muted underline decoration-border-strong underline-offset-4 hover:text-ink sm:min-h-8">
          {showOld ? "Hide tanks not in use" : `Show ${idle} tank${idle === 1 ? "" : "s"} not in use`}
        </button>
      )}
      <AddTank first={!tanks.length} />
    </>
  );
}

function Row({ t, upkeep }: { t: TankView; upkeep: TankUpkeep[string] | null }) {
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
        <div className="grid grid-cols-[1fr_4rem_4rem] gap-1 px-2 pb-1 md:hidden">
          <GridCell grid="tank-m" col="zone" value={t.zone} placeholder="Zone" onSave={save("zone")} ariaLabel={`${t.name} zone`} />
          <GridCell grid="tank-m" col="row" value={t.layoutRow} type="number" placeholder="Row" onSave={save("layoutRow")} ariaLabel={`${t.name} row on the floor plan`} />
          <GridCell grid="tank-m" col="col" value={t.layoutCol} type="number" placeholder="Col" onSave={save("layoutCol")} ariaLabel={`${t.name} column on the floor plan`} />
        </div>
      </Td>
      <Td className="hidden w-40 px-2 py-1.5 sm:table-cell"><GridSelect value={t.kind} options={KINDS} onSave={save("kind")} ariaLabel={`${t.name} kind`} /></Td>
      <Td className="w-28 px-2 py-1.5"><GridCell grid="tank" col="cap" value={t.capacityBbl} type="number" suffix="bbl" onSave={save("capacityBbl")} ariaLabel={`${t.name} size in barrels`} /></Td>
      <Td className="hidden w-40 px-2 py-1.5 md:table-cell"><GridCell grid="tank" col="zone" value={t.zone} placeholder="e.g. Back wall" onSave={save("zone")} ariaLabel={`${t.name} zone`} /></Td>
      <Td className="hidden w-20 px-2 py-1.5 md:table-cell"><GridCell grid="tank" col="row" value={t.layoutRow} type="number" placeholder="—" onSave={save("layoutRow")} ariaLabel={`${t.name} row on the floor plan`} /></Td>
      <Td className="hidden w-20 px-2 py-1.5 md:table-cell"><GridCell grid="tank" col="col" value={t.layoutCol} type="number" placeholder="—" onSave={save("layoutCol")} ariaLabel={`${t.name} column on the floor plan`} /></Td>
      <Td className="hidden w-20 px-2 py-1.5 lg:table-cell"><GridCell grid="tank" col="sort" value={t.sort} type="number" onSave={save("sort")} ariaLabel={`${t.name} order`} /></Td>
      <Td className="hidden w-36 px-2 py-1.5 sm:table-cell"><GridSelect value={t.active ? "yes" : "no"} options={ACTIVE} onSave={save("active")} ariaLabel={`${t.name} in use`} /></Td>
      <Td className="w-12 px-1 sm:w-32">
        <div className="flex items-center justify-end gap-1.5">
          {upkeep?.down && <Badge tone="bad">Down</Badge>}
          {upkeep ? (
            <Link href={equipmentHref(upkeep.equipmentId)} aria-label={`${t.name} upkeep`} className="inline-flex min-h-10 items-center gap-1.5 rounded-md px-2 text-sm text-ink-2 hover:bg-surface-2 hover:text-ink sm:min-h-8">
              <Wrench className="size-3.5" /><span className="hidden sm:inline">Upkeep</span>
            </Link>
          ) : (
            <button
              type="button"
              disabled={pending}
              aria-label={`${t.name} upkeep`}
              onClick={() => start(async () => { const r = await openTankUpkeepAction(t.id); if (r?.error) show(r.error, "bad"); })}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-md px-2 text-sm text-muted hover:bg-surface-2 hover:text-ink sm:min-h-8"
            >
              <Wrench className="size-3.5" /><span className="hidden sm:inline">Upkeep</span>
            </button>
          )}
        </div>
      </Td>
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

type Starter = { key: number; name: string; kind: TankKind; capacityBbl: string; zone: string; layoutRow: string; layoutCol: string };

/** Brew Manager's 11 tanks with their sizes and places, to check and change before adding them all. */
function StarterTanks() {
  const [list, setList] = useState<Starter[]>(() => STARTER_TANKS.map((t, i) => ({ key: i, name: t.name, kind: t.kind, capacityBbl: String(t.capacityBbl), zone: t.zone, layoutRow: String(t.layoutRow), layoutCol: String(t.layoutCol) })));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (key: number, patch: Partial<Starter>) => setList((cur) => cur.map((t) => (t.key === key ? { ...t, ...patch } : t)));
  const sorted = [...list].sort((a, b) => a.zone.localeCompare(b.zone) || Number(a.layoutRow) - Number(b.layoutRow) || Number(a.layoutCol) - Number(b.layoutCol));
  return (
    <Card className="p-4">
      <div className="text-[0.95rem] font-semibold">Start with Brew Manager&apos;s tanks</div>
      <p className="mt-0.5 text-sm text-muted">The 11 tanks from Zane&apos;s app, with their sizes and where they stand. Change anything, remove what you don&apos;t have, then add them all.</p>
      <ul className="mt-3 divide-y divide-border rounded-xl border border-border">
        {sorted.map((t) => (
          <li key={t.key} className="grid grid-cols-[1fr_auto] items-end gap-2 px-3 py-2.5 sm:grid-cols-[6rem_9rem_5.5rem_1fr_4rem_4rem_auto]">
            <Field label="Name" className="col-span-1"><Input value={t.name} onChange={(e) => set(t.key, { name: e.target.value })} aria-label="Tank name" autoComplete="off" /></Field>
            <button type="button" aria-label={`Leave out ${t.name}`} onClick={() => setList((cur) => cur.filter((x) => x.key !== t.key))} className="grid size-10 place-items-center self-end rounded-md text-muted hover:bg-bad-bg hover:text-bad sm:order-last sm:size-9">
              <X className="size-4" />
            </button>
            <Field label="Kind"><Select value={t.kind} onChange={(e) => set(t.key, { kind: e.target.value as TankKind })} options={KINDS} aria-label={`${t.name} kind`} /></Field>
            <Field label="Size, bbl"><Input value={t.capacityBbl} onChange={(e) => set(t.key, { capacityBbl: e.target.value })} inputMode="decimal" aria-label={`${t.name} size in barrels`} /></Field>
            <Field label="Zone" className="col-span-2 sm:col-span-1"><Input value={t.zone} onChange={(e) => set(t.key, { zone: e.target.value })} aria-label={`${t.name} zone`} /></Field>
            <Field label="Row"><Input value={t.layoutRow} onChange={(e) => set(t.key, { layoutRow: e.target.value })} inputMode="numeric" aria-label={`${t.name} row`} /></Field>
            <Field label="Column"><Input value={t.layoutCol} onChange={(e) => set(t.key, { layoutCol: e.target.value })} inputMode="numeric" aria-label={`${t.name} column`} /></Field>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="mt-2 text-sm text-bad">{error}</p>}
      <Button
        type="button"
        variant="primary"
        disabled={pending || !list.length}
        className="mt-3 h-11 w-full sm:h-9 sm:w-auto"
        onClick={() =>
          start(async () => {
            const r = await addStarterTanksAction(sorted.map((t) => ({ name: t.name, kind: t.kind, capacityBbl: t.capacityBbl, zone: t.zone, layoutRow: t.layoutRow, layoutCol: t.layoutCol })));
            setError(r.error ?? null);
          })
        }
      >
        {pending ? "Adding…" : `Add these ${list.length} tanks`}
      </Button>
    </Card>
  );
}

function AddTank({ first }: { first: boolean }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<TankKind>("FERMENTER");
  const [cap, setCap] = useState("7");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Card className="mt-2 p-4">
      {first && <p className="mb-3 text-sm text-muted">Or add each fermenter and brite tank yourself. You can change any of it later.</p>}
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

/** The weekdays transfers and packaging happen on: tap a day to add or remove it. Saved straight away. */
export function BrewDays({ transferDays, packageDays }: { transferDays: number[]; packageDays: number[] }) {
  return (
    <Card className="max-w-xl divide-y divide-border">
      <DayRow which="transfer" label="Transfers" days={transferDays} />
      <DayRow which="package" label="Packaging" days={packageDays} />
    </Card>
  );
}

const ORDER = [1, 2, 3, 4, 5, 6, 0];

function DayRow({ which, label, days: initial }: { which: "transfer" | "package"; label: string; days: number[] }) {
  const [days, setDays] = useState(initial);
  const [pending, start] = useTransition();
  const [toast, show] = useToast();
  const toggle = (d: number) => {
    const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort((a, b) => a - b);
    setDays(next);
    start(async () => {
      const r = await setSnapDaysAction(which, next);
      if (r?.error) {
        setDays(days);
        show(r.error, "bad");
      }
    });
  };
  return (
    <div className="p-3">
      {toast}
      <div className="flex items-baseline justify-between gap-2 px-1">
        <span className="text-[0.8rem] font-medium text-muted">{label}</span>
        <span className={cx("text-xs text-muted transition-opacity", pending && "opacity-50")}>{days.length ? `On ${weekdaysText(days)}` : "Any day"}</span>
      </div>
      <div className="mt-2 grid grid-cols-7 gap-1" role="group" aria-label={`${label} days`}>
        {ORDER.map((d) => (
          <button key={d} type="button" aria-pressed={days.includes(d)} onClick={() => toggle(d)} className={cx("h-10 rounded-lg border text-sm font-medium transition-colors duration-120 sm:h-9", days.includes(d) ? "border-ink bg-ink text-surface" : "border-border-strong bg-surface hover:bg-surface-2")}>
            {WEEKDAYS[d]}
          </button>
        ))}
      </div>
    </div>
  );
}
