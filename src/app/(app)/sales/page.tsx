import { HelpZone } from "@/components/help";
import { ForecastRanges } from "@/app/(app)/insights/forecast-ranges";
import { Chapter, Verdict } from "@/components/chapter";
import { Card, LinkButton, PageHeader, Section, Table, Td, Th, Tr } from "@/components/ui";
import { addDays, dateRange, daysBetween, weekday } from "@/domain/dates";
import { forecastTrust, weeklyScores } from "@/domain/forecastTrust";
import { HOLIDAY_LABEL } from "@/domain/holidays";
import { EFFECT_FAR_DAYS } from "@/domain/weatherEffect";
import { WEATHER_KIND_LABEL } from "@/domain/weatherHistory";
import { tintStep, usualByWeekday, weekOutlook, type OutlookDay } from "@/domain/weekOutlook";
import { businessDateOf, dayDate, money, pct, qty, relativeTime, shortDate, signedPct } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { isSquareConnected } from "@/server/services/square";
import Link from "next/link";
import { refreshIfStale } from "@/server/services/square-sync";
import { forecastItems } from "@/server/services/planning";
import { businessToday, lastSquareSync } from "@/server/services/sales";
import { Suspense } from "react";
import { SquareItemsSection, SquareItemsSkeleton } from "./square-items-section";
import { dailySalesHistory, demandDrivers, hourlySalesForecast, location, refreshWeather, storedMethod, weatherLabel, weatherMap, weatherStatus, type DayDrivers } from "@/server/services/forecasting";
import { ensureWeatherEffects, storedAccuracy } from "@/server/services/forecastScore";
import { after } from "next/server";
import { CalDay, ForecastCalendar } from "./forecast-calendar";
import { WeekColumns } from "./week-columns";
import { Bars } from "./bars";
import { SyncButtons } from "./sync-buttons";
import { ArrowRight } from "lucide-react";

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const toF = (c: number) => Math.round((c * 9) / 5 + 32);
const whole = (n: number) => money(n, { whole: true });
const LEVEL_COLOR = { trust: "var(--good)", guide: "var(--warn)", rough: "var(--bad)" } as const;

export const metadata = { title: "Sales & forecast" };

/** What makes a day different from a usual one, in a few words; null on an ordinary day. */
function whyOf(d: DayDrivers): string | null {
  if (d.events.some((e) => e.kind === "CLOSURE")) return d.events.find((e) => e.kind === "CLOSURE")!.title;
  if (d.holiday && (d.holidayFactor !== 1 || d.holiday.closed)) return HOLIDAY_LABEL[d.holiday.kind];
  const ev = d.events.find((e) => e.impact !== 1);
  if (ev) return ev.title;
  if (d.manual !== 1) return d.reason ?? "Your adjustment";
  if (d.weatherFactor !== 1 && d.weatherKind) return `${WEATHER_KIND_LABEL[d.weatherKind]} weather`;
  return null;
}

export default async function SalesPage() {
  await requireUser("MANAGER");
  const today = businessToday();
  const dates = dateRange(today, addDays(today, 7));
  const calStart = addDays(today, -weekday(today));
  const calEnd = addDays(calStart, 35);
  const calDates = dateRange(calStart, calEnd);
  const pastDates = calDates.filter((d) => d < today);

  // Weather self-throttles. With nothing for today, wait for it (8s cap); otherwise refresh after responding.
  const [todayWeather] = await Promise.all([weatherMap(today, addDays(today, 1)), refreshIfStale()]);
  const haveToday = todayWeather.size > 0;
  if (!haveToday) await refreshWeather();
  else after(() => refreshWeather().then(() => undefined, () => undefined));
  // What weather and online interest do to sales, and how far to trust the forecast, are learned nightly;
  // this catches a first run or a missed night.
  after(() => ensureWeatherEffects());

  const [connected, lastSync, forecast, hourly, actuals, pastDrivers, stored, weather, wStatus, loc, method] = await Promise.all([
    isSquareConnected(),
    lastSquareSync(),
    forecastItems(dates),
    hourlySalesForecast(calDates.filter((d) => d >= today)),
    dailySalesHistory(calStart, today),
    demandDrivers(pastDates),
    storedAccuracy(),
    weatherMap(calStart, calEnd),
    weatherStatus(),
    location(),
    storedMethod(),
  ]);

  const byDate = new Map(hourly.map((h) => [h.date, h]));
  const closedOn = (f: (typeof hourly)[number]) => f.drivers.eventFactor === 0 || f.samples === 0 || f.drivers.holidayFactor === 0;
  // A usual day of each weekday, as the forecast sees it now, to shade every calendar day against.
  const usualWd = usualByWeekday(hourly.map((h) => ({ date: h.date, usual: h.samples > 0 ? h.baseline : 0 })));
  const replayByDate = new Map((stored?.days ?? []).map((r) => [r.date, r.forecast]));
  // A past day with no sales is closed only if sales came in after it; otherwise it just isn't in yet.
  const syncedThrough = lastSync ? businessDateOf(lastSync) : null;
  const lastSold = [...actuals.openDays].sort().at(-1) ?? null;
  const notInYet = (date: string) => !actuals.openDays.has(date) && (lastSold == null || date > lastSold) && (syncedThrough == null || syncedThrough <= date);
  const days: CalDay[] = calDates.map((date) => {
    const f = byDate.get(date);
    const drivers = f?.drivers ?? pastDrivers.get(date)!;
    const w = weather.get(date);
    const past = date < today;
    const actual = past && actuals.openDays.has(date) ? actuals.sales.get(date) ?? 0 : null;
    const missing = past && notInYet(date);
    const closed = past ? !actuals.openDays.has(date) && !missing : !!f && closedOn(f);
    const usual = usualWd.get(weekday(date)) ?? null;
    const value = past ? actual : f ? f.qty : null;
    return {
      date,
      dayOfMonth: Number(date.slice(8)),
      weekdayName: WEEKDAY_NAMES[weekday(date)],
      past,
      today: date === today,
      closed,
      missing,
      forecast: f ? f.qty : null,
      actual,
      backtest: past ? replayByDate.get(date) ?? null : null,
      usual,
      tint: closed ? null : tintStep(value, usual),
      baseline: f?.baseline ?? 0,
      samples: f?.samples ?? 0,
      capped: !!method?.refined,
      trend: f?.trend ?? 1,
      seasonal: f?.seasonal ?? 1,
      orders: f?.orders ?? null,
      orderHours: f?.orderHours ?? null,
      manual: drivers.manual,
      reason: drivers.reason,
      eventFactor: drivers.eventFactor,
      weatherFactor: drivers.weatherFactor,
      weatherKind: drivers.weatherKind,
      weatherDays: drivers.weatherDays,
      weatherFar: daysBetween(today, date) >= EFFECT_FAR_DAYS,
      onlineFactor: drivers.onlineFactor,
      holidayFactor: drivers.holidayFactor,
      holiday: drivers.holiday ? { label: HOLIDAY_LABEL[drivers.holiday.kind], days: drivers.holiday.days, closed: drivers.holiday.closed, used: drivers.holiday.used } : null,
      events: drivers.events,
      weather: w ? { ...weatherLabel(w.code), highF: toF(w.tempMaxC), lowF: toF(w.tempMinC), precipMm: Math.round(w.precipMm) } : null,
      hours: f?.hours ?? [],
      shapeLearned: f?.shapeLearned ?? false,
    };
  });
  const upcomingWeather = calDates.some((d) => d >= today && weather.has(d));
  const weatherNote = !upcomingWeather
    ? `Weather unavailable${wStatus.error ? ` (${wStatus.error.toLowerCase()})` : ""}, so the forecast assumes a normal day.`
    : wStatus.error
      ? `Weather couldn't update just now; showing the last forecast we have for ${loc.label}.`
      : `Weather for ${loc.label} from the National Weather Service${wStatus.lastOk ? `, updated ${relativeTime(new Date(wStatus.lastOk))}` : ""}. Rain, snow, heat and cold are factored in where they've measurably moved sales here.`;

  // The coming week against a usual one.
  const week = hourly.filter((h) => h.date < addDays(today, 7));
  const outlookDays: OutlookDay[] = week.map((h) => ({ date: h.date, forecast: h.qty, usual: h.samples > 0 ? h.baseline : 0, closed: closedOn(h), why: whyOf(h.drivers) }));
  const outlook = weekOutlook(outlookDays);
  const next28 = hourly.filter((h) => h.date < addDays(today, 28)).reduce((s, h) => s + (closedOn(h) ? 0 : h.qty), 0);
  const seasonalOn = week.some((h) => h.seasonal !== 1);
  const anyOrders = week.some((h) => h.orders != null);

  // How far to trust it: the scorecard's own measure, kept from the nightly replay.
  const trust = stored ? forecastTrust({ recent: stored.recent, all: stored.all, avgDay: stored.avgDay }) : null;
  const weeks = stored ? weeklyScores(stored.days, 4) : [];
  const lastWeek = weeks.at(-1);

  return (
    <>
      <PageHeader
        help="sales.page"
        title="Sales & forecast"
        description={connected
          ? <><Link href="/settings/square" className="underline-offset-2 hover:text-ink hover:underline">{lastSync ? `Square synced ${relativeTime(lastSync)}` : "Square connected · first sync pending"}</Link> · keeps itself up to date through the day</>
          : <>Square not connected. <Link href="/settings/square" className="font-medium text-ink underline-offset-2 hover:underline">Connect it</Link> to bring in sales.</>}
        actions={<HelpZone id="sales.sync"><SyncButtons configured={connected} /></HelpZone>}
      />

      {forecast.hasHistory ? (
        <HelpZone id="sales.next7">
          <Verdict
            title={outlook.headline}
            line={outlook.line}
            stats={[
              { label: "Next 7 days", value: whole(outlook.total), hint: outlook.usual > 0 ? `a usual week is ${whole(outlook.usual)}` : undefined },
              { label: "Next 4 weeks", value: whole(next28), hint: "forecast sales" },
              trust
                ? { label: "How far to trust it", value: trust.label, hint: <>{trust.short} <Link href="/sales/scorecard" className="underline underline-offset-2 hover:text-ink">Scorecard</Link></>, tone: trust.tone }
                : { label: "How far to trust it", value: "Can't tell yet", hint: "The scorecard replays past days overnight; it shows here after the first run.", tone: "unknown" },
            ]}
            numbers={
              <>
                <Table>
                  <thead>
                    <tr>
                      <Th>Day</Th>
                      <Th align="right">Forecast</Th>
                      <Th align="right" className="hidden sm:table-cell">A usual day</Th>
                      <Th align="right">Orders</Th>
                      <Th align="right" className="hidden sm:table-cell">Average check</Th>
                      {seasonalOn && <Th align="right" className="hidden md:table-cell">Season</Th>}
                    </tr>
                  </thead>
                  <tbody>
                    {week.map((d) => (
                      <Tr key={d.date}>
                        <Td className="num">{dayDate(d.date)}</Td>
                        <Td align="right">{closedOn(d) ? <span className="text-muted">Closed</span> : whole(d.qty)}</Td>
                        <Td align="right" className="hidden text-ink-2 sm:table-cell">{d.samples > 0 ? whole(d.baseline) : "—"}</Td>
                        <Td align="right">{d.orders == null || closedOn(d) ? <span className="text-muted">—</span> : Math.round(d.orders)}</Td>
                        <Td align="right" className="hidden sm:table-cell">{d.orders && !closedOn(d) ? money(d.qty / d.orders) : <span className="text-muted">—</span>}</Td>
                        {seasonalOn && <Td align="right" className="hidden md:table-cell">{signedPct(d.seasonal - 1, 0)}</Td>}
                      </Tr>
                    ))}
                  </tbody>
                </Table>
                <p className="mt-2 text-xs text-muted">
                  {seasonalOn ? "Season is how the same weeks last year compared with the weeks around them." : "The seasonal swing switches on once there's a year of sales on file; until then the forecast follows recent weeks."}
                  {!anyOrders && " Order counts appear once hourly sales have synced from Square."}
                </p>
              </>
            }
          >
            <WeekColumns
              days={week.map((d) => ({ date: d.date, label: WEEKDAY_NAMES[weekday(d.date)].slice(0, 3), forecast: closedOn(d) ? 0 : d.qty, usual: d.samples > 0 ? d.baseline : null, closed: closedOn(d), why: whyOf(d.drivers) }))}
              mark={outlook.busiest?.date ?? null}
            />
            <div className="mt-5 flex gap-2.5 rounded-lg bg-surface-2 px-3.5 py-3 text-sm text-ink">
              <ArrowRight aria-hidden className="mt-0.5 size-4 shrink-0 text-muted" />
              <p className="max-w-2xl font-medium">{outlook.action}</p>
            </div>
          </Verdict>
        </HelpZone>
      ) : (
        <Card className="mb-4 p-5 text-sm text-ink-2">No sales history yet. Sync Square to start forecasting.</Card>
      )}

      <nav aria-label="More on sales" className="mb-8 grid gap-3 sm:grid-cols-2">
        <Link href="/sales/scorecard" className="group flex min-h-14 items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 transition-colors duration-120 hover:border-border-strong">
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-ink">Forecast scorecard</span>
            <span className="block text-xs text-muted">Every past day scored, and where the forecast goes wrong</span>
          </span>
          <ArrowRight aria-hidden className="size-4 shrink-0 text-muted group-hover:text-ink" />
        </Link>
        <Link href="/sales/customers" className="group flex min-h-14 items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 transition-colors duration-120 hover:border-border-strong">
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-ink">Customers</span>
            <span className="block text-xs text-muted">Who comes back, and who has stopped coming</span>
          </span>
          <ArrowRight aria-hidden className="size-4 shrink-0 text-muted group-hover:text-ink" />
        </Link>
      </nav>

      <Section
        help="sales.forecast5w"
        title="Forecast"
        description={forecast.hasHistory ? "Sales per day for the next five weeks. Tap a day for the hourly shape, why it says what it says, and to adjust it." : "No sales history yet. Sync Square to start forecasting."}
        actions={<Link href="/events" className="relative text-sm whitespace-nowrap text-ink-2 after:absolute after:-inset-2 after:content-[''] hover:text-ink">Events →</Link>}
      >
        <ForecastCalendar days={days} weatherNote={weatherNote} />
      </Section>

      <div className="mb-10 empty:hidden"><ForecastRanges /></div>

      <HelpZone id="sales.accuracyWeeks" className="mb-10 block">
        {trust ? (
          <Chapter
            id="accuracy"
            point={{
              tone: trust.tone,
              title: trust.headline,
              detail: trust.line,
              action: lastWeek?.miss != null ? `Last week it was off by ${pct(lastWeek.miss, 0)} on a typical day. The scorecard says where it goes wrong and what to do about it.` : "The scorecard says where it goes wrong and what to do about it.",
            }}
            title={trust.headline}
            numbers={
              <>
                <Table>
                  <thead>
                    <tr><Th>Week of</Th><Th align="right">Forecast</Th><Th align="right">Sold</Th><Th align="right" className="hidden sm:table-cell">Difference</Th><Th align="right">Typical miss</Th></tr>
                  </thead>
                  <tbody>
                    {weeks.map((w) => (
                      <Tr key={w.from}>
                        <Td className="font-medium">{shortDate(w.from)}</Td>
                        <Td align="right">{whole(w.forecast)}</Td>
                        <Td align="right">{whole(w.actual)}</Td>
                        <Td align="right" className="hidden text-ink-2 sm:table-cell">{w.actual ? signedPct(w.forecast / w.actual - 1, 0) : "—"}</Td>
                        <Td align="right">{w.miss == null ? "—" : pct(w.miss, 0)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
                <h4 className="mt-5 mb-1 text-sm font-medium text-ink">Each day</h4>
                <Table>
                  <thead>
                    <tr><Th>Day</Th><Th align="right">Forecast</Th><Th align="right">Sold</Th><Th align="right">Miss</Th></tr>
                  </thead>
                  <tbody>
                    {[...(stored?.days ?? [])].reverse().slice(0, 28).map((r) => (
                      <Tr key={r.date}>
                        <Td>{dayDate(r.date)}</Td>
                        <Td align="right" className="text-ink-2">{whole(r.forecast)}</Td>
                        <Td align="right">{whole(r.actual)}</Td>
                        <Td align="right" className="text-ink-2">{signedPct(r.forecast / r.actual - 1, 0)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
                <p className="mt-2 text-xs text-muted">Each open day forecast again as it would have been made the evening before, scored the way the scorecard scores it: the total miss over the total sold. Closed days aren&apos;t scored.</p>
              </>
            }
          >
            {weeks.length > 0 && (
              <>
                <h4 className="mb-3 text-sm font-medium text-ink">A typical day&apos;s miss, week by week</h4>
                <Bars
                  ariaLabel="A typical day's miss in each of the last four weeks"
                  rows={weeks.map((w, i) => ({ key: w.from, label: `Week of ${shortDate(w.from)}`, value: w.miss, display: w.miss == null ? "—" : `${pct(w.miss, 0)} off`, color: w.level ? LEVEL_COLOR[w.level] : undefined, mark: i === weeks.length - 1 }))}
                  max={0.3}
                />
                <p className="mt-2 text-xs text-muted">Within 15% is solid, up to 30% needs a cushion, beyond that is a rough guide.</p>
              </>
            )}
            <div className="mt-4">
              <LinkButton href="/sales/scorecard" size="sm">Open the scorecard</LinkButton>
            </div>
          </Chapter>
        ) : (
          <Card className="p-5 text-sm text-muted">How far to trust the forecast shows here once the scorecard has replayed past days, overnight or on its first visit.</Card>
        )}
      </HelpZone>

      {forecast.items.length > 0 && (
        <Section help="sales.forecastByItem" title="Forecast by item" description="Next 7 days, in portions, with events, weather and your adjustments in.">
          <Table sticky>
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

      {/* Linking coverage reads every item's sales, so it streams in after the forecast. */}
      <Suspense fallback={<SquareItemsSkeleton />}>
        <SquareItemsSection />
      </Suspense>
    </>
  );
}
