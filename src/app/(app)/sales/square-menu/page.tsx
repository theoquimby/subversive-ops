import { HelpZone } from "@/components/help";
import Link from "next/link";
import { Card, LinkButton, PageHeader, Stat } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { isSquareConnected } from "@/server/services/square";
import { squareItemRows } from "@/server/services/square-menu";
import { SquareItemsTable } from "../square-items-table";
import { loadDrafts } from "@/server/services/recipe-drafts";

export const metadata = { title: "Menu from Square" };

export default async function SquareMenuPage() {
  await requireUser("MANAGER");
  const [connected, { review: r, rows, recipes, toMatch }, drafts] = await Promise.all([isSquareConnected(), squareItemRows(), loadDrafts()]);

  return (
    <>
      <PageHeader
        help="sales.squareMenu"
        back={{ href: "/sales", label: "Sales" }}
        title="Menu from Square"
        description="Match each Square item to its recipe, draft recipes for the ones you don't have yet, and keep menu prices in step with what Square charges. Tick rows to accept, reject, link, draft or create in bulk."
        actions={drafts.length > 0 ? <LinkButton href="/menu/drafts" variant="primary">Review {drafts.length} draft{drafts.length === 1 ? "" : "s"}</LinkButton> : undefined}
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
            <Stat help="sales.squareMenu.open" label="Still to match" value={toMatch.items} tone={toMatch.items ? "warn" : "good"} hint={toMatch.items ? `sold lately · ${toMatch.suggested} with a suggestion` : "all done"} />
            <Stat help="sales.squareMenu.driftCount" label="Price differences" value={r.drift.length} tone={r.drift.length ? "warn" : undefined} hint="Square vs. menu price" />
            <Stat help="sales.squareMenu.needIngredients" label="Need ingredients" value={r.needIngredients} tone={r.needIngredients ? "warn" : undefined} hint="linked recipes with no lines" />
          </div>

          {!r.hasMeta && (
            <Card className="mb-8 p-4 text-sm text-ink-2">Prices and categories show up after the next Square sync.</Card>
          )}

          {(toMatch.resting > 0 || toMatch.skipped > 0) && (
            <p className="mb-4 text-sm text-ink-2">
              {toMatch.resting > 0 && <>{toMatch.resting} unmatched item{toMatch.resting === 1 ? " hasn't" : "s haven't"} sold in four weeks (old specials and the like): they show as <b>Not selling lately</b> and need nothing until they sell again. </>}
              {toMatch.skipped > 0 && <>{toMatch.skipped} {toMatch.skipped === 1 ? "is" : "are"} skipped for now. </>}
              <Link href="/sales/link" className="font-medium text-ink underline underline-offset-2">Link your sales</Link> lists what to do first.
            </p>
          )}

          <SquareItemsTable id="square-menu" help="sales.squareMenu.table" rows={rows} recipes={recipes} defaultFilters={toMatch.suggested ? { status: ["suggested"] } : toMatch.items ? { status: ["open"] } : {}} />
        </>
      )}
    </>
  );
}
