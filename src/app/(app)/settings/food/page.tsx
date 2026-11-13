import { PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { classSettings, DEFAULT_TARGET_FOOD_COST, targetFoodCost } from "@/server/services/insights";
import { storageAreasWithCounts } from "@/server/services/inventory";
import { spikeThreshold } from "@/server/services/notify";
import { LinkRow, SettingGroup, SettingRow } from "../controls";
import { DrinkTargetInput, FoodTargetInput, SpikeInput } from "./food-client";

export const metadata = { title: "Food & drink" };

export default async function FoodSettingsPage() {
  await requireUser("MANAGER");
  const [target, cls, spike, areas, suppliers, overrides] = await Promise.all([
    targetFoodCost(),
    classSettings(),
    spikeThreshold(),
    storageAreasWithCounts(),
    db.supplier.count({ where: { active: true } }),
    db.recipe.count({ where: { targetFoodCostPct: { not: null } } }).catch(() => null),
  ]);

  return (
    <div className="max-w-3xl">
      <PageHeader back={{ href: "/settings", label: "Settings" }} title="Food & drink" description="Cost targets, price alerts and where things are kept." />

      <SettingGroup id="target" title="Cost targets" description="Menu costs, the P&L and the brief measure against these.">
        <SettingRow label="Food cost target" help="settings.target" what={`The goal for every menu item.${overrides ? ` ${overrides} item${overrides === 1 ? " sets its" : "s set their"} own on the menu page.` : " Any item can set its own on the menu page."}`} defaultNote={`Default ${DEFAULT_TARGET_FOOD_COST * 100}%. Most kitchens aim for 28–32%.`}>
          <FoodTargetInput value={target} />
        </SettingRow>
        <SettingRow label="Drink cost target" help="settings.food.bevTarget" what="The goal for beer and other drinks on the P&L. Leave blank for the default." defaultNote="Default 22%">
          <DrinkTargetInput value={cls.bevTarget ?? null} />
        </SettingRow>
        <LinkRow href="/menu/draft-beer" label="Menu categories" what="Which Square categories count as food, beer, other drinks or retail." help="settings.food.classes" value={`${Object.keys(cls.map).length} mapped`} />
      </SettingGroup>

      <SettingGroup id="alerts" title="Price alerts">
        <SettingRow label="Tell me when a price rises by" help="settings.food.spike" what="Managers with price alerts on get an email or phone alert." defaultNote="Default 8%">
          <SpikeInput value={spike} />
        </SettingRow>
        <LinkRow href="/settings/notifications" label="Who gets price alerts" what="Each manager turns price alerts on or off for themselves." />
      </SettingGroup>

      <SettingGroup id="ordering" title="Ordering & storage">
        <LinkRow href="/settings/suppliers" label="Suppliers" what="Delivery days, lead time, minimums, order emails and cutoffs." value={`${suppliers} active`} help="settings.suppliers" />
        <LinkRow href="/settings/areas" label="Storage areas" what="Where things live, in the order you walk them when counting." value={`${areas.length} area${areas.length === 1 ? "" : "s"}`} help="settings.areas" />
        <LinkRow href="/ingredients" label="Order buffer, pars & units" what="Per ingredient: extra on top of the forecast (15% unless changed), the least to keep on hand, and unit conversions." help="settings.food.buffer" />
      </SettingGroup>
    </div>
  );
}
