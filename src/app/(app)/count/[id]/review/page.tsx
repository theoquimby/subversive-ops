import { Badge, Card, cx, PageHeader, Section } from "@/components/ui";
import { describeParts, looksOff, readParts } from "@/domain/countUnits";
import { partsByArea, prepKey, totalCheck } from "@/domain/countPlan";
import { HomeAreaSuggest } from "../../home-area-suggest";
import { toBase } from "@/domain/units";
import { relativeTime, shortDate } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { countItems, foundElsewhere, type CountItem } from "@/server/services/counts";
import { notFound, redirect } from "next/navigation";
import { HelpTip, HelpZone } from "@/components/help";
import { ReviewActions } from "./review-actions";

export const metadata = { title: "Review count" };

const show = (base: number, unit: string, i: CountItem) => {
  try {
    return `${Number((base / toBase(1, unit, i.base, i.conversions)).toFixed(2))} ${unit}`;
  } catch {
    return `${Number(base.toFixed(2))} ${i.base}`;
  }
};

/** A manager checks a staff count before it becomes the official one. */
export default async function ReviewCountPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser("MANAGER");
  const { id } = await params;
  const count = await db.stockCount.findUnique({ where: { id }, include: { lines: true, prepLines: true, user: { select: { name: true } } } });
  if (!count) notFound();
  if (count.completed) redirect("/count");
  const [items, found] = await Promise.all([countItems(count.area ?? undefined, "MANAGER", { expected: true }), foundElsewhere(count.id)]);
  const lines = new Map<string, { qtyBase: { toNumber(): number }; parts: unknown }>([...count.lines.map((l) => [l.ingredientId, l] as const), ...count.prepLines.map((l) => [prepKey(l.recipeId), l] as const)]);

  const rows = items.filter((i) => lines.has(i.id)).map((i) => {
    const l = lines.get(i.id)!;
    const qty = l.qtyBase.toNumber();
    const parts = readParts(l.parts);
    const unit = i.units[0];
    let one = 0;
    try { one = toBase(1, unit, i.base, i.conversions); } catch { /* keep 0 */ }
    const places = parts ? partsByArea(parts, i.area).length : 1;
    const check = totalCheck({ total: qty, places, expected: i.expected, last: i.last?.qtyBase ?? null, minGap: one * 2 });
    const off = !!check || looksOff(qty, i.last?.qtyBase ?? null, one * 2).off;
    const change = i.last ? qty - i.last.qtyBase : null;
    return { i, qty, parts, unit, off, check, change, big: change != null && one > 0 && Math.abs(change) >= one };
  });
  rows.sort((a, b) => Number(b.off) - Number(a.off) || Number(b.big) - Number(a.big) || 0);
  const skipped = items.filter((i) => i.due && !lines.has(i.id));
  const carried = items.filter((i) => !i.due && !lines.has(i.id));
  const flagged = rows.filter((r) => r.off).length;
  const notes = (count.staffNote ?? "").split("\n").filter(Boolean);
  const where = !count.area || count.area === "All" ? "Everything" : count.area;

  return (
    <div className="mx-auto max-w-xl pb-28">
      <PageHeader help="count.review" title={`Review: ${where}`} description={`Counted by ${count.user?.name ?? "someone"}${count.submittedAt ? `, sent ${relativeTime(count.submittedAt)}` : " (not sent yet)"}. Nothing changes until you approve.`} back={{ href: "/count", label: "Counts" }} />

      <div className="mb-6 grid grid-cols-3 gap-2 text-center">
        <Card className="p-3"><div className="num text-xl font-semibold">{rows.length}</div><div className="text-xs text-muted">counted</div></Card>
        <Card className="p-3"><div className={cx("num text-xl font-semibold", flagged > 0 && "text-warn")}>{flagged}</div><div className="text-xs text-muted">look off</div></Card>
        <Card className="p-3"><div className={cx("num text-xl font-semibold", skipped.length > 0 && "text-bad")}>{skipped.length ? skipped.length : carried.length}</div><div className="text-xs text-muted">{skipped.length ? "missing" : "carried"}</div></Card>
      </div>

      {notes.length > 0 && (
        <HelpZone id="count.review.notes"><Section title="Notes from the count">
          <Card className="divide-y divide-border">
            {notes.map((n, k) => <p key={k} className="px-4 py-3 text-sm">{n}</p>)}
          </Card>
        </Section></HelpZone>
      )}

      <HelpZone id="count.review.lines"><Section title={<span className="inline-flex items-center gap-1.5">Counted, compared with the last count <HelpTip id="count.review.lines" /></span>}>
        {rows.length === 0 ? <Card className="p-5 text-sm text-muted">Nothing was counted.</Card> : (
          <Card className="divide-y divide-border">
            {rows.map(({ i, qty, parts, unit, off, check, change, big }) => (
              <div key={i.id} className={cx("flex items-start justify-between gap-3 px-4 py-3 text-sm", off && "bg-warn-bg/60")}>
                <div className="min-w-0 flex-1">
                  <div className="font-medium leading-tight">{i.name}</div>
                  <div className="text-xs text-muted">{i.area}{i.last ? ` · last ${show(i.last.qtyBase, unit, i)} on ${shortDate(i.last.at.slice(0, 10))}` : " · never counted before"}</div>
                  {off && <Badge tone="warn" className="mt-1">{check?.kind === "double" ? "Counted twice? Check it" : "Looks off: check it"}</Badge>}
                </div>
                <div className="num max-w-[50%] shrink-0 text-right">
                  <div className="font-medium">{show(qty, unit, i)}</div>
                  {parts && (parts.length > 1 || parts[0].unit !== unit) && <div className="text-xs text-muted">{partsByArea(parts, i.area).map((p, _n, all) => `${all.length > 1 ? `${p.area} ` : ""}${describeParts(p.parts)}`).join(" · ")}</div>}
                  {change != null && (big || off) && <div className={cx("text-xs", off ? "text-warn" : "text-muted")}>{change > 0 ? "+" : "−"}{show(Math.abs(change), unit, i)}</div>}
                </div>
              </div>
            ))}
          </Card>
        )}
      </Section></HelpZone>

      {skipped.length > 0 && (
        <HelpZone id="count.review.skipped"><Section title="Missing" description="Due but not counted (the count was sent before every line was required). They keep their last count.">
          <Card className="divide-y divide-border">
            {skipped.map((i) => (
              <div key={i.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0 truncate">{i.name}</span>
                <span className="num shrink-0 text-xs text-muted">{i.last ? `last ${show(i.last.qtyBase, i.units[0], i)}` : "never counted"}</span>
              </div>
            ))}
          </Card>
        </Section></HelpZone>
      )}

      {carried.length > 0 && (
        <HelpZone id="count.review.carried"><Section title="Not due, carried forward" description="Monthly and “only when it changes” items. Their last count stays in the value.">
          <Card className="divide-y divide-border">
            {carried.map((i) => (
              <div key={i.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0 truncate">{i.name}</span>
                <span className="num shrink-0 text-xs text-muted">{i.last ? `${show(i.last.qtyBase, i.units[0], i)} from ${shortDate(i.last.at.slice(0, 10))}` : "never counted"}</span>
              </div>
            ))}
          </Card>
        </Section></HelpZone>
      )}

      <HomeAreaSuggest found={found} />

      <ReviewActions countId={count.id} />
    </div>
  );
}
