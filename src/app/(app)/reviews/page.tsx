import { HelpZone } from "@/components/help";
import { GridCell } from "@/components/grid";
import { LineChart } from "@/components/line-chart";
import { Badge, Card, cx, EmptyState, PageHeader, Section, Stat } from "@/components/ui";
import { addDays } from "@/domain/dates";
import { OpsDay, operationalHint, rollingRating, themeCounts, themeLabel } from "@/domain/reviews";
import { money, pct, relativeTime, shortDate, signedPct } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { claudeHints, generateWhatToFix, lastGoogleSync, LoadedReview, loadReviews, needsReply, opsForDates, reviewAlerts, reviewSettings, whatToFixThisMonth } from "@/server/services/reviews";
import { after } from "next/server";
import { RefreshFix } from "./fix-refresh";
import { businessToday } from "@/server/services/sales";
import Link from "next/link";
import { saveSetting } from "./actions";
import { ImportActions, ReplyBox } from "./review-ui";

const RATING_AXIS: [number, number] = [1, 5];

export const metadata = { title: "Reviews" };

const FILTERS = [
  { key: "open", label: "Needs reply" },
  { key: "all", label: "All" },
  { key: "negative", label: "Critical" },
  { key: "positive", label: "Happy" },
] as const;

const SOURCE_LABEL: Record<string, string> = { GOOGLE: "Google", YELP: "Yelp", TRIPADVISOR: "TripAdvisor", MANUAL: "Pasted" };

export default async function ReviewsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  await requireUser("MANAGER");
  const { show: rawShow } = await searchParams;
  const today = businessToday();
  const [reviews, settings, hints, alerts, lastSync] = await Promise.all([loadReviews(), reviewSettings(), claudeHints(), reviewAlerts(), lastGoogleSync()]);
  const { fix, stale } = reviews.length ? await whatToFixThisMonth() : { fix: null, stale: false };
  // A new month: show the quick version now and let Claude rewrite it after the response.
  if (stale) after(() => generateWhatToFix(true).then(() => undefined, (e) => console.error("what-to-fix failed", e)));
  const critical = reviews.filter((r) => r.rating <= 3 || r.sentiment === "negative" || r.sentiment === "mixed");
  const ops = await opsForDates(critical.map((r) => r.date));

  const since90 = addDays(today, -90);
  const recent = reviews.filter((r) => r.date >= since90);
  const avg = (rs: LoadedReview[]) => (rs.length ? rs.reduce((s, r) => s + r.rating, 0) / rs.length : null);
  const avg30 = avg(reviews.filter((r) => r.date > addDays(today, -30)));
  const avgPrev30 = avg(reviews.filter((r) => r.date <= addDays(today, -30) && r.date > addDays(today, -60)));
  const open = reviews.filter(needsReply);
  const lite = recent.map((r) => ({ rating: r.rating, postedAt: r.date, themes: r.themes, sentiment: r.sentiment }));
  const themes = themeCounts(lite);
  const worst = [...themes].sort((a, b) => b.negative + b.mixed * 0.5 - (a.negative + a.mixed * 0.5))[0];
  const trend = rollingRating(lite, 5).map((p) => ({ x: p.date, y: Math.round(p.avg * 100) / 100 }));
  const maxTheme = Math.max(1, ...themes.map((t) => t.total));

  const show = FILTERS.some((f) => f.key === rawShow) ? rawShow! : open.length ? "open" : "all";
  const listed = reviews.filter((r) =>
    show === "open" ? needsReply(r) : show === "negative" ? r.rating <= 3 || r.sentiment !== "positive" : show === "positive" ? r.rating >= 4 && r.sentiment === "positive" : true,
  );

  return (
    <>
      <PageHeader
        help="reviews.page"
        title="Reviews"
        description={`What guests are saying, lined up against what happened on the floor and in the kitchen that day.${settings.googleConfigured && settings.placeId ? ` Google checked ${relativeTime(lastSync)}, and every morning.` : ""}`}
        actions={<HelpZone id="reviews.import" className="flex flex-wrap items-center gap-2"><ImportActions googleReady={settings.googleConfigured && Boolean(settings.placeId)} googleHint={!settings.googleConfigured ? "Google import needs a Google Maps API key set up on the server — ask whoever manages your hosting" : "Add your Google Place ID at the bottom of this page"} /></HelpZone>}
      />

      {reviews.length === 0 ? (
        <EmptyState title="No reviews yet">Paste a few reviews from Google, Yelp or TripAdvisor to see themes, reply drafts, and what was going on in operations that day.</EmptyState>
      ) : (
        <>
          <div className="mb-10 grid grid-cols-2 gap-3 lg:grid-cols-4 [&>[data-help-zone]>*]:h-full">
            <Stat help="reviews.average" label="Average rating, 90 days" value={<Stars value={avg(recent)} />} hint={`${recent.length} review${recent.length === 1 ? "" : "s"}`} />
            <Stat
              help="reviews.last30"
              label="Last 30 days"
              value={avg30 == null ? "—" : avg30.toFixed(1)}
              hint={avg30 != null && avgPrev30 != null ? `${avg30 >= avgPrev30 ? "Up" : "Down"} from ${avgPrev30.toFixed(1)} the 30 days before` : "Not enough reviews to compare"}
              tone={avg30 != null && avgPrev30 != null ? (avg30 >= avgPrev30 ? "good" : "warn") : undefined}
            />
            <Stat help="reviews.needReply" label="Need a reply" value={open.length} hint="Critical or mixed, not answered" tone={open.length ? "warn" : "good"} />
            <Stat help="reviews.worst" label="Most complained about" value={<span className="text-[1.25rem] sm:text-[1.5rem]">{worst && worst.negative + worst.mixed > 0 ? themeLabel(worst.theme) : "Nothing"}</span>} hint={worst && worst.negative + worst.mixed > 0 ? `${worst.negative + worst.mixed} critical or mixed mention${worst.negative + worst.mixed === 1 ? "" : "s"}` : "No recurring complaints"} />
          </div>

          {alerts.map((a) => (
            <Card key={a.kind} className="-mt-4 mb-8 border-bad/30 bg-bad-bg p-4 text-sm">
              <span className="font-medium text-bad">{a.title}.</span> <span className="text-ink-2">{a.detail}</span>
            </Card>
          ))}

          {fix && (
            <Section
              help="reviews.fix"
              title="What to fix this month"
              description={`${fix.by === "claude" ? "Written by Claude" : "From the most-mentioned complaints"} from ${fix.reviewCount} review${fix.reviewCount === 1 ? "" : "s"} in the last 90 days and what operations looked like on those days.`}
              actions={<RefreshFix claude={settings.claude} />}
            >
              {fix.actions.length === 0 ? (
                <Card className="p-4 text-sm text-muted">No recurring complaints in the last 90 days. Keep doing what you&apos;re doing.</Card>
              ) : (
                <div className="grid gap-3 lg:grid-cols-3">
                  {fix.actions.map((a, i) => (
                    <Card key={`${a.theme}-${i}`} className="flex flex-col p-4">
                      <div className="flex items-baseline gap-2">
                        <span className="num text-xs font-medium text-muted">{i + 1}</span>
                        <span className="text-[0.95rem] font-medium">{a.title}</span>
                      </div>
                      {a.theme && <div className="mt-1"><Badge>{themeLabel(a.theme)}</Badge></div>}
                      <p className="mt-2 text-sm text-ink-2">{a.action}</p>
                      <p className="mt-2 text-xs text-muted">{a.why}</p>
                    </Card>
                  ))}
                </div>
              )}
            </Section>
          )}

          <div className="grid grid-cols-1 gap-x-8 lg:grid-cols-5">
            <Section help="reviews.trend" className="min-w-0 lg:col-span-3" title="Rating trend" description="Rolling average of the last 5 reviews">
              <Card className="p-4">
                {trend.length >= 2 ? <LineChart points={trend} valueFormat="number" ariaLabel="Average rating over time" height={200} domain={RATING_AXIS} /> : <div className="py-10 text-center text-sm text-muted">Add a few more reviews to see a trend.</div>}
              </Card>
            </Section>
            <Section help="reviews.themes" className="min-w-0 lg:col-span-2" title="Themes" description="Last 90 days · what guests mention most">
              <Card className="divide-y divide-border">
                {themes.length === 0 && <div className="p-4 text-sm text-muted">No themes yet.</div>}
                {themes.slice(0, 8).map((t) => (
                  <div key={t.theme} className="px-4 py-2.5">
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="font-medium">{themeLabel(t.theme)}</span>
                      <span className="num text-xs text-muted">
                        {t.total}
                        {t.negative + t.mixed > 0 && <span className="text-bad"> · {t.negative + t.mixed} critical</span>}
                      </span>
                    </div>
                    <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-surface-2" style={{ width: `${Math.max(12, (t.total / maxTheme) * 100)}%` }} aria-hidden>
                      <span className="bg-good/70" style={{ width: `${(t.positive / t.total) * 100}%` }} />
                      <span className="bg-warn/70" style={{ width: `${(t.mixed / t.total) * 100}%` }} />
                      <span className="bg-bad/70" style={{ width: `${(t.negative / t.total) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </Card>
            </Section>
          </div>

          <Section
            title="Reviews"
            description={settings.claude ? "Themes and reply drafts by Claude, in your voice. Edit before posting." : "Themes from keywords and simple reply drafts. Add the Claude API key for written-for-you replies."}
            actions={<HelpZone id="reviews.list" className="hidden sm:block"><FilterTabs show={show} openCount={open.length} className="flex" /></HelpZone>}
          >
            {/* On a phone the tabs get their own full-width row instead of squeezing beside the title. */}
            <HelpZone id="reviews.list" className="mb-3 sm:hidden"><FilterTabs show={show} openCount={open.length} className="flex flex-wrap" /></HelpZone>
            {listed.length === 0 ? (
              <EmptyState title={show === "open" ? "All caught up" : "Nothing here"}>{show === "open" ? "Every critical review has a reply." : "No reviews match this filter."}</EmptyState>
            ) : (
              <div className="space-y-3">
                {listed.map((r) => (
                  <HelpZone key={r.id} id="reviews.card"><ReviewCard r={r} ops={ops.get(r.date)} hint={hints.get(r.id) ?? operationalHint(r.themes, ops.get(r.date))} /></HelpZone>
                ))}
              </div>
            )}
          </Section>
        </>
      )}

      <Section help="reviews.settings" title="Review settings">
        <Card className="divide-y divide-border">
          <div className="grid gap-1 px-4 py-3 sm:grid-cols-[14rem_1fr] sm:items-center sm:gap-4">
            <div>
              <div className="text-sm font-medium">Google Place ID</div>
              <div className="text-xs text-muted">{settings.googleConfigured ? "Find it with Google's Place ID finder" : "Google import also needs a Google Maps API key, added on the server by whoever manages your hosting"}</div>
            </div>
            <GridCell grid="review-settings" col="v" value={settings.placeId} onSave={saveSetting.bind(null, "placeId")} placeholder="ChIJ…" ariaLabel="Google Place ID" className="border-b border-border sm:border-0" />
          </div>
          <div className="grid gap-1 px-4 py-3 sm:grid-cols-[14rem_1fr] sm:items-center sm:gap-4">
            <div>
              <div className="text-sm font-medium">Tone notes for replies</div>
              <div className="text-xs text-muted">Used when Claude drafts replies</div>
            </div>
            <GridCell grid="review-settings" col="v" value={settings.toneNotes} onSave={saveSetting.bind(null, "tone")} placeholder="e.g. Sign as Max. Mention the trivia night. Never offer comps in public." ariaLabel="Tone notes" className="border-b border-border sm:border-0" />
          </div>
        </Card>
      </Section>
    </>
  );
}

function Stars({ value }: { value: number | null }) {
  if (value == null) return <>—</>;
  return (
    <span className="inline-flex items-baseline gap-1.5">
      {value.toFixed(1)}
      <span className="text-base text-warn" aria-hidden>★</span>
    </span>
  );
}

function StarRow({ rating }: { rating: number }) {
  return (
    <span className="text-[13px] tracking-[0.5px]" aria-label={`${rating} out of 5 stars`}>
      <span className={rating <= 2 ? "text-bad" : rating === 3 ? "text-warn" : "text-ink"}>{"★".repeat(rating)}</span>
      <span className="text-border-strong">{"★".repeat(5 - rating)}</span>
    </span>
  );
}

function ReviewCard({ r, ops, hint }: { r: LoadedReview; ops?: OpsDay; hint: string | null }) {
  const critical = r.rating <= 3 || r.sentiment === "negative" || r.sentiment === "mixed";
  return (
    <Card className={cx("p-4 sm:p-5", r.replied && "bg-surface/60")}>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <StarRow rating={r.rating} />
        <span className="text-sm font-medium">{r.author ?? "Guest"}</span>
        <span className="text-xs text-muted">
          {SOURCE_LABEL[r.source] ?? r.source} · {shortDate(r.date)}
        </span>
        <span className="ml-auto flex flex-wrap gap-1">
          {r.replied && <Badge tone="good">Replied</Badge>}
          {r.sentiment === "mixed" && <Badge tone="warn">Mixed</Badge>}
          {r.sentiment === "negative" && <Badge tone="bad">Critical</Badge>}
        </span>
      </div>
      <p className="mt-2.5 text-[0.95rem] leading-relaxed whitespace-pre-line text-ink">{r.text}</p>
      {r.themes.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1">
          {r.themes.map((t) => (
            <Badge key={t}>{themeLabel(t)}</Badge>
          ))}
        </div>
      )}

      {critical && ops && <OpsStrip ops={ops} hint={hint} />}

      <ReplyBox id={r.id} draft={r.replyDraft} replied={r.replied} compact={!critical} />
    </Card>
  );
}

function OpsStrip({ ops, hint }: { ops: OpsDay; hint: string | null }) {
  const surge = ops.sales != null && ops.forecast ? ops.sales / ops.forecast - 1 : null;
  const staffed = ops.workedHours ?? ops.scheduledHours;
  const short = staffed != null && ops.neededHours ? staffed / ops.neededHours - 1 : null;
  return (
    <div className="mt-4 rounded-lg border border-border bg-surface-2/50">
      <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Metric
          label="Sales vs forecast"
          value={ops.sales == null ? "No sales data" : `${money(ops.sales, { whole: true })}${ops.forecast ? ` vs ${money(ops.forecast, { whole: true })}` : ""}`}
          note={surge == null ? undefined : signedPct(surge, 0)}
          tone={surge != null && surge > 0.15 ? "warn" : undefined}
        />
        <Metric
          label={ops.workedHours != null ? "Staff hours worked vs needed" : "Staff hours scheduled vs needed"}
          value={staffed == null ? "No schedule that day" : `${Math.round(staffed)} h${ops.neededHours ? ` vs ${Math.round(ops.neededHours)} h` : ""}`}
          note={short == null ? undefined : short < -0.1 ? "short" : "covered"}
          tone={short != null && short < -0.1 ? "bad" : undefined}
        />
        <Metric
          label="Items over food-cost target"
          value={ops.overTarget.length === 0 ? "None sold" : ops.overTarget.slice(0, 2).map((i) => i.name).join(", ")}
          note={ops.overTarget.length ? `${ops.overTarget.length} item${ops.overTarget.length === 1 ? "" : "s"} · ${pct(ops.overTarget[0].foodCostPct, 0)}` : undefined}
          tone={ops.overTarget.length ? "warn" : undefined}
        />
      </div>
      {hint && <div className="border-t border-border px-3.5 py-2.5 text-sm text-ink-2"><span className="font-medium text-ink">Likely cause: </span>{hint}</div>}
    </div>
  );
}

function Metric({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: "warn" | "bad" }) {
  return (
    <div className="px-3.5 py-2.5">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-0.5 flex items-baseline justify-between gap-2 text-sm">
        <span className="num truncate font-medium">{value}</span>
        {note && <span className={cx("num shrink-0 text-xs font-medium", tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : "text-muted")}>{note}</span>}
      </div>
    </div>
  );
}

function FilterTabs({ show, openCount, className }: { show: string; openCount: number; className?: string }) {
  return (
    <nav aria-label="Filter reviews" className={cx("gap-0.5 rounded-lg border border-border bg-surface p-0.5", className)}>
      {FILTERS.map((f) => (
        <Link
          key={f.key}
          href={`/reviews?show=${f.key}`}
          scroll={false}
          aria-current={show === f.key ? "page" : undefined}
          className={cx("flex h-10 flex-auto items-center justify-center rounded-md px-3 text-sm whitespace-nowrap sm:h-8 sm:px-3", show === f.key ? "bg-primary font-medium text-primary-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink")}
        >
          {f.label}
          {f.key === "open" && openCount > 0 && <span className={cx("num ml-1.5 text-xs", show === f.key ? "opacity-80" : "text-muted")}>{openCount}</span>}
        </Link>
      ))}
    </nav>
  );
}
