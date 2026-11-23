import { Chapter, InShort, Verdict, type Finding } from "@/components/chapter";
import { Fold } from "@/components/fold";
import { Badge, Card, EmptyState, PageHeader, Section, Table, Td, Th, Tr } from "@/components/ui";
import { WEEKDAYS } from "@/domain/dates";
import { HORIZONS, type GroupScore, type Score } from "@/domain/forecastScore";
import { forecastStory, type StoryPoint } from "@/domain/forecastStory";
import { weeklyScores } from "@/domain/forecastTrust";
import { HOLIDAY_HINT, HOLIDAY_LABEL } from "@/domain/holidays";
import { linkWord, onlineFactor, SIGNAL_MIN_SCORED, SIGNAL_NEAR_DAYS, SIGNAL_WARMUP, SIGNAL_WEEK_DAYS, type SignalResult } from "@/domain/leadSignals";
import { WEATHER_KIND_HINT, WEATHER_KIND_LABEL, WEATHER_KINDS } from "@/domain/weatherHistory";
import { money, pct, qty, shortDate, signedPct } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { forecastScorecard, learnedIsStale, saveLearned } from "@/server/services/forecastScore";
import Link from "next/link";
import { after } from "next/server";
import { ScoreDaysTable, type DayRow } from "./days-table";
import { LoadWeather } from "./load-weather";
import { Bars } from "../bars";

export const metadata = { title: "Forecast scorecard" };
/** Loading years of past weather takes several requests to NOAA. */
export const maxDuration = 60;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const dated = (d: string) => `${shortDate(d)}, ${d.slice(0, 4)}`;
/** Too few days to read anything into. */
const THIN = 8;

const LEVEL = {
  trust: { label: "Solid", tone: "good" },
  guide: { label: "Use with a cushion", tone: "warn" },
  rough: { label: "Rough guide", tone: "bad" },
} as const;
const LEVEL_COLOR = { trust: "var(--good)", guide: "var(--warn)", rough: "var(--bad)" } as const;
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** "12% under" / "8% over": sales against the forecast, for a bar's label. */
const liftWords = (l: number | null) => (l == null ? "—" : Math.abs(l) < 0.02 ? "On forecast" : `${pct(Math.abs(l), 0)} ${l > 0 ? "over" : "under"}`);
const asFinding = (p: StoryPoint): Finding => ({ tone: p.tone, title: p.title, detail: p.detail, action: p.action });

function lean(b: number) {
  return Math.abs(b) < 0.02 ? "No lean" : `${pct(Math.abs(b), 0)} ${b > 0 ? "high" : "low"}`;
}

/** "8% under" for a group, from actual ÷ forecast. */
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
      <Td align="right" className={`num text-ink-2 ${lift !== undefined ? "hidden sm:table-cell" : ""}`}>{s ? qty(s.days, 0) : "0"}</Td>
      {lift !== undefined && <Td align="right" className={`num whitespace-nowrap ${thin ? "text-muted" : lift != null && Math.abs(lift) >= 0.08 ? "font-medium text-warn" : "text-ink-2"}`}>{ran(lift)}</Td>}
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
          <Th align="right" className={lift ? "hidden sm:table-cell" : undefined}>Days</Th>
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
  // The live forecast reads what's learned here; keep it current if the nightly run hasn't yet today.
  if (s.firstSale && (await learnedIsStale(s.today))) after(() => saveLearned(s).catch(() => undefined));
  const story = forecastStory(s);

  if (!s.all.f1 || !story) {
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
  const level = LEVEL[story.level];
  const solid = s.byWeekday.filter((g) => (g.score?.days ?? 0) >= THIN).sort((x, y) => x.score!.wape - y.score!.wape);
  const bestDay = solid[0];
  const worstDay = solid[solid.length - 1];
  const ev = find(s.byEvent, "event");
  const fx = s.weatherEffects;
  const helping = s.signals.filter((x) => x.verdict === "helps");
  const judged = s.signals.filter((x) => x.verdict !== "thin");
  const mc = s.method.check;
  const methodGist = mc.use && mc.all
    ? `In use: stray-sale days left out, freak days capped (miss ${pct(mc.all.before, 1)} → ${pct(mc.all.after, 1)})`
    : mc.all
      ? "Tested: leaving out stray-sale days and capping freak days isn't closer, so it's not in use"
      : "Not enough history to test yet";
  const hol = s.holidays;
  const holOn = hol.effects.kinds.filter((k) => k.used);
  const holidayGist = holOn.length || hol.closed.length
    ? [holOn.length ? `In the forecast: ${holOn.length} of ${hol.effects.kinds.length}` : null, hol.closed.length ? `closed on ${hol.closed.map((k) => HOLIDAY_LABEL[k]).join(", ")}` : null].filter(Boolean).join("; ")
    : hol.effects.kinds.length
      ? "None has a steady enough pattern to use yet"
      : "No holidays in your history yet";
  const live = s.online.stored;
  const inForecast = live.near.used || live.week.used;
  const nearMove = onlineFactor(live, 0) - 1;
  const weekMove = onlineFactor(live, SIGNAL_NEAR_DAYS + 1) - 1;
  const moved = (m: number) => (Math.abs(m) < 0.005 ? "no change" : `${pct(Math.abs(m), 0)} ${m > 0 ? "more" : "less"}`);
  const signalGist = inForecast
    ? `In the forecast: ${s.online.members.join(", ")}, as one reading`
    : !s.signals.length
      ? "Nothing on file yet from Google or the website"
      : helping.length
        ? `${helping.map((x) => x.label).join(", ")} would make the forecast closer`
        : judged.length
          ? `${judged.length} tested against sales; none makes the forecast closer yet`
          : "Not enough history yet to say";
  const fxOn = fx.kinds.filter((k) => k.used);
  const plans = (f: number) => `${pct(Math.abs(f - 1), 0)} ${f < 1 ? "less" : "more"}`;
  const normal = find(s.byEvent, "normal");
  const weeks = weeklyScores(s.days.map((d) => ({ date: d.date, forecast: d.f1!, actual: d.actual })), 8);
  const pointKeys = new Set(story.points.map((p) => p.key));

  const weekdayTitle = bestDay && worstDay ? `Closest on ${WEEKDAY_NAMES[Number(bestDay.key)]}s, weakest on ${WEEKDAY_NAMES[Number(worstDay.key)]}s` : "By weekday";
  const weakDays = new Set(s.byWeekday.filter((g) => (g.score?.days ?? 0) >= THIN && worstDay && g.score!.wape >= worstDay.score!.wape * 0.999).map((g) => g.key));

  // The table behind each finding.
  const weekdayTable = (
    <ScoreTable first="Weekday" lift>
      {s.byWeekday.map((g) => <ScoreRow key={g.key} label={WEEKDAYS[Number(g.key)]} s={g.score} lift={g.lift} />)}
    </ScoreTable>
  );
  const monthTable = (
    <ScoreTable first="Month" lift>
      {s.byMonth.map((g) => <ScoreRow key={g.key} label={MONTHS[Number(g.key) - 1]} s={g.score} lift={g.lift} />)}
    </ScoreTable>
  );
  const eventTable = (
    <ScoreTable first="Days with" lift>
      <ScoreRow label="Nothing on the calendar" s={normal?.score ?? null} lift={normal?.lift ?? null} />
      <ScoreRow label="An event or a manual change" s={ev?.score ?? null} lift={ev?.lift ?? null} />
    </ScoreTable>
  );
  const horizonTable = (
    <ScoreTable first="Forecast made">
      {HORIZONS.map((h) => <ScoreRow key={h.model} label={h.label} s={a[h.model]} />)}
      <ScoreRow label="Same day last week" hint="The plain yardstick" s={a.naive} />
    </ScoreTable>
  );
  const yardstickTable = (
    <ScoreTable first="Over">
      <ScoreRow label="The forecast, last 90 days" s={s.recent.f1} />
      <ScoreRow label="Same day last week, last 90 days" s={s.recent.naive} />
      <ScoreRow label="The forecast, all history" s={a.f1} />
      <ScoreRow label="Same day last week, all history" s={a.naive} />
    </ScoreTable>
  );
  const weatherLiftTable = (
    <ScoreTable first="The day was" lift>
      {WEATHER_KINDS.map((k) => {
        const g = find(s.byWeather, k);
        return g ? <ScoreRow key={k} label={WEATHER_KIND_LABEL[k]} hint={WEATHER_KIND_HINT[k]} s={g.score} lift={g.lift} /> : null;
      })}
    </ScoreTable>
  );
  const numbersFor = (key: string) =>
    key === "weekdays" ? weekdayTable
      : key === "season" ? monthTable
        : key === "events" ? eventTable
          : key === "ahead" ? horizonTable
            : key === "yardstick" || key === "lean" ? yardstickTable
              : key === "weather" || key === "weatherBuiltIn" || key === "hot" ? weatherLiftTable
                : undefined;

  // The picture for each finding.
  const missBar = (label: string, sc: Score | null, mark = false, hint?: string) => ({ key: label, label, hint, value: sc ? sc.wape : null, display: sc ? `${pct(sc.wape, 0)} off` : "—", mark });
  const chartFor = (key: string) => {
    if (key === "weekdays")
      return (
        <Bars
          ariaLabel="A typical day's miss by weekday"
          color="var(--money-forecast)"
          rows={s.byWeekday.filter((g) => g.score).map((g) => ({ key: g.key, label: WEEKDAY_NAMES[Number(g.key)], hint: (g.score!.days < THIN ? "too few days to judge" : undefined), value: g.score!.wape, display: `${pct(g.score!.wape, 0)} off`, mark: weakDays.has(g.key) }))}
        />
      );
    if (key === "season") {
      const m = story.points.find((p) => p.key === "season");
      const which = m ? MONTHS.findIndex((x) => m.title.startsWith(x)) + 1 : 0;
      return (
        <>
          <h4 className="mb-3 text-sm font-medium text-ink">Sales against the forecast, month by month</h4>
          <Bars ariaLabel="How far sales ran over or under the forecast in each month" color="var(--money-sales)" rows={s.byMonth.map((g) => ({ key: g.key, label: MONTHS[Number(g.key) - 1], value: g.lift, display: liftWords(g.lift), mark: Number(g.key) === which }))} />
          <p className="mt-2 text-xs text-muted">Bars left of the line: sales ran under the forecast. Every year on file together.</p>
        </>
      );
    }
    if (key === "yardstick" || key === "lean")
      return (
        <>
          <h4 className="mb-3 text-sm font-medium text-ink">The forecast against just repeating the same day last week</h4>
          <Bars
            ariaLabel="A typical day's miss: the forecast against the same day last week"
            rows={[
              { ...missBar("The forecast", s.recent.f1, true, "last 90 days"), color: "var(--money-forecast)" },
              { ...missBar("Same day last week", s.recent.naive, false, "last 90 days"), color: "var(--border-strong)" },
              { ...missBar("The forecast ", a.f1, false, "all history"), color: "var(--money-forecast)" },
              { ...missBar("Same day last week ", a.naive, false, "all history"), color: "var(--border-strong)" },
            ]}
          />
          {key === "lean" && <p className="mt-2 text-xs text-muted">Leaning {story.basis === "recent" ? lean(s.recent.f1?.bias ?? 0).toLowerCase() : lean(a.f1!.bias).toLowerCase()} over the stretch: {signedPct(story.basis === "recent" ? s.recent.f1?.bias ?? 0 : a.f1!.bias, 0)} in total.</p>}
        </>
      );
    if (key === "ahead")
      return <Bars ariaLabel="A typical day's miss by how far ahead the forecast was made" color="var(--money-forecast)" rows={[...HORIZONS.map((h) => missBar(h.label, a[h.model], h.model === "f14")), { ...missBar("Same day last week", a.naive), color: "var(--border-strong)" }]} />;
    if (key === "events")
      return <Bars ariaLabel="A typical day's miss on event days and ordinary days" color="var(--money-forecast)" rows={[missBar("Ordinary days", normal?.score ?? null), missBar("Event or manual change", ev?.score ?? null, true)]} />;
    if (key === "weather" || key === "weatherBuiltIn" || key === "hot")
      return (
        <>
          <h4 className="mb-3 text-sm font-medium text-ink">Sales against a forecast that didn&apos;t know the weather</h4>
          <Bars
            ariaLabel="How far sales ran over or under the forecast, by the kind of weather"
            color="var(--money-sales)"
            rows={WEATHER_KINDS.flatMap((k) => {
              const g = find(s.byWeather, k);
              return g ? [{ key: k, label: WEATHER_KIND_LABEL[k], hint: g.score && g.score.days < THIN ? "too few days" : `${qty(g.score?.days ?? 0, 0)} days`, value: g.lift, display: liftWords(g.lift), mark: fxOn.some((x) => x.kind === k) }] : [];
            })}
          />
          <p className="mt-2 text-xs text-muted">Marked: weather the forecast now allows for.</p>
        </>
      );
    return null;
  };

  return (
    <>
      <PageHeader help="sales.scorecard" title="Forecast scorecard" back={back} description="How far to trust the sales forecast, and what to do differently because of it." />

      <Verdict
        badge={{ tone: level.tone, label: level.label }}
        title={story.headline}
        line={story.line}
        stats={[
          { label: "A typical day is off by", value: <>{money(story.missDollars, { whole: true })} <span className="text-sm font-normal text-muted">· {pct(story.missShare, 0)} of the day</span></>, tone: level.tone },
          { label: "Days that land within 15%", value: `${story.closeInTen} in 10` },
          { label: "Against just repeating last week", value: story.skill == null ? "—" : Math.abs(story.skill) < 0.02 ? "About the same" : story.skill > 0 ? `${pct(story.skill, 0)} closer` : "Last week was closer", hint: story.basis === "recent" ? "Going by the last 90 days" : "Going by all your history" },
        ]}
        numbers={
          <ScoreTable first="Forecast made">
            {HORIZONS.map((h) => <ScoreRow key={h.model} label={h.label} s={a[h.model]} />)}
            <ScoreRow label="Same day last week" hint="The plain yardstick" s={a.naive} />
          </ScoreTable>
        }
      >
        {weeks.length > 1 && (
          <>
            <h3 className="mb-3 text-sm font-medium text-ink">A typical day&apos;s miss, week by week</h3>
            <Bars
              ariaLabel="A typical day's miss in each of the last eight weeks scored"
              rows={weeks.map((w, i) => ({ key: w.from, label: `Week of ${shortDate(w.from)}`, value: w.miss, display: w.miss == null ? "—" : `${pct(w.miss, 0)} off`, color: w.level ? LEVEL_COLOR[w.level] : undefined, mark: i === weeks.length - 1 }))}
              max={0.3}
            />
            <p className="mt-2 text-xs text-muted">Within 15% is solid (green), up to 30% needs a cushion (amber), beyond that is a rough guide (red).</p>
          </>
        )}
      </Verdict>

      {story.points.length > 0 && (
        <Section help="sales.scorecard.todo" title="What to do with it" description="The few things worth doing differently, from how the forecast has actually done. Tap one to jump to it.">
          <InShort items={[...story.points.map((p) => ({ id: `pt-${p.key}`, point: asFinding(p) })), ...(pointKeys.has("weekdays") || !bestDay || !worstDay || bestDay === worstDay ? [] : [{ id: "pt-weekdays", point: { tone: "neutral" as const, title: weekdayTitle, detail: "", action: null } }])]} />
        </Section>
      )}

      <div className="mb-10 grid gap-4">
        {story.points.map((p) => (
          <Chapter key={p.key} id={`pt-${p.key}`} point={asFinding(p)} title={p.title} numbers={numbersFor(p.key)}>
            {chartFor(p.key)}
            {p.link && (
              <Link href={p.link.href} className="mt-4 inline-flex min-h-10 items-center text-sm text-ink-2 underline underline-offset-2 hover:text-ink">
                {p.link.label} →
              </Link>
            )}
          </Chapter>
        ))}
        {!pointKeys.has("weekdays") && bestDay && worstDay && bestDay !== worstDay && (
          <Chapter id="pt-weekdays" title={weekdayTitle} detail="Each weekday's typical miss, the evening before. A small day swings more: one party or one dead night moves it a long way." numbers={numbersFor("weekdays")}>
            {chartFor("weekdays")}
          </Chapter>
        )}
      </div>

      <Section title="What happens next">
        <p className="max-w-2xl text-sm leading-relaxed text-ink-2">{story.next}</p>
      </Section>

      <Section
        help="sales.scorecard.numbers"
        title="The numbers behind it"
        description={`${qty(a.f1!.days, 0)} open days from ${dated(a.from!)} to ${dated(a.to!)}, each forecast again using only what was known the evening before. Open any line for the detail. The live forecast reads the same history, item sales from before hourly sales were kept included.`}
      >
        <Card className="overflow-hidden">

          <Fold title="The usual day" gist={methodGist}>
            <p className="mb-3 text-sm text-ink-2">
              Every forecast starts from the usual for that weekday: the last eight weeks, recent ones counting most. Two refinements are tested against it. A day with only a stray sale (under a tenth of a typical day, like a gift card bought on a closed Tuesday) isn&apos;t counted as an open day. And one freak day, a holiday or a single huge order, counts for at most one-and-a-half usual days, so it can&apos;t pull the usual for weeks afterwards.
            </p>
            {mc.all ? (
              <Table>
                <thead>
                  <tr>
                    <Th>Replayed over</Th>
                    <Th align="right" className="hidden sm:table-cell">Days</Th>
                    <Th align="right">Miss without → with</Th>
                    <Th align="right">In the forecast</Th>
                  </tr>
                </thead>
                <tbody>
                  {([["All your history", mc.all], ["The last 12 months", mc.recent]] as const).map(([label, m]) =>
                    m ? (
                      <Tr key={label}>
                        <Td><span className="font-medium text-ink">{label}</span></Td>
                        <Td align="right" className="num hidden text-ink-2 sm:table-cell">{qty(m.days, 0)}</Td>
                        <Td align="right" className="num whitespace-nowrap text-ink-2">{pct(m.before, 1)} → {pct(m.after, 1)}</Td>
                        <Td align="right">{mc.use ? <Badge tone="good">On</Badge> : <Badge>Off</Badge>}</Td>
                      </Tr>
                    ) : null,
                  )}
                </tbody>
              </Table>
            ) : (
              <p className="text-sm text-muted">This needs a few months of sales before it can be tested.</p>
            )}
            <p className="mt-2 text-xs text-muted">
              Switched on only when it&apos;s at least 1% closer over all your history and no worse over the last 12 months; decided again every night.
              {mc.strayDays > 0 && ` ${qty(mc.strayDays, 0)} ${mc.strayDays === 1 ? "day" : "days"} with only a stray sale ${mc.use ? "are no longer counted as open days, so they aren't scored on this page either" : "would no longer count as open days"}.`}
            </p>
          </Fold>

          <Fold title="By weather" gist={fxOn.length ? `In the forecast: ${fxOn.map((k) => `${WEATHER_KIND_LABEL[k.kind].toLowerCase()} ${plans(k.factor)}`).join(", ")}` : `Weather on file for ${qty(weatherDays, 0)} of ${qty(s.days.length, 0)} days`}>
            <p className="mb-3 text-sm text-ink-2">Past forecasts are replayed without weather, so “Sales ran” shows what that weather does to sales here.</p>
            {weatherLiftTable}
            <p className="mt-2 text-xs text-muted">
              Past weather is NOAA&apos;s record at {s.weather.station}, about 35 miles north (US government data, free to use). It runs about five days behind and has the whole day&apos;s rain, not the hours it fell. Groups with fewer than {THIN} days are greyed.
            </p>
            <h4 className="mt-7 mb-1 text-sm font-medium text-ink">What the forecast does about it</h4>
            <p className="mb-3 text-sm text-ink-2">
              Each kind of weather is replayed day by day, using only the days before it. A kind is switched on only where that landed closer than the forecast without it.
              {s.withWeather.without && s.withWeather.with && fxOn.length > 0 && ` Over all ${qty(s.withWeather.with.days, 0)} scored days, that takes the typical miss from ${pct(s.withWeather.without.wape, 1)} to ${pct(s.withWeather.with.wape, 1)}.`}
            </p>
            <Table>
              <thead>
                <tr>
                  <Th>Weather</Th>
                  <Th align="right" className="hidden sm:table-cell">Days learned from</Th>
                  <Th align="right">Forecast plans for</Th>
                  <Th align="right" className="hidden sm:table-cell">Miss without → with</Th>
                  <Th align="right">In the forecast</Th>
                </tr>
              </thead>
              <tbody>
                {fx.kinds.map((k) => (
                  <Tr key={k.kind}>
                    <Td><span className="font-medium text-ink">{WEATHER_KIND_LABEL[k.kind]}</span></Td>
                    <Td align="right" className="num hidden text-ink-2 sm:table-cell">{qty(k.days, 0)}</Td>
                    <Td align="right" className={`num whitespace-nowrap ${k.used ? "font-medium text-ink" : "text-muted"}`}>{Math.abs(k.factor - 1) < 0.005 ? "No change" : plans(k.factor)}</Td>
                    <Td align="right" className="num hidden whitespace-nowrap text-ink-2 sm:table-cell">{k.missWithout != null && k.missWith != null ? `${pct(k.missWithout, 0)} → ${pct(k.missWith, 0)}` : "—"}</Td>
                    <Td align="right">{k.used ? <Badge tone="good">On</Badge> : <Badge>Off</Badge>}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <p className="mt-2 text-xs text-muted">
              This replay uses the weather that actually happened. A real forecast only has the weather forecast, so the true gain is a little smaller; “Forecasts as they were made” below is the real test. Four or more days out, only part of the effect is applied.
            </p>
            {s.weather.onFile < s.weather.wanted && (
              <div className="mt-3">
                <LoadWeather missing={s.weather.wanted - s.weather.onFile} />
              </div>
            )}
          </Fold>

          <Fold title="Holidays and school breaks" gist={holidayGist}>
            <p className="mb-3 text-sm text-ink-2">
              For each holiday, how far sales ran from the forecast on it compared with ordinary days, replayed year by year using only the years before. A holiday is switched on only where that landed at least 5% closer and it moves the day by a tenth or more.
              {hol.effects.missWithout != null && hol.effects.missWith != null && ` On the ${qty(hol.effects.scored, 0)} replayed days of the ones switched on, the typical miss goes from ${pct(hol.effects.missWithout, 0)} to ${pct(hol.effects.missWith, 0)}.`}
            </p>
            {hol.effects.kinds.length || hol.closed.length ? (
              <Table>
                <thead>
                  <tr>
                    <Th>Holiday</Th>
                    <Th align="right" className="hidden sm:table-cell">Days learned from</Th>
                    <Th align="right">Forecast plans for</Th>
                    <Th align="right" className="hidden sm:table-cell">Miss without → with</Th>
                    <Th align="right">In the forecast</Th>
                  </tr>
                </thead>
                <tbody>
                  {hol.closed.map((k) => (
                    <Tr key={k}>
                      <Td><span className="font-medium text-ink">{HOLIDAY_LABEL[k]}</span></Td>
                      <Td align="right" className="num hidden text-ink-2 sm:table-cell">—</Td>
                      <Td align="right" className="whitespace-nowrap font-medium text-ink">Closed</Td>
                      <Td align="right" className="num hidden text-ink-2 sm:table-cell">—</Td>
                      <Td align="right"><Badge tone="good">Every year</Badge></Td>
                    </Tr>
                  ))}
                  {hol.effects.kinds.filter((k) => !hol.closed.includes(k.kind)).map((k) => (
                    <Tr key={k.kind}>
                      <Td>
                        <span className="font-medium text-ink">{HOLIDAY_LABEL[k.kind]}</span>
                        {HOLIDAY_HINT[k.kind] && <span className="block text-xs text-muted">{HOLIDAY_HINT[k.kind]}</span>}
                      </Td>
                      <Td align="right" className="num hidden text-ink-2 sm:table-cell">{qty(k.days, 0)}</Td>
                      <Td align="right" className={`num whitespace-nowrap ${k.used ? "font-medium text-ink" : "text-muted"}`}>{Math.abs(k.factor - 1) < 0.005 ? "No change" : plans(k.factor)}</Td>
                      <Td align="right" className="num hidden whitespace-nowrap text-ink-2 sm:table-cell">{k.missWithout != null && k.missWith != null ? `${pct(k.missWithout, 0)} → ${pct(k.missWith, 0)}` : "—"}</Td>
                      <Td align="right">{k.used ? <Badge tone="good">On</Badge> : <Badge>Off</Badge>}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <p className="text-sm text-muted">Nothing to show until a holiday has come round at least once with sales on file.</p>
            )}
            <p className="mt-2 text-xs text-muted">
              “More” and “less” are against a usual day of that weekday. A holiday comes once a year, so these rest on few days and are learned again every night. Days with your own adjustment, a closure, or an event that changes the forecast are left out: on those, your number is used and nothing is learned. “Closed” means closed at each of the last three, so nothing is forecast unless you add an event with its effect.
            </p>
          </Fold>


          {!pointKeys.has("events") && (
            <Fold title="Event days" gist={ev?.score && normal?.score ? `Off by ${pct(ev.score.wape, 0)} on ${qty(ev.score.days, 0)} event days, ${pct(normal.score.wape, 0)} on ordinary days` : "Days with an event or a manual change, against ordinary days"}>
              {eventTable}
            </Fold>
          )}

          {!pointKeys.has("season") && (
            <Fold title="By month" gist="Every year on file together">
              {monthTable}
            </Fold>
          )}

          <Fold title="Online signals" gist={signalGist}>
            <p className="mb-3 text-sm text-ink-2">
              Each number from Google and the website, tested two ways. <strong className="font-medium text-ink">On the day</strong>: when it runs above its usual level for that weekday, do sales run above the forecast too? <strong className="font-medium text-ink">Ahead</strong>: using only what had arrived when the forecast was made, would it have landed closer? Only the second can improve a forecast.
            </p>
            {s.signals.length ? (
              <Table>
                <thead>
                  <tr>
                    <Th>Number</Th>
                    <Th align="right" className="hidden sm:table-cell">On file since</Th>
                    <Th align="right">On the day</Th>
                    <Th align="right" className="hidden sm:table-cell">Ahead</Th>
                    <Th align="right" className="hidden sm:table-cell">Miss without → with</Th>
                    <Th align="right">Verdict</Th>
                  </tr>
                </thead>
                <tbody>
                  {s.signals.map((x) => (
                    <Tr key={x.key}>
                      <Td>
                        <span className="font-medium text-ink">{x.label}</span>
                        <span className="block text-xs text-muted">{x.source} · arrives {x.delay === 1 ? "the next day" : `${x.delay} days late`}</span>
                      </Td>
                      <Td align="right" className="num hidden whitespace-nowrap text-ink-2 sm:table-cell">{x.from ? dated(x.from) : "—"}</Td>
                      <Td align="right" className="whitespace-nowrap text-ink-2">
                        {linkWord(x.sameDay?.r)}
                        {x.sameDay && <span className="num block text-xs text-muted">{x.sameDay.r.toFixed(2)} · {qty(x.sameDay.days, 0)} days</span>}
                      </Td>
                      <Td align="right" className="hidden whitespace-nowrap text-ink-2 sm:table-cell">
                        {linkWord(x.ahead?.r)}
                        {x.ahead && <span className="num block text-xs text-muted">{x.ahead.r.toFixed(2)} · {qty(x.ahead.days, 0)} days</span>}
                      </Td>
                      <Td align="right" className="num hidden whitespace-nowrap text-ink-2 sm:table-cell">{x.verdict !== "thin" && x.missWithout != null && x.missWith != null ? `${pct(x.missWithout, 1)} → ${pct(x.missWith, 1)}` : "—"}</Td>
                      <Td align="right">{x.verdict === "helps" ? <Badge tone="good">Helps</Badge> : x.verdict === "noHelp" ? <Badge>No help</Badge> : <Badge>Too soon</Badge>}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <p className="text-sm text-muted">Connect Google under Settings › Connections, or wait for the website to collect a few weeks of visits.</p>
            )}
            <p className="mt-2 text-xs text-muted">
              The small figure is the correlation, from −1 to 1. The ahead test compares the last week on file with the four weeks before it, starts after {SIGNAL_WARMUP} days of history, and needs {SIGNAL_MIN_SCORED} replayed days for a verdict. “Helps” means the replay cut the typical miss by at least 1%.
            </p>
            <h4 className="mt-7 mb-1 text-sm font-medium text-ink">What the forecast does with them</h4>
            {s.online.members.length ? (
              <>
                <p className="mb-3 text-sm text-ink-2">
                  The numbers that help rise and fall together, so they go in as one reading: {s.online.members.join(", ")}, the last week on file against the four weeks before. It was replayed twice, once for the next few days and once for a forecast made a week ahead, and each part is only used where it beat the forecast without it.
                  {inForecast && live.level != null && ` Right now the reading is ${Math.abs(live.level) < 0.005 ? "level with" : `${pct(Math.abs(live.level), 0)} ${live.level > 0 ? "above" : "below"}`} the month before: ${moved(nearMove)} for today and the next ${SIGNAL_NEAR_DAYS} days, ${moved(weekMove)} for the rest of the coming week.`}
                </p>
                <Table>
                  <thead>
                    <tr>
                      <Th>Used for</Th>
                      <Th align="right" className="hidden sm:table-cell">Days replayed</Th>
                      <Th align="right">Miss without → with</Th>
                      <Th align="right">In the forecast</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {([["near", `Today and the next ${SIGNAL_NEAR_DAYS} days`, s.online.near], ["week", `The rest of the coming week (to ${SIGNAL_WEEK_DAYS} days out)`, s.online.week]] as [("near" | "week"), string, SignalResult | null][]).map(([k, label, r]) => (
                      <Tr key={k}>
                        <Td><span className="font-medium text-ink">{label}</span></Td>
                        <Td align="right" className="num hidden text-ink-2 sm:table-cell">{r ? qty(r.scored, 0) : "—"}</Td>
                        <Td align="right" className="num whitespace-nowrap text-ink-2">{r && r.verdict !== "thin" && r.missWithout != null && r.missWith != null ? `${pct(r.missWithout, 1)} → ${pct(r.missWith, 1)}` : "—"}</Td>
                        <Td align="right">{live[k].used ? <Badge tone="good">On</Badge> : <Badge>{r?.verdict === "thin" ? "Too soon" : "Off"}</Badge>}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
                <p className="mt-2 text-xs text-muted">It can move a day by a fifth at most, and it&apos;s learned again every night. The numbers going in were picked using all the history, so the replay flatters it a little; “Forecasts as they were made” below is the real test.</p>
              </>
            ) : (
              <p className="text-sm text-muted">Nothing goes into the forecast until a number above earns “Helps”.</p>
            )}
          </Fold>

          <Fold title="Forecasts as they were made" gist={s.logged.since ? `Each night's forecast, kept since ${dated(s.logged.since)}` : "Each night's forecast is kept from tonight"}>
            <p className="mb-3 text-sm text-ink-2">Each night&apos;s forecast is kept exactly as it was, weather and all, and scored against what then sells. This is the honest test of any change to the method.</p>
            {s.logged.dayBefore || s.logged.weekAhead ? (
              <ScoreTable first="Forecast made">
                <ScoreRow label="The day before" s={s.logged.dayBefore} />
                <ScoreRow label="A week ahead" s={s.logged.weekAhead} />
              </ScoreTable>
            ) : (
              <p className="text-sm text-muted">The first scores show once those days have sold.</p>
            )}
          </Fold>

          <Fold title="Every scored day" gist={`${qty(rows.length, 0)} days: what was forecast, what sold, the weather`}>
            <ScoreDaysTable rows={rows} />
            {s.dailyOnly > 0 && <p className="mt-2 text-xs text-muted">{qty(s.dailyOnly, 0)} older days come from item sales, from before hourly sales were kept.</p>}
          </Fold>
        </Card>
      </Section>
    </>
  );
}
