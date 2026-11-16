import { HelpZone } from "@/components/help";
import { RelativeTime } from "@/components/relative-time";
import { Badge, Card, cx, Dot, LinkButton, Section, Stat } from "@/components/ui";
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

  return (
    <>
      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4" data-tour="website.live">
        <Stat label="Open today" value={<span className="text-[1.4rem] sm:text-[1.75rem]">{dayRange(todayHours)}</span>} hint={todayHours && todayHours.kitchenClose !== todayHours.close ? `Kitchen until ${hhmmLabel(todayHours.kitchenClose)}` : p.site?.season ? `${p.site.season} hours` : "From Settings → Business"} />
        <Stat label="On the menu" value={menuTotal} hint={p.menu ? `${p.menu.counts.beers} on tap · ${p.menu.counts.food} food` : "Couldn't build the menu"} tone={p.menu ? undefined : "bad"} />
        <Stat label="Events, next 60 days" value={p.eventCount} hint={p.events[0] ? `Next: ${shortDate(p.events[0].date)}` : "Nothing coming up"} />
        <Stat label="New inquiries" value={fresh} tone={fresh ? "warn" : undefined} hint="From the website form" />
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
                <span className="text-muted">None — add one for a closure or a change</span>
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
                  {p.menu.counts.beers} beer{p.menu.counts.beers === 1 ? "" : "s"} on tap, {p.menu.counts.food} food, {p.menu.counts.drinks} other drinks
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
                      <>The website still updates within 5 minutes. For instant updates, add the address and shared secret in <Link href="/settings/connections?open=website" className="text-ink underline underline-offset-2">Settings → Connections</Link>.</>
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
            <Card className="divide-y divide-border">
              {p.health.map((h) => (
                <div key={h.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Dot tone={h.ok ? "good" : "bad"} />
                      <span className="font-mono text-[0.8rem]">{h.path}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted">{h.ok ? h.detail : `Error: ${h.detail}`}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="num text-sm">{h.count} <span className="text-muted">{h.noun}</span></span>
                    <a href={`${p.origin}${h.path}`} target="_blank" rel="noreferrer" className="grid size-10 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink sm:size-8" aria-label={`Open ${h.path}`}>
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
