import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, ChevronRight, MapPin, Search } from "lucide-react";
import { HelpTip, HelpZone } from "@/components/help";
import { Badge, Card, cx, EmptyState, LinkButton, Section, Table, Td, Th, Tr } from "@/components/ui";
import { EVENT_LABEL, MEDIUM_LABEL, parsePeriod, PERIODS, sourceLabel, type Medium } from "@/domain/webAnalytics";
import { RangeChips } from "../../online/bits";
import { CHANNEL } from "../../online/channel";
import { businessDateOf, money, pct, shortDate } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { publicOrigin } from "@/server/services/public-url";
import { db } from "@/server/db";
import { webDashboard, type Kpi, type WebDashboard } from "@/server/services/webDashboard";
import { cachedWebFindings } from "@/server/services/webInsights";
import type { LabFinding } from "@/domain/lab";
import { RateRange, ShareBar, TrendChart } from "./charts";
import { LinkToggle, RefreshButton, TrackingSetup } from "./client";

export const metadata = { title: "Website analytics" };

export default async function WebsiteAnalyticsPage({ searchParams }: { searchParams: Promise<{ range?: string; p?: string }> }) {
  await requireUser("MANAGER");
  const sp = await searchParams;
  // ?range= like every Online page; ?p= from links saved before.
  const periodId = parsePeriod(sp.range ?? sp.p);
  const [d, lastHit, ops, findings] = await Promise.all([webDashboard(periodId), db.webHit.findFirst({ orderBy: { at: "desc" }, select: { at: true } }), publicOrigin(), cachedWebFindings()]);
  const label = PERIODS.find((p) => p.id === periodId)!.label;

  return (
    <div>
      <HelpZone id="website.analytics" className="mb-4">
        <p className="max-w-2xl text-sm text-muted">Who visits the website, where they come from, and what they do next: call, get directions, order, book or ask about a private event. No cookies, no tracking people.</p>
      </HelpZone>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3" data-tour="webanalytics.period">
        <RangeChips base="/website/analytics" range={periodId} />
        <div className="flex items-center gap-3 text-xs text-muted">
          <span>
            {shortDate(d.from)} to {shortDate(d.to)}, compared with the {label} before
          </span>
          <RefreshButton />
        </div>
      </div>

      {/* An old test visit isn't tracking: with no visits in the period there is nothing to chart, only the setup. */}
      {!d.hasData || d.kpis.sessions.cur === 0 ? (
        <NoData d={d} lastHit={lastHit?.at ?? null} label={label} />
      ) : (
        <>
          <Kpis d={d} label={label} />
          <WorthKnowing items={findings} />
          <Section title="Visits a day" description={`Each line is a day; the dashed line is the same day in the ${label} before.`} help="website.analytics.trend">
            <Card className="p-4 pt-8 sm:p-5 sm:pt-9">
              <TrendChart points={d.trend.map((t) => ({ x: t.x, cur: t.sessions, prev: t.prevSessions }))} label="Visits" prevLabel={`The ${label} before`} />
            </Card>
          </Section>
          <Funnel d={d} />
          <Actions d={d} />
          <Sources d={d} />
          <Pages d={d} />
          <EventPages d={d} />
          <Audience d={d} />
          <SalesLink d={d} />
          <Inquiries d={d} />
        </>
      )}
      <Google />
      <TrackingSetup origins={d.origins} website={d.website} lastHit={lastHit?.at.toISOString() ?? null} ops={ops} />
    </div>
  );
}

// ---- Numbers --------------------------------------------------------------------------------

function Change({ k, invert, rate }: { k: Kpi; invert?: boolean; rate?: boolean }) {
  if (k.change == null) return <span className="text-muted">nothing to compare yet</span>;
  const up = k.change > 0;
  const good = invert ? !up : up;
  const size = rate ? `${Math.abs((k.cur - k.prev) * 100).toFixed(1)} pts` : pct(Math.abs(k.change), 0);
  if (!k.clear) return <span className="text-muted">about the same ({up ? "+" : "−"}{size})</span>;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cx("inline-flex items-center gap-0.5 font-medium", good ? "text-good" : "text-bad")}>
      <Icon className="size-3.5" aria-hidden />
      {up ? "+" : "−"}
      {size} <span className="font-normal text-muted">vs before</span>
    </span>
  );
}

function KpiCard({ label, value, k, help, invert, rate, tour }: { label: string; value: string; k: Kpi; help: string; invert?: boolean; rate?: boolean; tour?: string }) {
  return (
    <HelpZone id={help} className="h-full min-w-0">
      <Card className="relative flex h-full min-w-0 flex-col overflow-hidden p-4 sm:p-5" data-tour={tour}>
        <div className="truncate text-[0.8rem] font-medium text-muted">{label}</div>
        <div className="num mt-1.5 truncate text-[1.6rem] font-semibold tracking-tight">{value}</div>
        <div className="mt-1 text-[0.78rem]">
          <Change k={k} invert={invert} rate={rate} />
        </div>
      </Card>
    </HelpZone>
  );
}

const n0 = (n: number) => Math.round(n).toLocaleString("en-US");

function Kpis({ d }: { d: WebDashboard; label: string }) {
  const k = d.kpis;
  return (
    <div className="mb-10 grid grid-cols-2 gap-3 lg:grid-cols-5" data-tour="webanalytics.kpis">
      <KpiCard label="People" value={n0(k.visitors.cur)} k={k.visitors} help="website.analytics.visitors" />
      <KpiCard label="Visits" value={n0(k.sessions.cur)} k={k.sessions} help="website.analytics.visits" />
      <KpiCard label="Pages viewed" value={n0(k.views.cur)} k={k.views} help="website.analytics.views" />
      <KpiCard label="Actions taken" value={n0(k.actions.cur)} k={k.actions} help="website.analytics.actions" />
      <div className="col-span-2 lg:col-span-1">
        <KpiCard label="Visits that act" value={pct(k.convRate.cur, 1)} k={k.convRate} rate help="website.analytics.rate" tour="webanalytics.rate" />
      </div>
    </div>
  );
}

// ---- Funnel ----------------------------------------------------------------------------------

function Funnel({ d }: { d: WebDashboard }) {
  const first = d.funnel[0]?.value ?? 0;
  return (
    <Section title="From visit to visit-in-person" description="How many visits looked at what we offer, and how many then did something that brings someone through the door." help="website.analytics.funnel">
      <Card className="p-4 sm:p-5" data-tour="webanalytics.funnel">
        <ol className="space-y-4">
          {d.funnel.map((s, i) => (
            <li key={s.id}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 text-ink-2">{s.label}</span>
                <span className="num shrink-0 font-semibold">{n0(s.value)}</span>
              </div>
              <div className="mt-1.5 h-7 w-full rounded-md" style={{ background: "color-mix(in oklab, var(--ink) 6%, var(--surface))" }}>
                <div className="flex h-full items-center rounded-md px-2 text-xs font-medium" style={{ width: `${first ? Math.max(3, (s.value / first) * 100) : 0}%`, background: i === 0 ? `color-mix(in oklab, ${CHANNEL.website} 40%, var(--surface))` : i === 1 ? `color-mix(in oklab, ${CHANNEL.website} 70%, var(--surface))` : CHANNEL.website, color: i === 0 ? "var(--ink)" : "#fff" }}>
                  {s.ofStart != null && s.ofStart >= 0.12 ? pct(s.ofStart, 0) : ""}
                </div>
              </div>
              {i > 0 && s.ofPrev != null && (
                <div className="mt-1 text-xs text-muted">
                  {pct(s.ofPrev, 0)} of the step before{s.ofStart != null && s.ofStart < 0.12 ? ` · ${pct(s.ofStart, 1)} of all visits` : ""}
                </div>
              )}
            </li>
          ))}
        </ol>
      </Card>
    </Section>
  );
}

function Actions({ d }: { d: WebDashboard }) {
  return (
    <Section title="What people did" description="Taps on the website that lead to a visit or a sale. The line under each says where most of them came from." help="website.analytics.actionList">
      <div id="actions" className="grid scroll-mt-20 grid-cols-2 gap-3 lg:grid-cols-3">
        {d.actions.map((a) => {
          const ch = a.prev > 0 ? a.count / a.prev - 1 : null;
          return (
            <Card key={a.kind} className="min-w-0 p-4">
              <div className="truncate text-[0.8rem] font-medium text-muted">{EVENT_LABEL[a.kind]}</div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="num text-xl font-semibold">{n0(a.count)}</span>
                {ch != null && <span className="num text-xs text-muted">{ch >= 0 ? "+" : "−"}{pct(Math.abs(ch), 0)}</span>}
              </div>
              <div className="mt-1 line-clamp-2 text-xs text-muted">{a.topSource && a.count >= 10 ? `${pct(a.topSource.share, 0)} from ${a.topSource.label}` : a.count ? "Too few to say where from" : "None yet"}</div>
            </Card>
          );
        })}
      </div>
    </Section>
  );
}

// ---- Sources ---------------------------------------------------------------------------------

function Sources({ d }: { d: WebDashboard }) {
  const overall = d.kpis.convRate.cur;
  const max = Math.min(1, Math.max(overall * 2.2, ...d.sources.map((s) => (s.vsAll === "few" ? 0 : (s.high ?? 0)))) * 1.05) || 0.1;
  const top = d.sources[0]?.sessions ?? 0;
  return (
    <Section title="Where visits come from" description="Each visit is credited to where it started. The dot is how often visits from there took an action, the shaded band is how sure that is (wider means fewer visits), and the thin line is the whole site." help="website.analytics.sources">
      <div id="sources" className="scroll-mt-20" data-tour="webanalytics.sources">
        <Table>
          <thead>
            <tr>
              <Th>Source</Th>
              <Th align="right">Visits</Th>
              <Th className="hidden w-[30%] sm:table-cell">Visits that act</Th>
              <Th align="right" className="hidden md:table-cell">Acted</Th>
            </tr>
          </thead>
          <tbody>
            {d.sources.map((s) => (
              <Tr key={s.key}>
                <Td className="max-w-[11rem] sm:max-w-none">
                  <div className="truncate font-medium">{s.label}</div>
                  <div className="mt-1 flex items-center gap-2">
                    <ShareBar value={s.sessions} max={top} className="max-w-28" />
                    <span className="hidden text-xs text-muted sm:inline">{MEDIUM_LABEL[s.medium as Medium] ?? s.medium}</span>
                  </div>
                </Td>
                <Td align="right">
                  <div>{n0(s.sessions)}</div>
                  <div className="text-xs text-muted">{pct(s.share, 0)}<span className="sm:hidden"> · {s.vsAll === "few" ? "few" : `${pct(s.rate, 0)} act`}</span></div>
                </Td>
                <Td className="hidden sm:table-cell">
                  <div className="flex items-center gap-3">
                    <RateRange rate={s.rate} low={s.vsAll === "few" ? null : s.low} high={s.vsAll === "few" ? null : s.high} overall={overall} max={max} />
                    <span className="num w-12 shrink-0 text-right text-xs">{pct(s.rate, 0)}</span>
                  </div>
                </Td>
                <Td align="right" className="hidden md:table-cell">
                  {s.vsAll === "above" ? <Badge tone="good">Better</Badge> : s.vsAll === "below" ? <Badge tone="warn">Lower</Badge> : s.vsAll === "few" ? <span className="text-xs text-muted">Too few</span> : <span className="text-xs text-muted">Typical</span>}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
        <p className="mt-2 text-xs text-muted">“Better” and “Lower” only show when the difference is too big to be luck ({pct(overall, 1)} of all visits act). Under 30 visits is too few to judge.</p>
        {d.campaigns.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <span className="text-muted">Tagged links:</span>
            {d.campaigns.map((c) => (
              <span key={c.key} className="rounded-md bg-surface-2 px-2 py-1">
                {c.key} · <span className="num">{n0(c.sessions)}</span> visits · <span className="num">{pct(c.rate, 0)}</span> act
              </span>
            ))}
          </div>
        )}
      </div>
    </Section>
  );
}

// ---- Pages -----------------------------------------------------------------------------------

function Pages({ d }: { d: WebDashboard }) {
  const max = d.pages[0]?.views ?? 0;
  return (
    <Section title="Top pages" description="Views of each page. Left right away is the share of visits that started there and saw nothing else." help="website.analytics.pages">
      <Table>
        <thead>
          <tr>
            <Th>Page</Th>
            <Th align="right">Views</Th>
            <Th align="right" className="hidden sm:table-cell">Started here</Th>
            <Th align="right" className="hidden sm:table-cell">Left right away</Th>
            <Th align="right">Visits that act</Th>
          </tr>
        </thead>
        <tbody>
          {d.pages.map((p) => (
            <Tr key={p.path}>
              <Td className="max-w-[10rem] sm:max-w-none">
                <div className="truncate text-[0.85rem]">{p.path === "/" ? "Home page" : p.path}</div>
                <ShareBar value={p.views} max={max} className="mt-1 max-w-32" />
              </Td>
              <Td align="right">{n0(p.views)}</Td>
              <Td align="right" className="hidden sm:table-cell">{n0(p.entries)}</Td>
              <Td align="right" className="hidden sm:table-cell">{p.entries >= 10 ? pct(p.bounceRate, 0) : "—"}</Td>
              <Td align="right">{p.sessions >= 10 ? pct(p.rate, 0) : "—"}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </Section>
  );
}

function EventPages({ d }: { d: WebDashboard }) {
  if (!d.eventPages.length) return null;
  return (
    <Section title="Event pages" description="Each event's page: views, and taps on its ticket or RSVP link." help="website.analytics.events">
      <Table>
        <thead>
          <tr>
            <Th>Event page</Th>
            <Th align="right">Views</Th>
            <Th align="right">Tickets</Th>
            <Th align="right" className="hidden sm:table-cell">RSVPs</Th>
            <Th align="right" className="hidden sm:table-cell">Visits that act</Th>
          </tr>
        </thead>
        <tbody>
          {d.eventPages.map((e) => (
            <Tr key={e.path}>
              <Td className="max-w-[11rem] truncate text-[0.85rem] sm:max-w-none">{e.path.replace(/^\/events\//, "")}</Td>
              <Td align="right">{n0(e.views)}</Td>
              <Td align="right">{n0(e.tickets)}</Td>
              <Td align="right" className="hidden sm:table-cell">{n0(e.rsvps)}</Td>
              <Td align="right" className="hidden sm:table-cell">{e.sessions >= 10 ? pct(e.rate, 0) : "—"}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </Section>
  );
}

// ---- Devices and places ------------------------------------------------------------------------

function Audience({ d }: { d: WebDashboard }) {
  const dmax = d.devices[0]?.sessions ?? 0;
  const pmax = d.places[0]?.sessions ?? 0;
  const DEVICE: Record<string, string> = { mobile: "Phones", desktop: "Computers", tablet: "Tablets" };
  return (
    <div className="mb-10 grid gap-6 lg:grid-cols-2">
      <Section title="Devices" description="What people use to visit, and how often each kind of visit acts." help="website.analytics.devices" className="mb-0">
        <Card className="space-y-4 p-4 sm:p-5">
          {d.devices.map((x) => (
            <div key={x.key}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span>{DEVICE[x.key] ?? x.key}</span>
                <span className="num text-muted">
                  <span className="font-semibold text-ink">{pct(x.share, 0)}</span> · {pct(x.rate, 0)} act
                </span>
              </div>
              <ShareBar value={x.sessions} max={dmax} className="mt-1.5" />
            </div>
          ))}
        </Card>
      </Section>
      <Section title="Where visitors are" description="Rough location from the internet connection (city level). Never stored with anything that identifies a person." help="website.analytics.places" className="mb-0">
        <Card className="p-4 sm:p-5">
          {d.places.length ? (
            <ul className="space-y-2.5">
              {d.places.map((p) => (
                <li key={p.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
                  <span className="truncate text-sm">{p.label}</span>
                  <span className="num text-sm text-muted">{pct(p.share, 0)}</span>
                  <ShareBar value={p.sessions} max={pmax} className="col-span-2" />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Locations appear once the website runs on Vercel, which adds a rough location to each request.</p>
          )}
        </Card>
      </Section>
    </div>
  );
}

// ---- Website ↔ sales -------------------------------------------------------------------------

function SalesLink({ d }: { d: WebDashboard }) {
  const l = d.link;
  const verdict = l.directions.verdict === "real" ? l.directions : l.all.verdict === "real" ? l.all : l.directions;
  return (
    <Section title="Website and sales" description="Do busier website days go with busier days at the taproom? Compared within each weekday, with the season and event days allowed for. Last 12 months." help="website.analytics.salesLink">
      <div id="sales" className="scroll-mt-20">
        <Card className="p-4 sm:p-5" data-tour="webanalytics.sales">
          <div className="flex flex-wrap items-start gap-3">
            <Badge tone={verdict.verdict === "real" ? "good" : "neutral"}>{verdict.verdict === "real" ? "Goes together" : verdict.verdict === "unclear" ? "No clear link yet" : "Not enough data yet"}</Badge>
            <p className="min-w-0 flex-1 basis-60 text-sm text-ink-2">{verdict.sentence}</p>
          </div>
          {verdict.why && <p className="mt-2 text-xs text-muted">{verdict.why}</p>}
          {l.days.length > 7 && (
            <div className="mt-5">
              <LinkToggle days={l.days} />
            </div>
          )}
          <p className="mt-3 text-xs text-muted">
            Each day&apos;s sales are set against that day&apos;s website actions, Mondays with Mondays and so on, leaving out event days and closed days. It needs at least 8 weeks of days to say anything, and even then it shows the two move together, not that one causes the other.{" "}
            <HelpTip id="website.analytics.salesLink" />
          </p>
        </Card>
      </div>
    </Section>
  );
}

// ---- Private events --------------------------------------------------------------------------

function Inquiries({ d }: { d: WebDashboard }) {
  const q = d.inquiries;
  return (
    <Section title="Private-event inquiries from the website" description="Inquiries sent through the website's form, where they came from, and what became of them." help="website.analytics.inquiries">
      {q.total.inquiries === 0 ? (
        <Card className="p-5 text-sm text-muted">No inquiries from the website in this period.</Card>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Source</Th>
              <Th align="right">Inquiries</Th>
              <Th align="right" className="hidden sm:table-cell">Quoted</Th>
              <Th align="right">Booked</Th>
              <Th align="right">Booked revenue</Th>
            </tr>
          </thead>
          <tbody>
            {q.rows.map((r) => (
              <Tr key={r.source}>
                <Td className="font-medium">{sourceLabel(r.source)}</Td>
                <Td align="right">{r.inquiries}</Td>
                <Td align="right" className="hidden sm:table-cell">{r.quoted}</Td>
                <Td align="right">{r.booked}</Td>
                <Td align="right">{money(r.revenue, { whole: true })}</Td>
              </Tr>
            ))}
            <Tr className="font-semibold">
              <Td>All</Td>
              <Td align="right">{q.total.inquiries}</Td>
              <Td align="right" className="hidden sm:table-cell">{q.total.quoted}</Td>
              <Td align="right">{q.total.booked}</Td>
              <Td align="right">{money(q.total.revenue, { whole: true })}</Td>
            </Tr>
          </tbody>
        </Table>
      )}
      <p className="mt-2 text-xs text-muted">
        Booked means a deposit, confirmed or done; revenue is the quote total. <Link href="/events/private" className="underline underline-offset-2 hover:text-ink">Private events</Link>
      </p>
    </Section>
  );
}

// ---- Google ------------------------------------------------------------------------------------

/** Google's own numbers live under Online; this is the way there, so nothing is shown twice. */
function Google() {
  const rows = [
    { href: "/online#searches", icon: <Search className="size-4" />, title: "Google Search", body: "How often the website shows up in Google's results, the searches behind it, and how many people click through." },
    { href: "/online/google", icon: <MapPin className="size-4" />, title: "Google listing", body: "How often the listing is shown on Maps and Search, and the calls, direction requests and website clicks from it." },
  ];
  return (
    <Section title="Google" description="Google Search and the Google listing have their own pages under Online, beside the website's numbers." help="website.analytics.google" actions={<LinkButton href="/settings/connections/google" variant="ghost" size="sm">Manage the connection</LinkButton>}>
      <Card className="divide-y divide-border overflow-hidden" data-tour="webanalytics.google">
        {rows.map((r) => (
          <Link key={r.href} href={r.href} className="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors duration-120 hover:bg-surface-2/60 active:bg-surface-2 sm:px-5">
            <span aria-hidden className="shrink-0 text-muted">{r.icon}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{r.title}</span>
              <span className="block text-xs text-pretty text-muted">{r.body}</span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
          </Link>
        ))}
      </Card>
    </Section>
  );
}

function NoData({ d, lastHit, label }: { d: WebDashboard; lastHit: Date | null; label: string }) {
  const title = !d.origins.length ? "Tell the app the website's address" : lastHit ? `No visits in the last ${label}` : "Waiting for the first visit";
  const body = !d.origins.length
    ? "Add the website's address on the Website overview (or below), then add the snippet to the website."
    : lastHit
      ? `The last visit arrived ${shortDate(businessDateOf(lastHit))}. The website has probably lost its small analytics snippet: put it back (below) and visits show here within a minute.`
      : "The website needs the small analytics snippet (below). Visits show here within a minute of it going live. Nothing has arrived yet.";
  return (
    <div className="mb-10">
      <EmptyState title={title} action={<LinkButton href="#tracking" variant="primary">See the setup</LinkButton>}>
        {body}
      </EmptyState>
      <HelpTip id="website.analytics.setup" className="mt-2" />
    </div>
  );
}

function WorthKnowing({ items }: { items: LabFinding[] }) {
  if (!items.length) return null;
  return (
    <Section title="Worth knowing" description="Found in the last 28 days, only when the numbers are clear. Also in Insights." help="website.analytics.findings">
      <div className="grid gap-3 lg:grid-cols-2">
        {items.map((f) => (
          <Card key={f.key} className="min-w-0 p-4">
            <div className="text-sm font-semibold text-ink">{f.title}</div>
            <p className="mt-1 text-sm text-ink-2">{f.action}</p>
            {f.how[0] && <p className="mt-1.5 text-xs text-muted">{f.how[0]}</p>}
          </Card>
        ))}
      </div>
    </Section>
  );
}
