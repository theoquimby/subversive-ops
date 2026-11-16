import { PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { coolerBoard } from "@/server/services/kegs";
import { CoolerBoard } from "./board";

export const metadata = { title: "Walk-in" };

export default async function CoolerPage({ searchParams }: { searchParams: Promise<{ beer?: string }> }) {
  const me = await requireUser();
  const { beer } = await searchParams;
  const b = await coolerBoard();
  // A link from a beer's own page filters to it even when it isn't one of the listed beers.
  const linked = beer && !b.beers.some((x) => x.id === beer) ? b.others.find((x) => x.id === beer) : undefined;
  const beers = linked ? [...b.beers, linked] : b.beers;
  return (
    <>
      <PageHeader help="kegs.cooler" title="Walk-in" back={{ href: "/kegs", label: "Kegs" }} description="Every keg that isn't on tap or out, by spot. Solid tiles are full, dashed are empty." />
      <CoolerBoard areas={b.areas} boardAreas={b.boardAreas} spots={b.spots} kegs={b.kegs} beers={beers.map((x) => ({ id: x.id, name: x.name, color: x.color, retired: x.standing === "retired" }))} initialBeer={beer && beers.some((x) => x.id === beer) ? beer : null} manager={me.role === "MANAGER"} />
    </>
  );
}
