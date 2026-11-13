import { Badge, Card, cx, EmptyState, LinkButton, PageHeader, Section, Stat, Table, Td, Th, Tr } from "@/components/ui";
import type { BaseUnit } from "@/domain/units";
import { dayDate, money, pct, qty, signedPct } from "@/lib/format";
import { DISPLAY_UNIT } from "@/lib/units-display";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { gapTone } from "@/domain/pnl";
import { friendlyUnit } from "@/domain/variance";
import { countPoints, VarianceLine, varianceReport } from "@/server/services/variance";
import Link from "next/link";
import { PeriodPicker } from "./period-picker";
import { HelpTip, HelpZone } from "@/components/help";

export const metadata = { title: "Margin gap" };

/** One plain-English line per notable gap: how much, what it means per plate or pour, and where to look. */
function explain(row: VarianceLine): string | null {
  const e = row.explanation;
  if (!e || e.cause === "small") return null;
  const each = row.baseUnit === "each";
  const tu = friendlyUnit(row.baseUnit, e.amount);
  const amount = each ? qty(Math.abs(e.amount), 0) : `${qty(Math.abs(e.amount) / tu.factor, 1)} ${tu.unit}`;
  let per = "";
  if (e.dish && e.perServing != null) {
    const pu = friendlyUnit(row.baseUnit, e.perServing, true);
    const v = Math.abs(e.perServing) / pu.factor;
    const word = e.amount > 0 ? "extra" : "short";
    const others = e.others ? ` (and the ${e.others} other item${e.others === 1 ? "" : "s"} using it)` : "";
    // Counted items read better as "1 extra for every 3 burgers" than "0.3 extra per burger".
    per = each && v > 0 && v < 1
      ? ` — about one ${word} for every ${Math.max(2, Math.round(1 / v))} orders of ${e.dish.name}${others}`
      : ` — about ${qty(v, v < 0.1 ? 2 : 1)}${each ? "" : ` ${pu.unit}`} ${word} per ${e.dish.name}${others}`;
  }
  const bev = row.group === "beverage";
  switch (e.cause) {
    case "over":
      return `${amount} more than recipes explain${per}. ${bev ? "Check pour sizes, foam loss, and comps or staff drinks that weren't rung in." : "Weigh a few portions and make sure waste gets logged."}`;
    case "overWithWaste":
      return `${amount} more than recipes explain, even after logged waste${per}. ${bev ? "Check pour sizes and foam loss." : "Check portions first."}`;
    case "under":
      return `${amount} less than recipes say${per}. Usually a delivery that wasn't checked in or a counting slip${bev ? "" : "; otherwise portions are running light"}.`;
    case "unsold":
      return `${amount} went out but nothing sold uses it. Is a Square item missing its recipe link?`;
  }
  return null;
}

export default async function VariancePage({ searchParams }: { searchParams: Promise<{ start?: string; end?: string; group?: string }> }) {
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
  const group = sp.group === "food" || sp.group === "beverage" ? sp.group : "all";
  const end = points.find((p) => p.id === sp.end) ?? points[0];
  const start = points.find((p) => p.id === sp.start && p.at < end.at) ?? points.find((p) => p.at < end.at && p.date !== end.date) ?? points[points.length - 1];
  const [r, ingredients] = await Promise.all([
    varianceReport(start.id, end.id),
    db.ingredient.findMany({ select: { id: true, baseUnit: true } }),
  ]);
  const baseOf = new Map(ingredients.map((i) => [i.id, i.baseUnit as BaseUnit]));
  const kegLike = new Set(r.rows.filter((row) => row.group === "beverage" && row.baseUnit === "ml").map((row) => row.ingredientId));
  const show = (id: string, v: number | null) => {
    if (v == null) return "—";
    // Beer reads in gallons; everything else in the usual lb / qt / ea.
    const d = kegLike.has(id) ? { unit: "gal", factor: 3785.411784 } : DISPLAY_UNIT[baseOf.get(id) ?? "each"];
    return `${qty(v / d.factor, 1)} ${d.unit}`;
  };
  const g = group === "all" ? null : r.groups[group];
  const t = g ?? { sales: r.foodSales, theoreticalCost: r.theoreticalCost, actualCost: r.actualCost, wasteCost: r.wasteCost, unexplainedCost: r.unexplainedCost };
  const theoPct = t.sales > 0 ? t.theoreticalCost / t.sales : null;
  const actPct = t.sales > 0 ? t.actualCost / t.sales : null;
  const rows = group === "all" ? r.rows : r.rows.filter((row) => row.group === group);
  const skipped = rows.filter((row) => row.unexplainedCost == null);
  const salesWord = group === "beverage" ? "drink sales" : group === "food" ? "food sales" : "sales";

  return (
    <>
      <PageHeader
        title="Margin gap"
        description={`${dayDate(r.from)} → ${dayDate(r.to)} · ${r.days} days between counts`}
      />
      <div className="-mt-4 mb-8" data-tour="variance.period">
        <PeriodPicker points={points.map((p) => ({ id: p.id, label: `${dayDate(p.date)} · ${p.area} · ${p.lines} items` }))} start={start.id} end={end.id} group={group} />
      </div>

      <HelpZone id="variance.page" tour="variance.stats" className="mb-10 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={<span className="inline-flex items-center gap-1.5">Cost if recipes were followed <HelpTip id="variance.theoretical" /></span>} value={pct(theoPct)} hint={`${money(t.theoreticalCost, { whole: true })} on ${money(t.sales, { whole: true })} ${salesWord}`} />
        <Stat label={<span className="inline-flex items-center gap-1.5">Actual cost <HelpTip id="variance.actual" /></span>} value={pct(actPct)} hint={`${money(t.actualCost, { whole: true })} used`} tone={gapTone(actPct, theoPct) === "neutral" ? undefined : gapTone(actPct, theoPct)} />
        <Stat label="Logged waste" value={money(t.wasteCost, { whole: true })} hint="Accounted for" />
        <Stat label={<span className="inline-flex items-center gap-1.5">Unexplained <HelpTip id="variance.unexplained" /></span>} value={money(t.unexplainedCost, { whole: true })} hint={t.sales > 0 ? `${pct(t.unexplainedCost / t.sales)} of ${salesWord}` : undefined} tone={t.unexplainedCost > 0 ? "bad" : "good"} />
      </HelpZone>
      {group === "all" && (
        <div className="-mt-6 mb-10 flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-2">
          {(["food", "beverage"] as const).map((k) => {
            const x = r.groups[k];
            return (
              <Link key={k} href={`/variance?start=${start.id}&end=${end.id}&group=${k}`} className="inline-flex items-center gap-1.5 hover:underline">
                {k === "food" ? "Food" : "Beverage"}: actual
                {x.actualPct != null ? <Badge tone={gapTone(x.actualPct, x.theoreticalPct)}>{pct(x.actualPct)}</Badge> : " —"}
                <span className="text-muted">vs {pct(x.theoreticalPct)} if recipes were followed</span>
              </Link>
            );
          })}
        </div>
      )}

      <HelpZone id="variance.byIngredient" tour="variance.by-ingredient">
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
            {rows.filter((row) => row.unexplainedCost != null).map((row) => {
              const missing = row.opening == null ? "Not counted at start" : row.closing == null ? "Not counted at end" : row.unitCost == null ? "No price" : null;
              const big = row.unexplainedPct != null && Math.abs(row.unexplainedPct) > 0.1 && Math.abs(row.unexplainedCost ?? 0) >= 5;
              const why = explain(row);
              return (
                <Tr key={row.ingredientId}>
                  <Td>
                    <Link href={`/ingredients/${row.ingredientId}`} className="font-medium hover:underline">{row.name}</Link>
                    <div className="text-xs text-muted">{missing ?? row.category}{group === "all" && row.group === "beverage" ? " · beverage" : ""}</div>
                    {why && <div className="mt-1 max-w-xl text-xs text-ink-2">{why}</div>}
                  </Td>
                  <Td align="right" className="hidden text-ink-2 md:table-cell">{show(row.ingredientId, row.theoretical)}</Td>
                  <Td align="right" className="hidden md:table-cell">{show(row.ingredientId, row.actual)}</Td>
                  <Td align="right" className="hidden text-ink-2 lg:table-cell">{row.waste ? show(row.ingredientId, row.waste) : "—"}</Td>
                  <Td align="right">
                    {row.unexplained == null ? <span className="text-muted">—</span> : (
                      <span className={cx("whitespace-nowrap", big && (row.unexplained > 0 ? "text-bad" : "text-warn"))}>
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
        {skipped.length > 0 && (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-muted hover:text-ink">{skipped.length} ingredient{skipped.length === 1 ? "" : "s"} not in the totals — count them at both ends to include them</summary>
            <ul className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
              {skipped.map((row) => (
                <li key={row.ingredientId} className="flex justify-between gap-3 border-b border-border py-1.5">
                  <Link href={`/ingredients/${row.ingredientId}`} className="hover:underline">{row.name}</Link>
                  <span className="text-xs text-muted">{row.opening == null ? "not counted at start" : row.closing == null ? "not counted at end" : "no price"}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </Section>
      </HelpZone>

      <Card className="p-5 text-sm text-ink-2">
        <div className="font-medium text-ink">Reading this</div>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li><b>Over</b> usually means heavy portions (or pours), waste nobody logged, or a Square item not linked to its recipe.</li>
          <li><b>Under</b> usually means a delivery wasn't checked in on the Ordering page, or a counting slip.</li>
          <li>The &ldquo;about … per item&rdquo; figure spreads the gap over everything that uses the ingredient, in proportion to its recipe.</li>
          <li>Each ingredient sits under Food or Beverage by which sales use most of it. Both columns use prices as of the closing count, so price changes don&apos;t show up as gaps.</li>
        </ul>
      </Card>
    </>
  );
}
