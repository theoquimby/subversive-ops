import { LineChart } from "@/components/line-chart";
import { Badge, Card, LinkButton, PageHeader, Section } from "@/components/ui";
import { TRACKING_SETUP_HREF } from "@/domain/online";
import { META_SETUP_HREF, SOCIAL } from "@/domain/onlineChannels";
import { relativeTime, shortDate } from "@/lib/format";
import type { SocialBlock, SocialConnection, SocialReport } from "@/server/services/online";
import Link from "next/link";
import { Change, MeasureRow, MoreLink, n0, Notice, RangeChips, spanText } from "./bits";
import { Trend, TrendKey } from "./charts";
import { PostsTable } from "./posts";

/**
 * Online → Instagram and Online → Facebook: the same page for either channel,
 * in the same visual language as the Google listing. Followers, how far the
 * posts travelled, what people did next, the posts themselves, and the
 * connection. Server component; the posts table sorts on the client.
 */

const HELP = {
  instagram: { page: "online.instagram", followers: "online.instagram.followers", seen: "online.instagram.seen", next: "online.instagram.next", posts: "online.instagram.posts", connection: "online.instagram.connection" },
  facebook: { page: "online.facebook", followers: "online.facebook.followers", seen: "online.facebook.seen", next: "online.facebook.next", posts: "online.facebook.posts", connection: "online.facebook.connection" },
} as const;

const WILL_SHOW = {
  instagram: [
    "Followers, and how many were gained or lost over the period.",
    "How often your posts, reels and stories were shown, and how many accounts they reached, day by day.",
    "Taps on the profile's Call, Directions, Email and Text buttons, and visits to the website that started on Instagram.",
    "Your recent posts and reels with their numbers, sortable by reach, with the best and the quietest called out.",
  ],
  facebook: [
    "Followers, and how many were gained or lost over the period.",
    "How often the Page and its posts were shown, and how many people they reached, day by day.",
    "Visits to the Page, taps on its buttons, and visits to the website that started on Facebook.",
    "The Page's recent posts with their numbers, sortable by reach, with the best and the quietest called out.",
  ],
} as const;

export function SocialPage({ r }: { r: SocialReport }) {
  const c = SOCIAL[r.channel];
  const b = r.block.data;
  const help = HELP[r.channel];
  const late = r.channel === "instagram" ? "Instagram's numbers arrive a day or two late." : "Facebook's numbers arrive a day or two late.";
  return (
    <>
      <PageHeader
        help={help.page}
        title={c.label}
        back={{ href: "/online", label: "Online" }}
        description={r.channel === "instagram" ? "Your Instagram account: who follows it, how far your posts and reels travel, and what people do from the profile." : "Your Facebook Page: who follows it, how often it and its posts are seen, and what people do from it."}
        actions={b ? <RangeChips base={c.href} range={r.range} /> : undefined}
      />

      {b ? (
        <>
          <p className="-mt-3 mb-6 text-xs text-pretty text-muted">
            {spanText(b.windows.cur)}, compared with the {r.period} before.{" "}
            {b.stale && b.through ? <span className="text-warn">Nothing newer than {shortDate(b.through)} has arrived.</span> : late}
            {b.since && <> Counting since {shortDate(b.since)}.</>}
          </p>
          <Followers b={b} period={r.period} help={help.followers} />
          <Seen b={b} period={r.period} help={help.seen} />
          <Next b={b} period={r.period} help={help.next} />
          <Posts b={b} period={r.period} help={help.posts} />
        </>
      ) : (
        <Section>
          <Card className="p-5 sm:p-6">
            <Notice state={r.block.state} bare />
            {r.block.state.kind !== "unavailable" && (
              <div className="mt-5 border-t border-border pt-4">
                <h2 className="text-sm font-semibold text-ink">What will show here</h2>
                <ul className="mt-2 space-y-1.5 text-sm text-pretty text-ink-2">
                  {WILL_SHOW[r.channel].map((line) => <li key={line}>{line}</li>)}
                </ul>
              </div>
            )}
          </Card>
        </Section>
      )}

      <Connection c={r.connection} through={b?.through ?? null} help={help.connection} channel={r.channel} />
    </>
  );
}

function Followers({ b, period, help }: { b: SocialBlock; period: string; help: string }) {
  const f = b.followers;
  const gained = f.change ?? 0;
  return (
    <Section help={help} title="Followers" description={`People following ${b.channel === "instagram" ? "the account" : "the Page"}. A count on a day, so it is compared, never added up.`}>
      <Card className="grid gap-x-6 gap-y-3 p-4 sm:p-5 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
        {f.now == null ? (
          <p className="text-sm text-pretty text-muted md:col-span-2">No follower count on record yet. It is read once a day, starting with the next sync.</p>
        ) : (
          <>
            <div className="min-w-0">
              <div className="num text-[1.75rem] leading-tight font-semibold tracking-tight">{n0(f.now)}</div>
              <p className="mt-1 text-sm text-pretty text-ink-2">
                {f.change == null ? (
                  <span className="text-muted">The change shows once a second day is on record.</span>
                ) : gained === 0 ? (
                  <>No change since {shortDate(f.since!)}.</>
                ) : (
                  <>
                    <span className={gained > 0 ? "num font-semibold text-good" : "num font-semibold text-bad"}>{gained > 0 ? `+${n0(gained)}` : `−${n0(-gained)}`}</span> since {shortDate(f.since!)}
                    {f.partial ? ", the first day on record" : `, the start of the last ${period}`}.
                  </>
                )}
              </p>
            </div>
            <div className="min-w-0 self-center">
              {f.trend.length >= 2 ? (
                <LineChart points={f.trend} valueFormat="number" ariaLabel="Followers, day by day" height={128} />
              ) : (
                <p className="text-sm text-pretty text-muted">A line appears here once a few days are on record.</p>
              )}
            </div>
          </>
        )}
      </Card>
    </Section>
  );
}

function Seen({ b, period, help }: { b: SocialBlock; period: string; help: string }) {
  const copy = SOCIAL[b.channel].copy;
  const who = SOCIAL[b.channel].audience;
  return (
    <Section help={help} title={b.channel === "instagram" ? "How far your posts travelled" : "How often the Page was seen"} description="Each on its own scale, over the same period.">
      <Card className="divide-y divide-border">
        {[b.viewsTrend, b.reachTrend].some((t) => t.some((pt) => pt.prev != null)) && (
          <div className="px-4 py-2.5 sm:px-5">
            <TrendKey period={period} />
          </div>
        )}
        <MeasureRow title={copy.views.title} counts={copy.views.counts} value={n0(b.views.cur)} change={b.stale ? undefined : <Change d={b.views} period={period} />} note={b.interactions.cur > 0 ? <>{n0(b.interactions.cur)} {b.channel === "instagram" ? "likes, comments, saves and shares" : "reactions, comments, shares and clicks"} in the same period.</> : undefined}>
          <Trend points={b.viewsTrend} title={copy.views.counts} unit={copy.views.unit} period={period} legend={false} />
        </MeasureRow>
        <MeasureRow
          title={copy.reach.title}
          counts={copy.reach.counts}
          value={b.reachPerDay != null ? n0(b.reachPerDay) : "—"}
          change={<span className="text-muted">on a typical day{b.reachPerDayBefore != null ? `, ${n0(b.reachPerDayBefore)} in the ${period} before` : ""}</span>}
          note={<>The same {who === "accounts" ? "account" : "person"} on two days is counted on both, so the days are averaged, not added.</>}
        >
          <Trend points={b.reachTrend} title={copy.reach.counts} unit={copy.reach.unit} period={period} legend={false} />
        </MeasureRow>
      </Card>
    </Section>
  );
}

function Next({ b, period, help }: { b: SocialBlock; period: string; help: string }) {
  const copy = SOCIAL[b.channel].copy;
  return (
    <Section help={help} title="What people did next" description={b.channel === "instagram" ? "From the profile, and on to the website." : "On the Page, and on to the website."}>
      <Card className="divide-y divide-border">
        {b.visits && (
          <MeasureRow title={copy.visits.title} counts={copy.visits.counts} value={n0(b.visits.cur)} change={b.stale ? undefined : <Change d={b.visits} period={period} />}>
            <Trend points={b.visitsTrend} title={copy.visits.counts} unit={copy.visits.unit} period={period} height={104} legend={false} />
          </MeasureRow>
        )}
        <MeasureRow
          title={copy.taps.title}
          counts={copy.taps.counts}
          value={n0(b.taps.cur)}
          change={b.stale ? undefined : <Change d={b.taps} period={period} />}
          note={b.tapParts.length > 0 ? b.tapParts.map((p) => `${p.label} ${n0(p.value)}`).join(" · ") : undefined}
        >
          <Trend points={b.tapsTrend} title={copy.taps.counts} unit={copy.taps.unit} period={period} height={104} legend={false} />
        </MeasureRow>
        <MeasureRow title={copy.website.title} counts={copy.website.counts} value={b.website ? n0(b.website.cur) : undefined} change={b.website ? <Change d={b.website} period={period} /> : undefined}>
          {b.website ? (
            <div className="text-sm text-pretty text-muted">
              <p>{b.channel === "instagram" ? "Instagram no longer tells apps how many people tapped the website link, so this is the website's own count of visits that arrived from Instagram." : "The website's own count of visits that arrived from Facebook."}</p>
              <div className="mt-1">
                <MoreLink href="/website/analytics#sources">Every source, and how often its visits act</MoreLink>
              </div>
            </div>
          ) : (
            <p className="text-sm text-pretty text-muted">
              The website isn&apos;t counting visits yet, so there is nothing to show here.{" "}
              <Link href={TRACKING_SETUP_HREF} className="font-medium text-ink-2 underline underline-offset-2 hover:text-ink">Set up tracking</Link>
            </p>
          )}
        </MeasureRow>
        {b.channel === "instagram" && b.postVisits != null && (
          <MeasureRow title={copy.visits.title} counts={copy.visits.counts} value={n0(b.postVisits)}>
            <p className="text-sm text-pretty text-muted">Added up from the posts below that went up in this period. Instagram no longer gives a count of profile visits for the whole account, and reels don&apos;t report theirs.</p>
          </MeasureRow>
        )}
      </Card>
    </Section>
  );
}

function Posts({ b, period, help }: { b: SocialBlock; period: string; help: string }) {
  const c = SOCIAL[b.channel];
  return (
    <div id="posts" className="scroll-mt-24">
      <Section help={help} title={b.channel === "instagram" ? "Posts and reels" : "Posts"} description={b.postsInPeriod ? `What went up in the last ${period}. Tap a column to sort by it.` : "The latest posts. Tap a column to sort by it."}>
        {b.posts.length === 0 ? (
          <Card className="p-4 text-sm text-pretty text-muted sm:p-5">
            {b.lastPostDay ? `Nothing went up in the last ${period}. The last post was on ${shortDate(b.lastPostDay)}.` : "No posts have been brought in yet. They arrive with the next sync."}
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <p className="border-b border-border p-4 text-sm text-pretty text-ink-2 sm:px-5">
              {b.callout ?? (b.postsInPeriod ? `With fewer than three posts that have numbers in the last ${period}, there is no best or quietest to call out yet.` : `Fewer than three posts went up in the last ${period}, so these are the latest instead.`)}
            </p>
            <PostsTable posts={b.posts} reachLabel={c.copy.reach.title} hasSaves={b.channel === "instagram"} />
          </Card>
        )}
        <p className="mt-2 text-xs text-pretty text-muted">
          {b.channel === "instagram"
            ? "Reach is the number of accounts that saw the post at least once. A post's numbers keep growing for a few days, and stories aren't listed: Instagram only keeps their numbers for a day."
            : "Reach is the number of people who saw the post at least once. A post's numbers keep growing for a few days."}
        </p>
      </Section>
    </div>
  );
}

function Connection({ c, through, help, channel }: { c: SocialConnection | null; through: string | null; help: string; channel: "instagram" | "facebook" }) {
  const who = channel === "instagram" ? "Instagram" : "Facebook";
  return (
    <Section help={help} title="Connection" description={`Read-only. The app reads these numbers from ${who} every night and never posts, replies or messages.`}>
      <Card className="flex flex-wrap items-center justify-between gap-4 p-4 sm:p-5">
        {c ? (
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-ink">{c.name ?? (channel === "instagram" ? "No Instagram account linked yet" : "No Page picked yet")}</span>
              <Badge tone={c.error ? "warn" : c.connected ? "good" : "neutral"}>{c.error ? "Needs a look" : c.connected ? "Connected" : "Not connected"}</Badge>
            </div>
            <p className="mt-1 text-sm text-pretty text-muted">
              {c.lastSyncAt ? `Last checked ${relativeTime(new Date(c.lastSyncAt))}` : "Not checked yet"}
              {through ? `. Numbers through ${shortDate(through)}` : ""}
              {c.connectedBy ? `. Connected by ${c.connectedBy}` : ""}.
            </p>
            {c.error && <p className="mt-1 text-sm text-pretty text-warn">{c.error}</p>}
            {c.skipped.length > 0 && <p className="mt-1 text-xs text-pretty text-muted">{who} no longer gives these, so they are left out: {c.skipped.join(", ")}.</p>}
          </div>
        ) : (
          <p className="min-w-0 text-sm text-muted">Couldn&apos;t read the connection just now. Try again in a minute.</p>
        )}
        <LinkButton href={c?.manageHref ?? META_SETUP_HREF} variant="secondary" className="h-10 sm:h-9">
          Manage the connection
        </LinkButton>
      </Card>
    </Section>
  );
}
