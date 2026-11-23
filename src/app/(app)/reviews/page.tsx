import { Chapter, InShort, Verdict, type Finding } from "@/components/chapter";
import { HelpZone } from "@/components/help";
import { GridCell } from "@/components/grid";
import { LineChart } from "@/components/line-chart";
import { Badge, Card, cx, EmptyState, LinkButton, PageHeader, Section } from "@/components/ui";
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
  // With the text, each theme is judged by what the review says about it, not by the review as a whole.
  const lite = recent.map((r) => ({ rating: r.rating, postedAt: r.date, themes: r.themes, sentiment: r.sentiment, text: r.text }));
  const themes = themeCounts(lite);
  const worstRaw = [...themes].sort((a, b) => b.negative + b.mixed * 0.5 - (a.negative + a.mixed * 0.5))[0];
  const worst = worstRaw && worstRaw.negative + worstRaw.mixed > 0 ? worstRaw : null;
  const trend = rollingRating(lite, 5).map((p) => ({ x: p.date, y: Math.round(p.avg * 100) / 100 }));

  const show = FILTERS.some((f) => f.key === rawShow) ? rawShow! : open.length ? "open" : "all";
  const listed = reviews.filter((r) =>
    show === "open" ? needsReply(r) : show === "negative" ? r.rating <= 3 || r.sentiment !== "positive" : show === "positive" ? r.rating >= 4 && r.sentiment === "positive" : true,
  );

  // ---- The story: the verdict, then one chapter per finding --------------------------------
  const avg90 = avg(recent);
  const slipping = avg30 != null && avgPrev30 != null && avg30 < avgPrev30 - 0.05;
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const ratingLine =
    avg90 == null
      ? "No reviews in the last 90 days."
      : `${avg90.toFixed(1)} stars from ${plural(recent.length, "review")} in the last 90 days${avg30 != null && avgPrev30 != null ? `; the last 30 days averaged ${avg30.toFixed(1)}, ${avg30 >= avgPrev30 ? "up" : "down"} from ${avgPrev30.toFixed(1)}` : ""}.`;
  const worstN = worst ? worst.negative + worst.mixed : 0;
  const replyPoint: Finding | null = open.length
    ? { tone: "warn", title: `${plural(open.length, "critical review")} need${open.length === 1 ? "s" : ""} a reply`, detail: "Critical or mixed, and nobody has answered yet. A reply drafted in your voice is under each one.", action: "Read each one, edit the draft if it needs it, post it, then press Mark replied." }
    : null;
  const themePoint: Finding = worst
    ? { tone: worstN >= 3 ? "warn" : "neutral", title: `${themeLabel(worst.theme)} is what guests complain about most`, detail: `${plural(worstN, "critical or mixed mention")} in the last 90 days, judged by what each review says about it. A review that praises the beer and faults the service counts against the service only.`, action: fix?.actions[0] ? `${fix.actions[0].title}: see What to fix below.` : null }
    : { tone: "good", title: "No recurring complaints", detail: "No theme is faulted in the last 90 days of reviews.", action: null };
  const ratingPoint: Finding = { tone: slipping ? "warn" : "neutral", title: avg90 == null ? "No recent reviews" : `${avg90.toFixed(1)} stars over the last 90 days`, detail: ratingLine, action: null };
  const verdict = alerts[0]
    ? { tone: "bad" as const, title: alerts[0].title, line: `${alerts[0].detail}${replyPoint ? ` ${replyPoint.title}.` : ""}` }
    : replyPoint
      ? { tone: "warn" as const, title: replyPoint.title, line: `${ratingLine}${worst ? ` Most complaints are about ${themeLabel(worst.theme).toLowerCase()}.` : ""}` }
      : worst
        ? { tone: themePoint.tone, title: themePoint.title, line: ratingLine }
        : { tone: "good" as const, title: "Guests are happy, and every critical review has a reply", line: ratingLine };
  const contents = [
    replyPoint && { id: "list", point: replyPoint },
    { id: "themes", point: themePoint },
    fix && fix.actions.length > 0 && { id: "fix", point: { tone: "neutral", title: `What to fix this month: ${fix.actions[0].title.charAt(0).toLowerCase()}${fix.actions[0].title.slice(1)}`, detail: "", action: null } as Finding },
    { id: "trend", point: ratingPoint },
  ].filter((x): x is { id: string; point: Finding } => !!x);

  return (
    <>
      <PageHeader
        help="reviews.page"
        title="Reviews"
        description={`What guests are saying, lined up against what happened on the floor and in the kitchen that day.${settings.googleConfigured && settings.placeId ? ` Google checked ${relativeTime(lastSync)}, and every morning.` : ""}`}
        actions={<HelpZone id="reviews.import" className="flex flex-wrap items-center gap-2"><ImportActions googleReady={settings.googleConfigured && Boolean(settings.placeId)} googleHint={!settings.googleConfigured ? "Turn on Google reviews in Settings → Connections → Google first" : "Pick your business in Settings → Connections → Google first"} /></HelpZone>}
      />

      {reviews.length === 0 ? (
        <EmptyState title="No reviews yet">Paste a few reviews from Google, Yelp or TripAdvisor to see themes, reply drafts, and what was going on in operations that day.</EmptyState>
      ) : (
        <>
          <HelpZone id="reviews.average">
            <Verdict
              badge={{ tone: verdict.tone }}
              title={verdict.title}
              line={verdict.line}
              stats={[
                { label: "Average, last 90 days", value: avg90 == null ? "—" : `${avg90.toFixed(1)} ★`, hint: plural(recent.length, "review") },
                { label: "Last 30 days", value: avg30 == null ? "—" : `${avg30.toFixed(1)} ★`, hint: avg30 != null && avgPrev30 != null ? `${avg30 >= avgPrev30 ? "Up" : "Down"} from ${avgPrev30.toFixed(1)}` : "Too few to compare", tone: avg30 == null ? "unknown" : slipping ? "warn" : undefined },
                { label: "Need a reply", value: open.length, hint: open.length ? "Critical or mixed" : "All answered", tone: open.length ? "warn" : "good" },
              ]}
            />
          </HelpZone>
          {contents.length > 1 && (
            <Section title="In short" description="What stands out, in the order the page tells it. Tap one to jump to it.">
              <InShort items={contents} />
            </Section>
          )}

          <Chapter
            id="themes"
            point={themePoint}
            title="Themes"
            className="mb-10"
            numbers={
              <p className="text-xs text-muted">
                The last 90 days. A theme is judged by the sentence or clause that mentions it, so one review can praise one thing and fault another. A theme picked out by AI without its words in the review takes the feeling of the whole review.
              </p>
            }
          >
            <HelpZone id="reviews.themes">
              <ThemeBars themes={themes} />
            </HelpZone>
          </Chapter>

          {fix && (
            <Section
              help="reviews.fix"
              title="What to fix this month"
              description={`${fix.by === "claude" ? "Written by Claude" : "From the most-complained-about themes"} over the last 90 days of reviews and what operations looked like on those days. Worked out ${shortDate(fix.generatedAt.slice(0, 10))}.`}
              actions={<RefreshFix claude={settings.claude} />}
              className="scroll-mt-24"
            >
              <span id="fix" className="block scroll-mt-24" />
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

          <Chapter id="trend" point={ratingPoint} title="Rating trend" className="mb-10">
            <HelpZone id="reviews.trend">
              {trend.length >= 2 ? <LineChart points={trend} valueFormat="number" ariaLabel="Average rating of the last 5 reviews, over time" height={200} domain={RATING_AXIS} /> : <div className="py-10 text-center text-sm text-muted">Add a few more reviews to see a trend.</div>}
              <p className="mt-2 text-xs text-muted">Each point is the average of the last 5 reviews.</p>
            </HelpZone>
          </Chapter>

          <span id="list" className="block scroll-mt-24" />
          <Section
            title="Reviews"
            description={settings.claude ? "Themes and reply drafts written by AI, in your voice. Edit before posting." : "Themes from keywords and simple reply drafts. Turn on AI features in Settings → Connections for written-for-you replies."}
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
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">Google reviews</div>
              <div className="text-xs text-muted">
                {settings.googleConfigured && settings.placeId
                  ? `On${settings.placeName ? ` · ${settings.placeName}` : ""} · checked every morning`
                  : settings.googleConfigured
                    ? "Almost there: pick your business so new Google reviews come in by themselves."
                    : "Off. A 5-minute guide with pictures turns it on."}
              </div>
            </div>
            <LinkButton href="/settings/connections/google#reviews" size="sm">{settings.googleConfigured && settings.placeId ? "Change" : "Set up"}</LinkButton>
          </div>
          <div className="grid gap-1 px-4 py-3 sm:grid-cols-[14rem_1fr] sm:items-center sm:gap-4">
            <div>
              <div className="text-sm font-medium">Tone notes for replies</div>
              <div className="text-xs text-muted">Used when the AI drafts replies</div>
            </div>
            <GridCell grid="review-settings" col="v" value={settings.toneNotes} onSave={saveSetting.bind(null, "tone")} placeholder="e.g. Sign as Max. Mention the trivia night. Never offer comps in public." ariaLabel="Tone notes" className="border-b border-border sm:border-0" />
          </div>
        </Card>
      </Section>
    </>
  );
}

const FEELINGS = [
  { key: "positive", label: "Happy", className: "bg-good/70" },
  { key: "neutral", label: "Just mentioned", className: "bg-border-strong" },
  { key: "mixed", label: "Mixed", className: "bg-warn/70" },
  { key: "negative", label: "Critical", className: "bg-bad/70" },
] as const;

/** Each theme as a bar of its mentions, split by how the review felt about it, with the key above. */
function ThemeBars({ themes }: { themes: ReturnType<typeof themeCounts> }) {
  if (!themes.length) return <p className="text-sm text-muted">No themes yet.</p>;
  const max = Math.max(1, ...themes.map((t) => t.total));
  return (
    <>
      <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Key">
        {FEELINGS.map((f) => (
          <li key={f.key} className="inline-flex items-center gap-1.5">
            <span aria-hidden className={cx("inline-block size-2.5 rounded-sm", f.className)} />
            {f.label}
          </li>
        ))}
      </ul>
      <ul className="divide-y divide-border">
        {themes.slice(0, 8).map((t) => (
          <li key={t.theme} className="py-2.5">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium">{themeLabel(t.theme)}</span>
              <span className="num text-xs text-muted">
                {t.total} mention{t.total === 1 ? "" : "s"}
                {t.negative + t.mixed > 0 && <span className="text-bad"> · {t.negative + t.mixed} critical</span>}
              </span>
            </div>
            <div
              className="mt-1.5 flex h-2 gap-px overflow-hidden rounded-full bg-surface-2"
              style={{ width: `${Math.max(12, (t.total / max) * 100)}%` }}
              role="img"
              aria-label={`${themeLabel(t.theme)}: ${FEELINGS.map((f) => `${t[f.key]} ${f.label.toLowerCase()}`).join(", ")}`}
            >
              {FEELINGS.map((f) => (t[f.key] > 0 ? <span key={f.key} className={f.className} style={{ width: `${(t[f.key] / t.total) * 100}%` }} /> : null))}
            </div>
          </li>
        ))}
      </ul>
    </>
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
          note={short != null && short < -0.1 ? "short" : undefined}
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
