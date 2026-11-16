import { PageHeader } from "@/components/ui";
import { addDays, parseISODate } from "@/domain/dates";
import { whyLine } from "@/domain/orderGuards";
import { dayDate } from "@/lib/format";
import { db } from "@/server/db";
import { minutesToCutoff, usualQuantities } from "@/server/services/orderPlacing";
import { buildOrderPlan } from "@/server/services/planning";
import { requireOrderer } from "@/server/services/supplierPrefs";
import { notFound, redirect } from "next/navigation";
import { GuidedOrder, type GuidedLine } from "./guided-order";

export const metadata = { title: "Place an order" };

/** Staff (and managers) on a phone: one supplier, its suggested order with the reasons, then send. */
export default async function GuidedOrderPage({ params }: { params: Promise<{ supplierId: string }> }) {
  await requireOrderer();
  const { supplierId } = await params;
  const supplier = await db.supplier.findUnique({ where: { id: supplierId }, select: { id: true, name: true, department: true, active: true, leadTimeDays: true, deliveryDays: true } });
  if (!supplier || !supplier.active) notFound();
  if (supplier.department === "brewery") redirect("/my/ordering");
  const plan = await buildOrderPlan(supplierId);
  const [usual, cutoff, draft] = await Promise.all([
    usualQuantities(plan.lines.map((l) => l.supplierProductId)),
    minutesToCutoff(supplier, plan.deliveryDate),
    db.purchaseOrder.findFirst({ where: { supplierId, deliveryDate: parseISODate(plan.deliveryDate), status: { in: ["DRAFT", "SENT"] } }, select: { id: true, status: true } }),
  ]);
  if (draft?.status === "SENT") redirect("/my/ordering");
  const byDate = addDays(plan.coverUntil, -1);
  const lines: GuidedLine[] = plan.lines
    .filter((l) => l.status !== "needs-setup")
    .map((l) => {
      const pos = plan.positions.get(l.ingredientId);
      return {
        ingredientId: l.ingredientId,
        supplierProductId: l.supplierProductId,
        name: l.ingredientName,
        description: l.description,
        unit: l.purchaseUnit,
        unitPrice: l.unitPrice,
        suggested: l.suggestedUnits,
        runsOut: l.status === "runs-out",
        needsCount: l.status === "needs-count",
        usual: usual.get(l.supplierProductId) ?? null,
        why: pos ? whyLine({ onHandBase: pos.onHandNow, needBase: Math.max(0, pos.usageUntilDelivery + l.neededForCover - pos.incoming), packQtyBase: l.packQtyBase, unit: l.purchaseUnit, byDate, known: pos.known }) : "",
      };
    });

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader help="ordering.staff" title={supplier.name} description={`For the ${dayDate(plan.deliveryDate)} delivery, to last through ${dayDate(byDate)}.`} back={{ href: "/my/ordering", label: "Orders" }} />
      <GuidedOrder
        supplierId={supplierId}
        supplierName={supplier.name}
        deliveryDate={plan.deliveryDate}
        coverUntil={plan.coverUntil}
        minOrder={plan.supplier.minOrder}
        minsToCutoff={cutoff?.mins ?? null}
        hasDraft={draft?.status === "DRAFT" ? draft.id : null}
        lines={lines}
      />
    </div>
  );
}
