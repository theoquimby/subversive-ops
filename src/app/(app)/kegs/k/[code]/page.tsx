import { Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { displayCode } from "@/domain/kegs";
import { shortDate } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { kegLife, type KegLife } from "@/server/services/kegFleet";
import { findKegByScan, kegCard, panelContext } from "@/server/services/kegs";
import { KegPanel } from "../../keg-panel";
import { KegAdmin } from "../../keg-admin";
import { QueueWatcher } from "../../scanner";

export const metadata = { title: "Keg" };

const dated = (d: string) => `${shortDate(d)}, ${d.slice(0, 4)}`;
const WENT: Record<KegLife["cycles"][number]["went"], { label: string; tone: string }> = {
  tapped: { label: "Tapped here", tone: "text-ink-2" },
  out: { label: "Sent out", tone: "text-ink-2" },
  stock: { label: "Still full", tone: "text-good" },
  none: { label: "No scan", tone: "text-warn" },
};

/** Where a sticker's QR lands when scanned with the phone's own camera. */
export default async function KegPage({ params }: { params: Promise<{ code: string }> }) {
  const me = await requireUser();
  const { code } = await params;
  const hit = await findKegByScan(decodeURIComponent(code));
  const card = hit ? await kegCard(hit.id) : null;
  if (!card) {
    return (
      <div className="mx-auto max-w-md">
        <PageHeader title="Keg not found" back={{ href: "/kegs/scan", label: "Scan" }} />
        <EmptyState title={`No keg with the code ${displayCode(decodeURIComponent(code))}`} action={<LinkButton href="/kegs/scan" variant="primary">Scan again</LinkButton>}>
          Check the sticker. {me.role === "MANAGER" ? "New kegs are added on Kegs → All kegs." : "A manager can add it."}
        </EmptyState>
      </div>
    );
  }
  const manager = me.role === "MANAGER";
  const [ctx, life] = await Promise.all([
    panelContext(),
    // The keg's life is extra: a problem working it out never blocks the buttons.
    manager ? kegLife(card.id).catch(() => null) : null,
  ]);
  const showLife = !!life && life.scans > 0;
  return (
    <div className={showLife ? "mx-auto max-w-md lg:mx-0 lg:grid lg:max-w-5xl lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)] lg:items-start lg:gap-10" : "mx-auto max-w-md"}>
      <div className="min-w-0">
        <PageHeader title={`Keg ${displayCode(card.code)}`} back={{ href: manager ? "/kegs/all" : "/kegs", label: manager ? "All kegs" : "Kegs" }} />
        <div className="mb-4"><QueueWatcher /></div>
        <KegPanel card={card} ctx={ctx} role={me.role} />
        {manager && <KegAdmin card={card} />}
        <div className="mt-6">
          <LinkButton href="/kegs/scan" size="lg" className="h-12 w-full">Scan another keg</LinkButton>
        </div>
      </div>

      {showLife && life && (
        <section aria-labelledby="keg-life" className="mt-10 min-w-0 lg:mt-[4.25rem]">
          <h2 id="keg-life" className="text-[0.95rem] font-semibold text-ink">This keg&apos;s working life</h2>
          <p className="mt-0.5 text-sm text-muted">
            From its {life.scans} scan{life.scans === 1 ? "" : "s"}{life.firstScan ? ` since ${dated(life.firstScan)}` : ""}.
          </p>
          <dl className="mt-4 flex flex-wrap gap-x-10 gap-y-4">
            <div>
              <dt className="text-xs text-muted">Filled</dt>
              <dd className="num text-xl font-semibold tracking-tight">{life.fills} time{life.fills === 1 ? "" : "s"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">A fill usually lasts</dt>
              <dd className="num text-xl font-semibold tracking-tight">{life.medianDays == null ? "—" : `${life.medianDays} days`}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Back with no scan</dt>
              <dd className="num text-xl font-semibold tracking-tight">{life.cycles.filter((c) => c.went === "none").length} of {life.fills}</dd>
            </div>
          </dl>
          {life.cycles.length > 0 && (
            <Card className="mt-5 divide-y divide-border">
              {life.cycles.slice(0, 10).map((c, i) => (
                <div key={`${c.start}-${i}`} className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{c.beer ?? "Beer not recorded"}</span>
                    <span className="num block text-xs text-muted">{c.scannedFill ? "Filled" : "First seen full"} {dated(c.start)}{c.end ? ` · back ${dated(c.end)}` : ""}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className={`block text-xs font-medium ${WENT[c.went].tone}`}>{WENT[c.went].label}</span>
                    <span className="num block text-xs text-muted">{c.days == null ? (c.end ? "" : "not back yet") : `${c.days} day${c.days === 1 ? "" : "s"}`}</span>
                  </span>
                </div>
              ))}
            </Card>
          )}
          {life.cycles.length > 10 && <p className="mt-2 text-xs text-muted">The latest 10 of {life.cycles.length} fills. Every scan is under History, in the card.</p>}
        </section>
      )}
    </div>
  );
}
