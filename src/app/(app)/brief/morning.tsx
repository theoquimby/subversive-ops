import { TeamCard } from "./team-card";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  Beer,
  CalendarCheck,
  CalendarDays,
  ChevronRight,
  CircleCheck,
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  Compass,
  Cylinder,
  FileCheck,
  GraduationCap,
  History,
  Lightbulb,
  type LucideIcon,
  MessageSquarePlus,
  MessageSquareText,
  NotebookPen,
  PackageCheck,
  Plus,
  Send,
  ShoppingCart,
  Snowflake,
  Sun,
  Sunrise,
  Users,
  UtensilsCrossed,
} from "lucide-react";
import { HelpTip, HelpZone } from "@/components/help";
import { Badge, Card, cx, LinkButton } from "@/components/ui";
import { focusLabels, showSection, type BriefSection, type ElsewhereGroup, type Focus } from "@/domain/focus";
import { activeSpan, hourLabel, joinList } from "@/domain/morningBrief";
import { morningForFocus } from "@/server/email/morning-digest";
import { dayDate, money, pct, shortDate, signedPct } from "@/lib/format";
import { CompactHero } from "@/app/(app)/insights/deck";
import { toDeck } from "@/app/(app)/insights/deck-data";
import { insightFeed } from "@/server/services/analytics";
import { morningBrief, type MorningBrief, type TonightItem } from "@/server/services/morningBrief";
import { newFeedbackCount } from "@/server/services/feedback";
import { newFeedbackLine } from "@/domain/feedback";
import { usual86 } from "@/server/services/shiftNotes";
import { NoteCard } from "../notes/note-card";

const whole = (n: number) => money(n, { whole: true });
const signedWhole = (n: number) => `${n < 0 ? "−" : ""}${whole(Math.abs(n))}`;

const WEATHER_ICON: Record<string, LucideIcon> = { sun: Sun, cloud: Cloud, rain: CloudRain, snow: Snowflake, storm: CloudLightning, fog: CloudFog };
const TONIGHT_ICON: Record<TonightItem["kind"], LucideIcon> = { deadline: ShoppingCart, draft: Send, checkin: PackageCheck, invoices: FileCheck, kegs: Beer, brewery: Cylinder, requests: Users, schedule: CalendarCheck, certs: GraduationCap, reviews: MessageSquareText, other: CircleCheck };
const CHIP = { bad: "bg-bad-bg text-bad", warn: "bg-warn-bg text-warn", neutral: "bg-surface-2 text-ink-2", good: "bg-good-bg text-good" } as const;
const TEXT = { bad: "text-bad", warn: "text-warn", neutral: "text-ink-2", good: "text-good" } as const;

const greeting = () => {
  const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: process.env.BUSINESS_TIMEZONE || "America/New_York", hour: "numeric", hourCycle: "h23" }).format(new Date()));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};
const clock = (hhmm: string | null) => {
  if (!hhmm) return null;
  const h = Number(hhmm.slice(0, 2));
  const m = hhmm.slice(3, 5);
  return `${h % 12 === 0 ? 12 : h % 12}${m === "00" ? "" : `:${m}`}${h < 12 ? "am" : "pm"}`;
};

/** The daily brief (default view of /brief). */
export async function MorningView({ name, viewer, focus = [] }: { name: string; viewer: { userId: string; role: "MANAGER" | "STAFF" }; focus?: Focus[] }) {
  const show = (s: BriefSection) => showSection(s, focus);
  const [b, feed, usual, feedback] = await Promise.all([
    morningBrief(),
    show("insight") ? insightFeed({ limit: 6 }).catch(() => ({ items: [] })) : { items: [] },
    show("notes") ? usual86().catch(() => []) : [],
    viewer.role === "MANAGER" ? newFeedbackCount().catch(() => 0) : 0,
  ]);
  const feedbackLine = newFeedbackLine(feedback);
  const mine = morningForFocus(b, focus);
  const lead = leadSentence(b, mine.tonight.length, show("yesterday"), show("today"));

  return (
    <div>
      <HelpZone id="brief.morning" tour="brief.morning" className="mb-8">
        <header>
          <div className="flex items-center gap-2 text-[0.8rem] font-medium tracking-wide text-muted uppercase">
            <Sunrise aria-hidden className="size-4 text-area" strokeWidth={1.75} />
            {b.monday ? "Monday edition" : "Morning brief"} · {dayDate(b.today)}
          </div>
          <h1 className="mt-2 text-[1.9rem] leading-tight font-semibold tracking-tight text-ink sm:text-[2.2rem]">
            {greeting()}, {name}.
          </h1>
          <p className="mt-3 max-w-2xl text-[1.05rem] leading-relaxed text-ink-2">{lead}</p>
          {focus.length > 0 && (
            <p className="mt-2 text-sm text-muted">
              Led by what you look after: {focusLabels(focus).join(", ")}. Anything urgent elsewhere is in too. <Link href="/settings/notifications#focus" className="underline decoration-border-strong underline-offset-2 hover:text-ink">Change</Link>
            </p>
          )}
        </header>
      </HelpZone>

      <div className="space-y-6">
        {show("yesterday") && <YesterdayCard b={b} />}
        {show("today") && <TodayCard b={b} />}
        {show("team") && <TeamCard />}
        <TonightCard b={b} items={mine.tonight} focused={focus.length > 0} prep={b.prep && (focus.length === 0 || focus.includes("kitchen"))} />
        {mine.elsewhere.length > 0 && <ElsewhereCard groups={mine.elsewhere} />}
        {feedbackLine && (
          <Link href="/settings/feedback?status=new" className="-mt-2 flex min-h-10 items-center gap-2 px-1 text-sm text-muted transition-colors duration-120 hover:text-ink">
            <MessageSquarePlus aria-hidden className="size-4 shrink-0" strokeWidth={1.75} />
            <span>{feedbackLine}</span>
            <ChevronRight aria-hidden className="size-3.5 shrink-0" />
          </Link>
        )}
        {feed.items.length > 0 && (
          <HelpZone id="brief.insight">
            <section id="insight" className="scroll-mt-20">
              <CardTitle icon={Lightbulb} label="One thing to act on" help="brief.insight" action={<Link href="/insights" className="relative text-xs text-muted hover:text-ink after:absolute after:-inset-2 after:content-['']">Insights Lab →</Link>} bare />
              <CompactHero actions={feed.items.map((a) => toDeck(a))} />
            </section>
          </HelpZone>
        )}
        {show("notes") && <NotesCard b={b} viewer={viewer} usual={usual} />}
        {b.wrap && show("wrap") && <WrapCard w={b.wrap} />}
      </div>

      <p className="mt-10 text-center text-xs text-muted">
        Built {dayDate(b.today)} from Square sales, the forecast, the schedule, orders and shift notes. <Link href="/brief?view=week" className="underline decoration-border-strong underline-offset-2 hover:text-ink">This week&apos;s brief</Link>
      </p>
    </div>
  );
}

function leadSentence(b: MorningBrief, n: number, yesterday: boolean, today: boolean): string {
  const parts: string[] = [];
  if (yesterday && b.y && !b.y.closed) {
    const vs = b.y.vsForecast;
    parts.push(`Yesterday did ${whole(b.y.sales)}${vs != null && Math.abs(vs) >= 0.03 ? `, ${pct(Math.abs(vs), 0)} ${vs > 0 ? "over" : "under"} forecast` : vs != null ? ", right on forecast" : ""}.`);
  }
  if (b.day.closed) parts.push("We're closed today.");
  else if (today && b.day.forecast && b.day.forecast > 0) parts.push(`Today looks like ${whole(b.day.forecast)}${b.day.busy ? `, busiest ${b.day.busy.label}` : ""}.`);
  parts.push(n === 0 ? "Nothing needs you before tonight." : `${n} thing${n === 1 ? "" : "s"} to get done before tonight.`);
  return parts.join(" ");
}

function CardTitle({ icon: Icon, label, help, action, bare = false }: { icon: LucideIcon; label: ReactNode; help?: string; action?: ReactNode; bare?: boolean }) {
  return (
    <div className={cx("flex items-center justify-between gap-3", bare ? "mb-3" : "px-5 pt-4 pb-3 sm:px-6")}>
      <span className="inline-flex min-w-0 items-center gap-2 text-[0.8rem] font-medium text-muted">
        <Icon aria-hidden className="size-4 shrink-0" strokeWidth={1.75} />
        <span className="truncate">{label}</span>
        {help && <HelpTip id={help} />}
      </span>
      {action && <span className="shrink-0">{action}</span>}
    </div>
  );
}

// ---- Yesterday --------------------------------------------------------------------------

function YesterdayCard({ b }: { b: MorningBrief }) {
  const y = b.y;
  const pnl = `/pnl?period=custom&from=${b.yesterday}&to=${b.yesterday}`;
  return (
    <HelpZone id="brief.yesterday" tour="brief.yesterday">
      <Card className="overflow-hidden">
        <CardTitle icon={History} label={<>Yesterday · {dayDate(b.yesterday)}</>} help="brief.yesterday" action={<Link href={pnl} className="relative text-xs text-muted hover:text-ink after:absolute after:-inset-2 after:content-['']">P&amp;L →</Link>} />
        {!y ? (
          <p className="px-5 pb-5 text-sm text-muted sm:px-6">Yesterday&apos;s numbers aren&apos;t in yet. They come from Square overnight.</p>
        ) : y.closed ? (
          <p className="px-5 pb-5 text-[0.95rem] text-ink-2 sm:px-6">{y.line}</p>
        ) : (
          <>
            <p className="px-5 text-[1.02rem] leading-relaxed text-ink sm:px-6">{y.line}</p>
            <div className="mt-4 grid grid-cols-2 border-t border-border sm:grid-cols-4">
              <Figure label="Sales" help="brief.figure.sales" value={whole(y.sales)} sub={y.orders ? `${Math.round(y.orders)} orders` : "net of tax and tips"} />
              <Figure label="vs forecast" help="brief.figure.vsForecast" value={y.vsForecast == null ? "—" : signedPct(y.vsForecast, 0)} sub={y.forecast ? `forecast ${whole(y.forecast)}` : "no forecast"} tone={y.vsForecast == null ? undefined : y.vsForecast >= -0.03 ? "good" : y.vsForecast <= -0.15 ? "warn" : undefined} />
              <Figure label="Labor" help="brief.figure.labor" value={y.laborPct == null ? "—" : pct(y.laborPct, 0)} sub={y.labor <= 0 ? "no timecards yet" : y.laborTarget != null ? `target ${pct(y.laborTarget, 0)}` : `${whole(y.labor)} wages`} tone={y.laborPct != null && y.laborTarget != null ? (y.laborPct > y.laborTarget + 0.03 ? "bad" : y.laborPct > y.laborTarget + 0.005 ? "warn" : "good") : undefined} />
              <Figure label="Profit (est.)" help="brief.figure.profit" value={y.profit == null ? "—" : signedWhole(y.profit)} sub={y.labor <= 0 ? "after food (no labor yet)" : "after food and labor"} tone={y.profit != null && y.profit < 0 ? "bad" : undefined} />
            </div>
            {y.flags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 border-t border-border px-5 py-3 sm:px-6">
                {y.flags.map((f) => <Badge key={f.key} tone={f.tone}>{f.text}</Badge>)}
              </div>
            )}
          </>
        )}
      </Card>
    </HelpZone>
  );
}

function Figure({ label, value, sub, tone, help }: { label: string; value: string; sub: string; tone?: "good" | "warn" | "bad"; help?: string }) {
  return (
    <div className="flex min-h-[5.5rem] min-w-0 flex-col justify-center border-border px-5 py-3 even:border-l max-sm:[&:nth-child(n+3)]:border-t sm:border-l sm:first:border-l-0 sm:px-6">
      <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted"><span className="truncate">{label}</span>{help && <HelpTip id={help} />}</div>
      <div className={cx("num mt-0.5 truncate text-[1.35rem] font-semibold tracking-tight", tone ? TEXT[tone] : "text-ink")}>{value}</div>
      <div className="truncate text-xs text-muted">{sub}</div>
    </div>
  );
}

// ---- Today ------------------------------------------------------------------------------

function TodayCard({ b }: { b: MorningBrief }) {
  const d = b.day;
  const W = d.weather ? WEATHER_ICON[d.weather.icon] ?? Cloud : null;
  const crew = b.crew;
  return (
    <HelpZone id="brief.today" tour="brief.today">
      <Card className="overflow-hidden">
        <CardTitle icon={CalendarDays} label={<>Today · {b.weekdayName}</>} help="brief.today" action={<Link href="/sales" className="relative text-xs text-muted hover:text-ink after:absolute after:-inset-2 after:content-['']">Forecast →</Link>} />
        <div className="grid gap-5 px-5 pb-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:px-6">
          <div className="min-w-0">
            {d.closed ? (
              <>
                <div className="text-[2rem] leading-none font-semibold tracking-tight text-ink">Closed</div>
                <p className="mt-2 text-sm text-muted">{d.events.length ? joinList(d.events.map((e) => e.title)) : "No sales expected today."}</p>
              </>
            ) : (
              <>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="num text-[2.4rem] leading-none font-semibold tracking-tight text-ink">{d.forecast != null ? whole(d.forecast) : "—"}</span>
                  <span className="text-sm text-muted">forecast</span>
                </div>
                <p className="mt-2 text-sm text-ink-2">
                  {d.range ? <>Likely <span className="num">{whole(d.range.low)}–{whole(d.range.high)}</span></> : d.orders ? <>About <span className="num">{Math.round(d.orders)}</span> orders</> : "From the last few weeks of sales"}
                  {d.busy && <> · busiest <b className="font-medium text-ink">{d.busy.label}</b> <span className="text-muted">({pct(d.busy.share, 0)} of the day)</span></>}
                </p>
              </>
            )}
          </div>
          {(d.weather || d.events.length > 0 || b.parties.today.length > 0) && (
            <div className="flex flex-wrap gap-2 sm:max-w-64 sm:flex-col sm:items-stretch">
              {d.weather && W && (
                <div className="flex min-w-0 items-center gap-2.5 rounded-lg bg-surface-2 px-3 py-2">
                  <W aria-hidden className="size-5 shrink-0 text-ink-2" strokeWidth={1.75} />
                  <div className="min-w-0 text-sm">
                    <div className="font-medium text-ink">{d.weather.label} <span className="num font-normal text-muted">{d.weather.hiF}° / {d.weather.loF}°</span></div>
                    {Math.abs(d.weather.factor - 1) >= 0.03 && <div className="text-xs text-muted">Forecast {d.weather.factor > 1 ? "up" : "down"} {pct(Math.abs(d.weather.factor - 1), 0)} for it</div>}
                  </div>
                </div>
              )}
              {d.events.map((e) => (
                <div key={e.title} className="flex min-w-0 items-center gap-2.5 rounded-lg bg-surface-2 px-3 py-2 text-sm">
                  <CalendarDays aria-hidden className="size-4 shrink-0 text-ink-2" strokeWidth={1.75} />
                  <span className="min-w-0 truncate font-medium text-ink">{e.title}</span>
                  {clock(e.startTime) && <span className="num shrink-0 text-muted">{clock(e.startTime)}</span>}
                </div>
              ))}
              {b.parties.today.map((p) => (
                <Link key={p.id} href={`/events/private/${p.id}`} className="flex min-w-0 items-center gap-2.5 rounded-lg bg-surface-2 px-3 py-2 text-sm transition-colors hover:bg-border/60">
                  <Users aria-hidden className="size-4 shrink-0 text-ink-2" strokeWidth={1.75} />
                  <span className="min-w-0 truncate font-medium text-ink">{p.title}</span>
                  <span className="num shrink-0 text-muted">{p.headcount} guests{clock(p.startTime) ? ` · ${clock(p.startTime)}` : ""}</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {b.parties.tomorrow.length > 0 && (
          <div className="flex items-start gap-3 border-t border-border px-5 py-3 text-sm sm:px-6">
            <CalendarDays aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-2" strokeWidth={1.75} />
            <div className="min-w-0 text-ink-2">
              <span className="font-medium text-ink">Tomorrow:</span>{" "}
              {b.parties.tomorrow.map((p, i) => (
                <span key={p.id}>
                  {i > 0 && ", "}
                  <Link href={`/events/private/${p.id}`} className="underline decoration-border-strong underline-offset-2 hover:text-ink">{p.title}</Link>
                  {` · ${p.headcount} guests${clock(p.startTime) ? ` at ${clock(p.startTime)}` : ""}${p.confirmed ? "" : " (deposit paid)"}`}
                </span>
              ))}
            </div>
          </div>
        )}

        {!d.closed && <HourStrip b={b} />}

        {crew && !d.closed && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3.5 sm:px-6">
            <div className="flex min-w-0 items-start gap-3">
              <span aria-hidden className={cx("grid size-8 shrink-0 place-items-center rounded-lg", CHIP[crew.check.tone])}><Users className="size-4" /></span>
              <div className="min-w-0">
                <div className="text-sm font-medium text-ink">
                  {crew.people === 0 ? "Nobody on yet" : `${crew.people} on today`}
                  {crew.drafts > 0 && <span className="ml-2 rounded-md bg-warn-bg px-1.5 py-0.5 text-[11px] font-medium text-warn">{crew.drafts} not published</span>}
                </div>
                <div className={cx("text-xs", crew.check.tone === "good" ? "text-muted" : TEXT[crew.check.tone])}>{crew.check.line}</div>
                {crew.names.length > 0 && <div className="mt-0.5 line-clamp-1 text-xs text-muted">{crew.names.join(", ")}</div>}
              </div>
            </div>
            <LinkButton href="/schedule" variant="secondary" size="sm" className="h-10 sm:h-8">Schedule</LinkButton>
          </div>
        )}
      </Card>
    </HelpZone>
  );
}

/** Forecast sales by hour (busy stretch dark), with people on vs needed underneath. */
function HourStrip({ b }: { b: MorningBrief }) {
  const hours = b.day.hours;
  const demand = new Map((b.crew?.demand ?? []).map((d) => [d.hour, d]));
  const span = activeSpan(hours, [...Array(24)].map((_, h) => demand.get(h)?.have ?? 0));
  if (!span || !hours.some((x) => x > 0)) return null;
  const [from, to] = span;
  const list = [...Array(to - from)].map((_, i) => from + i);
  const max = Math.max(1, ...list.map((h) => hours[h] ?? 0));
  const busy = b.day.busy;
  const inBusy = (h: number) => !!busy && h >= busy.from && h < busy.toExclusive;
  const showCrew = demand.size > 0;
  const every = list.length > 12 ? 3 : 2;
  return (
    <div className="border-t border-border px-5 pt-4 pb-4 sm:px-6" aria-label="Forecast by hour">
      <div className="grid items-end gap-[3px]" style={{ gridTemplateColumns: `repeat(${list.length}, minmax(0, 1fr))` }}>
        {list.map((h) => (
          <div key={h} className="flex h-16 items-end" title={`${hourLabel(h)}: ${whole(hours[h] ?? 0)} forecast${demand.get(h) ? ` · ${demand.get(h)!.have} on, ${Math.ceil(demand.get(h)!.need - 1e-9)} needed` : ""}`}>
            <div className={cx("w-full rounded-[3px]", inBusy(h) ? "bg-series-1" : "bg-series-1/25")} style={{ height: `${Math.max((hours[h] ?? 0) > 0 ? 6 : 2, ((hours[h] ?? 0) / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      {showCrew && (
        <div className="mt-1.5 grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${list.length}, minmax(0, 1fr))` }}>
          {list.map((h) => {
            const d = demand.get(h);
            const need = d ? Math.ceil(d.need - 1e-9) : 0;
            const short = !!d && need - d.have >= 1;
            return (
              <div key={h} className={cx("num grid h-6 place-items-center rounded-[3px] text-[10px] leading-none", short ? "bg-warn-bg font-semibold text-warn" : "bg-surface-2 text-muted")}>
                {d ? d.have : ""}
              </div>
            );
          })}
        </div>
      )}
      <div className="mt-1 grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${list.length}, minmax(0, 1fr))` }}>
        {list.map((h, i) => (
          <div key={h} className="num overflow-visible text-center text-[10px] whitespace-nowrap text-muted">{i % every === 0 ? hourLabel(h).replace("m", "") : ""}</div>
        ))}
      </div>
      {showCrew && <p className="mt-2 text-[11px] text-muted">Numbers under the bars are people on each hour; amber means fewer than the forecast needs.</p>}
    </div>
  );
}

// ---- Before tonight -----------------------------------------------------------------------

function TonightCard({ b, items, focused, prep }: { b: MorningBrief; items: TonightItem[]; focused: boolean; prep: boolean }) {
  return (
    <HelpZone id="brief.tonight" tour="brief.tonight">
      <Card className="overflow-hidden">
        <CardTitle icon={CircleCheck} label="Before tonight" help="brief.tonight" action={items.length > 0 ? <span className="num text-xs text-muted">{items.length}</span> : undefined} />
        {items.length === 0 ? (
          <div className="flex items-center gap-3 border-t border-border px-5 py-4 text-sm text-ink-2 sm:px-6">
            <span className="grid size-8 place-items-center rounded-lg bg-good-bg text-good"><CircleCheck aria-hidden className="size-4" /></span>
            {focused ? "Nothing in your areas needs you before tonight." : "Nothing needs you. Orders, deliveries, invoices, kegs and tanks are all clear."}
          </div>
        ) : (
          <div className="divide-y divide-border border-t border-border">
            {items.slice(0, 8).map((t) => {
              const Icon = TONIGHT_ICON[t.kind];
              return (
                <Link key={t.key} href={t.href} className="flex min-h-14 items-center gap-3 px-5 py-3 transition-colors duration-120 hover:bg-surface-2/60 sm:px-6">
                  <span aria-hidden className={cx("grid size-8 shrink-0 place-items-center rounded-lg", CHIP[t.tone])}><Icon className="size-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">{t.title}</span>
                    <span className="block truncate text-xs text-muted">{t.detail}</span>
                  </span>
                  <ChevronRight aria-hidden className="size-4 shrink-0 text-muted" />
                </Link>
              );
            })}
            {items.length > 8 && <div className="px-5 py-2.5 text-xs text-muted sm:px-6">and {items.length - 8} more on the <Link href="/" className="underline underline-offset-2 hover:text-ink">Overview</Link></div>}
          </div>
        )}
        {prep && (
          <Link href="/prep" className="flex min-h-12 items-center gap-3 border-t border-border bg-surface-2/40 px-5 py-2.5 text-sm transition-colors hover:bg-surface-2 sm:px-6">
            <UtensilsCrossed aria-hidden className="size-4 shrink-0 text-ink-2" strokeWidth={1.75} />
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-ink">Today&apos;s prep list</span>
              {b.prepToday && (
                <span className="block truncate text-xs text-muted">
                  {b.prepToday.toMake === 0
                    ? "Nothing to make"
                    : [`${b.prepToday.toMake} to make`, b.prepToday.done ? `${b.prepToday.done} done` : null, b.prepToday.runningOut ? `${b.prepToday.runningOut} running out` : null, b.prepToday.notCounted ? `${b.prepToday.notCounted} not counted` : null, b.prepToday.top.length ? joinList(b.prepToday.top.map((t) => t.name)) : null].filter(Boolean).join(" · ")}
                </span>
              )}
            </span>
            <ChevronRight aria-hidden className="size-4 shrink-0 text-muted" />
          </Link>
        )}
      </Card>
    </HelpZone>
  );
}

// ---- Elsewhere (with a focus) -------------------------------------------------------------

/** The areas this person doesn't look after: a line each, tap to open what's waiting there. */
function ElsewhereCard({ groups }: { groups: ElsewhereGroup<TonightItem>[] }) {
  return (
    <HelpZone id="brief.elsewhere">
      <Card className="overflow-hidden">
        <CardTitle icon={Compass} label="Elsewhere" help="brief.elsewhere" action={<Link href="/settings/notifications#focus" className="relative text-xs text-muted hover:text-ink after:absolute after:-inset-2 after:content-['']">Change →</Link>} />
        <div className="divide-y divide-border border-t border-border">
          {groups.map((g) =>
            g.items.length ? (
              <details key={g.area} className="group">
                <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-5 py-2.5 text-sm hover:bg-surface-2/60 sm:px-6 [&::-webkit-details-marker]:hidden">
                  <span className="w-20 shrink-0 font-medium text-ink">{g.label}</span>
                  <span className="min-w-0 flex-1 truncate text-ink-2">{g.line}</span>
                  <span className="num shrink-0 rounded-md bg-surface-2 px-1.5 py-0.5 text-xs font-medium text-ink-2">{g.items.length}</span>
                  <ChevronRight aria-hidden className="size-4 shrink-0 text-muted transition-transform group-open:rotate-90" />
                </summary>
                <div className="divide-y divide-border border-t border-border bg-surface-2/30">
                  {g.items.map((t) => {
                    const Icon = TONIGHT_ICON[t.kind];
                    return (
                      <Link key={t.key} href={t.href} className="flex min-h-12 items-center gap-3 px-5 py-2.5 transition-colors duration-120 hover:bg-surface-2/60 sm:px-6">
                        <span aria-hidden className={cx("grid size-7 shrink-0 place-items-center rounded-lg", CHIP[t.tone])}><Icon className="size-3.5" /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-ink">{t.title}</span>
                          <span className="block truncate text-xs text-muted">{t.detail}</span>
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </details>
            ) : (
              <Link key={g.area} href={g.href} className="flex min-h-12 items-center gap-3 px-5 py-2.5 text-sm hover:bg-surface-2/60 sm:px-6">
                <span className="w-20 shrink-0 font-medium text-ink">{g.label}</span>
                <span className="min-w-0 flex-1 truncate text-muted">{g.line}</span>
                <ChevronRight aria-hidden className="size-4 shrink-0 text-muted" />
              </Link>
            ),
          )}
        </div>
      </Card>
    </HelpZone>
  );
}

// ---- Last night ---------------------------------------------------------------------------

function NotesCard({ b, viewer, usual }: { b: MorningBrief; viewer: { userId: string; role: "MANAGER" | "STAFF" }; usual: string[] }) {
  const notes = b.notes;
  const date = notes.find((n) => n.date < b.today)?.date ?? (notes.length ? b.today : b.yesterday);
  const title = date === b.yesterday ? "Last night's notes" : date === b.today ? "Today's notes" : `Notes from ${dayDate(date)}`;
  return (
    <HelpZone id="brief.notes" tour="brief.notes">
      <section>
        <CardTitle icon={NotebookPen} label={title} help="brief.notes" bare action={<Link href="/notes" className="relative text-xs text-muted hover:text-ink after:absolute after:-inset-2 after:content-['']">All notes →</Link>} />
        {notes.length === 0 ? (
          <Card className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm text-muted">
            <span>Nobody left a shift note last night.</span>
            <LinkButton href="/notes" variant="secondary" size="sm" className="h-10 sm:h-8"><Plus className="size-3.5" />Add a note</LinkButton>
          </Card>
        ) : (
          <div className="space-y-3">
            {notes.map((n) => <NoteCard key={n.id} note={n} viewer={viewer} today={b.today} usual={usual} compact showDate={n.date !== b.yesterday} />)}
          </div>
        )}
      </section>
    </HelpZone>
  );
}

// ---- Monday: last week ----------------------------------------------------------------------

function WrapCard({ w }: { w: NonNullable<MorningBrief["wrap"]> }) {
  return (
    <HelpZone id="brief.wrap" tour="brief.wrap">
      <Card className="overflow-hidden">
        <CardTitle icon={History} label={<>Last week · {shortDate(w.from)} – {shortDate(w.to)}</>} help="brief.wrap" action={<Link href={`/pnl?period=custom&from=${w.from}&to=${w.to}`} className="relative text-xs text-muted hover:text-ink after:absolute after:-inset-2 after:content-['']">P&amp;L →</Link>} />
        <div className="grid grid-cols-2 border-t border-border sm:grid-cols-4">
          <Figure label="Sales" help="pnl.sales" value={whole(w.sales)} sub={w.budget ? `budget ${whole(w.budget)}` : "no budget set"} />
          <Figure label={w.vsBudget != null ? "vs budget" : "vs week before"} value={w.vsBudget != null ? signedPct(w.vsBudget, 0) : w.vsPrev != null ? signedPct(w.vsPrev, 0) : "—"} sub={w.vsBudget != null && w.vsPrev != null ? `${signedPct(w.vsPrev, 0)} on the week before` : " "} tone={(w.vsBudget ?? w.vsPrev) == null ? undefined : (w.vsBudget ?? w.vsPrev)! >= -0.03 ? "good" : "warn"} />
          <Figure label="Labor" help="brief.figure.labor" value={w.laborPct == null ? "—" : pct(w.laborPct, 0)} sub="of sales" />
          <Figure label="Profit (est.)" help="brief.figure.profit" value={w.profit == null ? "—" : signedWhole(w.profit)} sub="before fixed costs" tone={w.profit != null && w.profit < 0 ? "bad" : undefined} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3.5 sm:px-6">
          <p className="min-w-0 text-sm text-ink-2">{w.best ? `Best day was ${dayDate(w.best.date)} at ${whole(w.best.sales)}.` : w.lines[0]}</p>
          <LinkButton href="/brief?view=week" variant="secondary" size="sm" className="h-10 sm:h-8">This week</LinkButton>
        </div>
      </Card>
    </HelpZone>
  );
}
