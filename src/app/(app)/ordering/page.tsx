import { Badge, Card, EmptyState, PageHeader, Section, Table, Td, Th, Tr } from "@/components/ui";
import { toISODate, WEEKDAYS } from "@/domain/dates";
import { businessDateOf, dayDate, money, shortDate } from "@/lib/format";
import { env } from "@/server/env";
import { currentPrices, orderTotal } from "./estimate";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { deliveryWindow, supplierCutoffs } from "@/server/services/planning";
import { businessToday } from "@/server/services/sales";
import Link from "next/link";
import { HelpTip, HelpZone } from "@/components/help";
import { DeadlineEditor } from "./deadline-editor";
import { deadlineFor } from "@/domain/ordering";
import { pendingSuggestions } from "@/server/services/learned";
import { SupplierSuggestionLine } from "../settings/learned-cards";
import { coverageLabel, weekdaysLabel } from "@/domain/learned";

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
  const [suppliers, orders, cutoffs, learned] = await Promise.all([
    db.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" }, include: { _count: { select: { products: { where: { ingredientId: { not: null } } } } } } }),
    db.purchaseOrder.findMany({
      orderBy: { createdAt: "desc" },
      take: 25,
      include: { supplier: { select: { name: true } }, lines: { select: { qty: true, unitPrice: true, supplierProductId: true } }, invoices: { select: { total: true } } },
    }),
    supplierCutoffs(),
    pendingSuggestions(),
  ]);
  const prices = await currentPrices(orders.flatMap((o) => o.lines.filter((l) => l.unitPrice == null).map((l) => l.supplierProductId)), today);
  const totals = new Map(
    orders.map((o) => [
      o.id,
      orderTotal(
        o.lines.map((l) => ({ supplierProductId: l.supplierProductId, qty: l.qty.toNumber(), unitPrice: l.unitPrice?.toNumber() ?? null })),
        prices,
        o.invoices.map((i) => i.total?.toNumber() ?? null),
      ),
    ]),
  );
  const cutoffBy = new Map(cutoffs.map((c) => [c.supplierId, c]));
  const learnedBy = new Map(learned.suppliers.map((x) => [x.id, x]));
  /** What the deadline editor offers to fill in: "Invoices say Tue, Fri". */
  const hint = (id: string) => {
    const l = learnedBy.get(id);
    if (!l?.days && !l?.deadlines) return undefined;
    const note = [l.days && `${l.days.sources.includes("invoice") ? "Invoices say" : "Past orders say"} ${weekdaysLabel(l.days.days)} (${coverageLabel(l.days)}).`, l.deadlines && "Past orders suggest these deadlines."].filter(Boolean).join(" ");
    return { days: l.days?.days, perDay: l.deadlines?.perDay, note };
  };

  return (
    <>
      <PageHeader help="ordering.page" title="Ordering" description="Pick a supplier to get a suggested order for its next delivery." />
      <HelpZone id="ordering.suppliers" tour="ordering.suppliers">
      <Section title="Suppliers">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {suppliers.map((s) => {
            const w = deliveryWindow(s, today);
            const c = cutoffBy.get(s.id);
            return (
              <div key={s.id} data-tour="ordering.supplier-card">
                <Card className="relative h-full p-4 transition-colors hover:border-border-strong">
                  <Link href={`/ordering/${s.id}`} className="text-sm font-medium after:absolute after:inset-0 after:content-['']">{s.name}</Link>
                  <div className="mt-1 text-xs text-muted">
                    {s.deliveryDays.length ? `Delivers ${s.deliveryDays.map((d) => WEEKDAYS[d]).join(", ")}` : "No delivery days set"} · {s._count.products} item{s._count.products === 1 ? "" : "s"}
                  </div>
                  <div className="mt-4 flex items-end justify-between">
                    <div>
                      <div className="text-xs text-muted">Next delivery</div>
                      <div className="num text-sm font-medium">{dayDate(c?.next?.deliveryDate ?? w.deliveryDate)}</div>
                    </div>
                    <span className="text-sm text-ink-2">Build order →</span>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-2 text-xs text-muted">
                    <span className="min-w-0">
                      {c?.next ? (
                        <>
                          Order by <b className="font-medium text-ink-2">{hm(c.next.cutoffTime)} {dayDate(c.next.cutoffDate)}</b> for {dayDate(c.next.deliveryDate)}
                          {!c.rule.perDay && <span className="text-warn"> · guessed</span>}
                          {c.draftId ? <span className="text-good"> · drafted</span> : c.hoursToCutoff != null && c.hoursToCutoff <= 36 ? <span className="text-warn"> · {untilText(c.hoursToCutoff)} left</span> : null}
                        </>
                      ) : s.deliveryDays.length ? "No deadline coming up" : "Set delivery days and deadlines"}
                    </span>
                    {c && <DeadlineEditor supplierId={s.id} name={s.name} deliveryDays={s.deliveryDays} rule={c.rule} learned={hint(s.id)} />}
                  </div>
                  {learnedBy.get(s.id) && <SupplierSuggestionLine s={learnedBy.get(s.id)!} />}
                </Card>
              </div>
            );
          })}
        </div>
      </Section>
      </HelpZone>
      <Section
        help="ordering.cutoffs"
        title={<span className="inline-flex items-center gap-1.5">Deliveries &amp; order deadlines <HelpTip id="ordering.cutoffs" /></span>}
        description="When each truck comes and when its order has to be in. Press Edit deadlines to change them — each delivery day can have its own deadline."
      >
        <Table>
          <thead>
            <tr>
              <Th>Supplier</Th>
              <Th>Deadlines</Th>
              <Th className="hidden md:table-cell">Next</Th>
              <Th align="right"><span className="sr-only">Edit</span></Th>
            </tr>
          </thead>
          <tbody>
            {suppliers.map((s) => {
              const c = cutoffBy.get(s.id);
              if (!c) return null;
              return (
                <Tr key={s.id}>
                  <Td>
                    <div className="font-medium">{s.name}</div>
                    <div className="text-xs text-muted">{c.rule.autoDraft ? "Drafts the order for you" : "No auto-draft"}</div>
                  </Td>
                  <Td>
                    {s.deliveryDays.length === 0 ? (
                      <span className="text-muted">No delivery days</span>
                    ) : (
                      <ul className="space-y-0.5 text-sm">
                        {[...s.deliveryDays].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((wd) => {
                          const d = deadlineFor(c.rule, wd);
                          return (
                            <li key={wd} className="whitespace-nowrap">
                              <span className="font-medium">{WEEKDAYS[wd]}</span>
                              <span className="text-muted"> ← order by </span>
                              {WEEKDAYS[(wd - d.daysBefore + 70) % 7]} {hm(d.time)}
                              {!c.rule.perDay?.[wd] && <span className="text-warn"> (guessed)</span>}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </Td>
                  <Td className="hidden md:table-cell">
                    {c.next ? (
                      <>
                        <span className="num">{hm(c.next.cutoffTime)} {dayDate(c.next.cutoffDate)}</span>
                        <span className="text-muted"> for {shortDate(c.next.deliveryDate)}</span>
                        {c.draftId && <Link href={`/ordering/po/${c.draftId}`} className="ml-2 text-ink-2 hover:text-ink hover:underline">Order in →</Link>}
                      </>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </Td>
                  <Td align="right"><DeadlineEditor supplierId={s.id} name={s.name} deliveryDays={s.deliveryDays} rule={c.rule} learned={hint(s.id)} /></Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </Section>
      <HelpZone id="ordering.recent" tour="ordering.recent">
      <Section title="Recent orders">
        {orders.length === 0 ? (
          <EmptyState title="No orders yet">Saved orders show up here so deliveries can be checked in.</EmptyState>
        ) : (
          <Table>
            <thead><tr><Th className="pr-2 sm:pr-4">Supplier</Th><Th className="hidden sm:table-cell">Delivery</Th><Th className="px-2 sm:px-4">Status</Th><Th align="right" className="hidden sm:table-cell">Lines</Th><Th align="right" className="pl-2 sm:pl-4">Total</Th></tr></thead>
            <tbody>
              {orders.map((o) => {
                const t = totals.get(o.id)!;
                return (
                  <Tr key={o.id}>
                    <Td className="pr-2 sm:pr-4">
                      <Link href={`/ordering/po/${o.id}`} className="font-medium hover:underline">{o.supplier.name}</Link>
                      <div className="text-xs text-muted sm:hidden">For {dayDate(toISODate(o.deliveryDate))} · {o.lines.length} line{o.lines.length === 1 ? "" : "s"}</div>
                      <div className="text-xs text-muted">{o.notes?.startsWith("Auto-drafted") ? "Auto-drafted" : "Created"} {shortDate(businessDateOf(o.createdAt, env.BUSINESS_TIMEZONE))}</div>
                    </Td>
                    <Td className="num hidden sm:table-cell">{dayDate(toISODate(o.deliveryDate))}</Td>
                    <Td className="px-2 sm:px-4"><Badge tone={STATUS[o.status].tone}>{STATUS[o.status].label}</Badge></Td>
                    <Td align="right" className="hidden sm:table-cell">{o.lines.length}</Td>
                    <Td align="right" className="pl-2 whitespace-nowrap sm:pl-4">
                      {money(t.total)}
                      {t.total != null && (t.invoiced ? <div className="text-xs text-muted">invoiced</div> : t.estimated ? <div className="text-xs text-muted" title="Some lines priced from current supplier prices">est.</div> : null)}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Section>
      </HelpZone>
    </>
  );
}
