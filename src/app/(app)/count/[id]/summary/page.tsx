import { Card, cx, PageHeader, Section } from "@/components/ui";
import { LineChart } from "@/components/line-chart";
import { HelpTip, HelpZone } from "@/components/help";
import { Bars } from "@/app/(app)/sales/bars";
import { money, shortDate } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { countDay, countSummary, foundElsewhere, valueTrend } from "@/server/services/counts";
import { HomeAreaSuggest } from "../../home-area-suggest";
import { notFound, redirect } from "next/navigation";

export const metadata = { title: "Count result" };

/** What a finished count says: what the shelves are worth, what changed, what's carried, and stock the menu doesn't use. */
export default async function CountSummaryPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser("MANAGER");
  const { id } = await params;
  const [s, trend, found] = await Promise.all([countSummary(id), valueTrend(8), foundElsewhere(id)]);
  if (!s) {
    redirect("/count");
    notFound();
  }
  const { count, value: v, prev, offMenu, change } = s;
  const where = !count.area || count.area === "All" ? "Everything" : count.area;
  const date = countDay(count.takenAt);
  const offMenuTotal = offMenu.reduce((t, l) => t + l.value, 0);

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader help="count.summary" title={`${where}, ${shortDate(date)}`} description={`Counted by ${count.user?.name ?? "someone"}${count.approvedBy && count.approvedBy !== count.user?.name ? `, approved by ${count.approvedBy}` : ""}.`} back={{ href: "/count", label: "Counts" }} />

      <HomeAreaSuggest found={found} />

      <HelpZone id="count.summary.value"><Card className="mb-6 p-5">
        <div className="flex items-center gap-1.5 text-sm text-muted">Inventory value <HelpTip id="count.summary.value" /></div>
        <div className="num mt-1 text-3xl font-semibold tracking-tight">{money(v.total, { whole: true })}</div>
        <div className="mt-1 text-sm">
          {change ? (
            <>
              <span className={cx("num", change.amount === 0 ? "text-muted" : "text-ink")}>
                {change.amount >= 0 ? "+" : "−"}{money(Math.abs(change.amount), { whole: true })}{change.pct != null ? ` (${change.amount >= 0 ? "+" : "−"}${Math.abs(change.pct * 100).toFixed(0)}%)` : ""} <span className="text-muted">on the same items since {shortDate(prev!.date)}</span>
              </span>
              {change.added > 0 && <span className="mt-0.5 block text-xs text-muted">{change.added} item{change.added === 1 ? "" : "s"} counted for the first time ({money(change.addedValue, { whole: true })}) aren&apos;t part of that change.</span>}
            </>
          ) : <span className="text-muted">First count, nothing to compare yet.</span>}
        </div>
        {v.carriedCount > 0 && <p className="mt-2 text-xs text-muted"><span className="num">{money(v.carriedValue, { whole: true })}</span> of it is {v.carriedCount} item{v.carriedCount === 1 ? "" : "s"} carried from an earlier count.</p>}
        {trend.length > 1 && <div className="mt-4"><LineChart points={trend.map((t) => ({ x: t.date, y: t.total }))} height={120} ariaLabel="Inventory value over the last counts" /></div>}
      </Card></HelpZone>

      <div className="grid gap-6">
        <HelpZone id="count.summary.byArea"><Section title="By area">
          <Card className="p-4">
            <Bars ariaLabel="Inventory value by storage area" color="var(--money-goods)" rows={v.byArea.map((a) => ({ key: a.name, label: a.name, value: a.value, display: money(a.value, { whole: true }) }))} />
          </Card>
        </Section></HelpZone>
        <HelpZone id="count.summary.byCategory"><Section title="By category">
          <Card className="p-4">
            <Bars ariaLabel="Inventory value by category" color="var(--money-goods)" rows={v.byCategory.slice(0, 10).map((a) => ({ key: a.name, label: a.name, value: a.value, display: money(a.value, { whole: true }) }))} />
          </Card>
        </Section></HelpZone>
      </div>

      {v.carriedCount > 0 && (
        <HelpZone id="count.summary.carried"><Section title="Carried forward" description="Not counted this time (monthly or only when it changes). Their last count is in the value.">
          <Card className="divide-y divide-border">
            {v.lines.filter((l) => l.carriedFrom).map((l) => (
              <div key={l.key} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0"><span className="block truncate">{l.name}</span><span className="block text-xs text-muted">carried from {shortDate(l.carriedFrom!)}</span></span>
                <span className="num shrink-0">{money(l.value, { whole: true })}</span>
              </div>
            ))}
          </Card>
        </Section></HelpZone>
      )}

      {offMenu.length > 0 && (
        <HelpZone id="count.summary.offMenu"><Section title={<span className="inline-flex items-center gap-1.5">On hand, not on the menu <HelpTip id="count.summary.offMenu" /></span>} description={`${money(offMenuTotal, { whole: true })} sitting on shelves that no menu item uses. Ideas for a special?`}>
          <Card className="divide-y divide-border">
            {offMenu.slice(0, 30).map((l) => (
              <div key={l.key} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0"><span className="block truncate">{l.name}</span><span className="block truncate text-xs text-muted">{l.area}{l.carriedFrom ? ` · from ${shortDate(l.carriedFrom)}` : ""}</span></span>
                <span className="num shrink-0">{money(l.value, { whole: true })}</span>
              </div>
            ))}
          </Card>
        </Section></HelpZone>
      )}
    </div>
  );
}
