import { Card, EmptyState, PageHeader, Section, Table, Td, Th, Tr } from "@/components/ui";
import { HelpZone } from "@/components/help";
import { ML_PER_FL_OZ } from "@/domain/draftBeer";
import { money, pct } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { menuCosts } from "@/server/services/insights";
import Link from "next/link";
import { DraftBeerFormView } from "./draft-beer-form";

export const metadata = { title: "Draft beer" };

export default async function DraftBeerPage() {
  await requireUser("MANAGER");
  const [suppliers, square, kegs, { rows }] = await Promise.all([
    db.supplier.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.squareMapping.findMany({ where: { ignored: false, squareType: "ITEM_VARIATION" }, include: { recipe: { select: { name: true } } }, orderBy: { squareName: "asc" } }),
    db.ingredient.findMany({
      where: { active: true, baseUnit: "ml", conversions: { some: { unit: "keg" } } },
      include: { conversions: { where: { unit: "keg" } }, preferredProduct: { include: { prices: { orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }], take: 1 } } } },
      orderBy: { name: "asc" },
    }),
    menuCosts(),
  ]);
  const pours = rows.filter((r) => r.cls === "beer" && r.kind === "MENU");

  return (
    <>
      <PageHeader
        title="Draft beer"
        back={{ href: "/menu", label: "Menu costs" }}
        description="Cost a keg once and every pour gets a cost: 16 oz, 10 oz, flights. Beer then counts toward beverage cost on the P&L instead of looking free."
      />
      <HelpZone id="menu.draftBeer" tour="menu.draft-beer" className="mb-10">
        <DraftBeerFormView
          suppliers={suppliers}
          squareItems={square.map((s) => ({ value: s.squareId, label: s.squareName, hint: s.recipe ? `now: ${s.recipe.name}` : undefined }))}
        />
      </HelpZone>

      <Section title="Kegs on file" description="Re-enter a beer above with a new keg cost to record a price change. Past days keep the cost that applied then.">
        {kegs.length === 0 ? (
          <EmptyState title="No kegs yet">Set up your first beer above.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Keg</Th>
                <Th align="right" className="hidden sm:table-cell">Size</Th>
                <Th align="right">Keg cost</Th>
                <Th align="right">Per oz</Th>
              </tr>
            </thead>
            <tbody>
              {kegs.map((k) => {
                const ml = k.conversions[0]?.baseQty.toNumber() ?? 0;
                const price = k.preferredProduct?.prices[0]?.price.toNumber() ?? null;
                const perOz = price != null && ml > 0 ? price / ((ml / ML_PER_FL_OZ) * k.yieldPct.toNumber()) : null;
                return (
                  <Tr key={k.id}>
                    <Td><Link href={`/ingredients/${k.id}`} className="font-medium hover:underline">{k.name}</Link><div className="text-xs text-muted">{pct(k.yieldPct.toNumber(), 0)} usable after foam and line loss</div></Td>
                    <Td align="right" className="hidden text-muted sm:table-cell">{(ml / 3785.411784).toFixed(2)} gal</Td>
                    <Td align="right">{money(price)}</Td>
                    <Td align="right">{perOz == null ? "—" : `$${perOz.toFixed(3)}`}</Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Section>

      {pours.length > 0 && (
        <Section title="Beer on the menu">
          <Card className="divide-y divide-border">
            {pours.map((r) => (
              <Link key={r.id} href={`/menu/${r.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-2/60">
                <div className="text-sm font-medium">{r.name}</div>
                <div className="num text-right text-sm">
                  {money(r.cost)} on {money(r.menuPrice)} <span className={r.foodCostPct != null && r.foodCostPct > r.target ? "text-bad" : "text-muted"}>· {pct(r.foodCostPct)}</span>
                </div>
              </Link>
            ))}
          </Card>
        </Section>
      )}
    </>
  );
}
