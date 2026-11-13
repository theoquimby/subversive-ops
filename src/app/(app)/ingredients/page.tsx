import { GridCell, GridSelect } from "@/components/grid";
import { Badge, cx, EmptyState, Input, LinkButton, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { usableCostPerBase } from "@/domain/costing";
import { toBase } from "@/domain/units";
import { money, qty as fmtQty, shortDate } from "@/lib/format";
import { DISPLAY_UNIT, perDisplayUnit } from "@/lib/units-display";
import { setIngredientField } from "@/server/actions/inline";
import { requireUser } from "@/server/auth";
import { buildContext, loadCostingSnapshot } from "@/server/services/costing";
import { countUnitsFor, loadCountableIngredients } from "@/server/services/inventory";
import { estimatedOnHandAll, loadPars } from "@/server/services/planning";
import { MinOnHandCell } from "./min-on-hand-cell";
import { ArchiveIngredientButton, RestoreIngredientButton } from "./archive-buttons";
import { archivedLabel, baseName } from "@/domain/archiveName";
import { db } from "@/server/db";
import { businessToday } from "@/server/services/sales";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { HelpTip, HelpZone } from "@/components/help";

export const metadata = { title: "Ingredients" };

export default async function IngredientsPage({ searchParams }: { searchParams: Promise<{ q?: string; show?: string }> }) {
  await requireUser("MANAGER");
  const { q = "", show } = await searchParams;
  const showArchived = show === "archived";
  const [snap, ingredients, stock, pars, archived] = await Promise.all([
    loadCostingSnapshot(),
    loadCountableIngredients(),
    estimatedOnHandAll(),
    loadPars(),
    db.ingredient.findMany({ where: { active: false }, select: { id: true, name: true, category: true }, orderBy: { name: "asc" } }),
  ]);
  const ctx = buildContext(snap, businessToday());
  const usedIn = new Map<string, number>();
  for (const r of snap.recipes) for (const l of r.lines) if (l.ingredientId) usedIn.set(l.ingredientId, (usedIn.get(l.ingredientId) ?? 0) + 1);
  const list = ingredients
    .filter((i) => !q || i.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  const archivedList = archived.filter((i) => !q || baseName(i.name).toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <PageHeader
        help="ingredients.page"
        title="Ingredients"
        description="Click any cell to edit. Enter moves down, Tab moves across, and you can paste a column from a spreadsheet."
        actions={<LinkButton href="/ingredients/new" variant="primary">New ingredient</LinkButton>}
      />
      <HelpZone id="ingredients.search" className="mb-4 flex flex-wrap items-center gap-3">
        <form className="w-full max-w-xs" data-tour="ingredients.search">
          {showArchived && <input type="hidden" name="show" value="archived" />}
          <Input name="q" defaultValue={q} placeholder={showArchived ? "Search archived" : "Search ingredients"} type="search" />
        </form>
        {(archived.length > 0 || showArchived) && (
          <Link
            href={showArchived ? "/ingredients" : "/ingredients?show=archived"}
            className={cx("relative ml-auto rounded-full px-3 py-1 text-sm after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-['']", showArchived ? "bg-primary text-primary-ink" : "text-ink-2 hover:bg-surface-2")}
          >
            Archived <span className="num ml-1">{archived.length}</span>
          </Link>
        )}
      </HelpZone>
      {showArchived ? (
        archivedList.length === 0 ? (
          <EmptyState title="Nothing archived">Archived ingredients show up here so you can bring them back.</EmptyState>
        ) : (
          <HelpZone id="ingredients.archived"><Table>
            <thead>
              <tr>
                <Th>Ingredient</Th>
                <Th className="hidden sm:table-cell">Category</Th>
                <Th className="hidden sm:table-cell">Archived</Th>
                <Th align="right"><span className="sr-only">Restore</span></Th>
              </tr>
            </thead>
            <tbody>
              {archivedList.map((i) => (
                <Tr key={i.id}>
                  <Td>
                    <div className="font-medium">{baseName(i.name)}</div>
                    <div className="text-xs text-muted sm:hidden">{i.category}{archivedLabel(i.name) ? ` · archived ${archivedLabel(i.name)}` : ""}</div>
                  </Td>
                  <Td className="hidden text-muted sm:table-cell">{i.category}</Td>
                  <Td className="hidden text-muted sm:table-cell">{archivedLabel(i.name) ?? "—"}</Td>
                  <Td align="right" className="py-2"><RestoreIngredientButton id={i.id} name={baseName(i.name)} /></Td>
                </Tr>
              ))}
            </tbody>
          </Table></HelpZone>
        )
      ) : list.length === 0 ? (
        <EmptyState title="No ingredients found" />
      ) : (
        <HelpZone id="ingredients.grid" tour="ingredients.grid">
        <Table>
          <thead>
            <tr>
              <Th className="w-[30%] xl:w-[22%]">Ingredient</Th>
              <Th className="hidden md:table-cell">Category</Th>
              <Th className="hidden lg:table-cell">Storage</Th>
              <Th align="right"><span className="inline-flex items-center gap-1">Cost <HelpTip id="ingredients.cost" /></span></Th>
              <Th align="right" className="w-24"><span className="inline-flex items-center gap-1">Yield <HelpTip id="ingredients.yield" /></span></Th>
              <Th align="right" className="hidden w-24 sm:table-cell"><span className="inline-flex items-center gap-1">Buffer <HelpTip id="ingredients.buffer" /></span></Th>
              <Th className="hidden w-28 sm:table-cell"><span className="inline-flex items-center gap-1">Count in <HelpTip id="ingredients.countIn" /></span></Th>
              <Th align="right" className="hidden md:table-cell"><span className="inline-flex items-center gap-1">On hand (est.) <HelpTip id="ingredients.onHand" /></span></Th>
              <Th align="right" className="hidden w-28 lg:table-cell"><span className="inline-flex items-center gap-1">Min on hand <HelpTip id="ingredients.minOnHand" /></span></Th>
            </tr>
          </thead>
          <tbody>
            {list.map((i) => {
              const c = ctx.ingredients.get(i.id)!;
              const cost = perDisplayUnit(usableCostPerBase(c), c.baseUnit);
              const { units, conversions } = countUnitsFor(i);
              let perUnit = 1;
              try {
                perUnit = toBase(1, units[0], c.baseUnit, conversions);
              } catch {}
              const st = stock.get(i.id);
              const par = pars[i.id];
              return (
                <Tr key={i.id}>
                  <td className="border-b border-border py-1 pr-2 pl-2 [tr:last-child_&]:border-b-0">
                    <div className="flex flex-wrap items-center gap-1">
                      <GridCell grid="ing" col="name" value={i.name} onSave={setIngredientField.bind(null, i.id, "name")} ariaLabel="Name" className="flex-1 font-medium" />
                      {!i.preferredProduct && <Badge tone="warn" className="hidden sm:inline-flex">No supplier</Badge>}
                      <Link href={`/ingredients/${i.id}`} className="relative rounded-md p-1.5 text-muted after:absolute after:-inset-1.5 after:content-[''] hover:bg-surface-2 hover:text-ink" aria-label={`Open ${i.name}`}>
                        <ArrowUpRight className="size-4" />
                      </Link>
                      <ArchiveIngredientButton id={i.id} name={i.name} usedIn={usedIn.get(i.id) ?? 0} />
                    </div>
                    <div className="pl-2 text-xs text-muted md:hidden">{i.category}{usedIn.get(i.id) ? ` · in ${usedIn.get(i.id)} recipes` : ""}</div>
                  </td>
                  <td className="hidden border-b border-border px-2 py-1 md:table-cell [tr:last-child_&]:border-b-0">
                    <GridCell grid="ing" col="category" value={i.category} onSave={setIngredientField.bind(null, i.id, "category")} ariaLabel="Category" />
                  </td>
                  <td className="hidden border-b border-border px-2 py-1 lg:table-cell [tr:last-child_&]:border-b-0">
                    <GridCell grid="ing" col="storage" value={i.storageArea} onSave={setIngredientField.bind(null, i.id, "storageArea")} ariaLabel="Storage area" />
                  </td>
                  <Td align="right" className="whitespace-nowrap">
                    {cost == null ? <span className="text-warn">No price</span> : <>{money(cost)}<span className="text-muted">/{DISPLAY_UNIT[c.baseUnit].unit}</span></>}
                  </Td>
                  <td className="border-b border-border px-2 py-1 [tr:last-child_&]:border-b-0">
                    <GridCell grid="ing" col="yield" type="number" suffix="%" value={Math.round(c.yieldPct * 1000) / 10} onSave={setIngredientField.bind(null, i.id, "yieldPct")} ariaLabel="Yield percent" />
                  </td>
                  <td className="hidden border-b border-border px-2 py-1 sm:table-cell [tr:last-child_&]:border-b-0">
                    <GridCell grid="ing" col="buffer" type="number" suffix="%" value={Math.round(i.safetyPct.toNumber() * 100)} onSave={setIngredientField.bind(null, i.id, "safetyPct")} ariaLabel="Order buffer percent" />
                  </td>
                  <td className="hidden border-b border-border px-2 py-1 sm:table-cell [tr:last-child_&]:border-b-0">
                    <GridSelect value={units[0]} options={units.map((u) => ({ value: u, label: u }))} onSave={setIngredientField.bind(null, i.id, "countUnit")} ariaLabel="Count unit" />
                  </td>
                  <Td align="right" className="hidden whitespace-nowrap md:table-cell">
                    {!st?.known ? (
                      <span className="text-muted">Not counted</span>
                    ) : (
                      <>
                        <span className={cx(par != null && st.qty < par && "font-medium text-warn")}>{fmtQty(st.qty / perUnit, 1)}</span> <span className="text-muted">{units[0]}</span>
                        <div className="text-xs text-muted">counted {shortDate(st.countedOn!)}</div>
                      </>
                    )}
                  </Td>
                  <td className="hidden border-b border-border px-2 py-1 lg:table-cell [tr:last-child_&]:border-b-0">
                    <MinOnHandCell id={i.id} value={par == null ? null : Math.round((par / perUnit) * 100) / 100} unit={units[0]} />
                  </td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
        </HelpZone>
      )}
    </>
  );
}
