import { HelpZone } from "@/components/help";
import { PageHeader } from "@/components/ui";
import { addDays } from "@/domain/dates";
import { clock, compareByDeadline, deadlineBucket, todayItems } from "@/domain/orderingBoard";
import { dayDate } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { orderingBoard } from "@/server/services/orderingBoard";
import { cadenceNoticeOpen } from "@/server/services/supplierPrefs";
import { db } from "@/server/db";
import { CadenceNotice } from "./cadence-notice";
import { NowProvider } from "./countdown";
import { OrdersTable } from "./orders-table";
import { SuppliersBoard } from "./suppliers-board";
import { OrderingTabs } from "./tabs";
import { TodayStrip, type TodayEntry } from "./today-strip";

export const metadata = { title: "Ordering" };

export default async function OrderingPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireUser("MANAGER");
  const [{ tab }, board, notice, people] = await Promise.all([
    searchParams,
    orderingBoard(),
    cadenceNoticeOpen(),
    db.user.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const { today, suppliers, orders } = board;
  const tomorrow = addDays(today, 1);
  const byId = new Map(suppliers.map((s) => [s.id, s]));

  const items: TodayEntry[] = todayItems({
    today,
    // Suppliers ordered "when stock runs low" only show a deadline when something runs short.
    suppliers: suppliers.map((s) => ({ id: s.id, name: s.name, next: s.next, hoursToCutoff: s.hoursToCutoff, state: s.state, nag: s.nag })),
    orders,
  }).map((i) => ({ ...i, at: i.deadline ? byId.get(i.supplierId)?.cutoffAt ?? null : null, items: byId.get(i.supplierId)?.items ?? 0 }));

  // When nothing's urgent, say when the next deadline is.
  const upcoming = suppliers.filter((s) => s.next && s.state.kind === "none" && s.nag).sort(compareByDeadline)[0];
  const nextUp = upcoming?.next
    ? { name: upcoming.name, supplierId: upcoming.id, at: upcoming.cutoffAt, label: `${clock(upcoming.next.cutoffTime)} ${deadlineBucket(upcoming.next.cutoffDate, today) === "tomorrow" ? "tomorrow" : dayDate(upcoming.next.cutoffDate)}` }
    : null;

  return (
    <NowProvider now={board.now}>
      <PageHeader help="ordering.page" title="Ordering" description="Every supplier, its next deadline and where its order stands. Tap a row for the suggested order, or tick several to draft them at once." />
      {notice && <CadenceNotice names={suppliers.filter((s) => s.cadence === "as_needed").map((s) => s.name)} />}
      <HelpZone id="ordering.today" tour="ordering.today">
        <TodayStrip items={items} today={today} tomorrow={tomorrow} nextUp={nextUp} unscheduled={suppliers.filter((s) => !s.next).length} total={suppliers.length} />
      </HelpZone>
      <OrderingTabs
        initial={tab === "orders" ? "orders" : "suppliers"}
        counts={{ suppliers: suppliers.length, open: orders.filter((o) => o.status !== "RECEIVED").length }}
        suppliers={
          <HelpZone id="ordering.suppliers" tour="ordering.suppliers">
            <SuppliersBoard rows={suppliers} today={today} emailReady={board.emailReady} people={people} />
          </HelpZone>
        }
        orders={
          <HelpZone id="ordering.recent">
            <OrdersTable rows={orders} today={today} emailReady={board.emailReady} />
          </HelpZone>
        }
      />
    </NowProvider>
  );
}
