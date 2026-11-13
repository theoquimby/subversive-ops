import { money, pct, signedPct } from "@/lib/format";
import { Badge, cx, EmptyState, LinkButton, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { GridCell } from "@/components/grid";
import { setRecipeField } from "@/server/actions/inline";
import { requireUser } from "@/server/auth";
import { menuCosts } from "@/server/services/insights";
import Link from "next/link";

export const metadata = { title: "Menu costs" };

const TABS = [
  { kind: "MENU", label: "Menu items" },
  { kind: "MODIFIER", label: "Add-ons" },
  { kind: "PREP", label: "Prep recipes" },
] as const;

export default async function MenuPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  await requireUser("MANAGER");
  const { kind = "MENU" } = await searchParams;
  const { rows } = await menuCosts();
  const list = rows.filter((r) => r.kind === kind).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  const isPrep = kind === "PREP";

  return (
    <>
      <PageHeader
        title="Menu costs"
        description="Plate costs update automatically whenever a supplier price changes."
        actions={<LinkButton href={`/menu/new?kind=${kind}`} variant="primary">New recipe</LinkButton>}
      />
      <div className="mb-5 flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <Link key={t.kind} href={`/menu?kind=${t.kind}`} className={cx("-mb-px border-b-2 px-3 pb-2.5 text-sm", t.kind === kind ? "border-ink font-medium text-ink" : "border-transparent text-muted hover:text-ink")}>
            {t.label} <span className="num ml-1 text-muted">{rows.filter((r) => r.kind === t.kind).length}</span>
          </Link>
        ))}
      </div>

      {list.length === 0 ? (
        <EmptyState title="Nothing here yet" action={<LinkButton href={`/menu/new?kind=${kind}`}>Add one</LinkButton>}>
          {isPrep ? "Prep recipes are sauces, doughs and batches used inside menu items." : "Add a recipe to see its plate cost."}
        </EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th className="hidden sm:table-cell">Category</Th>
              {!isPrep && <Th align="right" className="w-28">Price</Th>}
              <Th align="right">{isPrep ? "Batch cost" : "Cost"}</Th>
              <Th align="right" className="hidden md:table-cell">30 days</Th>
              {!isPrep && <Th align="right">Food cost / target</Th>}
            </tr>
          </thead>
          <tbody>
            {list.map((r) => {
              const change = r.cost != null && r.costBefore ? (r.cost - r.costBefore) / r.costBefore : null;
              const over = r.foodCostPct != null && r.foodCostPct > r.target;
              return (
                <Tr key={r.id}>
                  <Td>
                    <Link href={`/menu/${r.id}`} className="font-medium hover:underline">{r.name}</Link>
                    {r.incomplete && <Badge tone="warn" className="ml-2">{r.error ? "Error" : "Missing prices"}</Badge>}
                  </Td>
                  <Td className="hidden text-muted sm:table-cell">{r.category}</Td>
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
      )}
    </>
  );
}
