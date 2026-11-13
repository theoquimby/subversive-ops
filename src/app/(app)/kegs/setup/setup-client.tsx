"use client";

import { useConfirm } from "@/components/dialog";
import { GridCell, GridSelect } from "@/components/grid";
import { Button, Input, Select, Table, Td, Th, Tr } from "@/components/ui";
import { BEER_COLORS } from "@/domain/kegs";
import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addAccount, addBeer, addSpot, removeSpot, renameSpot, saveConfig, savePour, setAccountField, setBeerField } from "../actions";
import { BeerDot } from "../bits";

/** "Add as a beer" next to a Square name that looks like draft beer. */
export function AddBeerFromSquare({ base }: { base: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="flex shrink-0 items-center gap-2">
      {err && <span className="text-xs text-bad">{err}</span>}
      <Button size="sm" className="h-10 sm:h-8" disabled={pending} onClick={() => start(async () => {
        const r = await addBeer(base.replace(/\*+$/, "").trim(), base);
        if ("error" in r) setErr(r.error);
        else router.refresh();
      })}><Plus className="size-3.5" /> Add as a beer</Button>
    </span>
  );
}

function AddRow({ placeholder, label, onAdd }: { placeholder: string; label: string; onAdd: (v: string) => Promise<{ error?: string } | { ok: true }> }) {
  const router = useRouter();
  const [v, setV] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form className="mt-2 flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (!v.trim()) return; start(async () => { const r = await onAdd(v); if ("error" in r && r.error) setErr(r.error); else { setV(""); setErr(null); router.refresh(); } }); }}>
      <Input value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} aria-label={label} className="max-w-xs" />
      <Button type="submit" disabled={pending || !v.trim()}><Plus className="size-4" /> {label}</Button>
      {err && <span className="text-sm text-bad">{err}</span>}
    </form>
  );
}

export interface BeerRow { id: string; name: string; style: string | null; color: string; squareNames: string[]; minFull: number; house: boolean; active: boolean; recipeId: string | null; kegs: number }

export function BeersTable({ beers, recipes }: { beers: BeerRow[]; recipes: { id: string; name: string }[] }) {
  return (
    <>
      <Table>
        <thead>
          <tr>
            <Th>Beer</Th>
            <Th>Color</Th>
            <Th className="hidden md:table-cell">Square items that pour it</Th>
            <Th align="right" className="hidden sm:table-cell">Alert under</Th>
            <Th className="hidden lg:table-cell">Recipe (for cost)</Th>
            <Th className="hidden sm:table-cell">On the list</Th>
          </tr>
        </thead>
        <tbody>
          {beers.map((b) => (
            <Tr key={b.id} className={b.active ? "" : "opacity-60"}>
              <Td className="min-w-40 py-1"><div className="flex items-center gap-2"><BeerDot color={b.color} /><GridCell grid="beers" col="name" ariaLabel="Beer name" value={b.name} onSave={(v) => setBeerField(b.id, "name", v)} /></div></Td>
              <Td className="w-40 py-1"><GridSelect ariaLabel="Board color" value={b.color} options={BEER_COLORS.map((c) => ({ value: c.id, label: c.label }))} onSave={(v) => setBeerField(b.id, "color", v)} /></Td>
              <Td className="hidden min-w-56 py-1 md:table-cell"><GridCell grid="beers" col="square" ariaLabel="Square item names, comma separated" value={b.squareNames.join(", ")} placeholder="Same as the beer's name" onSave={(v) => setBeerField(b.id, "squareNames", v)} /></Td>
              <Td className="hidden w-28 py-1 sm:table-cell"><GridCell grid="beers" col="min" type="number" ariaLabel="Alert when full kegs drop under" value={b.minFull} suffix="full" onSave={(v) => setBeerField(b.id, "minFull", v)} /></Td>
              <Td className="hidden w-56 py-1 lg:table-cell"><GridSelect ariaLabel="Beer recipe" value={b.recipeId ?? ""} options={[{ value: "", label: "None" }, ...recipes.map((r) => ({ value: r.id, label: r.name }))]} onSave={(v) => setBeerField(b.id, "recipeId", v)} /></Td>
              <Td className="hidden w-32 py-1 sm:table-cell"><GridSelect ariaLabel="On the list" value={b.active ? "true" : "false"} options={[{ value: "true", label: "Yes" }, { value: "false", label: "Retired" }]} onSave={(v) => setBeerField(b.id, "active", v)} /></Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      <AddRow placeholder="e.g. Golden Lager" label="Add beer" onAdd={(v) => addBeer(v)} />
    </>
  );
}

export function SpotsEditor({ areas, spots, counts }: { areas: string[]; spots: { id: string; area: string; name: string }[]; counts: Record<string, number> }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [area, setArea] = useState(areas[0] ?? "");
  const mine = spots.filter((s) => s.area === area);
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">Area</span>
        <Select value={area} onChange={(e) => setArea(e.target.value)} options={areas.map((a) => ({ value: a, label: a }))} className="w-56" aria-label="Area" />
      </div>
      <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
        {mine.length === 0 && <li className="px-3 py-3 text-sm text-muted">No spots in {area} yet. Kegs there are just “in {area}”.</li>}
        {mine.map((s) => (
          <li key={s.id} className="flex items-center gap-2 px-2 py-1">
            <div className="min-w-0 flex-1"><GridCell grid="spots" col="name" ariaLabel="Spot name" value={s.name} onSave={(v) => renameSpot(s.id, v)} /></div>
            <span className="num w-16 shrink-0 text-right text-xs text-muted">{counts[s.id] ?? 0} keg{(counts[s.id] ?? 0) === 1 ? "" : "s"}</span>
            <button aria-label={`Remove ${s.name}`} className="grid size-10 place-items-center rounded-lg text-muted hover:bg-bad-bg hover:text-bad" onClick={async () => {
              if (!(await confirm({ title: `Remove ${s.name}?`, body: counts[s.id] ? `The ${counts[s.id]} keg(s) there stay in ${area}, with no spot.` : undefined, confirmLabel: "Remove", danger: true }))) return;
              await removeSpot(s.id);
              router.refresh();
            }}><Trash2 className="size-4" /></button>
          </li>
        ))}
      </ul>
      <AddRow placeholder="e.g. Back left · stack 2" label="Add spot" onAdd={(v) => addSpot(area, v)} />
    </div>
  );
}

export function TapsConfig({ config, areas }: { config: { tapLines: number; tapArea: string; coldArea: string; fillDays: number }; areas: string[] }) {
  const opts = areas.map((a) => ({ value: a, label: a }));
  const row = (label: string, hint: string, el: React.ReactNode) => (
    <div className="grid grid-cols-1 items-center gap-1 border-b border-border px-4 py-2.5 last:border-b-0 sm:grid-cols-[14rem_1fr_12rem]">
      <span className="text-sm font-medium">{label}</span>
      <span className="text-xs text-muted">{hint}</span>
      <div>{el}</div>
    </div>
  );
  return (
    <div className="rounded-xl border border-border bg-surface">
      {row("Tap lines", "How many lines the bar has.", <GridCell grid="taps" col="v" type="number" ariaLabel="Tap lines" value={config.tapLines} onSave={(v) => saveConfig({ tapLines: Number(v) })} />)}
      {row("Taps are in", "Kegs on tap, and just kicked, are here.", <GridSelect ariaLabel="Tap area" value={config.tapArea} options={opts} onSave={(v) => saveConfig({ tapArea: v })} />)}
      {row("Cold storage", "Offered first for “Into the walk-in”.", <GridSelect ariaLabel="Cold storage" value={config.coldArea} options={opts} onSave={(v) => saveConfig({ coldArea: v })} />)}
      {row("Fill to ready, days", "Days from filling a keg to cold and pourable. Used for run-out warnings.", <GridCell grid="taps" col="v" type="number" ariaLabel="Days from fill to ready" value={config.fillDays} onSave={(v) => saveConfig({ fillDays: Number(v) })} />)}
    </div>
  );
}

export function PoursEditor({ pours }: { pours: { variation: string; oz: number; saved: boolean; sold: number }[] }) {
  return (
    <Table>
      <thead><tr><Th>Pour in Square</Th><Th align="right" className="hidden sm:table-cell">Sold, 90 days</Th><Th align="right">Ounces</Th></tr></thead>
      <tbody>
        {pours.map((p) => (
          <Tr key={p.variation}>
            <Td>{p.variation}{!p.saved && <span className="ml-2 text-xs text-muted">guessed</span>}</Td>
            <Td align="right" className="hidden text-muted sm:table-cell">{Math.round(p.sold)}</Td>
            <Td align="right" className="w-32 py-1"><GridCell grid="pours" col="oz" type="number" align="right" suffix="oz" ariaLabel={`Ounces in a ${p.variation}`} value={p.oz} onSave={(v) => savePour(p.variation, v)} /></Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}

export interface AccountRow { id: string; name: string; kind: string; contact: string | null; email: string | null; phone: string | null; address: string | null; out: number; active: boolean }

const KINDS = [{ value: "bar", label: "Bar" }, { value: "restaurant", label: "Restaurant" }, { value: "distributor", label: "Distributor" }, { value: "consumer", label: "Person / event" }, { value: "other", label: "Other" }];

export function AccountsTable({ accounts }: { accounts: AccountRow[] }) {
  return (
    <>
      {accounts.length > 0 && (
        <Table>
          <thead><tr><Th>Account</Th><Th className="hidden sm:table-cell">Type</Th><Th className="hidden md:table-cell">Contact</Th><Th className="hidden lg:table-cell">Phone</Th><Th className="hidden lg:table-cell">Email</Th><Th align="right">Kegs out</Th></tr></thead>
          <tbody>
            {accounts.map((a) => (
              <Tr key={a.id}>
                <Td className="min-w-40 py-1"><GridCell grid="acc" col="name" ariaLabel="Account name" value={a.name} onSave={(v) => setAccountField(a.id, "name", v)} /></Td>
                <Td className="hidden w-40 py-1 sm:table-cell"><GridSelect ariaLabel="Type" value={a.kind} options={KINDS} onSave={(v) => setAccountField(a.id, "kind", v)} /></Td>
                <Td className="hidden py-1 md:table-cell"><GridCell grid="acc" col="contact" ariaLabel="Contact" value={a.contact} placeholder="—" onSave={(v) => setAccountField(a.id, "contact", v)} /></Td>
                <Td className="hidden py-1 lg:table-cell"><GridCell grid="acc" col="phone" ariaLabel="Phone" value={a.phone} placeholder="—" onSave={(v) => setAccountField(a.id, "phone", v)} /></Td>
                <Td className="hidden py-1 lg:table-cell"><GridCell grid="acc" col="email" ariaLabel="Email" value={a.email} placeholder="—" onSave={(v) => setAccountField(a.id, "email", v)} /></Td>
                <Td align="right" className={a.out ? "font-medium" : "text-muted"}>{a.out}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      <AddRow placeholder="e.g. Catskill Tap House" label="Add account" onAdd={(v) => addAccount(v)} />
    </>
  );
}
