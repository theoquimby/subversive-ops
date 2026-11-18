import { EmptyState, PageHeader, Section, Stat, Table, Td, Th, Tr } from "@/components/ui";
import { WEEKDAYS } from "@/domain/dates";
import { HORIZONS, type GroupScore, type Score } from "@/domain/forecastScore";
import { WEATHER_KIND_HINT, WEATHER_KIND_LABEL, WEATHER_KINDS, type WeatherKind } from "@/domain/weatherHistory";
import { pct, qty, shortDate } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { forecastScorecard } from "@/server/services/forecastScore";
import { ScoreDaysTable, type DayRow } from "./days-table";
import { LoadWeather } from "./load-weather";

export const metadata = { title: "Forecast scorecard" };
/** Loading years of past weather takes several requests to NOAA. */
export const maxDuration = 60;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const dated = (d: string) => `${shortDate(d)}, ${d.slice(0, 4)}`;
const missTone = (w: number | null | undefined) => (w == null ? undefined : w <= 0.15 ? "good" : w <= 0.3 ? "warn" : "bad");
/** Too few days to read anything into. */
const THIN = 8;

function lean(b: number) {
  return Math.abs(b) < 0.02 ? "No lean" : `${pct(Math.abs(b), 0)} ${b > 0 ? "high" : "low"}`;
}

/** "Sales ran 8% under the forecast" for a group, from actual ÷ forecast. */
function ran(lift: number | null) {
  if (lift == null) return "—";
  return Math.abs(lift) < 0.02 ? "On forecast" : `${pct(Math.abs(lift), 0)} ${lift > 0 ? "over" : "under"}`;
}

function ScoreRow({ label, hint, s, lift }: { label: React.ReactNode; hint?: string; s: Score | null; lift?: number | null }) {
  const thin = !s || s.days < THIN;
  return (
    <Tr>
      <Td>
        <span className="font-medium text-ink">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </Td>
      <Td align="right" className="num text-ink-2">{s ? qty(s.days, 0) : "0"}</Td>
      {lift !== undefined && <Td align="right" className={`num ${thin ? "text-muted" : lift != null && Math.abs(lift) >= 0.08 ? "font-medium text-warn" : "text-ink-2"}`}>{ran(lift)}</Td>}
      <Td align="right" className={`num ${thin ? "text-muted" : "font-medium text-ink"}`}>{s ? pct(s.wape, 0) : "—"}</Td>
      <Td align="right" className="num hidden text-ink-2 sm:table-cell">{s ? pct(s.within15, 0) : "—"}</Td>
      <Td align="right" className="num hidden text-ink-2 sm:table-cell">{s ? lean(s.bias) : "—"}</Td>
    </Tr>
  );
}

function ScoreTable({ first, lift, children }: { first: string; lift?: boolean; children: React.ReactNode }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>{first}</Th>
          <Th align="right">Days</Th>
          {lift && <Th align="right">Sales ran</Th>}
          <Th align="right">Typical miss</Th>
          <Th align="right" className="hidden sm:table-cell">Within 15%</Th>
          <Th align="right" className="hidden sm:table-cell">Forecast leaned</Th>
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </Table>
  );
}

const find = (g: GroupScore[], key: string) => g.find((x) => x.key === key);

export default async function ScorecardPage() {
  await requireUser("MANAGER");
  const s = await forecastScorecard();
  const back = { href: "/sales", label: "Sales & forecast" };

  if (!s.all.f1) {
    return (
      <>
        <PageHeader help="sales.scorecard" title="Forecast scorecard" back={back} />
        <EmptyState title="Not enough sales history yet">The scorecard replays the forecast for every past open day. It needs about a month of sales from Square before the first days can be scored.</EmptyState>
      </>
    );
  }

  const a = s.all;
  const rows: DayRow[] = s.days.map((d) => ({ date: d.date, weekday: d.weekday, actual: d.actual, forecast: d.f1!, miss: d.f1! / d.actual - 1, weekAhead: d.f7, lastWeek: d.naive, weather: d.weather, event: d.event }));
  const weatherDays = s.days.filter((d) => d.weather != null).length;
  const worstWeather = s.byWeather.filter((g) => g.key !== "fair" && (g.score?.days ?? 0) >= THIN && g.lift != null).sort((x, y) => Math.abs(y.lift!) - Math.abs(x.lift!))[0];

  return (
    <>
      <PageHeader
        help="sales.scorecard"
        title="Forecast scorecard"
        back={back}
        description={`How close the sales forecast has been, on ${qty(a.f1!.days, 0)} open days from ${dated(a.from!)} to ${dated(a.to!)}. Each day is forecast again using only what was known the evening before, then compared with what sold.`}
      />

      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4 [&>[data-help-zone]>*]:h-full">
        <Stat help="sales.scorecard.miss" label="Typical daily miss" value={pct(a.f1!.wape, 0)} tone={missTone(a.f1!.wape)} hint={`of the day's sales, over all ${qty(a.f1!.days, 0)} days`} />
        <Stat help="sales.scorecard.miss" label="Lately" value={s.recent.f1 ? pct(s.recent.f1.wape, 0) : "—"} tone={missTone(s.recent.f1?.wape)} hint={s.recent.f1 ? `the last 90 days (${s.recent.f1.days} open days)` : "no open days in the last 90"} />
        <Stat
          help="sales.scorecard.skill"
          label="Against last week"
          value={a.skill == null ? "—" : Math.abs(a.skill) < 0.02 ? "About the same" : `${pct(Math.abs(a.skill), 0)} ${a.skill > 0 ? "closer" : "worse"}`}
          tone={a.skill == null ? undefined : a.skill > 0.05 ? "good" : a.skill < -0.05 ? "bad" : undefined}
          hint="than repeating the same day last week"
        />
        <Stat help="sales.scorecard.within" label="Within 15% of actual" value={pct(a.f1!.within15, 0)} hint={Math.abs(a.f1!.bias) < 0.02 ? "of days · no lean high or low" : `of days · the forecast leaned ${lean(a.f1!.bias)}`} />
      </div>

      <Section help="sales.scorecard.ahead" title="How far ahead" description="Schedules and orders are set days ahead, so the forecast has to hold up before the last week's sales are in.">
        <ScoreTable first="Forecast made">
          {HORIZONS.map((h) => <ScoreRow key={h.model} label={h.label} s={a[h.model]} />)}
          <ScoreRow label="Same day last week" hint="The plain yardstick" s={a.naive} />
        </ScoreTable>
      </Section>

      <Section
        help="sales.scorecard.weather"
        title="By weather"
        description={
          worstWeather
            ? `Past forecasts are replayed without weather, so this shows what weather does to sales here: on ${WEATHER_KIND_LABEL[worstWeather.key as WeatherKind].toLowerCase()} days, sales ran ${ran(worstWeather.lift).toLowerCase()} the forecast.`
            : "Past forecasts are replayed without weather, so this shows what weather does to sales here."
        }
      >
        <ScoreTable first="The day was" lift>
          {WEATHER_KINDS.map((k) => {
            const g = find(s.byWeather, k);
            return g ? <ScoreRow key={k} label={WEATHER_KIND_LABEL[k]} hint={WEATHER_KIND_HINT[k]} s={g.score} lift={g.lift} /> : null;
          })}
        </ScoreTable>
        <p className="mt-2 text-xs text-muted">
          Past weather is NOAA&apos;s record at {s.weather.station}, about 35 miles north (US government data, free to use). It&apos;s on file for {qty(weatherDays, 0)} of the {qty(s.days.length, 0)} scored days, and runs about five days behind. Past days have the whole day&apos;s rain, not the hours it fell. Groups with fewer than {THIN} days are greyed: too few to read anything into.
        </p>
        {s.weather.onFile < s.weather.wanted && (
          <div className="mt-3">
            <LoadWeather missing={s.weather.wanted - s.weather.onFile} />
          </div>
        )}
      </Section>

      <Section help="sales.scorecard.groups" title="By weekday">
        <ScoreTable first="Weekday" lift>
          {s.byWeekday.map((g) => <ScoreRow key={g.key} label={WEEKDAYS[Number(g.key)]} s={g.score} lift={g.lift} />)}
        </ScoreTable>
      </Section>

      <Section help="sales.scorecard.groups" title="Event days" description="Days with something on the Events calendar, or a manual change to the forecast, against ordinary days.">
        <ScoreTable first="Days with" lift>
          <ScoreRow label="Nothing on the calendar" s={find(s.byEvent, "normal")?.score ?? null} lift={find(s.byEvent, "normal")?.lift ?? null} />
          <ScoreRow label="An event or a manual change" s={find(s.byEvent, "event")?.score ?? null} lift={find(s.byEvent, "event")?.lift ?? null} />
        </ScoreTable>
      </Section>

      <Section help="sales.scorecard.groups" title="By month" description="Every year on file together. A month where sales run well over or under the forecast is a season the method is slow to pick up.">
        <ScoreTable first="Month" lift>
          {s.byMonth.map((g) => <ScoreRow key={g.key} label={MONTHS[Number(g.key) - 1]} s={g.score} lift={g.lift} />)}
        </ScoreTable>
      </Section>

      <Section
        help="sales.scorecard.logged"
        title="Forecasts as they were made"
        description="From now on each night's forecast is kept exactly as it was, weather and all, and scored against what then sells. This is the honest test of any change to the method."
      >
        {s.logged.dayBefore || s.logged.weekAhead ? (
          <ScoreTable first={`Kept since ${s.logged.since ? dated(s.logged.since) : "—"}`}>
            <ScoreRow label="The day before" s={s.logged.dayBefore} />
            <ScoreRow label="A week ahead" s={s.logged.weekAhead} />
          </ScoreTable>
        ) : (
          <p className="text-sm text-ink-2">{s.logged.since ? `Kept since ${dated(s.logged.since)}. The first scores show once those days have sold.` : "Starts tonight. The first scores show after a day or two."}</p>
        )}
      </Section>

      <Section help="sales.scorecard.days" title="Every scored day" description="What was forecast the evening before, and what sold. Sort by Forecast was to see the biggest misses.">
        <ScoreDaysTable rows={rows} />
        {s.dailyOnly > 0 && <p className="mt-2 text-xs text-muted">{qty(s.dailyOnly, 0)} older days come from item sales, from before hourly sales were kept.</p>}
      </Section>
    </>
  );
}
