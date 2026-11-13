import { Badge, Card, EmptyState, PageHeader, Section, Table, Td, Th, Tr } from "@/components/ui";
import { toISODate, WEEKDAYS } from "@/domain/dates";
import { dayDate, money, shortDate } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { deliveryWindow, supplierCutoffs } from "@/server/services/planning";
import { businessToday } from "@/server/services/sales";
import Link from "next/link";
import { HelpTip, HelpZone } from "@/components/help";
import { AutoDraftCell, CutoffDaysCell, CutoffTimeCell } from "./cutoff-cells";

const hm = (t: string) => {
  const h = Number(t.slice(0, 2));
  const m = t.slice(3, 5);
  return `${h % 12 === 0 ? 12 : h % 12}${m === "00" ? "" : `:${m}`}${h < 12 ? "am" : "pm"}`;
};
const untilText = (h: number) => (h < 1 ? "under an hour" : h < 36 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`);

export const metadata = { title: "Ordering" };

const STATUS = { DRAFT: { label: "Draft", tone: "neutral" }, SENT: { label: "Sent", tone: "warn" }, RECEIVED: { label: "Received", tone: "good" } } as const;

export default async function OrderingPage() {
  await requireUser("MANAGER");
  const today = businessToday();
  const [suppliers, orders, cutoffs] = await Promise.all([
    db.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" }, include: { _count: { select: { products: { where: { ingredientId: { not: null } } } } } } }),
    db.purchaseOrder.findMany({ orderBy: { createdAt: "desc" }, take: 25, include: { supplier: { select: { name: true } }, lines: { select: { qty: true, unitPrice: true } } } }),
    supplierCutoffs(),
  ]);
  const cutoffBy = new Map(cutoffs.map((c) => [c.supplierId, c]));

  return (
    <>
      <PageHeader title="Ordering" description="Pick a supplier to get a suggested order for its next delivery." />
      <HelpZone id="ordering.suppliers" tour="ordering.suppliers">
      <Section title="Suppliers">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {suppliers.map((s) => {
            const w = deliveryWindow(s, today);
            const c = cutoffBy.get(s.id);
            return (
              <Link key={s.id} href={`/ordering/${s.id}`} data-tour="ordering.supplier-card">
                <Card className="h-full p-4 transition-colors hover:border-border-strong">
                  <div className="text-sm font-medium">{s.name}</div>
                  <div className="mt-1 text-xs text-muted">
                    {s.deliveryDays.length ? `Delivers ${s.deliveryDays.map((d) => WEEKDAYS[d]).join(", ")}` : "No delivery days set"} · {s._count.products} items
                  </div>
                  <div className="mt-4 flex items-end justify-between">
                    <div>
                      <div className="text-xs text-muted">Next delivery</div>
                      <div className="num text-sm font-medium">{dayDate(c?.next?.deliveryDate ?? w.deliveryDate)}</div>
                    </div>
                    <span className="text-sm text-ink-2">Build order →</span>
                  </div>
                  {c?.next && (
                    <div className="mt-3 border-t border-border pt-2.5 text-xs text-muted">
                      Order by {hm(c.next.cutoffTime)} {dayDate(c.next.cutoffDate)} for {dayDate(c.next.deliveryDate)}
                      {c.draftId ? <span className="text-good"> · drafted</span> : c.hoursToCutoff != null && c.hoursToCutoff <= 36 ? <span className="text-warn"> · {untilText(c.hoursToCutoff)} left</span> : null}
                    </div>
                  )}
                </Card>
              </Link>
            );
          })}
        </div>
      </Section>
      </HelpZone>
      <Section
        title={<span className="inline-flex items-center gap-1.5">Order cutoffs <HelpTip id="ordering.cutoffs" /></span>}
        description="When each supplier needs the order. With auto-draft on, the suggested order is saved as a draft the day before the cutoff, ready for you to review and send."
      >
        <Table>
          <thead>
            <tr>
              <Th>Supplier</Th>
              <Th className="w-28">Order by</Th>
              <Th className="w-32"><span className="hidden sm:inline">Days before delivery</span><span className="sm:hidden">Days before</span></Th>
              <Th className="hidden w-36 sm:table-cell">Auto-draft</Th>
              <Th className="hidden md:table-cell">Next cutoff</Th>
            </tr>
          </thead>
          <tbody>
            {cutoffs.map((c) => (
              <Tr key={c.supplierId}>
                <Td>
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs text-muted md:hidden">{c.next ? `Next ${hm(c.next.cutoffTime)} ${shortDate(c.next.cutoffDate)}` : "No delivery days"}</div>
                </Td>
                <td className="border-b border-border px-2 py-1 [tr:last-child_&]:border-b-0"><CutoffTimeCell supplierId={c.supplierId} time={c.rule.time} /></td>
                <td className="border-b border-border px-2 py-1 [tr:last-child_&]:border-b-0"><CutoffDaysCell supplierId={c.supplierId} days={c.rule.daysBefore} /></td>
                <td className="hidden border-b border-border px-2 py-1 sm:table-cell [tr:last-child_&]:border-b-0"><AutoDraftCell supplierId={c.supplierId} on={c.rule.autoDraft} /></td>
                <Td className="hidden md:table-cell">
                  {!c.next ? (
                    <span className="text-muted">Set delivery days in Settings</span>
                  ) : (
                    <>
                      <span className="num">{hm(c.next.cutoffTime)} {dayDate(c.next.cutoffDate)}</span>
                      <span className="text-muted"> for {shortDate(c.next.deliveryDate)}</span>
                      {c.draftId && (
                        <Link href={`/ordering/po/${c.draftId}`} className="ml-2 text-ink-2 hover:text-ink hover:underline">Order in →</Link>
                      )}
                    </>
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Section>
      <HelpZone id="ordering.recent" tour="ordering.recent">
      <Section title="Recent orders">
        {orders.length === 0 ? (
          <EmptyState title="No orders yet">Saved orders show up here so deliveries can be checked in.</EmptyState>
        ) : (
          <Table>
            <thead><tr><Th>Supplier</Th><Th>Delivery</Th><Th>Status</Th><Th align="right">Lines</Th><Th align="right">Total</Th></tr></thead>
            <tbody>
              {orders.map((o) => (
                <Tr key={o.id}>
                  <Td><Link href={`/ordering/po/${o.id}`} className="font-medium hover:underline">{o.supplier.name}</Link><div className="text-xs text-muted">{o.notes?.startsWith("Auto-drafted") ? "Auto-drafted" : "Created"} {shortDate(toISODate(o.createdAt))}</div></Td>
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
      </HelpZone>
    </>
  );
}
