import { LineChart } from "@/components/line-chart";
import { Badge, Card, PageHeader, Section, Td, Th, Tr } from "@/components/ui";
import { parseRange, type Delta, type NextStep, type SourceState } from "@/domain/online";
import { pct, shortDate } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { SOCIAL, type SocialChannel } from "@/domain/onlineChannels";
import { onlineOverview, type Loaded, type OnlineOverview, type SocialBlock } from "@/server/services/online";
import { Camera, Globe, MapPin, Search, ThumbsUp } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Change, CHANNEL_FILL, FACEBOOK_FILL, INSTAGRAM_FILL, LISTING_FILL, LookList, MeasureRow, MoreLink, n0, Notice, PartsBar, RangeChips, spanText, SquareKey, WEBSITE_FILL, type Fill } from "./bits";
import { Trend, TrendKey } from "./charts";

export const metadata = { title: "Online" };

const RATING_AXIS: [number, number] = [1, 5];
const plural = (n: number, one: string, many = `${one}s`) => `${n0(n)} ${n === 1 ? one : many}`;
const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });

export default async function OnlinePage({ searchParams }: { searchParams: Promise<{ range?: string | string[] }> }) {
  await requireUser("MANAGER");
  const d = await onlineOverview(parseRange((await searchParams).range));
  const { search, listing, website, instagram, facebook, reviews, period } = d;
  // The key for the dashed line only shows when some chart has a period before to draw.
  const hasBefore = [search.data?.trend, listing.data?.viewsTrend, website.data?.trend, instagram.data?.viewsTrend, facebook.data?.viewsTrend].some((t) => t?.some((pt) => pt.prev != null));
  // One Facebook sign-in connects both, so while neither has numbers they share one notice.
  const socialTogether = !instagram.data && !facebook.data && instagram.state.title === facebook.state.title;

  return (
    <>
      <PageHeader
        help="online.page"
        title="Online"
        description="How guests find Subversive online and what they do next: Google Search, the Google listing, the website, Instagram, Facebook and reviews, side by side."
        actions={<RangeChips base="/online" range={d.range} />}
      />
      <p className="-mt-3 mb-6 text-xs text-pretty text-muted">
        {spanText(d.windows.cur)}, compared with the {period} before. Whole days only. Google&apos;s, Instagram&apos;s and Facebook&apos;s numbers arrive a few days late, so their rows end a little earlier.
      </p>

      <Section help="online.found" title="How people found you" description="The places a guest comes across Subversive, each over the same period.">
        <Card className="divide-y divide-border">
          {hasBefore && (
            <div className="px-4 py-2.5 sm:px-5">
              <TrendKey period={period} />
            </div>
          )}
          <Group>Search</Group>
          <MeasureRow
            icon={<Search />}
            title="Google Search"
            counts="Times the website showed up in Google's search results"
            value={search.data ? n0(search.data.shown.cur) : undefined}
            change={search.data && !search.data.stale ? <Change d={search.data.shown} period={period} /> : undefined}
            note={
              search.data ? (
                <>
                  {plural(search.data.clicks.cur, "click")} through to the website. <Through through={search.data.through} since={search.data.since} stale={search.data.stale} />
                </>
              ) : undefined
            }
          >
            {search.data ? <Trend points={search.data.trend} title="Times the website showed up in Google's search results" unit="times shown" period={period} legend={false} /> : <Notice state={search.state} />}
          </MeasureRow>

          <Group>Maps and the listing</Group>
          <MeasureRow
            icon={<MapPin />}
            title={listing.data ? <Link href="/online/google" className="underline-offset-2 hover:underline">Google listing</Link> : "Google listing"}
            counts="Times the listing was shown on Google Maps and Google Search"
            value={listing.data ? n0(listing.data.views.cur) : undefined}
            change={listing.data && !listing.data.stale ? <Change d={listing.data.views} period={period} /> : undefined}
            note={
              listing.data ? (
                <>
                  {n0(listing.data.maps.cur)} on Maps, {n0(listing.data.search.cur)} on Search. <Through through={listing.data.through} since={listing.data.since} stale={listing.data.stale} />
                </>
              ) : undefined
            }
          >
            {listing.data ? <Trend points={listing.data.viewsTrend} title="Times the listing was shown on Google Maps and Google Search" unit="times shown" period={period} legend={false} /> : <Notice state={listing.state} />}
          </MeasureRow>

          <Group>Website</Group>
          <MeasureRow
            icon={<Globe />}
            title={website.data ? <Link href="/website/analytics" className="underline-offset-2 hover:underline">Website</Link> : "Website"}
            counts="Visits to the website"
            value={website.data ? n0(website.data.visits.cur) : undefined}
            change={website.data ? <Change d={website.data.visits} period={period} /> : undefined}
            note={
              website.data ? (
                <>
                  From {plural(website.data.people.cur, "person", "people")}, counted per day. <Through through={null} since={website.data.since} stale={false} />
                </>
              ) : undefined
            }
          >
            {website.data ? <Trend points={website.data.trend} title="Visits to the website" unit="visits" period={period} legend={false} /> : <Notice state={website.state} />}
          </MeasureRow>

          {website.data && website.data.mix.total > 0 && (
            <div className="p-4 sm:p-5">
              <h3 className="text-sm font-semibold text-ink">Where website visits came from</h3>
              <p className="mt-0.5 mb-3 text-xs text-muted">Each visit is credited to where it started.</p>
              <PartsBar what="website visits" parts={website.data.mix.parts.map((p) => ({ key: p.key, label: p.label, value: p.visits, fill: CHANNEL_FILL[p.key] }))} />
              <div className="mt-3">
                <MoreLink href="/website/analytics#sources">Every source, and how often its visits act</MoreLink>
              </div>
            </div>
          )}

          <Group>Social</Group>
          {socialTogether ? (
            <MeasureRow icon={<Camera />} title="Instagram and Facebook" counts="Times your posts, and the profile or Page, were shown">
              <Notice state={instagram.state} />
            </MeasureRow>
          ) : (
            <>
              <SocialRow channel="instagram" icon={<Camera />} block={instagram} period={period} />
              <SocialRow channel="facebook" icon={<ThumbsUp />} block={facebook} period={period} />
            </>
          )}
        </Card>
      </Section>

      <Section help="online.next" title="What they did next" description="The same step in each place, side by side: the Google listing, the website, and Instagram and Facebook where they count it.">
        <NextSteps d={d} />
      </Section>

      {d.look.length > 0 && (
        <Section help="online.look" title="Worth a look" description="Only what the numbers show: a sharp change against the period before, or something not set up yet.">
          <LookList items={d.look} />
        </Section>
      )}

      <div className="grid grid-cols-1 gap-x-8 lg:grid-cols-5">
        <Section help="online.reviews" className="min-w-0 lg:col-span-2" title="Reviews" description="What guests said, from every review on file.">
          <Card className="p-4 sm:p-5">
            {reviews.data ? (
              <>
                <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                  <span className="num text-[2rem] leading-none font-semibold tracking-tight">{reviews.data.summary.rating != null ? reviews.data.summary.rating.toFixed(1) : "—"}</span>
                  <span className="text-sm text-muted">{reviews.data.summary.rating != null ? `out of 5, from ${plural(reviews.data.summary.ratingCount, "review")} in the last 90 days` : "No reviews in the last 90 days"}</span>
                </div>
                <p className="mt-3 text-sm text-ink-2">
                  <span className="num font-semibold text-ink">{n0(reviews.data.summary.inPeriod.cur)}</span> new in the last {period}
                  {reviews.data.summary.avg != null && <>, averaging <span className="num font-semibold text-ink">{reviews.data.summary.avg.toFixed(1)}</span></>}.
                </p>
                <p className="mt-0.5 text-xs">
                  {reviews.data.summary.inPeriod.prev != null ? (
                    <span className="text-muted">
                      {plural(reviews.data.summary.inPeriod.prev, "review")} in the {period} before{reviews.data.summary.prevAvg != null ? `, averaging ${reviews.data.summary.prevAvg.toFixed(1)}` : ""}.
                    </span>
                  ) : (
                    <span className="text-muted">Nothing earlier to compare with yet.</span>
                  )}
                </p>
                <div className="mt-4">
                  {reviews.data.trend.length >= 2 ? (
                    <LineChart points={reviews.data.trend} valueFormat="number" ariaLabel="Average rating of the last 5 reviews, over time" height={150} domain={RATING_AXIS} />
                  ) : (
                    <p className="py-4 text-sm text-muted">A trend line appears after a couple more reviews.</p>
                  )}
                </div>
                <p className="mt-2 text-xs text-muted">The average of the last 5 reviews, since {shortDate(reviews.data.trendFrom)}.</p>
                <div className="mt-3">
                  <MoreLink href="/reviews">Themes, replies and what to fix</MoreLink>
                </div>
              </>
            ) : (
              <Notice state={reviews.state} bare />
            )}
          </Card>
        </Section>

        <div id="searches" className="min-w-0 scroll-mt-24 lg:col-span-3">
          <Section help="online.searches" title="Top Google searches" description="What people typed when the website showed up in Google's results, most shown first.">
            {search.data ? (
              <Card className="overflow-hidden">
                <p className="border-b border-border p-4 text-sm text-pretty text-ink-2 sm:px-5">
                  The website showed up <b className="num font-semibold text-ink">{n0(search.data.shown.cur)}</b> times and was clicked <b className="num font-semibold text-ink">{n0(search.data.clicks.cur)}</b> times
                  {search.data.clickRate != null && <> ({pct(search.data.clickRate, 1)} of the time)</>}
                  {search.data.position != null && <>, sitting on average in spot <b className="num font-semibold text-ink">{search.data.position.toFixed(1)}</b></>}.
                  {search.data.brandShare != null && <> {pct(search.data.brandShare, 0)} of clicks came from people searching for Subversive by name.</>}
                </p>
                {search.data.queries.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr>
                          <Th>Search</Th>
                          <Th align="right">
                            <span className="sm:hidden">Shown</span>
                            <span className="hidden sm:inline">Times shown</span>
                          </Th>
                          <Th align="right">Clicks</Th>
                          <Th align="right" className="hidden sm:table-cell">Average spot</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {search.data.queries.map((q) => (
                          <Tr key={q.query}>
                            <Td className="max-w-[8.5rem] sm:max-w-none">
                              <span className="flex min-w-0 items-center gap-2">
                                <span className="min-w-0 truncate">{q.query}</span>
                                {q.brand && <Badge className="hidden sm:inline-flex">by name</Badge>}
                              </span>
                            </Td>
                            <Td align="right">{n0(q.shown)}</Td>
                            <Td align="right">{n0(q.clicks)}</Td>
                            <Td align="right" className="hidden sm:table-cell">{q.position != null ? q.position.toFixed(1) : "—"}</Td>
                          </Tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="p-4 text-sm text-muted sm:px-5">Google hasn&apos;t named any searches for this period. It leaves out searches only a few people made.</p>
                )}
              </Card>
            ) : (
              <Card className="p-4 sm:p-5">
                <Notice state={search.state} bare />
              </Card>
            )}
            <ListingSearches listing={listing} />
          </Section>
        </div>
      </div>
    </>
  );
}

/** A quiet label over the rows of one kind of place, so the list reads as groups, not a wall. */
function Group({ children }: { children: ReactNode }) {
  return <div className="bg-surface-2/50 px-4 py-2 text-xs font-medium text-muted sm:px-5">{children}</div>;
}

/** Instagram or the Facebook Page as a row of "How people found you". */
function SocialRow({ channel, icon, block, period }: { channel: SocialChannel; icon: ReactNode; block: Loaded<SocialBlock>; period: string }) {
  const c = SOCIAL[channel];
  const b = block.data;
  return (
    <MeasureRow
      icon={icon}
      title={b ? <Link href={c.href} className="underline-offset-2 hover:underline">{c.label}</Link> : c.label}
      counts={c.copy.views.counts}
      value={b ? n0(b.views.cur) : undefined}
      change={b && !b.stale ? <Change d={b.views} period={period} /> : undefined}
      note={
        b ? (
          <>
            {b.followers.now != null && <>{plural(b.followers.now, "follower")}. </>}
            <Through through={b.through} since={b.since} stale={b.stale} />
          </>
        ) : undefined
      }
    >
      {b ? <Trend points={b.viewsTrend} title={c.copy.views.counts} unit={c.copy.views.unit} period={period} legend={false} /> : <Notice state={block.state} />}
    </MeasureRow>
  );
}

/** "Through Nov 12." / "Counting since Nov 2." / a warning when the numbers have stopped. */
function Through({ through, since, stale }: { through: string | null; since: string | null; stale: boolean }) {
  return (
    <>
      {stale && through ? <span className="text-warn">Nothing newer than {shortDate(through)} has arrived. </span> : through ? <>Through {shortDate(through)}. </> : null}
      {since && <>Counting since {shortDate(since)}.</>}
    </>
  );
}

function SideBar({ name, d, fill, max, period }: { name: string; d: Delta; fill: Fill; max: number; period: string }) {
  return (
    <div className="grid grid-cols-[5.25rem_minmax(0,1fr)_auto] items-center gap-x-3">
      <span className="truncate text-xs text-muted">{name}</span>
      <span className="block h-2 rounded-full" style={{ background: "color-mix(in oklab, var(--ink) 7%, var(--surface))" }}>
        <span className="block h-full rounded-full" style={{ width: `${max > 0 && d.cur > 0 ? Math.max(1.5, (d.cur / max) * 100) : 0}%`, background: fill.fill, opacity: fill.opacity }} />
      </span>
      <span className="flex w-[6.75rem] items-baseline justify-end gap-2">
        <span className="text-xs"><Change d={d} period={period} compact /></span>
        <span className="num text-sm font-semibold">{n0(d.cur)}</span>
      </span>
    </div>
  );
}

/** While one side isn't ready: one line saying so, and where to look. */
function SideNote({ state, side }: { state: SourceState; side: string }) {
  if (state.kind === "ready") return null;
  return (
    <p className="border-t border-border px-4 py-3 text-xs text-pretty text-muted sm:px-5">
      <span className="font-medium text-ink-2">{state.title}.</span> {state.kind === "unavailable" ? state.body : `${side} fills in on each row after that.`}{" "}
      {state.href && state.action && <Link href={state.href} className="font-medium text-ink-2 underline underline-offset-2 hover:text-ink">{state.action}</Link>}
    </p>
  );
}

function NextSteps({ d }: { d: OnlineOverview }) {
  const steps: NextStep[] = d.next;
  if (!steps.length) {
    return (
      <Card>
        <p className="p-4 text-sm text-pretty text-muted sm:px-5">Directions, calls, menu views and private-event inquiries line up here, the Google listing beside the website, once either of them has numbers.</p>
        <SideNote state={d.listing.state} side="The Google listing's side" />
        <SideNote state={d.website.state} side="The website's side" />
      </Card>
    );
  }
  const max = Math.max(1, ...steps.flatMap((s) => [s.listing?.cur ?? 0, s.website?.cur ?? 0, s.instagram?.cur ?? 0, s.facebook?.cur ?? 0]));
  const has = (side: "instagram" | "facebook") => steps.some((s) => s[side]);
  return (
    <Card>
      <div className="border-b border-border px-4 py-3 sm:px-5">
        <SquareKey items={[{ label: "On the Google listing", fill: LISTING_FILL }, { label: "On the website", fill: WEBSITE_FILL }, ...(has("instagram") ? [{ label: "On Instagram", fill: INSTAGRAM_FILL }] : []), ...(has("facebook") ? [{ label: "On the Facebook Page", fill: FACEBOOK_FILL }] : [])]} />
      </div>
      <ol className="divide-y divide-border">
        {steps.map((s) => (
          <li key={s.key} className="grid gap-x-6 gap-y-2 px-4 py-3.5 sm:px-5 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] md:items-center">
            <div className="text-sm font-medium text-pretty">{s.label}</div>
            <div className="space-y-1.5">
              {s.listing && <SideBar name="Google listing" d={s.listing} fill={LISTING_FILL} max={max} period={d.period} />}
              {s.website && <SideBar name="Website" d={s.website} fill={WEBSITE_FILL} max={max} period={d.period} />}
              {s.instagram && <SideBar name="Instagram" d={s.instagram} fill={INSTAGRAM_FILL} max={max} period={d.period} />}
              {s.facebook && <SideBar name="Facebook" d={s.facebook} fill={FACEBOOK_FILL} max={max} period={d.period} />}
            </div>
          </li>
        ))}
      </ol>
      <SideNote state={d.listing.state} side="The Google listing's side" />
      <SideNote state={d.website.state} side="The website's side" />
      <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-border px-4 py-3 sm:px-5">
        {d.listing.data && <MoreLink href="/online/google">The listing, over time</MoreLink>}
        {d.website.data && <MoreLink href="/website/analytics#actions">Website actions, and where they came from</MoreLink>}
        {d.instagram.data && <MoreLink href="/online/instagram">Instagram, over time</MoreLink>}
        {d.facebook.data && <MoreLink href="/online/facebook">The Facebook Page, over time</MoreLink>}
      </div>
    </Card>
  );
}

/** The searches that put the listing in front of someone, when Google has sent them. */
function ListingSearches({ listing }: { listing: OnlineOverview["listing"] }) {
  const kws = listing.data?.keywords ?? [];
  return (
    <div className="mt-5">
      <h3 className="text-sm font-semibold text-ink">Searches that showed the listing{listing.data?.keywordMonth ? `, ${monthName(listing.data.keywordMonth)}${listing.data.keywordMonthPartial ? " so far" : ""}` : ""}</h3>
      {kws.length > 0 ? (
        <>
          <ul className="mt-2 flex flex-wrap gap-1.5 text-xs">
            {kws.slice(0, 8).map((k) => (
              <li key={k.keyword} className="rounded-md bg-surface-2 px-2 py-1 text-ink-2">
                {k.keyword} <span className="num text-muted">{k.value != null ? n0(k.value) : `under ${k.threshold ?? 15}`}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">The number is how many people searched it that month.</p>
          <div className="mt-1">
            <MoreLink href="/online/google#keywords">Every search for the listing</MoreLink>
          </div>
        </>
      ) : (
        <p className="mt-1 text-sm text-pretty text-muted">
          {listing.data ? "Google hasn't sent any search terms for the listing yet. They arrive a month at a time." : listing.state.kind === "waiting" ? "Waiting on Google's approval. What people typed before the listing came up on Google Search or Maps will show here." : `${listing.state.title}. What people typed before the listing came up on Google Search or Maps will show here.`}
        </p>
      )}
    </div>
  );
}
