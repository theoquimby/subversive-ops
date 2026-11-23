import { Verdict, type FindingTone } from "@/components/chapter";
import { HelpZone } from "@/components/help";
import { RelativeTime } from "@/components/relative-time";
import { Badge, Card, cx, Dot, LinkButton, Section } from "@/components/ui";
import { weekday } from "@/domain/dates";
import { dayRangeLabel, hhmmLabel, WEEKDAY_OF_DOW } from "@/domain/websiteHours";
import { WEEKDAYS, type FeedEvent, type SiteFeed, type WebDayHours } from "@/domain/websiteSchema";
import { dayDate, shortDate } from "@/lib/format";
import type { FeedHealth, PingResult } from "@/server/services/website";
import type { InquiryRow } from "@/server/services/websiteInquiries";
import { businessToday } from "@/server/services/sales";
import { ChevronRight, ExternalLink } from "lucide-react";
import Link from "next/link";
import { TestPingButton } from "./test-ping";

const DAY: Record<string, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };

const dayRange = (h: WebDayHours) => dayRangeLabel(h);

/** Each feed by what it carries, not by its address. */
const FEED_NAME: Record<FeedHealth["id"], string> = { site: "Hours and notice", menu: "Menu", events: "Events", taps: "Tap list" };

interface SiteFinding {
  tone: FindingTone;
  title: string;
  line: string;
  href: string;
  action: string;
}

/** What the website most needs, most serious first: a broken feed, no food on the menu, new inquiries, hours or menu to check. */
function findings(p: Parameters<typeof OverviewTab>[0], fresh: number): SiteFinding[] {
  const out: SiteFinding[] = [];
  const broken = p.health.filter((h) => !h.ok);
  if (broken.length) out.push({ tone: "bad", title: `The website can't read ${broken.map((h) => FEED_NAME[h.id].toLowerCase()).join(" or ")}`, line: "Guests see whatever it last read until this is fixed.", href: "#feeds", action: "See what went wrong" });
  if (p.menu && p.menu.counts.food === 0) out.push({ tone: "warn", title: "The website shows no food menu", line: `Only ${p.menu.counts.beers} beer${p.menu.counts.beers === 1 ? "" : "s"} on tap and ${p.menu.counts.drinks} other drinks are listed. Put the kitchen's dishes on the website menu.`, href: "/website/menu", action: "Open the menu" });
  if (fresh > 0) out.push({ tone: "warn", title: `${fresh} new inquir${fresh === 1 ? "y is" : "ies are"} waiting`, line: "Sent from the website form and not opened yet.", href: "/website/inquiries", action: "Read them" });
  if (p.staleDays > 0) out.push({ tone: "warn", title: `Exact times on ${p.staleDays} day${p.staleDays === 1 ? "" : "s"} no longer fit your opening hours`, line: "The website shows the opening hours for those days until the times are fixed.", href: "/website/hours", action: "Fix the hours" });
  if (p.menu && p.menu.warnings > 0) out.push({ tone: "warn", title: `${p.menu.warnings} thing${p.menu.warnings === 1 ? "" : "s"} on the menu to check`, line: "Dishes or beers missing something the website needs.", href: "/website/menu", action: "Open the menu" });
  return out;
}

export function OverviewTab(p: {
  origin: string;
  site: SiteFeed | null;
  staleDays: number;
  menu: { counts: { food: number; drinks: number; beers: number }; warnings: number; updated: string } | null;
  events: FeedEvent[];
  eventCount: number;
  ping: PingResult | null;
  websiteUrl: string | null;
  secretSet: boolean;
  health: FeedHealth[];
  inquiries: InquiryRow[];
  /** A notice written ahead that isn't showing yet. */
  scheduledNotice: { text: string; label: string } | null;
}) {
  const today = businessToday();
  const wd = WEEKDAY_OF_DOW[weekday(today)];
  const todayHours = p.site?.hours[wd] ?? null;
  const fresh = p.inquiries.filter((i) => !i.seen).length;
  const connected = !!p.websiteUrl && p.secretSet;
  const menuTotal = p.menu ? p.menu.counts.food + p.menu.counts.drinks + p.menu.counts.beers : 0;
  const found = findings(p, fresh);
  const top = found[0];
  const others = found.slice(1);

  return (
    <>
      <div data-tour="website.live">
        <Verdict
          badge={top ? { tone: top.tone } : { tone: "good" }}
          title={top ? top.title : "The website is up to date"}
          line={
            top ? (
              <>
                {top.line}{" "}
                <Link href={top.href} className="font-medium text-ink underline underline-offset-2">{top.action}</Link>.
                {others.length > 0 && <> Also: {others.map((f) => f.title.charAt(0).toLowerCase() + f.title.slice(1)).join("; ")}.</>}
              </>
            ) : (
              "Every feed reads cleanly, the menu has food and drink, and no inquiry is waiting."
            )
          }
          stats={[
            { label: "Open today", value: dayRange(todayHours), hint: todayHours && todayHours.kitchenClose !== todayHours.close ? `Kitchen until ${hhmmLabel(todayHours.kitchenClose)}` : p.site?.season ? `${p.site.season} hours` : "From Settings › Business" },
            { label: "On the menu", value: p.menu ? menuTotal : "—", hint: p.menu ? `${p.menu.counts.beers} on tap, ${p.menu.counts.food} food, ${p.menu.counts.drinks} other drinks` : "Couldn't build the menu", tone: !p.menu ? "bad" : p.menu.counts.food === 0 ? "warn" : undefined },
            { label: "Events, next 60 days", value: p.eventCount, hint: p.events[0] ? `Next: ${shortDate(p.events[0].date)}` : "Nothing coming up" },
          ]}
        />
      </div>

      <div className="grid gap-x-6 lg:grid-cols-2">
        <Section title="What guests see now" description="Straight from the feeds the website reads.">
          <Card className="divide-y divide-border">
            <Row label="Notice" href="/website/hours">
              {p.site?.notice ? (
                <span>
                  {p.site.notice.text}
                  <span className="text-muted">{p.site.notice.until ? ` · until ${shortDate(p.site.notice.until)}` : " · until you remove it"}</span>
                </span>
              ) : p.scheduledNotice ? (
                <span>
                  <span className="text-muted">None today. </span>
                  {p.scheduledNotice.text}
                  <span className="text-muted"> · {p.scheduledNotice.label}</span>
                </span>
              ) : (
                <span className="text-muted">None. Add one for a closure or a change</span>
              )}
            </Row>
            <Row label="Hours" href="/website/hours">
              {p.site ? (
                <span className="grid grid-cols-[2.5rem_1fr] gap-x-2 text-sm">
                  {WEEKDAYS.map((d) => (
                    <span key={d} className={cx("contents", d === wd && "font-medium")}>
                      <span className="text-muted">{DAY[d]}</span>
                      <span className="num">{dayRange(p.site!.hours[d])}{p.site!.hours[d] && p.site!.hours[d]!.kitchenClose !== p.site!.hours[d]!.close ? <span className="text-muted"> · kitchen {hhmmLabel(p.site!.hours[d]!.kitchenClose)}</span> : null}</span>
                    </span>
                  ))}
                </span>
              ) : (
                <span className="text-bad">The hours feed has a problem</span>
              )}
              {p.staleDays > 0 && <span className="mt-1 block text-xs text-warn">Exact times on {p.staleDays} day{p.staleDays === 1 ? "" : "s"} no longer fit your opening hours</span>}
            </Row>
            <Row label="Menu" href="/website/menu">
              {p.menu ? (
                <span>
                  {p.menu.counts.beers} beer{p.menu.counts.beers === 1 ? "" : "s"} on tap, {p.menu.counts.food === 0 ? <span className="font-medium text-warn">no food</span> : `${p.menu.counts.food} food`}, {p.menu.counts.drinks} other drinks
                  <span className="text-muted"> · updated {shortDate(p.menu.updated)}</span>
                  {p.menu.warnings > 0 && <span className="mt-1 block text-xs text-warn">{p.menu.warnings} to check</span>}
                </span>
              ) : (
                <span className="text-bad">The menu feed has a problem</span>
              )}
            </Row>
            <Row label="Events" href="/website/events">
              {p.events.length ? (
                <ul className="space-y-1">
                  {p.events.map((e) => (
                    <li key={e.id} className="flex min-w-0 gap-2">
                      <span className="num w-20 shrink-0 text-muted">{shortDate(e.date)}</span>
                      <span className="min-w-0 truncate">{e.title}</span>
                      {e.closed && <Badge tone="warn">Closed</Badge>}
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-muted">Nothing in the next 60 days</span>
              )}
            </Row>
          </Card>
        </Section>

        <HelpZone id="website.connection" tour="website.connection">
          <Section title="Website connection" description="The website reads these feeds every 5 minutes, and at once when Ops pings it after a save.">
            <Card className="mb-4 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Dot tone={!connected ? "neutral" : p.ping?.ok ? "good" : p.ping && !p.ping.skipped ? "bad" : "warn"} />
                    {connected ? <span className="truncate">{p.websiteUrl!.replace(/^https?:\/\//, "")}</span> : "Instant updates aren't set up"}
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    {!connected ? (
                      <>The website still updates within 5 minutes. For instant updates, add the address and shared secret in <Link href="/settings/connections?open=website" className="text-ink underline underline-offset-2">Settings › Connections</Link>.</>
                    ) : p.ping ? (
                      <>
                        Last refresh <RelativeTime at={p.ping.at} />: <span className={p.ping.ok ? "text-good" : "text-bad"}>{p.ping.message}</span>
                      </>
                    ) : (
                      "No refresh sent yet. Save something, or send a test."
                    )}
                  </p>
                </div>
                {connected && <TestPingButton />}
              </div>
            </Card>
            <Card id="feeds" className="scroll-mt-24 divide-y divide-border">
              {p.health.map((h) => (
                <div key={h.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Dot tone={h.ok ? "good" : "bad"} />
                      <span>{FEED_NAME[h.id]}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted">{h.ok ? h.detail : `Error: ${h.detail}`}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="num text-sm">{h.count} <span className="text-muted">{h.noun}</span></span>
                    <a href={`${p.origin}${h.path}`} target="_blank" rel="noreferrer" className="grid size-10 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink sm:size-8" aria-label={`Open the ${FEED_NAME[h.id].toLowerCase()} feed the website reads`}>
                      <ExternalLink className="size-4" />
                    </a>
                  </div>
                </div>
              ))}
            </Card>
          </Section>
        </HelpZone>
      </div>

      {p.inquiries.length > 0 && (
        <Section title="Latest inquiries" actions={<LinkButton href="/website/inquiries" variant="ghost" size="sm">All inquiries <ChevronRight className="size-4" /></LinkButton>}>
          <Card className="divide-y divide-border">
            {p.inquiries.slice(0, 3).map((i) => (
              <div key={i.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium">{i.name}{!i.seen && <Badge tone="warn" className="ml-2">New</Badge>}</div>
                  <div className="truncate text-xs text-muted">{[i.type, i.date ? dayDate(i.date) : null, i.guests ? `${i.guests} guests` : null].filter(Boolean).join(" · ") || "No details"}</div>
                </div>
                <RelativeTime at={i.createdAt} className="shrink-0 text-xs text-muted" />
              </div>
            ))}
          </Card>
        </Section>
      )}
    </>
  );
}

function Row({ label, href, children }: { label: string; href: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[5rem_1fr_auto] items-start gap-3 px-4 py-3 text-sm">
      <span className="text-muted">{label}</span>
      <div className="min-w-0">{children}</div>
      <Link href={href} className="grid size-10 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink sm:size-8" aria-label={`Edit ${label.toLowerCase()}`}>
        <ChevronRight className="size-4" />
      </Link>
    </div>
  );
}
