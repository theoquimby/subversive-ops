import { PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { db, num } from "@/server/db";
import { beerPricing, labelUrl } from "@/server/services/taps";
import { BeersBoardTable, type BeerBoardRow } from "./beers-table";

export const metadata = { title: "Beers" };

export default async function BeersPage() {
  await requireUser("MANAGER");
  const [beers, onTap, full] = await Promise.all([
    db.beer.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] }),
    db.keg.findMany({ where: { status: "ON_TAP", active: true, beerId: { not: null } }, select: { beerId: true, tapLine: true } }),
    db.keg.groupBy({ by: ["beerId"], where: { active: true, status: { in: ["FILLED", "COLD"] }, beerId: { not: null } }, _count: { _all: true } }),
  ]);
  const pricing = await beerPricing(beers);
  const fullBy = new Map(full.map((f) => [f.beerId!, f._count._all]));
  const rows: BeerBoardRow[] = beers.map((b) => {
    const p = pricing.get(b.id);
    return {
      id: b.id,
      name: b.name,
      style: b.style,
      color: b.color,
      abv: num(b.abv),
      ibu: b.ibu,
      description: b.description,
      diet: b.diet,
      boardPours: b.boardPours,
      pours: p?.pours ?? [],
      priceSource: p?.source ?? "none",
      square: p?.square ?? null,
      squarePours: p?.squarePours ?? [],
      comingSoon: b.comingSoon == null ? "auto" : b.comingSoon ? "yes" : "no",
      labelUrl: labelUrl(b.id, b.labelAt),
      active: b.active,
      house: b.house,
      taps: onTap.filter((k) => k.beerId === b.id).map((k) => k.tapLine ?? 0).filter(Boolean).sort((x, y) => x - y),
      fullKegs: fullBy.get(b.id) ?? 0,
    };
  });

  return (
    <>
      <PageHeader
        help="taps.beers"
        title="Beers"
        back={{ href: "/kegs/taps", label: "Tap list" }}
        description="What the TV board and the website say about each beer. Prices come from Square (or your draft beer pours) unless you type them here."
      />
      <BeersBoardTable rows={rows} />
    </>
  );
}
