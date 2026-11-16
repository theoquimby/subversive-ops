import { LinkButton, PageHeader, Section } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { brewStockRows } from "@/server/services/brewStock";
import { AddIngredient } from "./add-ingredient";
import { StockTable } from "./stock-table";

export const metadata = { title: "Brewing stock" };

export default async function Page() {
  await requireUser("MANAGER");
  const { today, rows, strays } = await brewStockRows();
  return (
    <>
      <PageHeader
        help="brewery.stock"
        title="Brewing stock"
        description="Malt, hops, yeast and other brewing ingredients: what's on the shelf, what brews used, and what planned brews need. Kept apart from kitchen counts."
        actions={
          <>
            <LinkButton href="/brewery/stock/received">Received a delivery</LinkButton>
            <LinkButton href="/brewery/stock/count" variant="primary">Count brewing stock</LinkButton>
          </>
        }
      />
      <StockTable rows={rows} today={today} />
      <p className="mt-3 text-xs text-muted">On hand is the last count, plus deliveries, less what each brew used (worked out from its recipe when it's marked brewed), plus fixes. Tap an ingredient for its history, a delivery or a fix.</p>
      <Section className="mt-10" title="Add a brewing ingredient" description="Brewing ingredients live on the brewery side: they never show in kitchen counts or kitchen ordering.">
        <AddIngredient strays={strays} />
      </Section>
    </>
  );
}
