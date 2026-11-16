import { PageHeader } from "@/components/ui";
import { readParts } from "@/domain/countUnits";
import { prepKey } from "@/domain/countPlan";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { countItems } from "@/server/services/counts";
import { storageAreas } from "@/server/services/inventory";
import { notFound, redirect } from "next/navigation";
import { CountSheet } from "./count-sheet";

export const metadata = { title: "Counting" };

export default async function CountPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  const { id } = await params;
  const count = await db.stockCount.findUnique({ where: { id }, include: { lines: true, prepLines: true } });
  if (!count) notFound();
  if (count.completed) redirect("/count");
  const manager = me.role === "MANAGER";
  // Sent for approval: staff are done with it; the manager can still fix numbers here.
  if (count.submittedAt && !manager) redirect("/count?sent=1");
  const role = manager ? "MANAGER" : "STAFF";
  const area = !count.area || count.area === "All" ? null : count.area;
  // Everything, for "Found something here?" (and the items of this area within it).
  const [catalog, areaOrder] = await Promise.all([countItems("All", role, { expected: true }), storageAreas()]);
  const inScope = area ? catalog.filter((i) => i.homeAreas.some((a) => a.toLowerCase() === area.toLowerCase())) : catalog;
  const saved = new Map<string, { qtyBase: { toNumber(): number }; parts: unknown }>([...count.lines.map((l) => [l.ingredientId, l] as const), ...count.prepLines.map((l) => [prepKey(l.recipeId), l] as const)]);
  // Items counted elsewhere in this count (found in this area) come along too.
  const extra = catalog.filter((i) => !inScope.includes(i) && saved.has(i.id));
  const withSaved = <T extends { id: string }>(i: T) => {
    const l = saved.get(i.id);
    return { ...i, saved: l ? { total: l.qtyBase.toNumber(), parts: readParts(l.parts) } : null };
  };

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader help="count.sheet" title={area ? `Counting ${area}` : "Counting everything"} back={{ href: count.submittedAt ? `/count/${count.id}/review` : "/count", label: count.submittedAt ? "Review" : "Counts" }} />
      <CountSheet
        countId={count.id}
        countArea={area}
        areaOrder={areaOrder}
        manager={manager}
        items={[...inScope, ...extra.map((i) => ({ ...i, due: false }))].map(withSaved)}
        catalog={catalog}
      />
    </div>
  );
}
