import { Section, Table, Td, Th, Tr } from "@/components/ui";
import { addDays, dateRange, daysBetween } from "@/domain/dates";
import { dayDate, money } from "@/lib/format";
import { db } from "@/server/db";
import { dailySalesForecast } from "@/server/services/forecasting";
import { businessToday } from "@/server/services/sales";

const signed = (m: number) => {
  const p = Math.round((m - 1) * 100);
  return `${p > 0 ? "+" : p < 0 ? "−" : "±"}${Math.abs(p)}%`;
};

/**
 * Next 7 days of sales and orders (covers proxy) with the seasonal factor.
 * Self-contained server component — mount it on /sales.
 */
export async function DemandOutlook() {
  const today = businessToday();
  const dates = dateRange(today, addDays(today, 7));
  const [days, first] = await Promise.all([dailySalesForecast(dates), db.hourlySale.findFirst({ orderBy: { date: "asc" }, select: { date: true } })]);
  const seasonalOn = days.some((d) => d.seasonal !== 1);
  const historyDays = first ? daysBetween(first.date.toISOString().slice(0, 10), today) : 0;
  const needed = Math.max(0, 364 + 28 - historyDays);
  const anyOrders = days.some((d) => d.orders != null);
  const totals = days.reduce((a, d) => ({ sales: a.sales + d.qty, orders: a.orders + (d.orders ?? 0) }), { sales: 0, orders: 0 });

  return (
    <Section
      title="Sales and orders, next 7 days"
      description={
        seasonalOn
          ? "Includes the seasonal swing from the same weeks last year."
          : `Seasonality switches on once there's a year of history${needed > 0 && historyDays > 0 ? ` (about ${needed} more days, or backfill from Square)` : ""}. Until then the forecast follows recent weeks.`
      }
    >
      <Table>
          <thead>
            <tr>
              <Th>Day</Th>
              <Th align="right">Sales</Th>
              <Th align="right">Orders</Th>
              <Th align="right" className="hidden sm:table-cell">Avg check</Th>
              {seasonalOn && <Th align="right" className="hidden sm:table-cell">Season</Th>}
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <Tr key={d.date}>
                <Td className="num">{dayDate(d.date)}</Td>
                <Td align="right">{d.qty < 1 ? <span className="text-muted">Closed</span> : money(d.qty, { whole: true })}</Td>
                <Td align="right">{d.orders == null || d.qty < 1 ? <span className="text-muted">—</span> : Math.round(d.orders)}</Td>
                <Td align="right" className="hidden sm:table-cell">{d.orders && d.qty >= 1 ? money(d.qty / d.orders) : <span className="text-muted">—</span>}</Td>
                {seasonalOn && <Td align="right" className="hidden sm:table-cell">{signed(d.seasonal)}</Td>}
              </Tr>
            ))}
            <Tr className="font-medium">
              <Td>Week</Td>
              <Td align="right">{money(totals.sales, { whole: true })}</Td>
              <Td align="right">{anyOrders ? Math.round(totals.orders) : "—"}</Td>
              <Td align="right" className="hidden sm:table-cell">{anyOrders && totals.orders ? money(totals.sales / totals.orders) : "—"}</Td>
              {seasonalOn && <Td className="hidden sm:table-cell" />}
            </Tr>
          </tbody>
      </Table>
      {!anyOrders && <p className="mt-2 text-xs text-muted">Order counts appear once hourly sales have synced from Square.</p>}
    </Section>
  );
}
