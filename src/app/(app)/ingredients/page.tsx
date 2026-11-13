import { GridCell, GridSelect } from "@/components/grid";
import { Badge, EmptyState, Input, LinkButton, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { usableCostPerBase } from "@/domain/costing";
import { money } from "@/lib/format";
import { DISPLAY_UNIT, perDisplayUnit } from "@/lib/units-display";
import { setIngredientField } from "@/server/actions/inline";
import { requireUser } from "@/server/auth";
import { buildContext, loadCostingSnapshot } from "@/server/services/costing";
import { countUnitsFor, loadCountableIngredients } from "@/server/services/inventory";
import { businessToday } from "@/server/services/sales";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { HelpTip, HelpZone } from "@/components/help";

export const metadata = { title: "Ingredients" };

export default async function IngredientsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireUser("MANAGER");
  const { q = "" } = await searchParams;
  const [snap, ingredients] = await Promise.all([loadCostingSnapshot(), loadCountableIngredients()]);
  const ctx = buildContext(snap, businessToday());
  const usedIn = new Map<string, number>();
  for (const r of snap.recipes) for (const l of r.lines) if (l.ingredientId) usedIn.set(l.ingredientId, (usedIn.get(l.ingredientId) ?? 0) + 1);
  const list = ingredients
    .filter((i) => !q || i.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

  return (
    <>
      <PageHeader
        title="Ingredients"
        description="Click any cell to edit. Enter moves down, Tab moves across, and you can paste a column from a spreadsheet."
        actions={<LinkButton href="/ingredients/new" variant="primary">New ingredient</LinkButton>}
      />
      <form className="mb-4 max-w-xs" data-tour="ingredients.search">
        <Input name="q" defaultValue={q} placeholder="Search ingredients" type="search" />
      </form>
      {list.length === 0 ? (
        <EmptyState title="No ingredients found" />
      ) : (
        <HelpZone id="ingredients.grid" tour="ingredients.grid">
        <Table>
          <thead>
            <tr>
              <Th className="w-[30%]">Ingredient</Th>
              <Th className="hidden md:table-cell">Category</Th>
              <Th className="hidden lg:table-cell">Storage</Th>
              <Th align="right"><span className="inline-flex items-center gap-1">Cost <HelpTip id="ingredients.cost" /></span></Th>
              <Th align="right" className="w-24"><span className="inline-flex items-center gap-1">Yield <HelpTip id="ingredients.yield" /></span></Th>
              <Th align="right" className="hidden w-24 sm:table-cell"><span className="inline-flex items-center gap-1">Buffer <HelpTip id="ingredients.buffer" /></span></Th>
              <Th className="hidden w-28 sm:table-cell"><span className="inline-flex items-center gap-1">Count in <HelpTip id="ingredients.countIn" /></span></Th>
            </tr>
          </thead>
          <tbody>
            {list.map((i) => {
              const c = ctx.ingredients.get(i.id)!;
              const cost = perDisplayUnit(usableCostPerBase(c), c.baseUnit);
              const { units } = countUnitsFor(i);
              return (
                <Tr key={i.id}>
                  <td className="border-b border-border py-1 pr-2 pl-2 [tr:last-child_&]:border-b-0">
                    <div className="flex items-center gap-1">
                      <GridCell grid="ing" col="name" value={i.name} onSave={setIngredientField.bind(null, i.id, "name")} ariaLabel="Name" className="flex-1 font-medium" />
                      {!i.preferredProduct && <Badge tone="warn" className="hidden sm:inline-flex">No supplier</Badge>}
                      <Link href={`/ingredients/${i.id}`} className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-ink" aria-label={`Open ${i.name}`}>
                        <ArrowUpRight className="size-4" />
                      </Link>
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
