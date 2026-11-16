import { HelpTip } from "@/components/help";
import { Card, LinkButton, PageHeader, Section } from "@/components/ui";
import { PACKAGING_LOSS } from "@/domain/brewRecipes";
import { requireUser } from "@/server/auth";
import { brewingPriceRows, brewSuppliers, listBrewRecipes } from "@/server/services/brewRecipes";
import Link from "next/link";
import { PriceTable } from "./price-table";
import { RecipeList } from "./recipe-list";

export const metadata = { title: "Brewing recipes" };

export default async function Page() {
  await requireUser("MANAGER");
  const [rows, prices, suppliers] = await Promise.all([listBrewRecipes(), brewingPriceRows(), brewSuppliers()]);
  const needPrices = rows.filter((r) => r.status !== "archived" && r.unpricedLines > 0).length;
  const unpricedIngredients = prices.filter((p) => p.price == null && p.usedBy > 0).length;
  return (
    <>
      <PageHeader
        help="brewery.recipes"
        title="Recipes"
        description="Every brewing recipe with its gravity, bitterness, colour and cost, worked out live from today's ingredient prices."
        actions={
          <>
            <LinkButton href="/brewery/import" variant="ghost">Import from Brew Manager</LinkButton>
            <LinkButton href="/brewery/recipes/new" variant="primary">New recipe</LinkButton>
          </>
        }
      />
      {needPrices > 0 && (
        <Card className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 border-warn/30 bg-warn-bg/40 px-4 py-3 text-sm">
          <span className="min-w-0 flex-1">
            {needPrices === 1 ? "1 recipe is" : `${needPrices} recipes are`} missing prices
            {unpricedIngredients > 0 ? `: ${unpricedIngredients} brewing ingredient${unpricedIngredients === 1 ? " has" : "s have"} no price yet` : ", or have lines not matched to an ingredient"}. Their costs are the least they could be.
          </span>
          <Link href="#prices" className="font-medium text-ink underline underline-offset-2 hover:no-underline">Add prices</Link>
        </Card>
      )}
      <RecipeList rows={rows} />
      <p className="mt-3 mb-10 text-xs text-muted">
        Cost per pint is 16 oz of packaged beer: the batch cost shared over the batch less {Math.round(PACKAGING_LOSS * 100)}% lost between the brewhouse and the kegs. Foam and line loss at the tap are not included.
      </p>
      <div id="prices" className="scroll-mt-20">
        <Section
          help="brewery.recipes.prices"
          title={<span className="inline-flex items-center gap-1.5">Brewing ingredient prices <HelpTip id="brewery.recipes.prices" /></span>}
          description="Malt, hops, yeast and other brewing ingredients, with today's price and where it came from. Type a price to set it."
        >
          <PriceTable rows={prices} suppliers={suppliers} />
        </Section>
      </div>
    </>
  );
}
