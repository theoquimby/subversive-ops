import { pct } from "@/lib/format";
import { cx, EmptyState, LinkButton, PageHeader, Section, Table, Td, Th, Tr } from "@/components/ui";
import { GridCell, GridSelect } from "@/components/grid";
import { MenuTable, type MenuRow } from "./menu-table";
import { buildContext, loadCostingSnapshot, safeCost } from "@/server/services/costing";
import { businessToday } from "@/server/services/sales";
import { classLabel, classifyCategory, DEFAULT_BEV_TARGET, normalizeCategory, REVENUE_CLASSES } from "@/domain/revenueClass";
import { classSettings, costTargets } from "@/server/services/insights";
import { saveBevTarget, saveCategoryClass } from "./draft-beer/actions";
import { requireUser } from "@/server/auth";
import { menuCosts } from "@/server/services/insights";
import { db } from "@/server/db";
import Link from "next/link";
import { HelpTip, HelpZone } from "@/components/help";
import { archivedLabel, baseName } from "@/domain/archiveName";
import { RestoreButton } from "./restore-button";
import { loadDrafts } from "@/server/services/recipe-drafts";
import { Verdict } from "@/components/chapter";
import { menuStory } from "@/domain/menuStory";
import { Bars } from "../sales/bars";
import { MoreMenu } from "./more-menu";

export const metadata = { title: "Menu costs" };

const KIND_LABEL: Record<string, string> = { MENU: "Menu item", MODIFIER: "Add-on", PREP: "Prep recipe" };

export default async function MenuPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  await requireUser("MANAGER");
  const { kind = "MENU" } = await searchParams;
  // The snapshot is read once per render (cached), so it loads alongside the rest.
  const [snap, { rows }, noLines, cls, targets, archived, drafts] = await Promise.all([
    loadCostingSnapshot(),
    menuCosts(),
    db.recipe.findMany({ where: { lines: { none: {} } }, select: { id: true } }),
    classSettings(),
    costTargets(),
    db.recipe.findMany({ where: { active: false }, select: { id: true, name: true, kind: true, category: true }, orderBy: { name: "asc" } }),
    loadDrafts(),
  ]);
  const isArchived = kind === "ARCHIVED";
  // Every category in use (menu items and add-ons), with the class it maps to.
  const categories = [...new Map(rows.filter((r) => r.kind !== "PREP").map((r) => [normalizeCategory(r.category), r.category])).values()]
    .sort((a, b) => a.localeCompare(b))
    .map((c) => ({ name: c, cls: classifyCategory(c, cls.map), saved: normalizeCategory(c) in cls.map, items: rows.filter((r) => r.kind !== "PREP" && normalizeCategory(r.category) === normalizeCategory(c)).length }));
  const needsIngredients = new Set(noLines.map((r) => r.id));
  const ctx = buildContext(snap, businessToday());
  const tableRows: MenuRow[] = rows.map((r) => {
    const c = safeCost(ctx, r.id);
    return {
      ...r,
      kind: r.kind as MenuRow["kind"],
      clsLabel: classLabel(r.cls),
      needsIngredients: needsIngredients.has(r.id),
      error: r.error ?? null,
      lines: "error" in c ? [] : c.lines.map((l) => ({ label: l.label, qty: l.qty, unit: l.unit, cost: l.cost, recipe: l.kind === "recipe" })),
    };
  });

  const dishes = tableRows.filter((r) => r.kind === "MENU");
  const needWork = dishes.filter((r) => r.needsIngredients || r.incomplete).length;
  const story = menuStory(dishes.map((r) => ({ name: r.name, foodCostPct: r.foodCostPct, target: r.target, price: r.menuPrice, cost: r.cost })), { needWork });
  const shown = story.ranked.slice(0, 12);
  const pc = (n: number) => pct(n, 0);
  const unsaved = categories.filter((c) => !c.saved).length;

  return (
    <>
      <PageHeader
        help="menu.page"
        title="Menu costs"
        description="Plate costs update automatically whenever a supplier price changes."
        actions={
          <>
            <MoreMenu
              items={[
                { href: "/menu/draft-beer", label: "Draft beer", tour: "menu.draft-beer-link" },
                { href: "/menu/allergens", label: "Allergens", tour: "menu.allergens-link" },
                { href: "/menu/drafts", label: drafts.length ? "Drafts to review" : "Draft recipes", count: drafts.length },
                { href: "/import?for=recipes", label: "Bulk add" },
              ]}
            />
            <LinkButton href="/menu/new" variant="primary">New recipe</LinkButton>
          </>
        }
      />
      {(archived.length > 0 || isArchived) && (
        <div className="-mt-4 mb-4 flex justify-end">
          <Link href={isArchived ? "/menu" : "/menu?kind=ARCHIVED"} className={cx("relative rounded-full px-3 py-1 text-sm after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-['']", isArchived ? "bg-primary text-primary-ink" : "text-ink-2 hover:bg-surface-2")}>
            {isArchived ? "← All recipes" : <>Archived <span className="num ml-1">{archived.length}</span></>}
          </Link>
        </div>
      )}

      {isArchived ? (
        archived.length === 0 ? (
          <EmptyState title="Nothing archived">Archived recipes show up here so you can bring them back.</EmptyState>
        ) : (
          <HelpZone id="menu.archived"><Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th className="hidden sm:table-cell">Type</Th>
                <Th className="hidden sm:table-cell">Archived</Th>
                <Th align="right"><span className="sr-only">Restore</span></Th>
              </tr>
            </thead>
            <tbody>
              {archived.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    <div className="font-medium">{baseName(r.name)}</div>
                    <div className="text-xs text-muted sm:hidden">{KIND_LABEL[r.kind]}{archivedLabel(r.name) ? ` · archived ${archivedLabel(r.name)}` : ""}</div>
                  </Td>
                  <Td className="hidden text-muted sm:table-cell">{KIND_LABEL[r.kind]} · {r.category}</Td>
                  <Td className="hidden text-muted sm:table-cell">{archivedLabel(r.name) ?? "—"}</Td>
                  <Td align="right" className="py-2"><RestoreButton id={r.id} name={baseName(r.name)} /></Td>
                </Tr>
              ))}
            </tbody>
          </Table></HelpZone>
        )
      ) : (
        <>
          <Verdict
            badge={{ tone: story.tone }}
            title={story.headline}
            line={story.line}
            stats={story.average != null ? [
              { label: "Average food cost", value: pc(story.average), hint: `across ${story.ranked.length} priced ${story.ranked.length === 1 ? "dish" : "dishes"}` },
              { label: "Over their target", value: String(story.over), tone: story.over ? (story.tone === "bad" ? "bad" : "warn") : "neutral" },
              { label: "Need ingredients or prices", value: String(needWork), tone: needWork ? "warn" : "neutral" },
            ] : undefined}
          >
            {shown.length > 0 && (
              <>
                <h3 className="mb-3 text-sm font-medium text-ink">Food cost per dish, against its target</h3>
                <Bars
                  ariaLabel="Food cost as a share of the menu price for each dish, with its target"
                  color="var(--money-goods)"
                  rows={shown.map((d) => ({ key: d.name, label: d.name, hint: d.price != null && d.cost != null ? `$${d.cost.toFixed(2)} of $${d.price.toFixed(2)}` : undefined, value: d.foodCostPct, display: pc(d.foodCostPct!), tick: d.target, mark: story.named.includes(d.name) }))}
                  tickLabel="Its food-cost target"
                />
                {story.ranked.length > shown.length && <p className="mt-2 text-xs text-muted">The {shown.length} highest of {story.ranked.length}; every dish is in the list below.</p>}
              </>
            )}
            {story.action && (
              <p className="mt-5 rounded-lg bg-surface-2 px-3.5 py-3 text-sm font-medium text-ink">{story.action}</p>
            )}
          </Verdict>
          <MenuTable rows={tableRows} />
        </>
      )}

      {!isArchived && categories.length > 0 && (
        <HelpZone id="menu.classes" tour="menu.classes" className="mt-10">
          <Section
            title={<span className="inline-flex items-center gap-1.5">Food and drink <HelpTip id="menu.classes" /></span>}
            description="Which part of the business each category's sales and costs count toward on the P&L, Overview and Margin gap."
          >
            <Table>
              <thead>
                <tr>
                  <Th>Category</Th>
                  <Th className="w-48">Counts as</Th>
                  <Th align="right" className="hidden sm:table-cell">Items</Th>
                </tr>
              </thead>
              <tbody>
                {categories.map((c) => (
                  <Tr key={c.name}>
                    <Td className="font-medium">{c.name}</Td>
                    <td className="border-b border-border px-2 py-1 [tr:last-child_&]:border-b-0">
                      <GridSelect value={c.cls} options={REVENUE_CLASSES.map((x) => ({ value: x.value, label: x.label }))} onSave={saveCategoryClass.bind(null, c.name)} ariaLabel={`${c.name} counts as`} />
                    </td>
                    <Td align="right" className="hidden text-muted sm:table-cell">{c.items}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            {unsaved > 0 && <p className="mt-2 text-xs text-muted">Ops set {unsaved === categories.length ? "these" : `${unsaved} of these`} from the category name. Change any that&apos;s wrong and your choice is kept.</p>}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-ink-2">
              <span>Beverage cost target</span>
              <GridCell grid="menu-bev" col="target" type="number" suffix="%" value={Math.round(targets.beverage * 1000) / 10} onSave={saveBevTarget} ariaLabel="Beverage cost target" className="w-20" />
              <span className="text-xs text-muted">{cls.bevTarget == null ? `default ${pct(DEFAULT_BEV_TARGET, 0)}; ` : ""}food uses the target in Settings ({pct(targets.food, 0)}).</span>
            </div>
          </Section>
        </HelpZone>
      )}
    </>
  );
}
