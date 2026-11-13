import { Badge, Button, Card, cx, Input, PageHeader, Section, Table, Td, Th, Tr } from "@/components/ui";
import { addDays, dateRange } from "@/domain/dates";
import { dayDate, qty, relativeTime } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { squareConfigured } from "@/server/env";
import { forecastItems } from "@/server/services/planning";
import { businessToday, lastSquareSync } from "@/server/services/sales";
import { GridSelect } from "@/components/grid";
import { setSquareMapping } from "@/server/actions/inline";
import { saveAdjustment } from "./actions";
import { SyncButtons } from "./sync-buttons";

export const metadata = { title: "Sales" };

export default async function SalesPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  await requireUser("MANAGER");
  const { show } = await searchParams;
  const today = businessToday();
  const dates = dateRange(today, addDays(today, 7));
  const [lastSync, mappings, recipes, forecast, volume] = await Promise.all([
    lastSquareSync(),
    db.squareMapping.findMany({ orderBy: [{ ignored: "asc" }, { squareName: "asc" }], include: { recipe: { select: { name: true } } } }),
    db.recipe.findMany({ where: { active: true, kind: { in: ["MENU", "MODIFIER"] } }, select: { id: true, name: true, kind: true }, orderBy: { name: "asc" } }),
    forecastItems(dates),
    db.dailySale.groupBy({ by: ["squareId"], _sum: { qty: true }, where: { date: { gte: new Date(`${addDays(today, -28)}T00:00:00Z`) } } }),
  ]);
  const sold = new Map(volume.map((v) => [v.squareId, v._sum.qty?.toNumber() ?? 0]));
  const unmapped = mappings.filter((m) => !m.recipeId && !m.ignored);
  const listed = (show === "all" ? mappings : unmapped).sort((a, b) => (sold.get(b.squareId) ?? 0) - (sold.get(a.squareId) ?? 0));
  const dayTotals = dates.map((d) => forecast.items.reduce((s, i) => s + (i.days.find((x) => x.date === d)?.qty ?? 0), 0));

  return (
    <>
      <PageHeader
        title="Sales"
        description={squareConfigured() ? `Square synced ${relativeTime(lastSync)} · syncs automatically every night` : "Square isn't connected yet — add the access token in Vercel settings."}
        actions={<SyncButtons configured={squareConfigured()} />}
      />

      <Section title="Next 7 days" description={forecast.hasHistory ? `Forecast from ${forecast.historyDays} days of sales. Adjust a day for events, closures or buyouts.` : "No sales history yet — sync Square to start forecasting."}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {dates.map((d, i) => {
            const adj = forecast.adjustments.get(d);
            const closed = dayTotals[i] === 0 && !adj;
            return (
              <Card key={d} className={cx("p-3", closed && "bg-surface-2/50")}>
                <div className="text-xs text-muted">{dayDate(d)}</div>
                <div className="num mt-1 text-lg font-semibold">{closed ? <span className="text-muted">Closed</span> : qty(dayTotals[i], 0)}</div>
                <div className="text-xs text-muted">{closed ? "no history" : "food items"}</div>
                <form action={saveAdjustment.bind(null, d)} className="mt-2 flex items-center gap-1">
                  <Input name="pct" type="number" step="5" defaultValue={adj ? Math.round((adj - 1) * 100) : ""} placeholder="±%" className="num h-7 px-2 text-xs" aria-label={`Adjust ${d}`} />
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs">Set</Button>
                </form>
                {adj && <Badge tone={adj > 1 ? "good" : "warn"} className="mt-1.5">{adj > 1 ? "+" : ""}{Math.round((adj - 1) * 100)}%</Badge>}
              </Card>
            );
          })}
        </div>
      </Section>

      {forecast.items.length > 0 && (
        <Section title="Forecast by item">
          <Table>
            <thead><tr><Th>Item</Th>{dates.map((d) => <Th key={d} align="right" className="hidden md:table-cell">{dayDate(d).split(",")[0]}</Th>)}<Th align="right">Week</Th></tr></thead>
            <tbody>
              {forecast.items.map((it) => (
                <Tr key={it.recipeId}>
                  <Td className="font-medium">{it.name}</Td>
                  {it.days.map((d) => <Td key={d.date} align="right" className="hidden text-ink-2 md:table-cell">{d.qty < 0.5 ? "—" : qty(d.qty, 0)}</Td>)}
                  <Td align="right" className="font-medium">{qty(it.total, 0)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Section>
      )}

      <Section
        title="Square items"
        description="Link each Square item and modifier to a recipe so its sales drive costing and ordering."
        actions={
          <a href={show === "all" ? "/sales" : "/sales?show=all"} className="text-sm text-ink-2 hover:text-ink">
            {show === "all" ? `Only unlinked (${unmapped.length})` : `Show all (${mappings.length})`}
          </a>
        }
      >
        {listed.length === 0 ? (
          <Card className="p-5 text-sm text-muted">Every Square item is linked or ignored.</Card>
        ) : (
          <Table>
            <thead><tr><Th>Square item</Th><Th align="right" className="hidden sm:table-cell">Sold, 4 wks</Th><Th>Recipe</Th></tr></thead>
            <tbody>
              {listed.map((m) => (
                <Tr key={m.squareId}>
                  <Td>
                    <div className="font-medium">{m.squareName}</div>
                    <div className="text-xs text-muted">{m.squareType === "MODIFIER" ? "Modifier" : "Item"}</div>
                  </Td>
                  <Td align="right" className="hidden text-ink-2 sm:table-cell">{qty(sold.get(m.squareId) ?? 0, 0)}</Td>
                  <Td>
                    <GridSelect
                      value={m.ignored ? "__ignore" : m.recipeId ?? ""}
                      options={[
                        { value: "", label: "Not linked" },
                        { value: "__ignore", label: "Ignore (drinks, merch, gift cards)" },
                        ...recipes.map((r) => ({ value: r.id, label: `${r.name}${r.kind === "MODIFIER" ? " (add-on)" : ""}` })),
                      ]}
                      onSave={setSquareMapping.bind(null, m.squareId)}
                      ariaLabel={`Recipe for ${m.squareName}`}
                      className="max-w-64 border-border"
                    />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>
    </>
  );
}
