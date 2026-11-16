import { Card, EmptyState, PageHeader, Section, Table, Td, Th, Tr } from "@/components/ui";
import { HelpZone } from "@/components/help";
import type { KegCostSource } from "@/domain/beerLinks";
import { ML_PER_FL_OZ } from "@/domain/draftBeer";
import { money, pct, shortDate } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { brewingCostFor, kegCostRows } from "@/server/services/beerLinks";
import { menuCosts } from "@/server/services/insights";
import Link from "next/link";
import { BrewingCostButton, DraftBeerFormView } from "./draft-beer-form";

export const metadata = { title: "Draft beer" };

/** "From brew 26-031, packaged Nov 12" / "From the brewing recipe IPA v3" / "Typed". */
function sourceText(s: KegCostSource): string {
  if (s.kind === "brew") return `From brew ${s.code}${s.packagedOn ? `, packaged ${shortDate(s.packagedOn)}` : ""}`;
  if (s.kind === "recipe") return `From the brewing recipe ${s.name}`;
  if (s.kind === "typed") return "Typed";
  return "No price yet";
}

export default async function DraftBeerPage() {
  await requireUser("MANAGER");
  const [suppliers, square, kegs, { rows }, beers] = await Promise.all([
    db.supplier.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.squareMapping.findMany({ where: { ignored: false, squareType: "ITEM_VARIATION" }, include: { recipe: { select: { name: true } } }, orderBy: { squareName: "asc" } }),
    db.ingredient.findMany({
      where: { active: true, baseUnit: "ml", conversions: { some: { unit: "keg" } } },
      include: { conversions: { where: { unit: "keg" } }, preferredProduct: { include: { prices: { orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }], take: 1 } } } },
      orderBy: { name: "asc" },
    }),
    menuCosts(),
    db.beer.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const pours = rows.filter((r) => r.cls === "beer" && r.kind === "MENU");
  const [costs, brewing] = await Promise.all([
    kegCostRows(kegs.map((k) => k.id)),
    // What brewing says each beer costs (per ml), so the form can fill in the keg cost for any size.
    Promise.all(beers.map(async (b) => ({ name: b.name, cost: await brewingCostFor(b.id).catch(() => null) }))),
  ]);

  return (
    <>
      <PageHeader
        help="menu.draftBeer"
        title="Draft beer"
        back={{ href: "/menu", label: "Menu costs" }}
        description="Cost a keg once and every pour gets a cost: 16 oz, 10 oz, flights. Beer then counts toward beverage cost on the P&L instead of looking free."
      />
      <HelpZone id="menu.draftBeer.form" tour="menu.draft-beer" className="mb-10">
        <DraftBeerFormView
          suppliers={suppliers}
          squareItems={square.map((s) => ({ value: s.squareId, label: s.squareName, hint: s.recipe ? `now: ${s.recipe.name}` : undefined }))}
          brewing={brewing.flatMap((b) => (b.cost ? [{ beer: b.name, perMl: b.cost.perMl, label: b.cost.kind === "brew" ? sourceText({ kind: "brew", code: b.cost.code, packagedOn: b.cost.packagedOn }) : sourceText({ kind: "recipe", name: b.cost.name }) }] : []))}
        />
      </HelpZone>

      <Section help="menu.draftBeer.kegs" title="Kegs on file" description="A house beer's keg cost comes from brewing: each packaged brew records its cost per keg, else the brewing recipe's. Re-enter a beer above to type a different cost. Past days keep the cost that applied then.">
        {kegs.length === 0 ? (
          <EmptyState title="No kegs yet">Set up your first beer above.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Keg</Th>
                <Th align="right" className="hidden sm:table-cell">Size</Th>
                <Th align="right">Keg cost</Th>
                <Th align="right" className="hidden sm:table-cell">Per oz</Th>
              </tr>
            </thead>
            <tbody>
              {kegs.map((k) => {
                const ml = k.conversions[0]?.baseQty.toNumber() ?? 0;
                const c = costs.get(k.id);
                const price = c?.price ?? k.preferredProduct?.prices[0]?.price.toNumber() ?? null;
                const perOz = price != null && ml > 0 ? price / ((ml / ML_PER_FL_OZ) * k.yieldPct.toNumber()) : null;
                return (
                  <Tr key={k.id}>
                    <Td>
                      <Link href={`/ingredients/${k.id}`} className="font-medium hover:underline">{k.name}</Link>
                      <div className="text-xs text-muted">
                        {c?.beer ? <>Pours as <Link href={`/kegs/beers/${c.beerId}`} className="underline underline-offset-2">{c.beer}</Link> · </> : "Not linked to a beer · "}
                        {pct(k.yieldPct.toNumber(), 0)} usable after foam and line loss
                      </div>
                    </Td>
                    <Td align="right" className="hidden text-muted sm:table-cell">{(ml / 3785.411784).toFixed(2)} gal</Td>
                    <Td align="right">
                      <div className="num">{money(price)}</div>
                      <div className="text-xs text-muted">{c ? sourceText(c.source) : "—"}</div>
                      {c?.brewing && c.beerId && (
                        <BrewingCostButton beerId={c.beerId} label={`Use ${money(c.brewing.price)} ${c.brewing.kind === "brew" ? `from brew ${c.brewing.code}` : "from the brewing recipe"}`} />
                      )}
                    </Td>
                    <Td align="right" className="hidden sm:table-cell">{perOz == null ? "—" : `$${perOz.toFixed(3)}`}</Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Section>

      {pours.length > 0 && (
        <Section help="menu.draftBeer.pours" title="Beer on the menu">
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
