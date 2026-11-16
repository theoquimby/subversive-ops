import { Card, LinkButton, Section } from "@/components/ui";
import { pct } from "@/lib/format";
import { linkCoverage } from "@/server/services/linking";
import { SectionSkeleton, TableSkeleton } from "@/components/skeleton";
import { squareItemRows } from "@/server/services/square-menu";
import { SquareItemsTable } from "./square-items-table";

/**
 * The Square items table on /sales. Matching every unlinked Square item to a
 * recipe is the slowest part of the page, so it streams in on its own
 * (wrap it in Suspense with `SquareItemsSkeleton`) after the forecast shows.
 */
export async function SquareItemsSection() {
  const [squareRows, cov] = await Promise.all([squareItemRows(), linkCoverage()]);
  const unmapped = squareRows.rows.some((r) => !r.recipeId && !r.ignored && r.unitCost == null);
  return (
    <Section
      help="sales.mapping"
      title="Square items"
      description="Link each Square item and modifier to a recipe so its sales drive costing and ordering."
      actions={
        <a href="/sales/square-menu" className="text-sm font-medium whitespace-nowrap text-ink hover:underline">Menu from Square →</a>
      }
    >
      {cov.share != null && (
        <Card className="mb-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between" data-tour="sales.link-entry">
          <div className="min-w-0 text-sm">
            <div><span className="font-semibold">Linked: {pct(cov.share, 0)}</span> of last 30 days&apos; sales <span className="text-muted">→ {pct(cov.target, 0)} target</span></div>
            <div className="text-xs text-muted">{cov.share >= cov.target ? "On target. New items show up in the assistant when they first sell." : "The assistant takes the biggest sellers first, shows each link's cost before saving, and can undo anything."}</div>
          </div>
          <LinkButton href="/sales/link" variant={cov.share >= cov.target ? "secondary" : "primary"} className="shrink-0">Link your sales</LinkButton>
        </Card>
      )}
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
