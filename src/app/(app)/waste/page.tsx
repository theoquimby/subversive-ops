import { Card, PageHeader, Section } from "@/components/ui";
import { addDays } from "@/domain/dates";
import { formatBase, type BaseUnit } from "@/domain/units";
import { money, relativeTime } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { buildContext, loadCostingSnapshot } from "@/server/services/costing";
import { countUnitsFor, loadCountableIngredients } from "@/server/services/inventory";
import { wasteLeaderboard } from "@/server/services/variance";
import { businessToday } from "@/server/services/sales";
import { DeleteWasteButton, WasteForm } from "./waste-form";
import { canDeleteWaste, WASTE_UNDO_MINUTES } from "./undo";
import { HelpZone } from "@/components/help";
import { recipeWasteUnits } from "@/domain/prepWaste";

export const metadata = { title: "Waste" };

export default async function WastePage() {
  const session = await requireUser();
  const today = businessToday();
  const [ingredients, rows, board, recipes] = await Promise.all([
    loadCountableIngredients(),
    db.wasteLog.findMany({ where: { loggedAt: { gte: new Date(`${addDays(today, -14)}T00:00:00Z`) } }, orderBy: { loggedAt: "desc" }, take: 300, include: { ingredient: { select: { id: true, name: true, baseUnit: true } }, sourceRecipe: { select: { name: true } } } }),
    wasteLeaderboard(new Date(`${addDays(today, -30)}T00:00:00Z`)),
    db.recipe.findMany({ where: { active: true, kind: { in: ["PREP", "MENU"] }, lines: { some: {} } }, select: { id: true, name: true, kind: true, yieldUnit: true, yieldBase: true }, orderBy: [{ kind: "desc" }, { name: "asc" }] }),
  ]);
  const isManager = session.role === "MANAGER";
  const ctx = isManager ? buildContext(await loadCostingSnapshot(), today) : null;
  const costOf = (id: string, qtyBase: number) => {
    // Waste is raw product, so it's valued at purchase cost (no yield uplift).
    const c = ctx?.ingredients.get(id);
    return c?.costPerBase == null ? null : c.costPerBase * qtyBase;
  };
  const now = Date.now();
  const total = rows.reduce((s, w) => s + (costOf(w.ingredient.id, w.qtyBase.toNumber()) ?? 0), 0);
  // Rows exploded from one prep/menu entry show as that entry, with its ingredients underneath.
  type Entry = { first: (typeof rows)[number]; parts: typeof rows };
  const entries: Entry[] = [];
  const byBatch = new Map<string, Entry>();
  for (const w of rows) {
    if (w.batchId) {
      const e = byBatch.get(w.batchId);
      if (e) { e.parts.push(w); continue; }
      const n = { first: w, parts: [w] };
      byBatch.set(w.batchId, n);
      entries.push(n);
    } else entries.push({ first: w, parts: [w] });
  }
  const recent = entries.slice(0, 30);

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Log waste" description="Anything thrown out — so the numbers match what's really used." />
      <WasteForm
        items={ingredients.map((i) => ({ id: i.id, name: i.name, units: countUnitsFor(i).units }))}
        recipes={recipes.map((r) => ({ id: r.id, name: r.name, kind: r.kind, units: recipeWasteUnits({ yieldUnit: r.yieldUnit, yieldBase: r.yieldBase as BaseUnit, kind: r.kind }) }))}
      />
      {board.length > 0 && (
        <HelpZone id="waste.leaderboard">
        <Section title="Top loggers" description="Last 30 days. Logging everything keeps food cost honest — thank you!" className="mt-10">
          <Card className="divide-y divide-border">
            {board.slice(0, 5).map((b, i) => (
              <div key={b.name} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="num w-5 text-muted">{i + 1}</span>
                <span className="flex-1 font-medium">{b.name}</span>
                <span className="num text-muted">{b.logs} log{b.logs === 1 ? "" : "s"}</span>
              </div>
            ))}
          </Card>
        </Section>
        </HelpZone>
      )}
      <HelpZone id="waste.recent">
      <Section title="Last two weeks" description={isManager ? `${money(total)} logged` : `Logged something by mistake? Remove it within ${WASTE_UNDO_MINUTES} minutes.`} className="mt-10">
        {recent.length === 0 ? <Card className="p-5 text-sm text-muted">Nothing logged yet.</Card> : (
          <Card className="divide-y divide-border">
            {recent.map(({ first: w, parts }) => {
              const fromRecipe = w.sourceRecipe && w.sourceQty;
              const cost = isManager ? parts.reduce<number | null>((a, p) => { const c = costOf(p.ingredient.id, p.qtyBase.toNumber()); return c == null ? a : (a ?? 0) + c; }, null) : null;
              const amount = fromRecipe ? `${Number(w.sourceQty!.toNumber().toFixed(3))}${w.sourceUnit && w.sourceUnit !== "each" ? ` ${w.sourceUnit}` : ""}` : formatBase(w.qtyBase.toNumber(), w.ingredient.baseUnit as BaseUnit);
              const name = fromRecipe ? w.sourceRecipe!.name : w.ingredient.name;
              return (
                <div key={w.id} className="px-4 py-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium">{name}</div>
                      <div className="text-xs text-muted">{w.reason} · {w.loggedBy ?? "—"} · {relativeTime(w.loggedAt)}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <div className="num text-right">
                        <div>{amount}</div>
                        {cost != null && <div className="text-xs text-muted">{money(cost)}</div>}
                      </div>
                      {canDeleteWaste(w, session, now) && <DeleteWasteButton id={w.id} label={`${amount} ${name} · ${w.reason}`} />}
                    </div>
                  </div>
                  {fromRecipe && (
                    <div className="mt-1.5 text-xs text-muted">
                      {parts.map((p) => `${formatBase(p.qtyBase.toNumber(), p.ingredient.baseUnit as BaseUnit)} ${p.ingredient.name}`).join(" · ")}
                    </div>
                  )}
                </div>
              );
            })}
          </Card>
        )}
      </Section>
      </HelpZone>
    </div>
  );
}
