import { Chapter, InShort } from "@/components/chapter";
import { ColumnsChart, type Col } from "@/components/columns-chart";
import { Badge, Card, EmptyState, PageHeader, Section, Table, Td, Th, Tr } from "@/components/ui";
import { about, hourLabel, SEASONS, type ProfitPoint, type WeekdayProfit } from "@/domain/dayProfit";
import { TYPICAL_COST_SHARE } from "@/domain/pnlStory";
import { dayDate, money, pct, qty, shortDate } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { dayProfitView } from "@/server/services/dayProfit";
import Link from "next/link";
import { VIZ_VARS } from "../viz-vars";
import { DayStrip, HourBars } from "./charts";

export const metadata = { title: "Profit by day" };
/** The first look of the day reads a year of sales, recipes and timecards. */
export const maxDuration = 60;

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const whole = (x: number) => money(x, { whole: true });
const signed = (x: number) => (Math.round(x) < 0 ? `−${whole(-x)}` : whole(x));
const LEVEL = { good: "Every day pays", warn: "Thin in places", bad: "A day is losing money" } as const;

export default async function ProfitByDayPage() {
  await requireUser("MANAGER");
  const v = await dayProfitView();
  const p = v.profit;
  const header = <PageHeader help="pnl.days" title="Profit by day" back={{ href: "/pnl", label: "P&L" }} description="What each day of the week leaves once food, drink, wages and card fees are paid, and whether it's worth opening." />;

  if (!p.typical || !v.story) {
    return (
      <>
        {header}
        <EmptyState title="Not enough days yet">This needs a couple of months of sales, with timecards for the same days, before a weekday can be judged. It fills in by itself as the Square sync runs.</EmptyState>
      </>
    );
  }

  const story = v.story;
  const point = (key: ProfitPoint["key"]) => story.points.find((x) => x.key === key);
  const regular = p.weekdays.filter((w) => w.regular);
  const worst = [...regular].sort((a, b) => a.left - b.left)[0];
  const lostDays = p.days.filter((d) => d.left < 0).length;

  // ---- The pictures: everything a chart needs, as plain data ---------------------------------

  const dayCols: Col[] = p.weekdays.map((w) => ({
    key: String(w.wd),
    label: DAYS[w.wd].slice(0, 3),
    sub: signed(w.left),
    mark: w.wd === worst?.wd,
    parts: [w.goods, w.labor, w.fees, Math.max(0, w.left)],
    tick: w.left < 0 ? w.sales : undefined,
    tip: {
      title: `A typical ${DAYS[w.wd]} · open ${qty(w.openDays, 0)} times`,
      rows: [
        { label: "Sales", value: whole(w.sales), strong: true },
        { color: "var(--viz-cogs)", label: "Food & drink", value: whole(w.goods) },
        { color: "var(--viz-labor)", label: "Wages", value: `${whole(w.labor)}${w.laborPct != null ? ` · ${pct(w.laborPct, 0)}` : ""}` },
        { color: "var(--viz-fees)", label: "Card fees", value: whole(w.fees) },
        { color: "var(--viz-profit)", label: w.left < 0 ? "Lost" : "Left over", value: whole(Math.abs(w.left)), strong: true },
      ],
    },
  }));

  const stripRows = p.weekdays.map((w) => ({
    key: String(w.wd),
    name: DAYS[w.wd],
    mean: w.left,
    lost: w.lostDays,
    days: p.days.filter((d) => d.wd === w.wd).map((d) => ({ date: d.date, label: dayDate(d.date), sales: d.sales, left: d.left })),
  }));

  const yearMax = Math.max(1, ...regular.map((w) => Math.abs(w.yearLeft)));
  const seasonMax = Math.max(1, ...p.seasons.map((c) => Math.abs(c.left ?? 0)));
  const coldCells = p.seasons.filter((c) => c.left != null && c.left < 0).length;
  const laborMax = Math.max(0.01, ...regular.map((w) => w.laborPct ?? 0));

  const late = [...v.hours].filter((h) => h.late).sort((a, b) => a.late!.yearLeft - b.late!.yearLeft)[0];
  const hourDays = v.hours.map((h) => ({
    key: String(h.wd),
    name: DAYS[h.wd],
    hours: h.hours.map((c) => ({ hour: c.hour, label: hourLabel(c.hour), sales: c.sales, kept: c.kept, labor: c.labor, trading: c.trading })),
  }));
  const hourStart = String(late?.wd ?? (v.hours.some((h) => h.wd === worst?.wd) ? worst!.wd : (v.hours[0]?.wd ?? "")));

  const contents = (["weakest", "rent", "season", "hours", "labor", "closed"] as const)
    .map((k) => ({ id: k === "closed" ? "worked-out" : k, point: point(k) }))
    .filter((x): x is { id: string; point: ProfitPoint } => !!x.point);

  const WeekdayName = ({ w }: { w: WeekdayProfit }) => (
    <span className="font-medium text-ink">
      {DAYS[w.wd]}
      {!w.regular && <span className="ml-1.5 text-xs font-normal text-muted">open {qty(w.openDays, 0)} times</span>}
    </span>
  );

  return (
    <>
      {header}

      <Card className="mb-10 p-5 sm:p-6">
        <Badge tone={story.level}>{LEVEL[story.level]}</Badge>
        <h2 className="mt-2 max-w-3xl text-xl font-semibold tracking-tight text-balance text-ink sm:text-2xl">{story.headline}</h2>
        <p className="mt-2 max-w-2xl text-[0.95rem] leading-relaxed text-ink-2">{story.line}</p>
        <div className="mt-6">
          <h3 className="mb-3 text-sm font-medium text-ink">Where a typical day&apos;s sales go</h3>
          <ColumnsChart
            className={VIZ_VARS}
            cols={dayCols}
            series={[
              { color: "var(--viz-cogs)", label: "Food & drink" },
              { color: "var(--viz-labor)", label: "Wages" },
              { color: "var(--viz-fees)", label: "Card fees" },
              { color: "var(--viz-profit)", label: "Left over" },
            ]}
            tickLabel="Sales, on a day that falls short of its costs"
            height={220}
            ariaLabel="A typical open day of each weekday: sales split into food and drink, wages, card fees and what's left"
            caption="Weekday"
          />
          <p className="mt-2 text-xs text-muted">The figure under each day is what it leaves. The blue is the only part you keep; everything else is spent by closing time.</p>
        </div>
        <dl className="mt-5 grid gap-x-8 gap-y-4 border-t border-border pt-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted">A typical open day leaves</dt>
            <dd className="num mt-0.5 text-lg font-semibold tracking-tight text-ink">
              {signed(p.typical.left)} <span className="text-sm font-normal text-muted">· {p.typical.sales > 0 ? pct(p.typical.left / p.typical.sales, 0) : "—"} of sales</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Open days that lost money</dt>
            <dd className="num mt-0.5 text-lg font-semibold tracking-tight text-ink">
              {qty(lostDays, 0)} <span className="text-sm font-normal text-muted">of {qty(p.days.length, 0)}</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Rent and fixed costs, per open day</dt>
            <dd className="num mt-0.5 text-lg font-semibold tracking-tight text-ink">
              {p.fixedPerOpenDay != null ? whole(p.fixedPerOpenDay) : <Link href="/settings/money#fixed" className="text-sm font-medium underline underline-offset-2">Set them in Settings</Link>}
            </dd>
          </div>
        </dl>
      </Card>

      {contents.length > 0 && (
        <Section help="pnl.days.todo" title="In short" description="What stands out, in the order the page tells it. Tap one to jump to it.">
          <InShort items={contents} />
        </Section>
      )}

      <Section title="Is each day worth opening?" description={`Every open day from ${p.from ? shortDate(p.from) : "a year ago"} to ${p.to ? shortDate(p.to) : "yesterday"}. A day is worth opening when it leaves more than nothing: rent is owed either way.`}>
        <div className="grid gap-4">
          <Chapter
            id="weakest"
            point={point("weakest")}
            title="What each open day left"
            numbers={
              <Table>
                <thead>
                  <tr>
                    <Th>Weekday</Th>
                    <Th align="right">Sales</Th>
                    <Th align="right" className="hidden sm:table-cell">Food &amp; drink</Th>
                    <Th align="right" className="hidden sm:table-cell">Wages</Th>
                    <Th align="right" className="hidden md:table-cell">Card fees</Th>
                    <Th align="right">Left</Th>
                    <Th align="right">Lost money</Th>
                  </tr>
                </thead>
                <tbody>
                  {p.weekdays.map((w) => (
                    <Tr key={w.wd}>
                      <Td><WeekdayName w={w} /></Td>
                      <Td align="right" className="num text-ink-2">{whole(w.sales)}</Td>
                      <Td align="right" className="num hidden text-ink-2 sm:table-cell">{whole(w.goods)}</Td>
                      <Td align="right" className="num hidden text-ink-2 sm:table-cell">{whole(w.labor)}</Td>
                      <Td align="right" className="num hidden text-ink-2 md:table-cell">{whole(w.fees)}</Td>
                      <Td align="right" className={`num font-medium ${w.left < 0 ? "text-bad" : "text-ink"}`}>{signed(w.left)}</Td>
                      <Td align="right" className="num text-ink-2">{qty(w.lostDays, 0)} of {qty(w.openDays, 0)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            }
          >
            <h4 className="mb-3 text-sm font-medium text-ink">Every open day, by what it left</h4>
            <DayStrip rows={stripRows} fixed={p.fixedPerOpenDay} />
          </Chapter>

          <Chapter
            id="rent"
            point={point("rent")}
            title="What each weekday added over the year"
            detail="Everything a weekday left over the last 12 months, towards rent and everything else that's owed whether you open or not."
          >
            <h4 className="mb-3 text-sm font-medium text-ink">Added over the year, and what closing would take</h4>
            <ul className={`space-y-3.5 sm:space-y-2.5 ${VIZ_VARS}`}>
              {regular.map((w) => (
                <li key={w.wd} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5 sm:grid-cols-[6.5rem_1fr_5.5rem]">
                  <div className="text-sm font-medium text-ink">{DAYS[w.wd]}s</div>
                  <div className="col-span-2 sm:col-span-1 sm:col-start-2 sm:row-start-1">
                    <div className="h-2.5 min-w-[2px] rounded-r-[4px]" style={{ width: `${(Math.abs(w.yearLeft) / yearMax) * 100}%`, background: w.yearLeft < 0 ? "var(--bad)" : "var(--viz-profit)" }} />
                    <div className="mt-1 text-xs text-muted">
                      {w.yearLeft < 0
                        ? "Closing would save this even if nobody came another day instead."
                        : `Closing only pays if more than ${pct(w.moveShare ?? 0, 0)} of its sales turned up on other days.`}
                    </div>
                  </div>
                  <div className={`num col-start-2 row-start-1 text-right text-sm font-semibold whitespace-nowrap sm:col-start-3 ${w.yearLeft < 0 ? "text-bad" : "text-ink"}`}>{signed(w.yearLeft)}</div>
                </li>
              ))}
            </ul>
          </Chapter>
        </div>
      </Section>

      <Section title="Where it gets thin" description="The same weekday in each season, and a typical day hour by hour.">
        <div className="grid gap-4 xl:grid-cols-2">
          <Chapter
            id="season"
            point={point("season")}
            title={coldCells ? "Some days lose money in some seasons" : "Every weekday pays its way in every season"}
            detail="A typical open day's left-over for each weekday, season by season."
          >
            <div className={VIZ_VARS}>
              <table data-no-resize="" className="w-full border-separate border-spacing-1 text-sm">
                <thead>
                  <tr>
                    <th className="w-12 text-left text-xs font-normal text-muted"><span className="sr-only">Weekday</span></th>
                    {SEASONS.map((s) => (
                      <th key={s} className="pb-1 text-center text-xs font-normal text-muted">{s}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {regular.map((w) => (
                    <tr key={w.wd}>
                      <th scope="row" className="pr-2 text-left text-xs font-medium text-ink-2">{DAYS[w.wd].slice(0, 3)}</th>
                      {SEASONS.map((s, si) => {
                        const c = p.seasons.find((x) => x.wd === w.wd && x.season === si);
                        const left = c?.left ?? null;
                        const strength = left == null ? 0 : 8 + 40 * (Math.abs(left) / seasonMax);
                        return (
                          <td
                            key={s}
                            className="h-11 rounded-md text-center"
                            style={{ background: left == null ? "var(--surface-2)" : `color-mix(in oklab, ${left < 0 ? "var(--bad)" : "var(--viz-profit)"} ${strength.toFixed(0)}%, var(--surface))` }}
                            title={c ? `${DAYS[w.wd]}s in ${s.toLowerCase()}: ${qty(c.openDays, 0)} open days` : undefined}
                          >
                            {left == null ? <span className="text-xs text-muted">too few days</span> : <span className="num font-medium text-ink">{signed(left)}</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                <span className="inline-flex items-center gap-1.5"><span aria-hidden className="inline-block size-2.5 rounded-[3px]" style={{ background: "color-mix(in oklab, var(--viz-profit) 45%, var(--surface))" }} /> Left over (stronger colour is more)</span>
                <span className="inline-flex items-center gap-1.5"><span aria-hidden className="inline-block size-2.5 rounded-[3px]" style={{ background: "color-mix(in oklab, var(--bad) 45%, var(--surface))" }} /> Lost money</span>
              </div>
              <p className="mt-2 text-xs text-muted">Winter is December to February, spring March to May, summer June to August, autumn September to November.</p>
            </div>
          </Chapter>

          <Chapter
            id="hours"
            point={point("hours")}
            title={hourDays.length ? "No closing hour costs more than it brings in" : "Hour by hour"}
            detail={hourDays.length ? "Pick a weekday to see where its wages and its takings part company." : "There are no hour-by-hour sales on file for these days yet."}
          >
            {hourDays.length > 0 && <HourBars days={hourDays} initial={hourStart} />}
          </Chapter>
        </div>
      </Section>

      <Section title="The crew" description="Wages are the one cost you set before the day starts.">
        <Chapter
          id="labor"
          point={point("labor")}
          title="Wages against sales, by weekday"
          detail="How much of a typical day's sales goes on wages, and the sales that day needs to cover its crew."
          numbers={
            <Table>
              <thead>
                <tr>
                  <Th>Weekday</Th>
                  <Th align="right">Wages a day</Th>
                  <Th align="right">Of sales</Th>
                  <Th align="right" className="hidden sm:table-cell">Sales to cover the crew</Th>
                  <Th align="right">Days that got there</Th>
                </tr>
              </thead>
              <tbody>
                {p.weekdays.map((w) => (
                  <Tr key={w.wd}>
                    <Td><WeekdayName w={w} /></Td>
                    <Td align="right" className="num text-ink-2">{whole(w.labor)}</Td>
                    <Td align="right" className="num font-medium text-ink">{w.laborPct != null ? pct(w.laborPct, 0) : "—"}</Td>
                    <Td align="right" className="num hidden text-ink-2 sm:table-cell">{w.breakEven != null ? whole(w.breakEven) : "—"}</Td>
                    <Td align="right" className="num text-ink-2">{qty(w.openDays - w.lostDays, 0)} of {qty(w.openDays, 0)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          }
        >
          <ul className={`space-y-3.5 sm:space-y-2.5 ${VIZ_VARS}`}>
            {regular.map((w) => (
              <li key={w.wd} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5 sm:grid-cols-[6.5rem_1fr]">
                <div className="text-sm font-medium text-ink">{DAYS[w.wd]}</div>
                <div className="col-span-2 sm:col-span-1">
                  <div className="flex items-center gap-2">
                    <div className="h-2.5 min-w-[2px] rounded-r-[4px]" style={{ width: `calc((100% - 3rem) * ${(((w.laborPct ?? 0) / laborMax)).toFixed(4)})`, background: "var(--viz-labor)" }} />
                    <span className="num text-sm font-semibold text-ink">{w.laborPct != null ? pct(w.laborPct, 0) : "—"}</span>
                  </div>
                  <div className="mt-1 text-xs text-muted">
                    {whole(w.labor)} of wages a day.{w.breakEven != null && ` Needs ${about(w.breakEven)} in sales to cover them; ${qty(w.openDays - w.lostDays, 0)} of ${qty(w.openDays, 0)} days got there.`}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Chapter>
      </Section>

      <Section help="pnl.days.numbers" title="How this is worked out" description="What's counted, what's estimated, and what's left out on purpose.">
        <Card id="worked-out" className="scroll-mt-24 p-4 sm:p-6">
          {point("closed") && (
            <div className="mb-5">
              <h3 className="max-w-3xl text-base font-semibold tracking-tight text-balance text-ink sm:text-lg">{point("closed")!.title}</h3>
              <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-2">{point("closed")!.detail}</p>
            </div>
          )}
          <div className="max-w-2xl space-y-2 text-sm leading-relaxed text-ink-2">
            <p>
              These are the same figures as the <Link href="/pnl" className="underline underline-offset-2 hover:text-ink">P&amp;L</Link>, grouped by weekday over the last 52 weeks: net sales from Square, food and drink at each recipe&apos;s cost on the day, timecards with employer taxes, and Square&apos;s card fees.
            </p>
            {v.coverage != null && v.coverage < 0.995 && (
              <p>
                {pct(v.coverage, 0)} of sales have a recipe behind them. The rest is costed at a typical {pct(TYPICAL_COST_SHARE, 0)}, so every &ldquo;left over&rdquo; here is an estimate until more items are <Link href="/sales/link" className="underline underline-offset-2 hover:text-ink">linked to a recipe</Link>.
              </p>
            )}
            {p.feesEstimated > 0 && (
              <p>
                Card fees are Square&apos;s own for {qty(p.days.length - p.feesEstimated, 0)} of {qty(p.days.length, 0)} days{p.feeRate != null ? `; the rest are estimated at the same ${pct(p.feeRate, 1)} of sales` : "; the rest aren't in yet, so those days read a little high"}.
              </p>
            )}
            {v.missingRates > 0 && <p className="text-warn">{qty(v.missingRates, 0)} timecards have no pay rate, so wages are understated. Set rates under Team.</p>}
            <p>Wages are what&apos;s on the clock that day. Anyone on a salary, and your own time, isn&apos;t in them. Work done on one day for another (prep, brewing) counts on the day it was done.</p>
            <p>Rent, insurance and other fixed costs are left out of what a day leaves, on purpose: closing a day doesn&apos;t save them. They show only as a yardstick.</p>
            <p>&ldquo;What closing would take&rdquo; assumes the crew&apos;s wages are saved and the day&apos;s sales are lost, apart from whatever share comes in on other days. How many guests would really come another day is the one thing no till can tell you.</p>
          </div>
        </Card>
      </Section>
    </>
  );
}
