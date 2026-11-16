import { Badge, cx, EmptyState, LinkButton, PageHeader, Section, Stat, Table, Td, Th, Tr } from "@/components/ui";
import { barrels, isRangePreset, RANGE_PRESETS, type RangePreset, type VolumeLine } from "@/domain/kegAccounts";
import { requireUser } from "@/server/auth";
import { kegReports, NO_ACCOUNT } from "@/server/services/kegAccounts";
import { Store } from "lucide-react";
import Link from "next/link";
import { ExportCsv } from "../accounts/accounts-client";
import { bbl, Chip, dated, daysWord, gal, kegsWord } from "../accounts/bits";
import { BeerDot, sizeShort } from "../bits";

export const metadata = { title: "Keg reports" };

const DAY_CHOICES = [14, 30, 60, 90];
const NO_BEER = "Beer not recorded";
/** Two decimals in a file, so small kegs don't round away. */
const bbl2 = (gallons: number) => Math.round(barrels(gallons) * 100) / 100;

export default async function KegReportsPage({ searchParams }: { searchParams: Promise<{ range?: string; days?: string; sizes?: string }> }) {
  await requireUser("MANAGER");
  const sp = await searchParams;
  const preset: RangePreset = isRangePreset(sp.range) ? sp.range : "this-year";
  const asked = Number(sp.days);
  const bySize = sp.sizes === "1";
  const r = await kegReports(preset, Number.isInteger(asked) && asked >= 1 && asked <= 3650 ? asked : null);
  const { volume: v, snapshot: s } = r;

  // Each choice lives in the address, so a report can be bookmarked or sent to someone.
  const href = (patch: { range?: RangePreset; days?: number; sizes?: boolean }, hash: string) => {
    const q = new URLSearchParams();
    const range = patch.range ?? preset;
    const days = patch.days ?? r.days;
    const sizes = patch.sizes ?? bySize;
    if (range !== "this-year") q.set("range", range);
    if (days !== r.overdueDays) q.set("days", String(days));
    if (sizes) q.set("sizes", "1");
    const qs = q.toString();
    return `/kegs/reports${qs ? `?${qs}` : ""}#${hash}`;
  };
  const dayChoices = [...new Set([...DAY_CHOICES, r.overdueDays, r.days])].sort((a, b) => a - b);
  const dates = v.from === v.to ? dated(v.from) : `${dated(v.from)} to ${dated(v.to)}`;
  const stamp = `${v.from}-to-${v.to}`;
  const line = (l: VolumeLine) => `${kegsWord(l.kegs)} · ${gal(l.gallons)} gallons`;
  const bblCell = (l: VolumeLine) => <span className={cx(!l.kegs && "text-muted")}>{bbl(l.gallons)}</span>;

  if (!r.first) {
    return (
      <>
        <PageHeader help="kegs.fleet.went" title="Keg reports" back={{ href: "/kegs", label: "Kegs" }} description="Volume by where the beer went, and the kegs sitting at accounts." />
        <EmptyState title="No keg history yet" action={<LinkButton href="/kegs/import" variant="primary">Import from your old keg app</LinkButton>}>Reports fill in once kegs have been scanned for a while, or as soon as you bring in the history from your old keg app.</EmptyState>
      </>
    );
  }

  return (
    <>
      <PageHeader
        help="kegs.fleet.went"
        title="Keg reports"
        back={{ href: "/kegs", label: "Kegs" }}
        description="Two reports worked out from keg scans: how much beer left in kegs and where it went, and the kegs sitting at accounts right now."
        actions={<LinkButton href="/kegs/accounts" className="h-10 sm:h-9"><Store className="size-4" /> Accounts</LinkButton>}
      />

      <div id="volume" className="scroll-mt-24">
        <Section
          title="Volume"
          description={`${dates}. This counts scans, not sales: a keg that was tapped or delivered without a scan is missing, so the real volume is higher.`}
        >
          <div className="mb-4 flex flex-wrap gap-1.5">
            {RANGE_PRESETS.map((p) => <Chip key={p.id} href={href({ range: p.id }, "volume")} active={preset === p.id}>{p.label}</Chip>)}
          </div>

          <div className="mb-2 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Tapped here" value={`${bbl(v.tapped.gallons)} bbl`} hint={line(v.tapped)} />
            <Stat label="Sent to accounts" value={`${bbl(v.out.gallons)} bbl`} hint={line(v.out)} />
            <Stat label="Filled, no scan" value={`${bbl(v.none.gallons)} bbl`} tone={v.none.kegs ? "warn" : undefined} hint={line(v.none)} />
            <Stat label="Total" value={`${bbl(v.total.gallons)} bbl`} hint={line(v.total)} />
          </div>
          <p className="mb-6 text-xs text-muted">“Tapped here” is kegs put on in the taproom. “Filled, no scan” is beer that was kegged and came back empty with no tap or delivery scan in between, so the history can&apos;t say where it went. 31 gallons make a barrel (bbl).</p>

          {v.total.kegs === 0 ? (
            <p className="text-sm text-muted">No taps, deliveries or unscanned fills in these dates.</p>
          ) : (
            <div className="grid gap-x-8 gap-y-8 xl:grid-cols-[3fr_2fr]">
              <div>
                <div className="mb-2 flex items-end justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold">By beer</h3>
                    <p className="text-xs text-muted">Barrels. A tap counts on the day the keg first went on, a delivery on the day it went out, and an unscanned fill on the day it was filled.</p>
                  </div>
                  <ExportCsv
                    filename={`keg-volume-by-beer-${stamp}.csv`}
                    header={["Beer", "Tapped kegs", "Tapped barrels", "Sent out kegs", "Sent out barrels", "No scan kegs", "No scan barrels", "Total kegs", "Total barrels", "Total gallons"]}
                    rows={[
                      ...v.byBeer.map((b) => [b.name ?? NO_BEER, b.tapped.kegs, bbl2(b.tapped.gallons), b.out.kegs, bbl2(b.out.gallons), b.none.kegs, bbl2(b.none.gallons), b.total.kegs, bbl2(b.total.gallons), b.total.gallons]),
                      ["Total", v.tapped.kegs, bbl2(v.tapped.gallons), v.out.kegs, bbl2(v.out.gallons), v.none.kegs, bbl2(v.none.gallons), v.total.kegs, bbl2(v.total.gallons), v.total.gallons],
                    ]}
                  />
                </div>
                <Table>
                  <thead><tr><Th>Beer</Th><Th align="right">Tapped</Th><Th align="right">Sent out</Th><Th align="right" className="hidden sm:table-cell">No scan</Th><Th align="right">Total</Th><Th align="right" className="hidden sm:table-cell">Kegs</Th></tr></thead>
                  <tbody>
                    <Tr>
                      <Td className="font-medium">Every beer</Td>
                      <Td align="right" className="font-medium">{bbl(v.tapped.gallons)}</Td>
                      <Td align="right" className="font-medium">{bbl(v.out.gallons)}</Td>
                      <Td align="right" className="hidden font-medium sm:table-cell">{bbl(v.none.gallons)}</Td>
                      <Td align="right" className="font-medium">{bbl(v.total.gallons)}</Td>
                      <Td align="right" className="hidden font-medium sm:table-cell">{v.total.kegs}</Td>
                    </Tr>
                    {v.byBeer.map((b) => (
                      <Tr key={b.beerId ?? "none"}>
                        <Td><span className="flex items-center gap-2">{b.color && <BeerDot color={b.color} />}<span className={cx(!b.name && "text-muted")}>{b.name ?? NO_BEER}</span></span></Td>
                        <Td align="right">{bblCell(b.tapped)}</Td>
                        <Td align="right">{bblCell(b.out)}</Td>
                        <Td align="right" className="hidden sm:table-cell">{bblCell(b.none)}</Td>
                        <Td align="right">{bbl(b.total.gallons)}</Td>
                        <Td align="right" className="hidden text-ink-2 sm:table-cell">{b.total.kegs}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </div>

              <div>
                <div className="mb-2 flex items-end justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold">By account</h3>
                    <p className="text-xs text-muted">Kegs scanned out to each account in these dates.</p>
                  </div>
                  {v.byAccount.length > 0 && (
                    <ExportCsv
                      filename={`keg-volume-by-account-${stamp}.csv`}
                      header={["Account", "Kegs", "Barrels", "Gallons"]}
                      rows={[...v.byAccount.map((a) => [a.name ?? NO_ACCOUNT, a.kegs, bbl2(a.gallons), a.gallons]), ["Total", v.out.kegs, bbl2(v.out.gallons), v.out.gallons]]}
                    />
                  )}
                </div>
                {v.byAccount.length === 0 ? (
                  <p className="text-sm text-muted">No keg was scanned out to an account in these dates.</p>
                ) : (
                  <Table>
                    <thead><tr><Th>Account</Th><Th align="right">Kegs</Th><Th align="right">Barrels</Th><Th align="right" className="hidden sm:table-cell">Gallons</Th></tr></thead>
                    <tbody>
                      {v.byAccount.map((a) => (
                        <Tr key={a.accountId ?? "none"}>
                          <Td className={cx(a.accountId && a.name && "py-0")}>{a.accountId && a.name ? <Link href={`/kegs/accounts/${a.accountId}`} className="block py-3 hover:underline">{a.name}</Link> : <span className="text-muted">{NO_ACCOUNT}</span>}</Td>
                          <Td align="right">{a.kegs}</Td>
                          <Td align="right">{bbl(a.gallons)}</Td>
                          <Td align="right" className="hidden text-ink-2 sm:table-cell">{gal(a.gallons)}</Td>
                        </Tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </div>
            </div>
          )}
        </Section>
      </div>

      <div id="at-accounts" className="scroll-mt-24">
        <Section
          title="Kegs at accounts"
          description={`Every account holding kegs today, ${dated(r.today)}, and how many have been there more than ${daysWord(r.days)}. A keg counts from the day it was last scanned out.`}
          actions={
            s.rows.length > 0 ? (
              <ExportCsv
                filename={`kegs-at-accounts-${r.today}.csv`}
                header={["Account", "Kegs", `Out more than ${daysWord(r.days)}`, "Longest wait, days", ...(bySize ? s.sizes.map(sizeShort) : [])]}
                rows={[...s.rows.map((a) => [a.name, a.total, a.over, a.longest, ...(bySize ? s.sizes.map((z) => a.bySize[z]) : [])]), ["Total", s.all.total, s.all.over, "", ...(bySize ? s.sizes.map((z) => s.all.bySize[z]) : [])]]}
              />
            ) : undefined
          }
        >
          <div className="mb-4 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-sm text-muted">Out more than</span>
            {dayChoices.map((d) => <Chip key={d} href={href({ days: d }, "at-accounts")} active={r.days === d}>{daysWord(d)}</Chip>)}
            <span className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden />
            <Chip href={href({ sizes: !bySize }, "at-accounts")} active={bySize}>Split by size</Chip>
          </div>

          {s.rows.length === 0 ? (
            <p className="text-sm text-muted">No kegs are out at an account right now.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Account</Th>
                  <Th align="right">Kegs</Th>
                  <Th align="right">Over {daysWord(r.days)}</Th>
                  <Th align="right" className="hidden sm:table-cell">Longest wait</Th>
                  {bySize && s.sizes.map((z) => <Th key={z} align="right">{sizeShort(z)}</Th>)}
                </tr>
              </thead>
              <tbody>
                <Tr>
                  <Td className="font-medium">All accounts</Td>
                  <Td align="right" className="font-medium">{s.all.total}</Td>
                  <Td align="right" className={cx("font-medium", !s.all.over && "text-muted")}>{s.all.over}</Td>
                  <Td align="right" className="hidden sm:table-cell" />
                  {bySize && s.sizes.map((z) => <Td key={z} align="right" className="font-medium">{s.all.bySize[z]}</Td>)}
                </Tr>
                {s.rows.map((a) => (
                  <Tr key={a.accountId ?? "none"}>
                    <Td className={cx(a.accountId && "py-0")}>{a.accountId ? <Link href={`/kegs/accounts/${a.accountId}`} className="block py-3 hover:underline">{a.name}</Link> : <span className="text-muted">{a.name}</span>}</Td>
                    <Td align="right">{a.total}</Td>
                    <Td align="right">{a.over ? <Badge tone="warn">{a.over}</Badge> : <span className="text-muted">0</span>}</Td>
                    <Td align="right" className="hidden whitespace-nowrap text-ink-2 sm:table-cell">{daysWord(a.longest)}</Td>
                    {bySize && s.sizes.map((z) => <Td key={z} align="right" className={cx(!a.bySize[z] && "text-muted")}>{a.bySize[z]}</Td>)}
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Section>
      </div>
    </>
  );
}
