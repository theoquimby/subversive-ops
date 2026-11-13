import { Badge, Card, EmptyState, PageHeader, Section, Table, Td, Th, Tr } from "@/components/ui";
import { toISODate, WEEKDAYS } from "@/domain/dates";
import { dayDate, money, shortDate } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { deliveryWindow } from "@/server/services/planning";
import { businessToday } from "@/server/services/sales";
import Link from "next/link";

export const metadata = { title: "Ordering" };

const STATUS = { DRAFT: { label: "Draft", tone: "neutral" }, SENT: { label: "Sent", tone: "warn" }, RECEIVED: { label: "Received", tone: "good" } } as const;

export default async function OrderingPage() {
  await requireUser("MANAGER");
  const today = businessToday();
  const [suppliers, orders] = await Promise.all([
    db.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" }, include: { _count: { select: { products: { where: { ingredientId: { not: null } } } } } } }),
    db.purchaseOrder.findMany({ orderBy: { createdAt: "desc" }, take: 25, include: { supplier: { select: { name: true } }, lines: { select: { qty: true, unitPrice: true } } } }),
  ]);

  return (
    <>
      <PageHeader title="Ordering" description="Pick a supplier to get a suggested order for its next delivery." />
      <Section title="Suppliers">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {suppliers.map((s) => {
            const w = deliveryWindow(s, today);
            return (
              <Link key={s.id} href={`/ordering/${s.id}`}>
                <Card className="h-full p-4 transition-colors hover:border-border-strong">
                  <div className="text-sm font-medium">{s.name}</div>
                  <div className="mt-1 text-xs text-muted">
                    {s.deliveryDays.length ? `Delivers ${s.deliveryDays.map((d) => WEEKDAYS[d]).join(", ")}` : "No delivery days set"} · {s._count.products} items
                  </div>
                  <div className="mt-4 flex items-end justify-between">
                    <div>
                      <div className="text-xs text-muted">Next delivery</div>
                      <div className="num text-sm font-medium">{dayDate(w.deliveryDate)}</div>
                    </div>
                    <span className="text-sm text-ink-2">Build order →</span>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      </Section>
      <Section title="Recent orders">
        {orders.length === 0 ? (
          <EmptyState title="No orders yet">Saved orders show up here so deliveries can be checked in.</EmptyState>
        ) : (
          <Table>
            <thead><tr><Th>Supplier</Th><Th>Delivery</Th><Th>Status</Th><Th align="right">Lines</Th><Th align="right">Total</Th></tr></thead>
            <tbody>
              {orders.map((o) => (
                <Tr key={o.id}>
                  <Td><Link href={`/ordering/po/${o.id}`} className="font-medium hover:underline">{o.supplier.name}</Link><div className="text-xs text-muted">Created {shortDate(toISODate(o.createdAt))}</div></Td>
                  <Td className="num">{dayDate(toISODate(o.deliveryDate))}</Td>
                  <Td><Badge tone={STATUS[o.status].tone}>{STATUS[o.status].label}</Badge></Td>
                  <Td align="right">{o.lines.length}</Td>
                  <Td align="right">{money(o.lines.reduce((s, l) => s + l.qty.toNumber() * (l.unitPrice?.toNumber() ?? 0), 0))}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>
    </>
  );
}
