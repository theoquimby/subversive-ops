import { HelpZone } from "@/components/help";
import { Card, LinkButton, PageHeader, Section, Stat } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { isSquareConnected } from "@/server/services/square";
import { squareMenuReview } from "@/server/services/square-menu";
import { CreateList, DriftTable, SuggestionTable } from "./menu-client";

export const metadata = { title: "Menu from Square" };

export default async function SquareMenuPage() {
  await requireUser("MANAGER");
  const [connected, r] = await Promise.all([isSquareConnected(), squareMenuReview()]);
  const suggested = new Set(r.suggestions.map((s) => s.squareId));
  const nameOf = new Map(r.items.map((i) => [i.squareId, i]));

  return (
    <>
      <PageHeader
        help="sales.squareMenu"
        back={{ href: "/sales", label: "Sales" }}
        title="Menu from Square"
        description="Match each Square item to its recipe, start recipes for the ones you don't have yet, and keep menu prices in step with what Square charges."
      />

      {r.items.length === 0 ? (
        <HelpZone id="sales.squareMenu.empty"><Card className="p-6 text-sm text-muted">
          {connected ? "No Square items yet. Press Sync now on Sales, or run the first import, to read the Square menu." : "Connect Square first — the menu comes in with the first sync."}
          <div className="mt-4"><LinkButton href={connected ? "/sales" : "/settings/square"} variant="primary">{connected ? "Go to Sales" : "Connect Square"}</LinkButton></div>
        </Card></HelpZone>
      ) : (
        <>
          <div className="mb-10 grid grid-cols-2 gap-3 lg:grid-cols-4 [&>[data-help-zone]>*]:h-full">
            <Stat help="sales.squareMenu.items" label="Square items" value={r.items.filter((i) => !i.deleted).length} hint={`${r.linkedCount} linked · ${r.ignoredCount} ignored`} />
            <Stat help="sales.squareMenu.open" label="Still to match" value={r.open.length} tone={r.open.length ? "warn" : "good"} hint={r.open.length ? `${r.suggestions.length} with a suggestion` : "all done"} />
            <Stat help="sales.squareMenu.driftCount" label="Price differences" value={r.drift.length} tone={r.drift.length ? "warn" : undefined} hint="Square vs. menu price" />
            <Stat help="sales.squareMenu.needIngredients" label="Need ingredients" value={r.needIngredients} tone={r.needIngredients ? "warn" : undefined} hint="linked recipes with no lines" />
          </div>

          {!r.hasMeta && (
            <Card className="mb-8 p-4 text-sm text-ink-2">Prices and categories show up after the next Square sync.</Card>
          )}

          <Section help="sales.squareMenu.suggestions" title="Suggested matches" description="Recipes whose names match a Square item closely. Check them, then accept.">
            {r.suggestions.length === 0 ? (
              <Card className="p-5 text-sm text-muted">{r.open.length ? "No confident matches left — link the rest by hand on Sales, or create recipes for them below." : "Nothing left to match."}</Card>
            ) : (
              <SuggestionTable
                rows={r.suggestions.map((s) => ({ ...s, squareName: nameOf.get(s.squareId)?.name ?? s.squareId, price: nameOf.get(s.squareId)?.price ?? null, modifier: nameOf.get(s.squareId)?.squareType === "MODIFIER" }))}
              />
            )}
          </Section>

          <Section help="sales.squareMenu.create" title="Create recipes from the Square menu" description="Starts a recipe for each item you pick — named after it, with Square's price and category. Add the ingredients afterwards; they're flagged on Menu costs until you do.">
            {r.open.length === 0 ? (
              <Card className="p-5 text-sm text-muted">Every Square item is linked or ignored.</Card>
            ) : (
              <CreateList
                rows={r.open.map((i) => ({ squareId: i.squareId, name: i.name, price: i.price, category: i.category, modifier: i.squareType === "MODIFIER", archived: i.archived, known: i.known, suggested: suggested.has(i.squareId) }))}
              />
            )}
          </Section>

          <Section help="sales.squareMenu.drift" title="Price differences" description="Linked items where Square charges something different from the recipe's menu price. Food cost % uses the menu price.">
            {r.drift.length === 0 ? (
              <Card className="p-5 text-sm text-muted">Menu prices match Square.</Card>
            ) : (
              <DriftTable rows={r.drift} />
            )}
          </Section>
        </>
      )}
    </>
  );
}
