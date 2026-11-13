import { HelpZone } from "@/components/help";
import { Card, LinkButton, PageHeader, Stat } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { isSquareConnected } from "@/server/services/square";
import { squareItemRows } from "@/server/services/square-menu";
import { SquareItemsTable } from "../square-items-table";

export const metadata = { title: "Menu from Square" };

export default async function SquareMenuPage() {
  await requireUser("MANAGER");
  const [connected, { review: r, rows, recipes }] = await Promise.all([isSquareConnected(), squareItemRows()]);

  return (
    <>
      <PageHeader
        help="sales.squareMenu"
        back={{ href: "/sales", label: "Sales" }}
        title="Menu from Square"
        description="Match each Square item to its recipe, start recipes for the ones you don't have yet, and keep menu prices in step with what Square charges. Tick rows to accept, reject, link or create in bulk."
      />

      {r.items.length === 0 ? (
        <HelpZone id="sales.squareMenu.empty"><Card className="p-6 text-sm text-muted">
          {connected ? "No Square items yet. Press Sync now on Sales, or run the first import, to read the Square menu." : "Connect Square first — the menu comes in with the first sync."}
          <div className="mt-4"><LinkButton href={connected ? "/sales" : "/settings/square"} variant="primary">{connected ? "Go to Sales" : "Connect Square"}</LinkButton></div>
        </Card></HelpZone>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4 [&>[data-help-zone]>*]:h-full">
            <Stat help="sales.squareMenu.items" label="Square items" value={r.items.filter((i) => !i.deleted).length} hint={`${r.linkedCount} linked · ${r.ignoredCount} ignored`} />
            <Stat help="sales.squareMenu.open" label="Still to match" value={r.open.length} tone={r.open.length ? "warn" : "good"} hint={r.open.length ? `${r.suggestions.length} with a suggestion` : "all done"} />
            <Stat help="sales.squareMenu.driftCount" label="Price differences" value={r.drift.length} tone={r.drift.length ? "warn" : undefined} hint="Square vs. menu price" />
            <Stat help="sales.squareMenu.needIngredients" label="Need ingredients" value={r.needIngredients} tone={r.needIngredients ? "warn" : undefined} hint="linked recipes with no lines" />
          </div>

          {!r.hasMeta && (
            <Card className="mb-8 p-4 text-sm text-ink-2">Prices and categories show up after the next Square sync.</Card>
          )}

          <SquareItemsTable id="square-menu" help="sales.squareMenu.table" rows={rows} recipes={recipes} defaultFilters={r.suggestions.length ? { status: ["suggested"] } : r.open.length ? { status: ["open"] } : {}} />
        </>
      )}
    </>
  );
}
