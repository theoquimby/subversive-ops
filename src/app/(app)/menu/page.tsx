import { money, pct, signedPct } from "@/lib/format";
import { Badge, cx, EmptyState, LinkButton, PageHeader, Section, Table, Td, Th, Tr } from "@/components/ui";
import { GridCell, GridSelect } from "@/components/grid";
import { classLabel, classifyCategory, DEFAULT_BEV_TARGET, normalizeCategory, REVENUE_CLASSES } from "@/domain/revenueClass";
import { classSettings, costTargets } from "@/server/services/insights";
import { saveBevTarget, saveCategoryClass } from "./draft-beer/actions";
import { setRecipeField } from "@/server/actions/inline";
import { requireUser } from "@/server/auth";
import { menuCosts } from "@/server/services/insights";
import { db } from "@/server/db";
import Link from "next/link";
import { HelpTip, HelpZone } from "@/components/help";

export const metadata = { title: "Menu costs" };

const TABS = [
  { kind: "MENU", label: "Menu items" },
  { kind: "MODIFIER", label: "Add-ons" },
  { kind: "PREP", label: "Prep recipes" },
] as const;

export default async function MenuPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  await requireUser("MANAGER");
  const { kind = "MENU" } = await searchParams;
  const [{ rows }, noLines, cls, targets] = await Promise.all([menuCosts(), db.recipe.findMany({ where: { lines: { none: {} } }, select: { id: true } }), classSettings(), costTargets()]);
  // Every category in use (menu items and add-ons), with the class it maps to.
  const categories = [...new Map(rows.filter((r) => r.kind !== "PREP").map((r) => [normalizeCategory(r.category), r.category])).values()]
    .sort((a, b) => a.localeCompare(b))
    .map((c) => ({ name: c, cls: classifyCategory(c, cls.map), saved: normalizeCategory(c) in cls.map, items: rows.filter((r) => r.kind !== "PREP" && normalizeCategory(r.category) === normalizeCategory(c)).length }));
  const needsIngredients = new Set(noLines.map((r) => r.id));
  const list = rows.filter((r) => r.kind === kind).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  const isPrep = kind === "PREP";

  return (
    <>
      <PageHeader
        title="Menu costs"
        description="Plate costs update automatically whenever a supplier price changes."
        actions={
          <>
            <LinkButton href="/menu/draft-beer" data-tour="menu.draft-beer-link">Draft beer</LinkButton>
            <LinkButton href={`/menu/new?kind=${kind}`} variant="primary">New recipe</LinkButton>
          </>
        }
      />
      <HelpZone id="menu.tabs" tour="menu.tabs" className="mb-5 flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <Link key={t.kind} href={`/menu?kind=${t.kind}`} className={cx("-mb-px border-b-2 px-3 pb-2.5 text-sm", t.kind === kind ? "border-ink font-medium text-ink" : "border-transparent text-muted hover:text-ink")}>
            {t.label} <span className="num ml-1 text-muted">{rows.filter((r) => r.kind === t.kind).length}</span>
          </Link>
        ))}
      </HelpZone>

      {list.length === 0 ? (
        <EmptyState title="Nothing here yet" action={<LinkButton href={`/menu/new?kind=${kind}`}>Add one</LinkButton>}>
          {isPrep ? "Prep recipes are sauces, doughs and batches used inside menu items." : "Add a recipe to see its plate cost."}
        </EmptyState>
      ) : (
        <HelpZone id="menu.list" tour="menu.table">
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th className="hidden sm:table-cell">Category</Th>
              {!isPrep && <Th align="right" className="w-28">Price</Th>}
              <Th align="right">{isPrep ? "Batch cost" : "Cost"}</Th>
              <Th align="right" className="hidden md:table-cell"><span className="inline-flex items-center gap-1">30 days <HelpTip id="menu.list.change" /></span></Th>
              {!isPrep && <Th align="right"><span className="inline-flex items-center gap-1">Food cost / target <HelpTip id="menu.list.target" /></span></Th>}
            </tr>
          </thead>
          <tbody>
            {list.map((r) => {
              const change = r.cost != null && r.costBefore ? (r.cost - r.costBefore) / r.costBefore : null;
              const over = r.foodCostPct != null && r.foodCostPct > r.target;
              return (
                <Tr key={r.id}>
                  <Td>
                    <Link href={`/menu/${r.id}`} data-tour="menu.recipe-link" className="font-medium hover:underline">{r.name}</Link>
                    {needsIngredients.has(r.id) ? (
                      <Badge tone="warn" className="ml-2">Needs ingredients</Badge>
                    ) : (
                      r.incomplete && <Badge tone="warn" className="ml-2">{r.error ? "Error" : "Missing prices"}</Badge>
                    )}
                  </Td>
                  <Td className="hidden text-muted sm:table-cell">{r.category}{!isPrep && r.cls !== "food" && <Badge className="ml-2">{classLabel(r.cls)}</Badge>}</Td>
                  {!isPrep && (
                    <td className="border-b border-border px-2 py-1 [tr:last-child_&]:border-b-0">
                      <GridCell grid="menu" col="price" type="number" prefix="$" decimals={2} value={r.menuPrice} onSave={setRecipeField.bind(null, r.id, "menuPrice")} ariaLabel={`${r.name} price`} />
                    </td>
                  )}
                  <Td align="right">{money(r.cost)}</Td>
                  <Td align="right" className={cx("hidden md:table-cell", change == null || Math.abs(change) < 0.001 ? "text-muted" : change > 0 ? "text-bad" : "text-good")}>
                    {change == null || Math.abs(change) < 0.001 ? "—" : signedPct(change)}
                  </Td>
                  {!isPrep && (
                    <td className="border-b border-border px-2 py-1 [tr:last-child_&]:border-b-0">
                      <div className="flex items-center justify-end gap-1">
                        <span className={cx("num text-sm font-medium", over ? "text-bad" : "text-ink")}>{pct(r.foodCostPct)}</span>
                        <span className="text-xs text-muted">of</span>
                        <GridCell grid="menu" col="target" type="number" suffix="%" value={Math.round(r.target * 100)} onSave={setRecipeField.bind(null, r.id, "targetFoodCostPct")} ariaLabel={`${r.name} target food cost`} className="w-16" />
                      </div>
                    </td>
                  )}
                </Tr>
              );
            })}
          </tbody>
        </Table>
        </HelpZone>
      )}

      {!isPrep && categories.length > 0 && (
        <HelpZone id="menu.classes" tour="menu.classes" className="mt-10">
          <Section
            title={<span className="inline-flex items-center gap-1.5">Food and drink <HelpTip id="menu.classes" /></span>}
            description="Which part of the business each category's sales and costs count toward on the P&L, Overview and Margin gap."
          >
            <Table>
              <thead>
                <tr>
                  <Th>Category</Th>
                  <Th className="w-48">Counts as</Th>
                  <Th align="right" className="hidden sm:table-cell">Items</Th>
                </tr>
              </thead>
              <tbody>
                {categories.map((c) => (
                  <Tr key={c.name}>
                    <Td className="font-medium">{c.name}{!c.saved && <span className="ml-2 text-xs font-normal text-muted">guessed</span>}</Td>
                    <td className="border-b border-border px-2 py-1 [tr:last-child_&]:border-b-0">
                      <GridSelect value={c.cls} options={REVENUE_CLASSES.map((x) => ({ value: x.value, label: x.label }))} onSave={saveCategoryClass.bind(null, c.name)} ariaLabel={`${c.name} counts as`} />
                    </td>
                    <Td align="right" className="hidden text-muted sm:table-cell">{c.items}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-ink-2">
              <span>Beverage cost target</span>
              <GridCell grid="menu-bev" col="target" type="number" suffix="%" value={Math.round(targets.beverage * 1000) / 10} onSave={saveBevTarget} ariaLabel="Beverage cost target" className="w-20" />
              <span className="text-xs text-muted">{cls.bevTarget == null ? `default ${pct(DEFAULT_BEV_TARGET, 0)}; ` : ""}food uses the target in Settings ({pct(targets.food, 0)}).</span>
            </div>
          </Section>
        </HelpZone>
      )}
    </>
  );
}
