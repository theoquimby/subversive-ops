import { Badge, Card, LinkButton, PageHeader, Section, Td, Th, Tr } from "@/components/ui";
import { GOOGLE_SETUP_HREF, parseRange } from "@/domain/online";
import { relativeTime, shortDate } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { googleListing, type ListingBlock, type ListingConnection } from "@/server/services/online";
import { Change, MAPS_FILL, MeasureRow, n0, Notice, PartsBar, RangeChips, SEARCH_FILL, spanText, VIEW_FILL } from "../bits";
import { StackBars, Trend, TrendKey } from "../charts";

export const metadata = { title: "Google listing" };

const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

/** What each action counts, in a line. */
const ACTION_COUNTS: Record<string, { counts: string; unit: string }> = {
  BUSINESS_DIRECTION_REQUESTS: { counts: "Times someone asked Google for directions to you", unit: "direction requests" },
  CALL_CLICKS: { counts: "Taps on the listing's Call button", unit: "calls" },
  WEBSITE_CLICKS: { counts: "Taps on the listing's Website button", unit: "website clicks" },
  BUSINESS_FOOD_MENU_CLICKS: { counts: "Taps to see the menu from the listing", unit: "menu views" },
  BUSINESS_BOOKINGS: { counts: "Bookings made through the listing", unit: "bookings" },
};

export default async function GoogleListingPage({ searchParams }: { searchParams: Promise<{ range?: string | string[] }> }) {
  await requireUser("MANAGER");
  const r = await googleListing(parseRange((await searchParams).range));
  const l = r.listing.data;

  return (
    <>
      <PageHeader
        help="online.google"
        title="Google listing"
        back={{ href: "/online", label: "Online" }}
        description="The listing guests see on Google Maps and Google Search: how often it is shown, and what people do from it."
        actions={l ? <RangeChips base="/online/google" range={r.range} /> : undefined}
      />

      {l ? (
        <>
          <p className="-mt-3 mb-6 text-xs text-pretty text-muted">
            {spanText(l.windows.cur)}, compared with the {r.period} before.{" "}
            {l.stale && l.through ? <span className="text-warn">Nothing newer than {shortDate(l.through)} has arrived from Google.</span> : "Google's numbers arrive two or three days late."}
            {l.since && <> Counting since {shortDate(l.since)}.</>}
          </p>
          <Views l={l} period={r.period} />
          <Actions l={l} period={r.period} />
          <Keywords l={l} />
        </>
      ) : (
        <Section>
          <Card className="p-5 sm:p-6">
            <Notice state={r.listing.state} bare />
            {r.listing.state.kind !== "unavailable" && (
              <div className="mt-5 border-t border-border pt-4">
                <h2 className="text-sm font-semibold text-ink">What will show here</h2>
                <ul className="mt-2 space-y-1.5 text-sm text-pretty text-ink-2">
                  <li>How often the listing is shown, split by Google Maps and Google Search, and by phone and computer.</li>
                  <li>Calls, direction requests, website clicks and menu views from the listing, day by day.</li>
                  <li>What people searched for when the listing came up, a month at a time.</li>
                </ul>
              </div>
            )}
          </Card>
        </Section>
      )}

      <Connection c={r.connection} through={l?.through ?? null} waiting={r.listing.state.kind === "waiting"} />
    </>
  );
}

function Views({ l, period }: { l: ListingBlock; period: string }) {
  return (
    <Section help="online.google.views" title="Times the listing was shown" description="Each time the listing appeared in front of someone on Google Maps or in Google Search results.">
      <Card className="divide-y divide-border">
        <div className="p-4 sm:p-5">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="num text-[1.75rem] leading-tight font-semibold tracking-tight">{n0(l.views.cur)}</span>
            <span className="text-xs"><Change d={l.views} period={period} /></span>
          </div>
          <div className="mt-4">
            <PartsBar what="times shown" columns="grid-cols-2 lg:grid-cols-4" parts={l.split.map((s) => ({ key: s.key, label: s.label, value: s.value, fill: VIEW_FILL[s.key] }))} />
          </div>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
            <span>
              On Maps <span className="num font-medium text-ink-2">{n0(l.maps.cur)}</span> <Change d={l.maps} period={period} compact />
            </span>
            <span>
              In Search <span className="num font-medium text-ink-2">{n0(l.search.cur)}</span> <Change d={l.search} period={period} compact />
            </span>
          </div>
        </div>
        <div className="p-4 sm:p-5">
          <StackBars
            title="Times the listing was shown, on Maps and in Search"
            unit="times shown"
            series={[{ label: "Google Maps", ...MAPS_FILL }, { label: "Google Search", ...SEARCH_FILL }]}
            points={l.surfaceTrend.map((p) => ({ x: p.x, to: p.to, values: [p.maps, p.search] }))}
          />
        </div>
      </Card>
    </Section>
  );
}

function Actions({ l, period }: { l: ListingBlock; period: string }) {
  return (
    <Section help="online.google.actions" title="What people did from the listing" description="Each on its own scale, over the same period.">
      <Card className="divide-y divide-border">
        {l.actionTrends.some((a) => a.points.some((pt) => pt.prev != null)) && (
          <div className="px-4 py-2.5 sm:px-5">
            <TrendKey period={period} />
          </div>
        )}
        {l.actionTrends.map((a) => (
          <MeasureRow key={a.metric} title={a.label} counts={ACTION_COUNTS[a.metric]?.counts ?? ""} value={n0(a.total.cur)} change={<Change d={a.total} period={period} />}>
            <Trend points={a.points} title={a.label} unit={ACTION_COUNTS[a.metric]?.unit ?? "times"} period={period} height={104} legend={false} />
          </MeasureRow>
        ))}
      </Card>
      <p className="mt-2 text-xs text-pretty text-muted">Messages and food orders sent from the listing aren&apos;t brought in, so they aren&apos;t counted here.</p>
    </Section>
  );
}

function Keywords({ l }: { l: ListingBlock }) {
  const max = Math.max(1, ...l.keywords.map((k) => k.value ?? 0));
  return (
    <div id="keywords" className="scroll-mt-24">
      <Section
        help="online.google.keywords"
        title="Searches that showed the listing"
        description={l.keywordMonth ? `${monthName(l.keywordMonth)}${l.keywordMonthPartial ? ", so far" : ""}. Google counts the people who searched each term in a calendar month.` : "What people typed before the listing came up on Google Search or Maps."}
      >
        {l.keywords.length === 0 ? (
          <Card className="p-4 text-sm text-pretty text-muted sm:p-5">Google hasn&apos;t sent any search terms for the listing yet. They arrive a month at a time, a few days after the month ends.</Card>
        ) : (
          <Card className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <Th>Search</Th>
                  <Th className="hidden w-[40%] sm:table-cell" />
                  <Th align="right">People</Th>
                </tr>
              </thead>
              <tbody>
                {l.keywords.map((k) => (
                  <Tr key={k.keyword}>
                    <Td className="max-w-[11rem] truncate sm:max-w-none">{k.keyword}</Td>
                    <Td className="hidden sm:table-cell">
                      {k.value != null && (
                        <div className="h-1.5 w-full rounded-full" style={{ background: "color-mix(in oklab, var(--ink) 7%, var(--surface))" }}>
                          <div className="h-full rounded-full" style={{ width: `${Math.max(2, (k.value / max) * 100)}%`, background: "var(--area)", opacity: 0.85 }} />
                        </div>
                      )}
                    </Td>
                    <Td align="right">{k.value != null ? n0(k.value) : <span className="text-muted">under {k.threshold ?? 15}</span>}</Td>
                  </Tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
        <p className="mt-2 text-xs text-pretty text-muted">Google hides exact numbers for terms only a few people searched and shows &ldquo;under 15&rdquo; instead.</p>
      </Section>
    </div>
  );
}

function Connection({ c, through, waiting }: { c: ListingConnection | null; through: string | null; /** Google hasn't approved access yet: its refusal is expected, not a fault. */ waiting: boolean }) {
  return (
    <Section help="online.google.connection" title="Connection" description="Read-only. The app reads these numbers from Google every night and never changes the listing.">
      <Card className="flex flex-wrap items-center justify-between gap-4 p-4 sm:p-5">
        {c ? (
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-ink">{c.title ?? (waiting ? "Signed in to Google" : "No listing picked yet")}</span>
              <Badge tone={waiting ? "neutral" : c.error ? "warn" : c.connected ? "good" : "neutral"}>{waiting ? "Waiting on Google" : c.error ? "Needs a look" : c.connected ? "Google connected" : "Not connected"}</Badge>
            </div>
            <p className="mt-1 text-sm text-pretty text-muted">
              {c.lastSyncAt ? `Last checked ${relativeTime(new Date(c.lastSyncAt))}` : waiting ? "Google hasn't let the app read the listing yet" : "Not checked yet"}
              {through ? `. Numbers through ${shortDate(through)}` : ""}
              {c.connectedBy ? `. Connected by ${c.connectedBy}` : ""}.
            </p>
            {c.error && <p className={waiting ? "mt-1 text-sm text-pretty text-muted" : "mt-1 text-sm text-pretty text-warn"}>{c.error}</p>}
          </div>
        ) : (
          <p className="min-w-0 text-sm text-muted">Couldn&apos;t read the connection just now. Try again in a minute.</p>
        )}
        <LinkButton href={c?.manageHref ?? GOOGLE_SETUP_HREF} variant="secondary" className="h-10 sm:h-9">
          Manage the connection
        </LinkButton>
      </Card>
    </Section>
  );
}
