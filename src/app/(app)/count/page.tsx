import { Badge, Button, Card, PageHeader, Section } from "@/components/ui";
import { relativeTime } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { storageAreasWithCounts } from "@/server/services/inventory";
import { AreasPanel } from "./areas-panel";
import Link from "next/link";
import { startCount } from "./actions";
import { HelpZone } from "@/components/help";

export const metadata = { title: "Counts" };

export default async function CountHome({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  const me = await requireUser();
  const { done } = await searchParams;
  const [areaRows, open, recent] = await Promise.all([
    storageAreasWithCounts(),
    db.stockCount.findMany({ where: { completed: false }, include: { _count: { select: { lines: true } }, user: { select: { name: true } } } }),
    db.stockCount.findMany({ where: { completed: true }, orderBy: { takenAt: "desc" }, take: 8, include: { _count: { select: { lines: true } }, user: { select: { name: true } } } }),
  ]);
  const areas = areaRows.map((a) => a.name);

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader help="count.home" title="Inventory count" description="Pick an area and count what's on the shelf. Everything saves as you go." />
      {done && <Card className="mb-6 border-good/30 bg-good-bg p-4 text-sm font-medium text-good">Count saved. Thank you!</Card>}

      {open.length > 0 && (
        <HelpZone id="count.inProgress" tour="count.in-progress">
        <Section title="In progress">
          <Card className="divide-y divide-border">
            {open.map((c) => (
              <Link key={c.id} href={`/count/${c.id}`} className="flex items-center justify-between px-4 py-4 hover:bg-surface-2/60">
                <div>
                  <div className="font-medium">{!c.area || c.area === "All" ? "Everything" : c.area}</div>
                  <div className="text-xs text-muted">Started by {c.user?.name ?? "someone"} · {c._count.lines} counted</div>
                </div>
                <span className="text-sm text-ink-2">Continue →</span>
              </Link>
            ))}
          </Card>
        </Section>
        </HelpZone>
      )}

      <HelpZone id="count.start" tour="count.start">
      <Section title="Start a count" actions={me.role === "MANAGER" ? <AreasPanel areas={areaRows} /> : undefined}>
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
            {recent.map((c) => (
              <div key={c.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <div>{!c.area || c.area === "All" ? "Everything" : c.area} <span className="text-muted">· {c.user?.name ?? "—"}</span></div>
                <div className="flex items-center gap-2 text-muted"><Badge>{c._count.lines} items</Badge>{relativeTime(c.takenAt)}</div>
              </div>
            ))}
          </Card>
        </Section>
        </HelpZone>
      )}
    </div>
  );
}
