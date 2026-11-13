import { addDays } from "@/domain/dates";
import { dayDate, money, pct, relativeTime, shortDate, signedPct } from "@/lib/format";
import { Badge, Card, cx, EmptyState, LinkButton, PageHeader, Section, Stat, Table, Td, Th, Tr } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { loadCostingSnapshot } from "@/server/services/costing";
import { menuCosts, recentPriceMoves } from "@/server/services/insights";
import { deliveryWindow } from "@/server/services/planning";
import { businessToday, lastSquareSync, salesByRecipe } from "@/server/services/sales";
import Link from "next/link";

export const metadata = { title: "Overview" };

export default async function OverviewPage() {
  await requireUser("MANAGER");
  const today = businessToday();
  const snap = await loadCostingSnapshot();
  const [{ rows }, moves, week, sales7, suppliers, lastSync] = await Promise.all([
    menuCosts(snap),
    recentPriceMoves(30, snap),
    salesByRecipe(addDays(today, -7), today),
    db.dailySale.aggregate({ _sum: { netSales: true }, where: { date: { gte: new Date(`${addDays(today, -7)}T00:00:00Z`), lt: new Date(`${today}T00:00:00Z`) } } }),
    db.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    lastSquareSync(),
  ]);

  const sold = rows.filter((r) => r.kind !== "PREP");
  const costById = new Map(rows.map((r) => [r.id, r]));
  let theoCost = 0;
  let mappedSales = 0;
  for (const [recipeId, series] of week.byRecipe) {
    const r = costById.get(recipeId);
    if (!r || r.cost == null || r.menuPrice == null) continue;
    for (const q of series.values()) {
      theoCost += q * r.cost;
      mappedSales += q * r.menuPrice;
    }
  }
  const theoPct = mappedSales > 0 ? theoCost / mappedSales : null;
  const over = sold.filter((r) => r.foodCostPct != null && r.foodCostPct > r.target).sort((a, b) => b.foodCostPct! - b.target - (a.foodCostPct! - a.target));
  const ups = moves.filter((m) => m.changePct > 0);
  const target = sold[0]?.target ?? 0.3;

  return (
    <>
      <PageHeader title="Overview" description={`${dayDate(today)} · Square synced ${relativeTime(lastSync)}`} />

      <div className="mb-10 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Food cost, last 7 days" value={pct(theoPct)} hint={`Target ${pct(target, 0)} · theoretical`} tone={theoPct == null ? undefined : theoPct > target ? "bad" : "good"} />
        <Stat label="Sales, last 7 days" value={money(sales7._sum.netSales?.toNumber() ?? 0, { whole: true })} hint="Net, from Square" />
        <Stat label="Items over target" value={over.length} hint={`of ${sold.length} menu items`} tone={over.length ? "warn" : "good"} />
        <Stat label="Price increases" value={ups.length} hint="Last 30 days" tone={ups.length ? "warn" : undefined} />
      </div>

      <div className="grid gap-x-8 lg:grid-cols-5">
        <Section className="lg:col-span-3" title="Price changes" description="Last 30 days, biggest moves first" actions={<LinkButton href="/prices" variant="ghost" size="sm">All prices →</LinkButton>}>
          {moves.length === 0 ? (
            <EmptyState title="No price changes">Import a distributor sheet to start tracking prices.</EmptyState>
          ) : (
            <Table>
              <thead><tr><Th>Item</Th><Th align="right">Was</Th><Th align="right">Now</Th><Th align="right">Change</Th></tr></thead>
              <tbody>
                {moves.slice(0, 7).map((m) => (
                  <Tr key={m.productId}>
                    <Td>
                      <div className="font-medium">{m.ingredient ?? m.description}</div>
                      <div className="text-xs text-muted">{m.supplier} · {shortDate(m.date)}</div>
                    </Td>
                    <Td align="right" className="text-muted">{money(m.oldPrice)}</Td>
                    <Td align="right">{money(m.newPrice)}</Td>
                    <Td align="right"><Badge tone={m.changePct > 0 ? "bad" : "good"}>{signedPct(m.changePct)}</Badge></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Section>

        <Section className="lg:col-span-2" title="Over target" description="Menu items above their food cost target" actions={<LinkButton href="/menu" variant="ghost" size="sm">Menu →</LinkButton>}>
          {over.length === 0 ? (
            <EmptyState title="Everything's on target" />
          ) : (
            <Card className="divide-y divide-border">
              {over.slice(0, 6).map((r) => (
                <Link key={r.id} href={`/menu/${r.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-surface-2/60">
                  <div>
                    <div className="text-sm font-medium">{r.name}</div>
                    <div className="num text-xs text-muted">{money(r.cost)} on {money(r.menuPrice)}</div>
                  </div>
                  <div className="num text-right">
                    <div className="text-sm font-medium text-bad">{pct(r.foodCostPct)}</div>
                    <div className="text-xs text-muted">target {pct(r.target, 0)}</div>
                  </div>
                </Link>
              ))}
            </Card>
          )}
        </Section>
      </div>

      <Section title="Next deliveries" description="Suggested orders are drafted from forecast sales, recipes and your last count.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {suppliers.map((s) => {
            const w = deliveryWindow(s, today);
            const days = Math.round((Date.parse(w.deliveryDate) - Date.parse(today)) / 86_400_000);
            return (
              <Link key={s.id} href={`/ordering/${s.id}`}>
                <Card className="p-4 transition-colors hover:border-border-strong">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-sm font-medium">{s.name}</div>
                    <Badge>{s.kind === "LOCAL" ? "Local" : "Distributor"}</Badge>
                  </div>
                  <div className="mt-3 text-[0.8rem] text-muted">Next delivery</div>
                  <div className={cx("num text-sm font-medium", days <= 1 && "text-warn")}>
                    {dayDate(w.deliveryDate)} {days === 0 ? "· today" : days === 1 ? "· tomorrow" : ""}
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      </Section>
    </>
  );
}
