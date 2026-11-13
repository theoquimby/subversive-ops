import { HelpTip, HelpZone } from "@/components/help";
import { Card, cx, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { ALLERGENS } from "@/domain/allergens";
import { requireUser } from "@/server/auth";
import { menuAllergens } from "@/server/services/allergens";
import { businessToday } from "@/server/services/sales";
import { dayDate } from "@/lib/format";
import Link from "next/link";
import { Fragment } from "react";
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
  const categories = [...new Set(rows.map((r) => r.category))];

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
          <>
            {/* Phones: one card per item listing what it contains. */}
            <div className="space-y-6 sm:hidden print:hidden">
              {categories.map((c) => (
                <section key={c}>
                  <h2 className="mb-2 text-sm font-semibold">{c}</h2>
                  <Card className="divide-y divide-border">
                    {rows.filter((r) => r.category === c).map((r) => (
                      <Link key={r.id} href={`/menu/${r.id}`} className="block px-4 py-3">
                        <div className="text-sm font-medium">{r.name}</div>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {r.allergens.length === 0 ? <span className="text-xs text-muted">None tagged</span> : r.allergens.map((a) => (
                            <span key={a} className="rounded-md bg-surface-2 px-2 py-0.5 text-xs text-ink-2">{ALLERGENS.find((x) => x.id === a)!.short}</span>
                          ))}
                        </div>
                      </Link>
                    ))}
                  </Card>
                </section>
              ))}
            </div>
            {/* Wider screens and paper: the matrix. */}
            <Card className="hidden overflow-x-auto sm:block print:block print:border-0">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="sticky left-0 border-b border-border bg-surface px-4 py-2.5 text-left text-[0.75rem] font-medium text-muted">Item</th>
                    {ALLERGENS.map((a) => (
                      <th key={a.id} className="border-b border-border px-2 py-2.5 text-center text-[0.75rem] font-medium whitespace-nowrap text-muted" title={a.label}>{a.short}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {categories.map((c) => (
                    <Fragment key={c}>
                      <tr>
                        <td colSpan={ALLERGENS.length + 1} className="border-b border-border bg-surface-2/60 px-4 py-1.5 text-xs font-semibold text-ink-2">{c}</td>
                      </tr>
                      {rows.filter((r) => r.category === c).map((r) => (
                        <tr key={r.id} className="hover:bg-surface-2/60 print:break-inside-avoid">
                          <td className="sticky left-0 border-b border-border bg-surface px-4 py-2">
                            <Link href={`/menu/${r.id}`} className="hover:underline">{r.name}</Link>
                          </td>
                          {ALLERGENS.map((a) => {
                            const has = r.allergens.includes(a.id);
                            return (
                              <td key={a.id} className={cx("border-b border-border px-2 py-2 text-center", has && "font-semibold")} title={has ? `${a.label}: ${(r.sources[a.id] ?? []).join(", ")}` : undefined}>
                                {has ? <span aria-label={`Contains ${a.label}`}>●</span> : <span className="text-border-strong" aria-hidden>·</span>}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </Card>
          </>
        )}
      </HelpZone>
      <p className="mt-4 flex items-start gap-1.5 text-xs text-muted">
        <HelpTip id="menu.allergenChart" className="print:hidden" />
        Built from the allergen tags on each ingredient. Cross-contact in the kitchen (shared fryer, shared boards) isn&apos;t captured — confirm with the kitchen before promising a guest anything.
      </p>
    </>
  );
}
