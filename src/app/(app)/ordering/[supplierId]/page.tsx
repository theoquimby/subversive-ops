import { PageHeader } from "@/components/ui";
import { addDays, dateRange } from "@/domain/dates";
import { dayDate } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { buildOrderPlan } from "@/server/services/planning";
import { businessToday } from "@/server/services/sales";
import { notFound } from "next/navigation";
import { OrderBuilder } from "./order-builder";

export const metadata = { title: "Build order" };

export default async function BuildOrderPage({ params, searchParams }: { params: Promise<{ supplierId: string }>; searchParams: Promise<{ delivery?: string; until?: string }> }) {
  await requireUser("MANAGER");
  const { supplierId } = await params;
  const { delivery, until } = await searchParams;
  if (!(await db.supplier.findUnique({ where: { id: supplierId } }))) notFound();
  const valid = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);
  const plan = await buildOrderPlan(supplierId, { deliveryDate: valid(delivery), coverUntil: valid(until) });
  const today = businessToday();
  const deliveryOptions = dateRange(addDays(today, 0), addDays(today, 15));

  return (
    <>
      <PageHeader
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
        lines={plan.lines.map((l) => ({ ...l, onHandNote: plan.onHandNotes.get(l.ingredientId) ?? "" }))}
      />
    </>
  );
}
