import { PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { countUnitsFor, loadCountableIngredients } from "@/server/services/inventory";
import { notFound, redirect } from "next/navigation";
import { CountSheet } from "./count-sheet";
import type { BaseUnit } from "@/domain/units";

export const metadata = { title: "Counting" };

export default async function CountPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const count = await db.stockCount.findUnique({ where: { id }, include: { lines: true } });
  if (!count) notFound();
  if (count.completed) redirect("/count");
  const ingredients = await loadCountableIngredients(count.area ?? undefined);
  const saved = new Map(count.lines.map((l) => [l.ingredientId, l.qtyBase.toNumber()]));

  const items = ingredients.map((i) => {
    const { units, conversions } = countUnitsFor(i);
    return { id: i.id, name: i.name, area: i.storageArea, category: i.category, base: i.baseUnit as BaseUnit, units, conversions, savedBase: saved.get(i.id) ?? null };
  });

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader help="count.sheet" title={count.area === "All" || !count.area ? "Counting everything" : `Counting ${count.area}`} back={{ href: "/count", label: "Counts" }} />
      <CountSheet countId={count.id} items={items} />
    </div>
  );
}
