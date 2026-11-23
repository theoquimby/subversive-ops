import { EmptyState, LinkButton, PageHeader, Section, Stat } from "@/components/ui";
import { isRangePreset, RANGE_PRESETS, type RangePreset, type VolumeLine } from "@/domain/kegAccounts";
import { requireUser } from "@/server/auth";
import { kegReports } from "@/server/services/kegAccounts";
import { Store } from "lucide-react";
import { bbl, Chip, dated, daysWord, gal, kegsWord } from "../accounts/bits";
import { AtAccountsTable, VolumeByAccountTable, VolumeByBeerTable } from "./report-tables";

export const metadata = { title: "Keg reports" };

const DAY_CHOICES = [14, 30, 60, 90];

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

  if (!r.first) {
    return (
      <>
        <PageHeader help="kegs.reports" title="Keg reports" description="Volume by where the beer went, and the kegs sitting at accounts." />
        <EmptyState title="No keg history yet" action={<LinkButton href="/kegs/import" variant="primary">Import from your old keg app</LinkButton>}>Reports fill in once kegs have been scanned for a while, or as soon as you bring in the history from your old keg app.</EmptyState>
      </>
    );
  }

  return (
    <>
      <PageHeader
        help="kegs.reports"
        title="Keg reports"
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
            <div className="space-y-8">
              <div>
                <div className="mb-2">
                  <h3 className="text-sm font-semibold">By beer</h3>
                  <p className="text-xs text-muted">Barrels. A tap counts on the day the keg first went on, a delivery on the day it went out, and an unscanned fill on the day it was filled. The CSV has kegs and barrels for each.</p>
                </div>
                <VolumeByBeerTable rows={v.byBeer} stamp={stamp} />
              </div>

              <div>
                <div className="mb-2">
                  <h3 className="text-sm font-semibold">By account</h3>
                  <p className="text-xs text-muted">Kegs scanned out to each account in these dates.</p>
                </div>
                {v.byAccount.length === 0 ? (
                  <p className="text-sm text-muted">No keg was scanned out to an account in these dates.</p>
                ) : (
                  <VolumeByAccountTable rows={v.byAccount} stamp={stamp} />
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
            <AtAccountsTable rows={s.rows} sizes={s.sizes} days={r.days} bySize={bySize} today={r.today} />
          )}
        </Section>
      </div>
    </>
  );
}
