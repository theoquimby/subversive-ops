import { Badge, Card, cx, EmptyState, LinkButton, PageHeader, Section, Table, Td, Th, Tr } from "@/components/ui";
import { STANDING_LABEL } from "@/domain/beerStanding";
import { daysBetween } from "@/domain/dates";
import { displayCode } from "@/domain/kegs";
import { abvText } from "@/domain/taps";
import { requireUser } from "@/server/auth";
import { beerPage } from "@/server/services/beers";
import { Warehouse } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { dated, daysWord, kegsWord } from "../../accounts/bits";
import { BeerDot, sizeShort } from "../../bits";
import { MonthBars, WeeklyPints } from "../../demand/chart";
import { FillBars, Key, WENT_KEY } from "../../fleet/charts";
import { StandingControl } from "../../standing";

export const metadata = { title: "Beer" };

/** The same order as the fleet charts' key (WENT_KEY), so each count takes its color from there. */
const WENT_ORDER = ["tapped", "out", "stock", "none"] as const;

/**
 * One beer: where the brand stands. Its standing, the kegs of it right now by
 * size, where the full ones are and who has kegs of it out, its fills over
 * time and how they ended, and pints a week from Square.
 */
export default async function BeerPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser("MANAGER");
  const { id } = await params;
  const p = await beerPage(id);
  if (!p) notFound();
  const { beer: b, bySize, fills, demand } = p;
  const core = b.standing === "core";
  const sold = !!demand && demand.weekly.some((w) => w.pints > 0);
  const nothing = fills.total === 0 && bySize.total.total === 0 && !sold;
  const lastAgo = fills.last ? daysBetween(fills.last, p.today) : null;
  const facts = [b.style, abvText(b.abv), b.house ? null : "Guest beer"].filter(Boolean).join(" · ");

  return (
    <>
      <PageHeader
        help="kegs.beer"
        title={<span className="inline-flex items-center gap-2.5"><BeerDot color={b.color} className="size-4" />{b.name}</span>}
        back={{ href: "/kegs/beers", label: "Beers" }}
        description={`${facts ? `${facts}. ` : ""}Counted from keg scans and Square sales, so a keg that moved without a scan is counted where it was last seen.`}
        actions={<LinkButton href={`/kegs/cooler?beer=${b.id}`} size="sm" className="h-10 sm:h-8"><Warehouse className="size-4" /> In the walk-in</LinkButton>}
      />

      <div className="grid gap-x-8 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <Section help="kegs.standing" title="Standing">
          <StandingControl beerId={b.id} name={b.name} value={b.standing} />
          <p className="mt-3 text-sm text-ink-2">
            {core
              ? `Fill suggestions, run-out warnings and alerts apply. Alerts when fewer than ${b.minFull} ${b.minFull === 1 ? "keg is" : "kegs are"} full (set on Setup).`
              : b.standing === "rotation"
                ? "Shown in stock while there's some, and on Demand for information. Never flagged to fill."
                : "Hidden from stock and Demand. Its history stays here."}
          </p>
        </Section>

        <Section title="Kegs of it right now" description={bySize.total.total ? "By size: full in storage, on tap here, and out at accounts." : undefined}>
          {bySize.rows.length === 0 ? (
            <p className={cx("text-sm", core ? "font-medium text-bad" : "text-muted")}>{core ? `No kegs of ${b.name} right now: nothing full, nothing on tap, none out.` : `No kegs of ${b.name} right now.`}</p>
          ) : (
            <Table>
              <thead><tr><Th>Size</Th><Th align="right">Full</Th><Th align="right">On tap</Th><Th align="right">Out</Th><Th align="right">Total</Th></tr></thead>
              <tbody>
                {bySize.rows.map((r) => (
                  <Tr key={r.sizeId}>
                    <Td className="whitespace-nowrap">{sizeShort(r.sizeId)}</Td>
                    <Td align="right" className={cx("num", r.full === 0 && "text-muted")}>{r.full}</Td>
                    <Td align="right" className={cx("num", r.onTap === 0 && "text-muted")}>{r.onTap}</Td>
                    <Td align="right" className={cx("num", r.out === 0 && "text-muted")}>{r.out}</Td>
                    <Td align="right" className="num font-medium">{r.total}</Td>
                  </Tr>
                ))}
                {bySize.rows.length > 1 && (
                  <Tr className="border-t-2 border-border-strong">
                    <Td className="font-medium">All sizes</Td>
                    <Td align="right" className={cx("num font-medium", core && bySize.total.full === 0 && "text-bad")}>{bySize.total.full}</Td>
                    <Td align="right" className="num font-medium">{bySize.total.onTap}</Td>
                    <Td align="right" className="num font-medium">{bySize.total.out}</Td>
                    <Td align="right" className="num font-semibold">{bySize.total.total}</Td>
                  </Tr>
                )}
              </tbody>
            </Table>
          )}
          {p.onTap.length > 0 && (
            <p className="mt-2 text-sm text-ink-2">
              On tap: {p.onTap.map((k, i) => <span key={k.id}>{i > 0 && ", "}<Link href={`/kegs/k/${k.code}`} className="hover:underline">{k.line ? `line ${k.line}` : "a line"} ({sizeShort(k.sizeId)})</Link></span>)}
            </p>
          )}
        </Section>
      </div>

      {nothing ? (
        <EmptyState title={`Nothing on record for ${b.name} yet`} action={<LinkButton href="/kegs/scan" variant="primary">Scan a keg</LinkButton>}>
          No keg has been filled with it, and Square hasn&apos;t sold it. Once a keg is scanned as filled with {b.name}, its kegs, fills and sales show here.
        </EmptyState>
      ) : (
        <>
          <div className="grid gap-x-8 lg:grid-cols-2">
            <Section title="Where the full ones are" description={p.full.length ? "Oldest fill first: that's the one to use next." : undefined}>
              {p.full.length === 0 ? (
                <p className={cx("text-sm", core ? "text-bad" : "text-muted")}>No full kegs of it in storage.</p>
              ) : (
                <Table>
                  <thead><tr><Th>Keg</Th><Th>Where</Th><Th className="hidden sm:table-cell">Filled</Th><Th align="right">Age</Th></tr></thead>
                  <tbody>
                    {p.full.map((k, i) => (
                      <Tr key={k.id}>
                        <Td className="py-0">
                          <Link href={`/kegs/k/${k.code}`} className="block py-3 hover:underline">
                            <span className="num font-medium whitespace-nowrap">{displayCode(k.code)}</span> <span className="text-xs whitespace-nowrap text-muted">{sizeShort(k.sizeId)}</span>
                            {i === 0 && p.full.length > 1 && <span className="block text-xs text-good">Use this one next</span>}
                          </Link>
                        </Td>
                        <Td className="text-ink-2">{k.place}{k.status === "FILLED" && <span className="block text-xs text-muted">Not cold yet</span>}</Td>
                        <Td className="hidden whitespace-nowrap text-muted sm:table-cell">{k.filledOn ? dated(k.filledOn) : "—"}</Td>
                        <Td align="right" className="num whitespace-nowrap">{daysWord(k.days)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Section>

            <Section title="Out at accounts" description={p.out.length ? "Longest out first." : undefined}>
              {p.out.length === 0 ? (
                <p className="text-sm text-muted">No kegs of it are out at an account.</p>
              ) : (
                <Table>
                  <thead><tr><Th>Account</Th><Th align="right">Kegs</Th><Th className="hidden sm:table-cell">Sizes</Th><Th align="right">Longest</Th></tr></thead>
                  <tbody>
                    {p.out.map((g) => (
                      <Tr key={g.accountId ?? "none"}>
                        <Td>{g.accountId ? <Link href={`/kegs/accounts/${g.accountId}`} className="hover:underline">{g.account}</Link> : <span className="text-muted">{g.account}</span>}</Td>
                        <Td align="right" className="num">{g.kegs.length}</Td>
                        <Td className="hidden text-muted sm:table-cell">{[...new Set(g.kegs.map((k) => sizeShort(k.sizeId)))].join(", ")}</Td>
                        <Td align="right" className="num whitespace-nowrap">{daysWord(g.longest)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Section>
          </div>

          <Section
            title="Fills over time"
            description={
              fills.total === 0
                ? undefined
                : `Kegs filled each month, this year beside last. ${fills.fills12 ? `${kegsWord(fills.fills12)} in the last 12 months` : "None in the last 12 months"}; last filled ${dated(fills.last!)}${lastAgo != null && lastAgo > 0 ? ` (${daysWord(lastAgo)} ago)` : ""}. Hover a month for barrels.`
            }
          >
            {fills.total === 0 ? (
              <p className="text-sm text-muted">No keg has been filled with it, as far as the keg history goes.</p>
            ) : (
              <Card className="p-4">
                <FillBars thisYear={fills.thisYear} lastYear={fills.lastYear} />
                <div className="mt-4 border-t border-border pt-3">
                  <div className="mb-1.5 text-xs font-medium text-muted">How its {fills.total} fills on record ended{fills.first ? `, since ${dated(fills.first)}` : ""}</div>
                  <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                    {WENT_ORDER.map((w, i) => (
                      <div key={w} className="flex items-baseline gap-1.5">
                        <dt className="inline-flex items-center gap-1.5 text-ink-2"><span aria-hidden className="inline-block size-2.5 rounded-sm" style={{ background: WENT_KEY[i].fill, opacity: WENT_KEY[i].opacity }} />{WENT_KEY[i].label}</dt>
                        <dd className={cx("num font-semibold", w === "none" && fills.went.none > 0 && "text-warn")}>{fills.went[w]}</dd>
                      </div>
                    ))}
                  </dl>
                  {fills.went.none > 0 && <p className="mt-2 text-xs text-muted">No scan: next scanned empty or filled again with no tap or delivery scan in between.</p>}
                </div>
                <div className="mt-3"><Key items={[{ label: "This year", fill: "var(--area)", opacity: 0.85 }, { label: "Last year", fill: "var(--border-strong)", opacity: 1 }]} /></div>
              </Card>
            )}
          </Section>

          {demand && sold && (
            <Section
              help="kegs.demand.beers"
              title="Pints a week"
              description={core ? "From Square: the last 26 weeks it sold, and the next four with their range." : "From Square, for information. Only core beers get a fill plan."}
              actions={<LinkButton href="/kegs/demand" size="sm" className="h-10 sm:h-8">All beers</LinkButton>}
            >
              <Card className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm text-ink-2">{core ? demand.plan.sentence : demand.info}</p>
                  {core ? <Badge tone={demand.plan.tone}>{demand.plan.tone === "bad" ? "Runs out soon" : demand.plan.toFill > 0 ? `Fill ${demand.plan.toFill}` : "Covered"}</Badge> : <Badge>{STANDING_LABEL[b.standing]}</Badge>}
                </div>
                <div className="mt-3"><WeeklyPints history={demand.weekly} forecast={demand.forecast.weeks} /></div>
                <div className="mt-2 max-w-sm">
                  <div className="mb-1 text-[11px] text-muted">Its year: average pints by month</div>
                  <MonthBars months={demand.months} />
                </div>
              </Card>
            </Section>
          )}
        </>
      )}
    </>
  );
}
