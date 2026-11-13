import { Card, PageHeader, Section } from "@/components/ui";
import { addDays } from "@/domain/dates";
import { formatBase, type BaseUnit } from "@/domain/units";
import { money, relativeTime } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { buildContext, loadCostingSnapshot } from "@/server/services/costing";
import { countUnitsFor, loadCountableIngredients } from "@/server/services/inventory";
import { businessToday } from "@/server/services/sales";
import { WasteForm } from "./waste-form";

export const metadata = { title: "Waste" };

export default async function WastePage() {
  const session = await requireUser();
  const today = businessToday();
  const [ingredients, recent] = await Promise.all([
    loadCountableIngredients(),
    db.wasteLog.findMany({ where: { loggedAt: { gte: new Date(`${addDays(today, -14)}T00:00:00Z`) } }, orderBy: { loggedAt: "desc" }, take: 30, include: { ingredient: { select: { id: true, name: true, baseUnit: true } } } }),
  ]);
  const isManager = session.role === "MANAGER";
  const ctx = isManager ? buildContext(await loadCostingSnapshot(), today) : null;
  const costOf = (id: string, qtyBase: number) => {
    // Waste is raw product, so it's valued at purchase cost (no yield uplift).
    const c = ctx?.ingredients.get(id);
    return c?.costPerBase == null ? null : c.costPerBase * qtyBase;
  };
  const total = recent.reduce((s, w) => s + (costOf(w.ingredient.id, w.qtyBase.toNumber()) ?? 0), 0);

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Log waste" description="Anything thrown out — so the numbers match what's really used." />
      <WasteForm items={ingredients.map((i) => ({ id: i.id, name: i.name, units: countUnitsFor(i).units }))} />
      <Section title="Last two weeks" description={isManager ? `${money(total)} logged` : undefined} className="mt-10">
        {recent.length === 0 ? <Card className="p-5 text-sm text-muted">Nothing logged yet.</Card> : (
          <Card className="divide-y divide-border">
            {recent.map((w) => {
              const cost = isManager ? costOf(w.ingredient.id, w.qtyBase.toNumber()) : null;
              return (
                <div key={w.id} className="flex items-center justify-between px-4 py-3 text-sm">
                  <div>
                    <div className="font-medium">{w.ingredient.name}</div>
                    <div className="text-xs text-muted">{w.reason} · {w.loggedBy ?? "—"} · {relativeTime(w.loggedAt)}</div>
                  </div>
                  <div className="num text-right">
                    <div>{formatBase(w.qtyBase.toNumber(), w.ingredient.baseUnit as BaseUnit)}</div>
                    {cost != null && <div className="text-xs text-muted">{money(cost)}</div>}
                  </div>
                </div>
              );
            })}
          </Card>
        )}
      </Section>
    </div>
  );
}
