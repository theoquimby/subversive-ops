import { Badge, Card, cx, EmptyState, LinkButton, PageHeader, Section, Stat, Table, Td, Th, Tr } from "@/components/ui";
import type { BaseUnit } from "@/domain/units";
import { dayDate, money, pct, qty, signedPct } from "@/lib/format";
import { DISPLAY_UNIT } from "@/lib/units-display";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { countPoints, varianceReport } from "@/server/services/variance";
import Link from "next/link";
import { PeriodPicker } from "./period-picker";

export const metadata = { title: "Margin gap" };

export default async function VariancePage({ searchParams }: { searchParams: Promise<{ start?: string; end?: string }> }) {
  await requireUser("MANAGER");
  const sp = await searchParams;
  const points = await countPoints();
  if (points.length < 2) {
    return (
      <>
        <PageHeader title="Margin gap" description="What your recipes say you used vs what actually left the shelves." />
        <EmptyState title="Needs two counts" action={<LinkButton href="/count" variant="primary">Start a count</LinkButton>}>
          Count once now and again in a week. The gap between the two — after sales and logged waste — shows where food cost is leaking.
        </EmptyState>
      </>
    );
  }
  const end = points.find((p) => p.id === sp.end) ?? points[0];
  const start = points.find((p) => p.id === sp.start && p.at < end.at) ?? points.find((p) => p.at < end.at && p.date !== end.date) ?? points[points.length - 1];
  const [r, ingredients] = await Promise.all([
    varianceReport(start.id, end.id),
    db.ingredient.findMany({ select: { id: true, baseUnit: true } }),
  ]);
  const baseOf = new Map(ingredients.map((i) => [i.id, i.baseUnit as BaseUnit]));
  const show = (id: string, v: number | null) => {
    if (v == null) return "—";
    const d = DISPLAY_UNIT[baseOf.get(id) ?? "each"];
    return `${qty(v / d.factor, 1)} ${d.unit}`;
  };
  const theoPct = r.foodSales > 0 ? r.theoreticalCost / r.foodSales : null;
  const actPct = r.foodSales > 0 ? r.actualCost / r.foodSales : null;

  return (
    <>
      <PageHeader
        title="Margin gap"
        description={`${dayDate(r.from)} → ${dayDate(r.to)} · ${r.days} days between counts`}
      />
      <div className="-mt-4 mb-8">
        <PeriodPicker points={points.map((p) => ({ id: p.id, label: `${dayDate(p.date)} · ${p.area} · ${p.lines} items` }))} start={start.id} end={end.id} />
      </div>

      <div className="mb-10 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Food cost if recipes were followed" value={pct(theoPct)} hint={`${money(r.theoreticalCost, { whole: true })} on ${money(r.foodSales, { whole: true })} sales`} />
        <Stat label="Actual food cost" value={pct(actPct)} hint={`${money(r.actualCost, { whole: true })} used`} tone={actPct != null && theoPct != null && actPct - theoPct > 0.015 ? "bad" : undefined} />
        <Stat label="Logged waste" value={money(r.wasteCost, { whole: true })} hint="Accounted for" />
        <Stat label="Unexplained" value={money(r.unexplainedCost, { whole: true })} hint={r.foodSales > 0 ? `${pct(r.unexplainedCost / r.foodSales)} of food sales` : undefined} tone={r.unexplainedCost > 0 ? "bad" : "good"} />
      </div>

      <Section title="By ingredient" description="Biggest dollar gaps first. Positive = more went out than sales and waste explain.">
        <Table>
          <thead>
            <tr>
              <Th>Ingredient</Th>
              <Th align="right" className="hidden md:table-cell">Should have used</Th>
              <Th align="right" className="hidden md:table-cell">Actually used</Th>
              <Th align="right" className="hidden lg:table-cell">Logged waste</Th>
              <Th align="right">Unexplained</Th>
              <Th align="right">$</Th>
            </tr>
          </thead>
          <tbody>
            {r.rows.filter((row) => row.unexplainedCost != null).map((row) => {
              const missing = row.opening == null ? "Not counted at start" : row.closing == null ? "Not counted at end" : row.unitCost == null ? "No price" : null;
              const big = row.unexplainedPct != null && Math.abs(row.unexplainedPct) > 0.1 && Math.abs(row.unexplainedCost ?? 0) >= 5;
              return (
                <Tr key={row.ingredientId}>
                  <Td>
                    <Link href={`/ingredients/${row.ingredientId}`} className="font-medium hover:underline">{row.name}</Link>
                    <div className="text-xs text-muted">{missing ?? row.category}</div>
                  </Td>
                  <Td align="right" className="hidden text-ink-2 md:table-cell">{show(row.ingredientId, row.theoretical)}</Td>
                  <Td align="right" className="hidden md:table-cell">{show(row.ingredientId, row.actual)}</Td>
                  <Td align="right" className="hidden text-ink-2 lg:table-cell">{row.waste ? show(row.ingredientId, row.waste) : "—"}</Td>
                  <Td align="right">
                    {row.unexplained == null ? <span className="text-muted">—</span> : (
                      <span className={cx(big && (row.unexplained > 0 ? "text-bad" : "text-warn"))}>
                        {show(row.ingredientId, row.unexplained)}
                        {row.unexplainedPct != null && <span className="ml-1 text-xs text-muted">{signedPct(row.unexplainedPct, 0)}</span>}
                      </span>
                    )}
                  </Td>
                  <Td align="right">
                    {row.unexplainedCost == null ? "—" : big ? <Badge tone={row.unexplainedCost > 0 ? "bad" : "warn"}>{money(row.unexplainedCost)}</Badge> : money(row.unexplainedCost)}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
        {r.skipped > 0 && (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-muted hover:text-ink">{r.skipped} ingredient{r.skipped === 1 ? "" : "s"} not in the totals — count them at both ends to include them</summary>
            <ul className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
              {r.rows.filter((row) => row.unexplainedCost == null).map((row) => (
                <li key={row.ingredientId} className="flex justify-between gap-3 border-b border-border py-1.5">
                  <Link href={`/ingredients/${row.ingredientId}`} className="hover:underline">{row.name}</Link>
                  <span className="text-xs text-muted">{row.opening == null ? "not counted at start" : row.closing == null ? "not counted at end" : "no price"}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </Section>

      <Card className="p-5 text-sm text-ink-2">
        <div className="font-medium text-ink">Reading this</div>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li><b>Over</b> usually means heavy portions, waste nobody logged, or a Square item not linked to its recipe.</li>
          <li><b>Under</b> usually means a delivery wasn't checked in on the Ordering page, or a counting slip.</li>
          <li>Recipes are costed at today's prices for both columns, so price changes don't show up as gaps.</li>
        </ul>
      </Card>
    </>
  );
}
