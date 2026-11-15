import { HelpZone } from "@/components/help";
import { PageHeader } from "@/components/ui";
import { formatPrepQty, prepUnitLabel } from "@/domain/prep";
import { recipeYieldInBase } from "@/domain/costing";
import { requireUser } from "@/server/auth";
import { buildPrepList, loadPrepItems } from "@/server/services/prep";
import { PrepTabs } from "../tabs";
import { CoverDays, PrepSetupTable, type SetupRow } from "./setup-table";

export const metadata = { title: "Prep setup" };

export default async function PrepSetupPage() {
  await requireUser("MANAGER");
  const [items, list] = await Promise.all([loadPrepItems(), buildPrepList()]);
  const lineById = new Map(list.lines.map((l) => [l.recipeId, l]));
  const rows: SetupRow[] = items.map((i) => {
    const unit = i.settings.unit!;
    let batchBase = 0;
    try {
      batchBase = recipeYieldInBase({ id: i.id, name: i.name, yieldQty: i.yieldQty, yieldUnit: i.yieldUnit, yieldBase: i.base, menuPrice: null, lines: [] });
    } catch {
      batchBase = 0;
    }
    const daily = list.avgDaily.get(i.id) ?? 0;
    return {
      id: i.id,
      name: i.name,
      category: i.category,
      onList: i.settings.onList,
      station: i.settings.station ?? "",
      unitLabel: prepUnitLabel(unit, i.base),
      unitName: unit.container ? `${unit.name}s` : unit.name,
      par: i.settings.parBase != null ? Math.round((i.settings.parBase / unit.baseQty) * 100) / 100 : null,
      shelfLifeDays: i.settings.shelfLifeDays,
      rounding: i.settings.rounding,
      batchText: batchBase > 0 ? formatPrepQty(batchBase, unit) : "—",
      dailyText: daily > 0 ? formatPrepQty(daily, unit) : null,
      daily,
      status: lineById.get(i.id)?.status ?? null,
    };
  });
  const stations = [...new Set(rows.map((r) => r.station).filter(Boolean))].sort();

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader help="prep.setup" title="Prep list" description="What goes on the prep list, and how much to keep. Changes save as you type." />
      <PrepTabs active="setup" />
      <HelpZone id="prep.cover" className="mb-6">
        <CoverDays value={list.coverDays} />
      </HelpZone>
      <PrepSetupTable rows={rows} stations={stations} />
    </div>
  );
}
