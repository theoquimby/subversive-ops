"use client";

import { DataTable, type Column, type Filter, type GroupBy } from "@/components/data-table";
import { useConfirm } from "@/components/dialog";
import { GridCell, GridSelect } from "@/components/grid";
import { ShowMore } from "@/components/show-more";
import { Button, EmptyState, Input, Select, Table, Td, Th, Tr } from "@/components/ui";
import { STANDING_LABEL, STANDINGS, type Standing } from "@/domain/beerStanding";
import { BEER_COLORS } from "@/domain/kegs";
import { ArrowUpRight, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { addAccount, addBeer, addSpot, removeSpot, renameSpot, saveConfig, savePour, setAccountField, setBeerField, setSquareItemBeerAction } from "../actions";
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

export interface BeerRow { id: string; name: string; style: string | null; color: string; squareNames: string[]; minFull: number; house: boolean; standing: Standing; recipeId: string | null; kegs: number }

const STANDING_OPTIONS = STANDINGS.map((s) => ({ value: s, label: STANDING_LABEL[s] }));
const COLOR_OPTIONS = BEER_COLORS.map((c) => ({ value: c.id, label: c.label }));
const STANDING_RANK: Record<Standing, number> = { core: 0, rotation: 1, retired: 2 };

/** The arrow beside a name that opens its own page. */
function OpenLink({ href, name, what }: { href: string; name: string; what: string }) {
  return <Link href={href} aria-label={`Open ${name}`} title={`Open this ${what}'s page`} className="grid size-10 shrink-0 place-items-center rounded-lg text-muted transition-colors duration-120 hover:bg-surface-2 hover:text-ink sm:size-8"><ArrowUpRight className="size-4" /></Link>;
}

/** A labelled field in a phone or side-panel editor. */
const field = (label: string, el: React.ReactNode, hint?: React.ReactNode) => (
  <div className="py-2">
    <div className="mb-0.5 text-[0.8rem] font-medium text-ink-2">{label}</div>
    {el}
    {hint && <div className="mt-0.5 px-2 text-xs text-muted">{hint}</div>}
  </div>
);

export interface SquareItemRow { squareId: string; name: string; beerId: string | null }

/** The Square items linked to a beer, unlink one, or link another (its sales then count for this beer whatever it's called). */
function SquareLinks({ beer, items }: { beer: BeerRow; items: SquareItemRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const linked = items.filter((i) => i.beerId === beer.id);
  const others = items.filter((i) => i.beerId !== beer.id).map((i) => ({ value: i.squareId, label: i.name, hint: i.beerId ? "linked to another beer" : undefined }));
  const set = (squareId: string, beerId: string) => start(async () => {
    setErr(null);
    const r = await setSquareItemBeerAction(squareId, beerId);
    if (r.error) setErr(r.error);
    else router.refresh();
  });
  return (
    <div className="space-y-2 px-2">
      {linked.length === 0 ? (
        <p className="text-sm text-muted">None linked. Sales are matched by name until you link them.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {linked.map((i) => (
            <span key={i.squareId} className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-border bg-surface pl-2.5 text-sm sm:min-h-8">
              {i.name}
              <button type="button" disabled={pending} aria-label={`Unlink ${i.name}`} className="grid size-10 place-items-center rounded-lg text-muted hover:text-bad sm:size-8" onClick={() => set(i.squareId, "")}><X className="size-3.5" /></button>
            </span>
          ))}
        </div>
      )}
      {others.length > 0 && <Select aria-label={`Link a Square item to ${beer.name}`} placeholder="Link a Square item" searchable options={others} value="" disabled={pending} onChange={(e) => e.target.value && set(e.target.value, beer.id)} />}
      {err && <p className="text-xs text-bad">{err}</p>}
    </div>
  );
}

/** Every beer, edited in place. Retired beers sit under their own tab; search and the tabs never get in the way of typing. */
export function BeersTable({ beers, recipes, squareItems = [] }: { beers: BeerRow[]; recipes: { id: string; name: string }[]; squareItems?: SquareItemRow[] }) {
  const recipeOptions = useMemo(() => [{ value: "", label: "None" }, ...recipes.map((r) => ({ value: r.id, label: r.name }))], [recipes]);
  const linkedCount = useMemo(() => squareItems.reduce((m, i) => (i.beerId ? m.set(i.beerId, (m.get(i.beerId) ?? 0) + 1) : m), new Map<string, number>()), [squareItems]);
  const columns = useMemo<Column<BeerRow>[]>(() => [
    {
      id: "name", header: "Beer", edit: true, width: 220, hideable: false, sort: (b) => b.name, csv: (b) => b.name,
      cell: (b) => (
        <div className="flex items-center gap-2 pl-1">
          <BeerDot color={b.color} />
          <GridCell className="min-w-0 flex-1" grid="beers" col="name" ariaLabel={`Name of ${b.name}`} value={b.name} onSave={(v) => setBeerField(b.id, "name", v)} />
          <OpenLink href={`/kegs/beers/${b.id}`} name={b.name} what="beer" />
        </div>
      ),
    },
    { id: "color", header: "Color", edit: true, width: 150, sort: (b) => b.color, csv: (b) => b.color, cell: (b) => <GridSelect ariaLabel={`Board color of ${b.name}`} value={b.color} options={COLOR_OPTIONS} onSave={(v) => setBeerField(b.id, "color", v)} /> },
    { id: "square", header: "Square items that pour it", edit: true, width: 240, sort: (b) => b.squareNames.join(", "), csv: (b) => b.squareNames.join(", "), cell: (b) => <GridCell grid="beers" col="square" ariaLabel={`Square item names for ${b.name}, comma separated`} value={b.squareNames.join(", ")} placeholder="Same as the beer's name" onSave={(v) => setBeerField(b.id, "squareNames", v)} /> },
    { id: "linked", header: "Linked items", align: "right", width: 110, firstDir: "desc", sort: (b) => linkedCount.get(b.id) ?? 0, csv: (b) => linkedCount.get(b.id) ?? 0, cell: (b) => <span className={(linkedCount.get(b.id) ?? 0) ? "num" : "num text-muted"} title="Square items linked to this beer (open the beer to change them)">{linkedCount.get(b.id) ?? 0}</span> },
    { id: "standing", header: "Standing", help: "kegs.standing", edit: true, width: 150, sort: (b) => STANDING_RANK[b.standing], csv: (b) => STANDING_LABEL[b.standing], cell: (b) => <GridSelect ariaLabel={`Standing of ${b.name}`} value={b.standing} options={STANDING_OPTIONS} onSave={(v) => setBeerField(b.id, "standing", v)} /> },
    { id: "min", header: "Alert under", align: "right", edit: true, width: 120, sort: (b) => (b.standing === "core" ? b.minFull : null), csv: (b) => (b.standing === "core" ? b.minFull : ""), cell: (b) => (b.standing === "core" ? <GridCell grid="beers" col="min" type="number" ariaLabel={`Alert when full kegs of ${b.name} drop under`} value={b.minFull} suffix="full" onSave={(v) => setBeerField(b.id, "minFull", v)} /> : <span className="px-2 text-xs text-muted" title="Only core beers are alerted about">—</span>) },
    // Deprecated costing path: only used for a beer with no keg cost and no live brewing recipe.
    { id: "recipe", header: "Recipe (for cost)", defaultHidden: true, edit: true, width: 220, sort: (b) => recipes.find((r) => r.id === b.recipeId)?.name, csv: (b) => recipes.find((r) => r.id === b.recipeId)?.name ?? "", cell: (b) => <GridSelect ariaLabel={`Recipe for ${b.name}`} value={b.recipeId ?? ""} options={recipeOptions} onSave={(v) => setBeerField(b.id, "recipeId", v)} /> },
    { id: "kegs", header: "Kegs", align: "right", width: 70, defaultHidden: true, firstDir: "desc", sort: (b) => b.kegs, csv: (b) => b.kegs, cell: (b) => <span className="num text-muted">{b.kegs}</span> },
  ], [recipes, recipeOptions, linkedCount]);

  const filters = useMemo<Filter<BeerRow>[]>(() => [
    { id: "standing", label: "Standing", kind: "facet", display: "segmented", single: true, allLabel: "All", values: (b) => (b.standing === "retired" ? ["retired"] : ["active", b.standing]), options: [{ value: "active", label: "In use" }, { value: "core", label: "Core" }, { value: "rotation", label: "In rotation" }, { value: "retired", label: "Retired" }] },
    { id: "nosquare", label: "No Square items", kind: "toggle", test: (b) => b.squareNames.length === 0 && !linkedCount.get(b.id) },
    { id: "norecipe", label: "No recipe", kind: "toggle", test: (b) => !b.recipeId },
  ], [linkedCount]);

  return (
    <DataTable
      id="kegs-setup-beers"
      rows={beers}
      rowKey={(b) => b.id}
      columns={columns}
      noun={["beer", "beers"]}
      searchText={(b) => `${b.name} ${b.style ?? ""} ${b.squareNames.join(" ")}`}
      searchPlaceholder="Search beers"
      filters={filters}
      defaultView={{ filters: { standing: ["active"] } }}
      csvName="beers-setup"
      urlSearch={false}
      maxHeight="36rem"
      rowClassName={(b) => (b.standing === "retired" ? "opacity-60" : undefined)}
      footer={<div className="px-4 pb-3"><AddRow placeholder="e.g. Golden Lager" label="Add beer" onAdd={(v) => addBeer(v)} /></div>}
      empty={<EmptyState title="No beers yet" action={<AddRow placeholder="e.g. Golden Lager" label="Add beer" onAdd={(v) => addBeer(v)} />}>Add each beer you keg. Say which Square items pour it, and pick the core ones you never want to run out of.</EmptyState>}
      card={(b) => ({
        title: <span className="inline-flex items-center gap-2"><BeerDot color={b.color} />{b.name}</span>,
        subtitle: `${STANDING_LABEL[b.standing]}${b.squareNames.length ? ` · ${b.squareNames.join(", ")}` : ""}`,
        value: b.standing === "core" ? `alert under ${b.minFull}` : undefined,
      })}
      drawerTitle={(b) => b.name}
      rowHref={(b) => `/kegs/beers/${b.id}`}
      drawer={(b) => (
        <div className="divide-y divide-border">
          {field("Name", <GridCell grid="beerd" col="name" ariaLabel="Name" value={b.name} onSave={(v) => setBeerField(b.id, "name", v)} />)}
          {field("Standing", <GridSelect ariaLabel="Standing" value={b.standing} options={STANDING_OPTIONS} onSave={(v) => setBeerField(b.id, "standing", v)} />)}
          {field("Board color", <GridSelect ariaLabel="Board color" value={b.color} options={COLOR_OPTIONS} onSave={(v) => setBeerField(b.id, "color", v)} />)}
          {field("Square items linked", <SquareLinks beer={b} items={squareItems} />)}
          {field("Square names that pour it", <GridCell grid="beerd" col="square" ariaLabel="Square item names, comma separated" value={b.squareNames.join(", ")} placeholder="Same as the beer's name" onSave={(v) => setBeerField(b.id, "squareNames", v)} />, "The part before the pour, comma separated. Links the items they name, and matches any item not linked.")}
          {b.standing === "core" && field("Alert when full kegs drop under", <GridCell grid="beerd" col="min" type="number" ariaLabel="Alert when full kegs drop under" value={b.minFull} suffix="full" onSave={(v) => setBeerField(b.id, "minFull", v)} />)}
          {field("Recipe (for cost)", <GridSelect ariaLabel="Recipe" value={b.recipeId ?? ""} options={recipeOptions} onSave={(v) => setBeerField(b.id, "recipeId", v)} />, "The old way to cost a pint, from a kitchen prep recipe. Only used when the beer has no keg cost (Menu → Draft beer) and no live brewing recipe.")}
        </div>
      )}
    />
  );
}

interface SpotRow { id: string; area: string; name: string; kegs: number }

/** Every spot in every area: rename in place, remove, filter by area, add one to an area. */
export function SpotsEditor({ areas, spots, counts }: { areas: string[]; spots: { id: string; area: string; name: string }[]; counts: Record<string, number> }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [area, setArea] = useState(areas[0] ?? "");
  const rows = useMemo<SpotRow[]>(() => spots.map((s) => ({ ...s, kegs: counts[s.id] ?? 0 })), [spots, counts]);
  const columns = useMemo<Column<SpotRow>[]>(() => [
    { id: "name", header: "Spot", edit: true, width: 260, hideable: false, sort: (s) => s.name, csv: (s) => s.name, cell: (s) => <GridCell grid="spots" col="name" ariaLabel={`Name of spot ${s.name}`} value={s.name} onSave={(v) => renameSpot(s.id, v)} /> },
    { id: "area", header: "Area", width: 160, sort: (s) => s.area, csv: (s) => s.area, cell: (s) => <span className="text-ink-2">{s.area}</span> },
    { id: "kegs", header: "Kegs", align: "right", width: 80, firstDir: "desc", sort: (s) => s.kegs, csv: (s) => s.kegs, cell: (s) => <span className="num text-muted">{s.kegs}</span> },
    {
      id: "remove", header: <span className="sr-only">Remove</span>, label: "Remove", align: "right", width: 60, hideable: false, csv: () => undefined,
      cell: (s) => (
        <button aria-label={`Remove ${s.name}`} className="grid size-10 place-items-center rounded-lg text-muted hover:bg-bad-bg hover:text-bad sm:size-8" onClick={async () => {
          if (!(await confirm({ title: `Remove ${s.name}?`, body: s.kegs ? `The ${s.kegs} keg${s.kegs === 1 ? "" : "s"} there stay in ${s.area}, with no spot.` : undefined, confirmLabel: "Remove", danger: true }))) return;
          await removeSpot(s.id);
          router.refresh();
        }}><Trash2 className="size-4" /></button>
      ),
    },
  ], [confirm, router]);
  const filters = useMemo<Filter<SpotRow>[]>(() => [{ id: "area", label: "Area", kind: "facet", display: "segmented", single: true, allLabel: "All areas", values: (s) => s.area, options: areas.filter((a) => spots.some((s) => s.area === a)).map((a) => ({ value: a, label: a })) }], [areas, spots]);
  return (
    <div className="space-y-3">
      <DataTable
        id="kegs-setup-spots"
        rows={rows}
        rowKey={(s) => s.id}
        columns={columns}
        noun={["spot", "spots"]}
        searchText={(s) => `${s.name} ${s.area}`}
        searchPlaceholder="Search spots"
        filters={filters}
        groups={SPOT_GROUPS}
        defaultView={{ sort: [{ id: "area", dir: "asc" }] }}
        csvName="keg-spots"
        urlSearch={false}
        maxHeight="28rem"
        card={(s) => ({ title: s.name, subtitle: s.area, value: `${s.kegs} keg${s.kegs === 1 ? "" : "s"}` })}
        drawerTitle={(s) => s.name}
        drawer={(s) => (
          <div className="divide-y divide-border">
            {field("Name", <GridCell grid="spotd" col="name" ariaLabel="Spot name" value={s.name} onSave={(v) => renameSpot(s.id, v)} />, `In ${s.area} · ${s.kegs} keg${s.kegs === 1 ? "" : "s"} there now`)}
            <div className="py-3">
              <Button variant="ghost" className="text-bad" onClick={async () => {
                if (!(await confirm({ title: `Remove ${s.name}?`, body: s.kegs ? `The ${s.kegs} keg${s.kegs === 1 ? "" : "s"} there stay in ${s.area}, with no spot.` : undefined, confirmLabel: "Remove", danger: true }))) return;
                await removeSpot(s.id);
                router.refresh();
              }}><Trash2 className="size-4" /> Remove this spot</Button>
            </div>
          </div>
        )}
        empty={<EmptyState title="No spots yet">Kegs in an area are just “in” it until you add some below.</EmptyState>}
      />
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted">Add a spot in</span>
          <Select value={area} onChange={(e) => setArea(e.target.value)} options={areas.map((a) => ({ value: a, label: a }))} className="w-56" aria-label="Area for the new spot" />
        </div>
        <AddRow placeholder="e.g. Back left · stack 2" label="Add spot" onAdd={(v) => addSpot(area, v)} />
      </div>
    </div>
  );
}

const SPOT_GROUPS: GroupBy<SpotRow>[] = [{ id: "area", label: "Area", key: (s) => s.area }];

export function TapsConfig({ config, areas }: { config: { tapLines: number; tapArea: string; coldArea: string; fillDays: number; overdueDays: number; idleDays: number }; areas: string[] }) {
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
      {row("Out too long, days", "A keg at an account longer than this shows under Needs a look.", <GridCell grid="taps" col="v" type="number" ariaLabel="Days out at an account before a keg needs a look" value={config.overdueDays} onSave={(v) => saveConfig({ overdueDays: Number(v) })} />)}
      {row("Not seen, days", "A keg nobody has scanned for this long shows under Needs a look.", <GridCell grid="taps" col="v" type="number" ariaLabel="Days without a scan before a keg needs a look" value={config.idleDays} onSave={(v) => saveConfig({ idleDays: Number(v) })} />)}
    </div>
  );
}

export function PoursEditor({ pours }: { pours: { variation: string; oz: number; saved: boolean; sold: number }[] }) {
  return (
    <Table>
      <thead><tr><Th>Pour in Square</Th><Th align="right" className="hidden sm:table-cell">Sold, 90 days</Th><Th align="right">Ounces</Th></tr></thead>
      <ShowMore as="tbody" limit={15} noun={["pour", "pours"]}>
        {pours.map((p) => (
          <Tr key={p.variation}>
            <Td>{p.variation}{!p.saved && <span className="ml-2 text-xs text-muted">guessed</span>}</Td>
            <Td align="right" className="hidden text-muted sm:table-cell">{Math.round(p.sold)}</Td>
            <Td align="right" className="w-32 py-1"><GridCell grid="pours" col="oz" type="number" align="right" suffix="oz" ariaLabel={`Ounces in a ${p.variation}`} value={p.oz} onSave={(v) => savePour(p.variation, v)} /></Td>
          </Tr>
        ))}
      </ShowMore>
    </Table>
  );
}

export interface AccountRow { id: string; name: string; kind: string; contact: string | null; email: string | null; phone: string | null; address: string | null; out: number; active: boolean }

const KINDS = [{ value: "bar", label: "Bar" }, { value: "restaurant", label: "Restaurant" }, { value: "distributor", label: "Distributor" }, { value: "consumer", label: "Person / event" }, { value: "other", label: "Other" }];

const kindLabel = (k: string) => KINDS.find((x) => x.value === k)?.label ?? "Other";

/** Every account, edited in place. Accounts no longer used sit under their own tab. */
export function AccountsTable({ accounts }: { accounts: AccountRow[] }) {
  const columns = useMemo<Column<AccountRow>[]>(() => [
    {
      id: "name", header: "Account", edit: true, width: 230, hideable: false, sort: (a) => a.name, csv: (a) => a.name,
      cell: (a) => (
        <div className="flex items-center gap-1">
          <GridCell className="min-w-0 flex-1" grid="acc" col="name" ariaLabel={`Name of ${a.name}`} value={a.name} onSave={(v) => setAccountField(a.id, "name", v)} />
          <OpenLink href={`/kegs/accounts/${a.id}`} name={a.name} what="account" />
        </div>
      ),
    },
    { id: "kind", header: "Type", edit: true, width: 160, sort: (a) => kindLabel(a.kind), csv: (a) => kindLabel(a.kind), cell: (a) => <GridSelect ariaLabel={`Type of ${a.name}`} value={a.kind} options={KINDS} onSave={(v) => setAccountField(a.id, "kind", v)} /> },
    { id: "contact", header: "Contact", edit: true, width: 170, sort: (a) => a.contact, csv: (a) => a.contact ?? "", cell: (a) => <GridCell grid="acc" col="contact" ariaLabel={`Contact at ${a.name}`} value={a.contact} placeholder="—" onSave={(v) => setAccountField(a.id, "contact", v)} /> },
    { id: "phone", header: "Phone", edit: true, width: 150, sort: (a) => a.phone, csv: (a) => a.phone ?? "", cell: (a) => <GridCell grid="acc" col="phone" ariaLabel={`Phone for ${a.name}`} value={a.phone} placeholder="—" onSave={(v) => setAccountField(a.id, "phone", v)} /> },
    { id: "email", header: "Email", edit: true, width: 200, sort: (a) => a.email, csv: (a) => a.email ?? "", cell: (a) => <GridCell grid="acc" col="email" ariaLabel={`Email for ${a.name}`} value={a.email} placeholder="—" onSave={(v) => setAccountField(a.id, "email", v)} /> },
    { id: "out", header: "Kegs out", align: "right", width: 90, firstDir: "desc", sort: (a) => a.out, csv: (a) => a.out, cell: (a) => <span className={a.out ? "font-medium" : "text-muted"}>{a.out}</span> },
  ], []);
  const filters = useMemo<Filter<AccountRow>[]>(() => [
    { id: "use", label: "Accounts", kind: "facet", display: "segmented", single: true, allLabel: "All", values: (a) => (a.active ? "active" : "old"), options: [{ value: "active", label: "On the list" }, { value: "old", label: "No longer used" }] },
    { id: "kind", label: "Type", kind: "facet", values: (a) => a.kind, options: KINDS },
    { id: "nocontact", label: "No phone or email", kind: "toggle", test: (a) => !a.phone && !a.email },
  ], []);
  return (
    <DataTable
      id="kegs-setup-accounts"
      rows={accounts}
      rowKey={(a) => a.id}
      columns={columns}
      noun={["account", "accounts"]}
      searchText={(a) => `${a.name} ${a.contact ?? ""} ${a.phone ?? ""} ${a.email ?? ""} ${kindLabel(a.kind)}`}
      searchPlaceholder="Search accounts"
      filters={filters}
      defaultView={{ filters: { use: ["active"] } }}
      csvName="keg-accounts-setup"
      urlSearch={false}
      maxHeight="32rem"
      rowClassName={(a) => (a.active ? undefined : "opacity-60")}
      footer={<div className="px-4 pb-3"><AddRow placeholder="e.g. Catskill Tap House" label="Add account" onAdd={(v) => addAccount(v)} /></div>}
      empty={<EmptyState title="No accounts yet" action={<AddRow placeholder="e.g. Catskill Tap House" label="Add account" onAdd={(v) => addAccount(v)} />}>The bars, restaurants and people your kegs go out to.</EmptyState>}
      card={(a) => ({ title: a.name, subtitle: [kindLabel(a.kind), a.contact, a.phone].filter(Boolean).join(" · "), value: `${a.out} out` })}
      drawerTitle={(a) => a.name}
      rowHref={(a) => `/kegs/accounts/${a.id}`}
      drawer={(a) => (
        <div className="divide-y divide-border">
          {field("Name", <GridCell grid="accd" col="name" ariaLabel="Account name" value={a.name} onSave={(v) => setAccountField(a.id, "name", v)} />)}
          {field("Type", <GridSelect ariaLabel="Type" value={a.kind} options={KINDS} onSave={(v) => setAccountField(a.id, "kind", v)} />)}
          {field("Contact", <GridCell grid="accd" col="contact" ariaLabel="Contact" value={a.contact} placeholder="—" onSave={(v) => setAccountField(a.id, "contact", v)} />)}
          {field("Phone", <GridCell grid="accd" col="phone" ariaLabel="Phone" value={a.phone} placeholder="—" onSave={(v) => setAccountField(a.id, "phone", v)} />)}
          {field("Email", <GridCell grid="accd" col="email" ariaLabel="Email" value={a.email} placeholder="—" onSave={(v) => setAccountField(a.id, "email", v)} />)}
        </div>
      )}
    />
  );
}
