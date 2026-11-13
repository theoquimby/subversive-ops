import { HelpTip, HelpZone } from "@/components/help";
import { EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { AllergenChart } from "./allergen-chart";
import { requireUser } from "@/server/auth";
import { menuAllergens } from "@/server/services/allergens";
import { businessToday } from "@/server/services/sales";
import { dayDate } from "@/lib/format";
import { PrintButton } from "./print-button";

export const metadata = { title: "Allergen chart" };

// Only on this page: drop the app chrome when printing so the chart fills the sheet.
const PRINT_CSS = `@media print {
  aside.fixed, header.sticky, nav[aria-label="Main"] { display: none !important; }
  main { padding: 0 !important; }
  main > div { padding: 0 !important; max-width: none !important; }
  @page { margin: 12mm; }
}`;

export default async function AllergenChartPage({ searchParams }: { searchParams: Promise<{ addons?: string }> }) {
  await requireUser("MANAGER");
  const { addons } = await searchParams;
  const showAddons = addons === "1";
  const { rows: all, taggedCount, ingredientCount } = await menuAllergens();
  const rows = all.filter((r) => showAddons || r.kind === "MENU");

  return (
    <>
      <style>{PRINT_CSS}</style>
      <PageHeader
        help="menu.allergenChart"
        title="Allergen chart"
        description={`Menu items against the nine major allergens, rolled up from tagged ingredients. ${taggedCount} of ${ingredientCount} ingredients have tags.`}
        back={{ href: "/menu", label: "Menu costs" }}
        actions={
          <HelpZone id="menu.allergenChart.actions" className="flex flex-wrap items-center gap-2">
            <LinkButton href={showAddons ? "/menu/allergens" : "/menu/allergens?addons=1"} variant="ghost" className="print:hidden">{showAddons ? "Hide add-ons" : "Include add-ons"}</LinkButton>
            <PrintButton />
          </HelpZone>
        }
      />
      <p className="mb-4 hidden text-xs print:block">Subversive · printed {dayDate(businessToday())}</p>
      <HelpZone id="menu.allergenChart" tour="menu.allergenChart">
        {rows.length === 0 ? (
          <EmptyState title="No menu items yet">Add recipes on Menu costs, then tag allergens on each ingredient.</EmptyState>
        ) : (
          <AllergenChart rows={rows.map((r) => ({ id: r.id, name: r.name, category: r.category, allergens: r.allergens, sources: r.sources }))} />
        )}
      </HelpZone>
      <p className="mt-4 flex items-start gap-1.5 text-xs text-muted">
        <HelpTip id="menu.allergenChart" className="print:hidden" />
        Built from the allergen tags on each ingredient. Cross-contact in the kitchen (shared fryer, shared boards) isn&apos;t captured — confirm with the kitchen before promising a guest anything.
      </p>
    </>
  );
}
