import { Card, PageHeader, Section, Stat, Table, Td, Th, Tr } from "@/components/ui";
import { addDays, dateRange, weekday } from "@/domain/dates";
import { dayDate, money, qty, relativeTime, shortDate, signedPct } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { isSquareConnected } from "@/server/services/square";
import { refreshIfStale } from "@/server/services/square-sync";
import { forecastItems } from "@/server/services/planning";
import { businessToday, lastSquareSync, squareCatalogMeta } from "@/server/services/sales";
import { GridSelect } from "@/components/grid";
import { setSquareMapping } from "@/server/actions/inline";
import { dailySalesHistory, demandDrivers, forecastAccuracy, hourlySalesForecast, location, refreshWeather, weatherLabel, weatherMap, weatherStatus } from "@/server/services/forecasting";
import { after } from "next/server";
import { CalDay, ForecastCalendar } from "./forecast-calendar";
import { DemandOutlook } from "./demand-outlook";
import { SyncButtons } from "./sync-buttons";

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const toF = (c: number) => Math.round((c * 9) / 5 + 32);

export const metadata = { title: "Sales & forecast" };

export default async function SalesPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  await requireUser("MANAGER");
  const { show } = await searchParams;
  await refreshIfStale();
  const today = businessToday();
  const dates = dateRange(today, addDays(today, 7));
  const calStart = addDays(today, -weekday(today));
  const calEnd = addDays(calStart, 35);
  const calDates = dateRange(calStart, calEnd);
  const pastDates = calDates.filter((d) => d < today);

  // Weather self-throttles. With nothing for today, wait for it (8s cap); otherwise refresh after responding.
  const haveToday = (await weatherMap(today, addDays(today, 1))).size > 0;
  if (!haveToday) await refreshWeather();
  else after(() => refreshWeather().then(() => undefined, () => undefined));

  const [connected, catalogMeta, lastSync, mappings, recipes, forecast, volume, hourly, actuals, pastDrivers, accuracy, weather, wStatus, loc] = await Promise.all([
    isSquareConnected(),
    squareCatalogMeta(),
    lastSquareSync(),
    db.squareMapping.findMany({ orderBy: [{ ignored: "asc" }, { squareName: "asc" }], include: { recipe: { select: { name: true } } } }),
    db.recipe.findMany({ where: { active: true, kind: { in: ["MENU", "MODIFIER"] } }, select: { id: true, name: true, kind: true }, orderBy: { name: "asc" } }),
    forecastItems(dates),
    db.dailySale.groupBy({ by: ["squareId"], _sum: { qty: true }, where: { date: { gte: new Date(`${addDays(today, -28)}T00:00:00Z`) } } }),
    hourlySalesForecast(calDates.filter((d) => d >= today)),
    dailySalesHistory(calStart, today),
    demandDrivers(pastDates),
    forecastAccuracy(28),
    weatherMap(calStart, calEnd),
    weatherStatus(),
    location(),
  ]);
  const sold = new Map(volume.map((v) => [v.squareId, v._sum.qty?.toNumber() ?? 0]));
  const unmapped = mappings.filter((m) => !m.recipeId && !m.ignored);
  const listed = (show === "all" ? mappings : unmapped).sort((a, b) => (sold.get(b.squareId) ?? 0) - (sold.get(a.squareId) ?? 0));

  const byDate = new Map(hourly.map((h) => [h.date, h]));
  const backtestByDate = new Map(accuracy.rows.map((r) => [r.date, r.forecast]));
  const days: CalDay[] = calDates.map((date) => {
    const f = byDate.get(date);
    const drivers = f?.drivers ?? pastDrivers.get(date)!;
    const w = weather.get(date);
    const past = date < today;
    const actual = past ? actuals.sales.get(date) ?? 0 : null;
    const closed = past ? !actuals.openDays.has(date) : !!f && (f.drivers.eventFactor === 0 || f.samples === 0);
    return {
      date,
      dayOfMonth: Number(date.slice(8)),
      weekdayName: WEEKDAY_NAMES[weekday(date)],
      past,
      today: date === today,
      closed,
      forecast: f ? f.qty : null,
      actual,
      backtest: past ? backtestByDate.get(date) ?? null : null,
      baseline: f?.baseline ?? 0,
      samples: f?.samples ?? 0,
      trend: f?.trend ?? 1,
      seasonal: f?.seasonal ?? 1,
      orders: f?.orders ?? null,
      orderHours: f?.orderHours ?? null,
      manual: drivers.manual,
      reason: drivers.reason,
      eventFactor: drivers.eventFactor,
      weatherFactor: drivers.weatherFactor,
      rain: drivers.rain,
      events: drivers.events,
      weather: w ? { ...weatherLabel(w.code), highF: toF(w.tempMaxC), lowF: toF(w.tempMinC), precipMm: Math.round(w.precipMm) } : null,
      hours: f?.hours ?? [],
      shapeLearned: f?.shapeLearned ?? false,
    };
  });
  const upcomingWeather = calDates.some((d) => d >= today && weather.has(d));
  const weatherNote = !upcomingWeather
    ? `Weather unavailable${wStatus.error ? ` (${wStatus.error.toLowerCase()})` : ""} — forecasts assume a normal day.`
    : wStatus.error
      ? `Weather couldn't update just now; showing the last forecast we have for ${loc.label}.`
      : `Weather for ${loc.label} from Open-Meteo${wStatus.lastOk ? `, updated ${relativeTime(new Date(wStatus.lastOk))}` : ""}. Rain is factored in by how much it has slowed sales here before.`;

  const next7 = hourly.filter((h) => h.date < addDays(today, 7)).reduce((s, h) => s + h.qty, 0);
  const next28 = hourly.filter((h) => h.date < addDays(today, 28)).reduce((s, h) => s + h.qty, 0);
  const weeks = [0, 1, 2, 3].map((k) => {
    const rows = accuracy.rows.slice(k * 7, k * 7 + 7);
    const open = rows.filter((r) => r.open);
    const errs = rows.map((r) => r.error).filter((e): e is number => e != null);
    return {
      from: rows[0]?.date,
      forecast: open.reduce((s, r) => s + r.forecast, 0),
      actual: open.reduce((s, r) => s + r.actual, 0),
      mape: errs.length ? errs.reduce((s, e) => s + Math.abs(e), 0) / errs.length : null,
    };
  }).filter((w) => w.from);

  return (
    <>
      <PageHeader
        title="Sales & forecast"
        description={connected ? `Square synced ${relativeTime(lastSync)} · keeps itself up to date through the day` : "Square isn't connected yet — connect it to bring in sales."}
        actions={<SyncButtons configured={connected} />}
      />

      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Next 7 days" value={money(next7, { whole: true })} hint="forecast sales" />
        <Stat label="Next 4 weeks" value={money(next28, { whole: true })} hint="forecast sales" />
        <Stat
          label="Forecast accuracy"
          value={accuracy.mape == null ? "—" : `${Math.round(accuracy.mape * 100)}%`}
          hint={accuracy.mape == null ? "needs a few weeks of sales" : "average daily miss, last 4 weeks"}
          tone={accuracy.mape == null ? undefined : accuracy.mape <= 0.15 ? "good" : accuracy.mape <= 0.3 ? "warn" : "bad"}
        />
        <Stat label="Bias" value={accuracy.bias == null ? "—" : signedPct(accuracy.bias, 0)} hint={accuracy.bias == null ? "" : accuracy.bias > 0.02 ? "we forecast a little high" : accuracy.bias < -0.02 ? "we forecast a little low" : "no lean either way"} />
      </div>

      <Section
        title="Forecast"
        description={forecast.hasHistory ? "Sales per day for the next five weeks. Tap a day to see the hourly shape, why it says what it says, and to adjust it." : "No sales history yet — sync Square to start forecasting."}
        actions={<a href="/events" className="text-sm whitespace-nowrap text-ink-2 hover:text-ink">Events →</a>}
      >
        <ForecastCalendar days={days} weatherNote={weatherNote} />
        <div className="mt-6"><DemandOutlook /></div>
      </Section>

      <Section title="How the forecast did" description="Each of the last four weeks, forecast as it would have been made the day before, against what we actually sold.">
        {weeks.length === 0 || accuracy.mape == null ? (
          <Card className="p-5 text-sm text-muted">Accuracy shows up once there are a few weeks of sales history.</Card>
        ) : (
          <>
            <Table>
              <thead>
                <tr><Th>Week of</Th><Th align="right">Forecast</Th><Th align="right">Actual</Th><Th align="right" className="hidden sm:table-cell">Difference</Th><Th align="right">Daily miss</Th></tr>
              </thead>
              <tbody>
                {weeks.map((w) => (
                  <Tr key={w.from}>
                    <Td className="font-medium">{shortDate(w.from!)}</Td>
                    <Td align="right">{money(w.forecast, { whole: true })}</Td>
                    <Td align="right">{money(w.actual, { whole: true })}</Td>
                    <Td align="right" className="hidden text-ink-2 sm:table-cell">{w.actual ? signedPct(w.forecast / w.actual - 1, 0) : "—"}</Td>
                    <Td align="right" className={w.mape == null ? "" : w.mape <= 0.15 ? "text-good" : w.mape <= 0.3 ? "text-warn" : "text-bad"}>{w.mape == null ? "—" : `${Math.round(w.mape * 100)}%`}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <details className="group mt-3">
              <summary className="cursor-pointer text-sm text-ink-2 select-none hover:text-ink">Show each day</summary>
              <Table className="mt-3">
                <thead>
                  <tr><Th>Day</Th><Th align="right">Forecast</Th><Th align="right">Actual</Th><Th align="right">Miss</Th></tr>
                </thead>
                <tbody>
                  {[...accuracy.rows].reverse().map((r) => (
                    <Tr key={r.date}>
                      <Td>{dayDate(r.date)}</Td>
                      <Td align="right" className="text-ink-2">{r.open ? money(r.forecast, { whole: true }) : "—"}</Td>
                      <Td align="right">{r.open ? money(r.actual, { whole: true }) : <span className="text-muted">Closed</span>}</Td>
                      <Td align="right" className={r.error == null ? "text-muted" : Math.abs(r.error) <= 0.15 ? "text-ink-2" : "text-warn"}>{r.error == null ? "—" : signedPct(r.error, 0)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </details>
          </>
        )}
      </Section>

      {forecast.items.length > 0 && (
        <Section title="Forecast by item" description="Next 7 days, in portions — events, weather and your adjustments included.">
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
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <a href="/sales/square-menu" className="text-sm font-medium whitespace-nowrap text-ink hover:underline">Menu from Square →</a>
            <a href={show === "all" ? "/sales" : "/sales?show=all"} className="text-sm whitespace-nowrap text-ink-2 hover:text-ink">
              {show === "all" ? `Only unlinked (${unmapped.length})` : `Show all (${mappings.length})`}
            </a>
          </div>
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
                    <div className="text-xs text-muted">
                      {m.squareType === "MODIFIER" ? "Modifier" : "Item"}
                      {catalogMeta[m.squareId]?.price != null && ` · ${money(catalogMeta[m.squareId].price)}`}
                      {catalogMeta[m.squareId]?.deleted ? " · removed from Square" : catalogMeta[m.squareId]?.archived ? " · archived in Square" : ""}
                    </div>
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
