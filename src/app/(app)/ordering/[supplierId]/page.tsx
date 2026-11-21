import { PageHeader } from "@/components/ui";
import { addDays, dateRange, parseISODate } from "@/domain/dates";
import { whyLine } from "@/domain/orderGuards";
import { dayDate } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { minutesToCutoff, usualQuantities } from "@/server/services/orderPlacing";
import { buildOrderPlan } from "@/server/services/planning";
import { businessToday } from "@/server/services/sales";
import { notFound, redirect } from "next/navigation";
import { OrderBuilder } from "./order-builder";

export const metadata = { title: "Build order" };

export default async function BuildOrderPage({ params, searchParams }: { params: Promise<{ supplierId: string }>; searchParams: Promise<{ delivery?: string; until?: string }> }) {
  await requireUser("MANAGER");
  const { supplierId } = await params;
  const { delivery, until } = await searchParams;
  const supplier = await db.supplier.findUnique({ where: { id: supplierId }, select: { id: true, department: true, leadTimeDays: true, deliveryDays: true } });
  if (!supplier) notFound();
  // Brewing suppliers are ordered from the Brewery's own screens.
  if (supplier.department === "brewery") redirect("/brewery/ordering");
  const valid = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);
  const plan = await buildOrderPlan(supplierId, { deliveryDate: valid(delivery), coverUntil: valid(until) });
  const today = businessToday();
  const deliveryOptions = dateRange(addDays(today, 0), addDays(today, 15));
  const productIds = [...new Set(plan.lines.flatMap((l) => [l.supplierProductId, ...(l.options ?? []).map((o) => o.supplierProductId)]))];
  const [usual, cutoff, draft] = await Promise.all([
    usualQuantities(productIds),
    minutesToCutoff(supplier, plan.deliveryDate),
    // Saving adds to a draft already there for this delivery, so say so up front.
    db.purchaseOrder.findFirst({ where: { supplierId, status: "DRAFT", deliveryDate: parseISODate(plan.deliveryDate) }, orderBy: { createdAt: "asc" }, select: { id: true, _count: { select: { lines: true } } } }),
  ]);
  const byDate = addDays(plan.coverUntil, -1);

  return (
    <>
      <PageHeader
        help="ordering.builder"
        title={plan.supplier.name}
        description={`Delivery ${dayDate(plan.deliveryDate)}, covering sales through ${dayDate(addDays(plan.coverUntil, -1))}.`}
        back={{ href: "/ordering", label: "Ordering" }}
      />
      <OrderBuilder
        key={`${plan.deliveryDate}-${plan.coverUntil}`}
        supplierId={supplierId}
        deliveryDate={plan.deliveryDate}
        coverUntil={plan.coverUntil}
        deliveryOptions={deliveryOptions}
        minOrder={plan.supplier.minOrder}
        problems={plan.problems}
        usual={Object.fromEntries(usual)}
        minsToCutoff={cutoff?.mins ?? null}
        existingDraft={draft ? { id: draft.id, lines: draft._count.lines } : null}
        lines={plan.lines.map((l) => {
          const pos = plan.positions.get(l.ingredientId);
          return {
            ...l,
            onHandNote: plan.onHandNotes.get(l.ingredientId) ?? "",
            why: pos ? whyLine({ onHandBase: pos.onHandNow, needBase: Math.max(0, pos.usageUntilDelivery + l.neededForCover - pos.incoming), packQtyBase: l.packQtyBase, unit: l.purchaseUnit, byDate, known: pos.known }) : "",
          };
        })}
      />
    </>
  );
}
