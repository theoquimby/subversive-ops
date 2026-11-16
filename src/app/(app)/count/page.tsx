import { Badge, Button, Card, cx, LinkButton, PageHeader, Section } from "@/components/ui";
import { ListChecks } from "lucide-react";
import { money, relativeTime, shortDate } from "@/lib/format";
import { valueTrend } from "@/server/services/counts";
import { valueChange } from "@/domain/countPlan";
import { LineChart } from "@/components/line-chart";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { storageAreasWithCounts } from "@/server/services/inventory";
import { AreasPanel } from "./areas-panel";
import Link from "next/link";
import { startCount } from "./actions";
import { HelpZone } from "@/components/help";

export const metadata = { title: "Counts" };

export default async function CountHome({ searchParams }: { searchParams: Promise<{ done?: string; sent?: string }> }) {
  const me = await requireUser();
  const manager = me.role === "MANAGER";
  const { done, sent } = await searchParams;
  const [areaRows, open, waiting, recent, trend] = await Promise.all([
    storageAreasWithCounts(),
    db.stockCount.findMany({ where: { completed: false, submittedAt: null }, include: { _count: { select: { lines: true, prepLines: true } }, user: { select: { name: true } } } }),
    db.stockCount.findMany({ where: { completed: false, submittedAt: { not: null } }, orderBy: { submittedAt: "asc" }, include: { _count: { select: { lines: true, prepLines: true } }, user: { select: { name: true } } } }),
    db.stockCount.findMany({ where: { completed: true }, orderBy: { takenAt: "desc" }, take: 8, include: { _count: { select: { lines: true, prepLines: true } }, user: { select: { name: true } } } }),
    manager ? valueTrend(8) : Promise.resolve([]),
  ]);
  const latest = trend.at(-1);
  const change = latest ? valueChange(latest.total, trend.at(-2)?.total ?? null) : null;
  const areas = areaRows.map((a) => a.name);

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader help="count.home" title="Inventory count" description="Pick an area and count what's on the shelf. Everything saves as you go." />
      {done && <Card className="mb-6 border-good/30 bg-good-bg p-4 text-sm font-medium text-good">Count saved. Thank you!</Card>}
      {sent && <Card className="mb-6 border-good/30 bg-good-bg p-4 text-sm font-medium text-good">Sent to the manager to check. Thank you!</Card>}

      {waiting.length > 0 && (
        <HelpZone id="count.waiting" tour="count.waiting">
        <Section title={manager ? "Waiting for your approval" : "With the manager"}>
          <Card className="divide-y divide-border">
            {waiting.map((c) => {
              const body = (
                <>
                  <div className="min-w-0">
                    <div className="font-medium">{!c.area || c.area === "All" ? "Everything" : c.area}</div>
                    <div className="text-xs text-muted">{c.user?.name ?? "Someone"} · {c._count.lines + c._count.prepLines} counted · sent {relativeTime(c.submittedAt)}{c.staffNote ? " · has a note" : ""}</div>
                  </div>
                  {manager ? <span className="shrink-0 text-sm font-medium text-ink">Review →</span> : <Badge>Waiting</Badge>}
                </>
              );
              return manager
                ? <Link key={c.id} href={`/count/${c.id}/review`} className="flex items-center justify-between gap-3 px-4 py-4 hover:bg-surface-2/60">{body}</Link>
                : <div key={c.id} className="flex items-center justify-between gap-3 px-4 py-4">{body}</div>;
            })}
          </Card>
        </Section>
        </HelpZone>
      )}

      {open.length > 0 && (
        <HelpZone id="count.inProgress" tour="count.in-progress">
        <Section title="In progress">
          <Card className="divide-y divide-border">
            {open.map((c) => (
              <Link key={c.id} href={`/count/${c.id}`} className="flex items-center justify-between px-4 py-4 hover:bg-surface-2/60">
                <div>
                  <div className="font-medium">{!c.area || c.area === "All" ? "Everything" : c.area}</div>
                  <div className="text-xs text-muted">Started by {c.user?.name ?? "someone"} · {c._count.lines + c._count.prepLines} counted</div>
                </div>
                <span className="text-sm text-ink-2">Continue →</span>
              </Link>
            ))}
          </Card>
        </Section>
        </HelpZone>
      )}

      {manager && latest && (
        <HelpZone id="count.value" tour="count.value" className="mb-8"><Link href={`/count/${latest.id}/summary`} className="block"><Card className="p-4 hover:border-border-strong">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm text-muted">Inventory value{latest.area !== "All" ? ` · ${latest.area}` : ""} · {shortDate(latest.date)}</div>
              <div className="num mt-0.5 text-2xl font-semibold tracking-tight">{money(latest.total, { whole: true })}</div>
              {/* Say how much the number stands on: a 2-item count isn't the whole stock. */}
              <div className="text-xs text-muted">From {latest.items} item{latest.items === 1 ? "" : "s"} counted{latest.items < 20 ? " — a full count gives the real figure" : ""}</div>
              {change && <div className="num text-sm text-ink-2">{change.amount >= 0 ? "+" : "−"}{money(Math.abs(change.amount), { whole: true })} <span className="text-muted">vs the count before</span></div>}
            </div>
            <span className="text-sm text-ink-2">Details →</span>
          </div>
          {trend.length > 1 && <div className="mt-3"><LineChart points={trend.map((t) => ({ x: t.date, y: t.total }))} height={96} ariaLabel="Inventory value over the last counts" /></div>}
        </Card></Link></HelpZone>
      )}

      <HelpZone id="count.start" tour="count.start">
      <Section title="Start a count" actions={manager ? <div className="flex flex-wrap justify-end gap-1"><LinkButton href="/count/setup" size="sm" variant="ghost"><ListChecks className="size-4" /> Set up the count</LinkButton><AreasPanel areas={areaRows} /></div> : undefined}>
        <div className="grid grid-cols-2 gap-3">
          {["All", ...areas].map((a) => (
            <form key={a} action={startCount}>
              <input type="hidden" name="area" value={a} />
              <Button size="lg" className="h-16 w-full text-base">{a === "All" ? "Everything" : a}</Button>
            </form>
          ))}
        </div>
      </Section>
      </HelpZone>

      {recent.length > 0 && (
        <HelpZone id="count.recent" tour="count.recent">
        <Section title="Recent counts">
          <Card className="divide-y divide-border">
            {recent.map((c) => {
              const Row = manager ? Link : "div";
              return (
              <Row key={c.id} href={`/count/${c.id}/summary`} className={cx("flex items-center justify-between gap-3 px-4 py-3 text-sm", manager && "hover:bg-surface-2/60")}>
                <div className="min-w-0">{!c.area || c.area === "All" ? "Everything" : c.area} <span className="text-muted">· {c.user?.name ?? "—"}{c.approvedBy && c.approvedBy !== c.user?.name ? `, approved by ${c.approvedBy}` : ""}</span></div>
                <div className="flex items-center gap-2 text-muted"><Badge>{c._count.lines + c._count.prepLines} items</Badge>{relativeTime(c.takenAt)}</div>
              </Row>
              );
            })}
          </Card>
        </Section>
        </HelpZone>
      )}
    </div>
  );
}
