import { Card, cx, PageHeader, Section } from "@/components/ui";
import { LineChart } from "@/components/line-chart";
import { HelpTip, HelpZone } from "@/components/help";
import { valueChange } from "@/domain/countPlan";
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
  const { count, value: v, prev, offMenu } = s;
  const change = valueChange(v.total, prev?.total ?? null);
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
            <span className={cx("num", change.amount > 0 ? "text-ink" : change.amount < 0 ? "text-ink" : "text-muted")}>
              {change.amount >= 0 ? "+" : "−"}{money(Math.abs(change.amount), { whole: true })}{change.pct != null ? ` (${change.amount >= 0 ? "+" : "−"}${Math.abs(change.pct * 100).toFixed(0)}%)` : ""} <span className="text-muted">vs {shortDate(prev!.date)}</span>
            </span>
          ) : <span className="text-muted">First count, nothing to compare yet.</span>}
        </div>
        {v.carriedCount > 0 && <p className="mt-2 text-xs text-muted"><span className="num">{money(v.carriedValue, { whole: true })}</span> of it is {v.carriedCount} item{v.carriedCount === 1 ? "" : "s"} carried from an earlier count.</p>}
        {trend.length > 1 && <div className="mt-4"><LineChart points={trend.map((t) => ({ x: t.date, y: t.total }))} height={120} ariaLabel="Inventory value over the last counts" /></div>}
      </Card></HelpZone>

      <div className="grid gap-6 sm:grid-cols-2">
        <HelpZone id="count.summary.byArea"><Section title="By area">
          <Card className="divide-y divide-border">
            {v.byArea.map((a) => <div key={a.name} className="flex justify-between gap-3 px-4 py-2.5 text-sm"><span className="truncate">{a.name}</span><span className="num">{money(a.value, { whole: true })}</span></div>)}
          </Card>
        </Section></HelpZone>
        <HelpZone id="count.summary.byCategory"><Section title="By category">
          <Card className="divide-y divide-border">
            {v.byCategory.slice(0, 10).map((a) => <div key={a.name} className="flex justify-between gap-3 px-4 py-2.5 text-sm"><span className="truncate">{a.name}</span><span className="num">{money(a.value, { whole: true })}</span></div>)}
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
