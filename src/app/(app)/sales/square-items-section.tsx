import { Card, Section } from "@/components/ui";
import { SectionSkeleton, TableSkeleton } from "@/components/skeleton";
import { squareItemRows } from "@/server/services/square-menu";
import { SquareItemsTable } from "./square-items-table";

/**
 * The Square items table on /sales. Matching every unlinked Square item to a
 * recipe is the slowest part of the page, so it streams in on its own
 * (wrap it in Suspense with `SquareItemsSkeleton`) after the forecast shows.
 */
export async function SquareItemsSection() {
  const squareRows = await squareItemRows();
  const unmapped = squareRows.rows.some((r) => !r.recipeId && !r.ignored);
  return (
    <Section
      help="sales.mapping"
      title="Square items"
      description="Link each Square item and modifier to a recipe so its sales drive costing and ordering."
      actions={
        <a href="/sales/square-menu" className="text-sm font-medium whitespace-nowrap text-ink hover:underline">Menu from Square →</a>
      }
    >
      {squareRows.rows.length === 0 ? (
        <Card className="p-5 text-sm text-muted">No Square items yet. They come in with the first sync.</Card>
      ) : (
        <SquareItemsTable id="sales-items" rows={squareRows.rows} recipes={squareRows.recipes} defaultFilters={unmapped ? { status: ["open", "suggested"] } : {}} />
      )}
    </Section>
  );
}

export function SquareItemsSkeleton() {
  return (
    <SectionSkeleton action>
      <TableSkeleton rows={8} cols={["2fr", "1fr", "1.4fr", "1fr"]} />
    </SectionSkeleton>
  );
}
