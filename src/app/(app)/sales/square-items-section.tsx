import { Card, LinkButton } from "@/components/ui";
import { Bone } from "@/components/skeleton";
import { money, pct, qty } from "@/lib/format";
import { linkCoverage } from "@/server/services/linking";
import Link from "next/link";

/**
 * One line on how much of what sells has a cost behind it, and the way to the
 * work: linking lives on /sales/link, and every Square item on /sales/square-menu.
 * It reads every item's sales, so it streams in (Suspense with `SquareItemsSkeleton`).
 */
export async function SquareItemsSection() {
  const cov = await linkCoverage();
  const onTarget = cov.share != null && cov.share >= cov.target;
  return (
    <Card id="sales-items" className="mb-8 flex scroll-mt-24 flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between" data-tour="sales.link-entry">
      <div className="min-w-0 text-sm">
        {cov.share == null ? (
          <div className="font-medium text-ink">No item sales from Square yet. They come in with the first sync.</div>
        ) : (
          <>
            <div className="text-ink">
              <span className="font-semibold">{pct(cov.share, 0)}</span> of the last 30 days&apos; sales have a cost behind them <span className="text-muted">(aim for {pct(cov.target, 0)})</span>
            </div>
            <div className="mt-0.5 text-xs text-muted">
              {onTarget
                ? "On target. New items show up to link when they first sell."
                : `${qty(cov.unlinkedItems, 0)} Square item${cov.unlinkedItems === 1 ? "" : "s"} still need a cost; ${money(cov.toTarget, { whole: true })} more of sales to reach the aim.`}{" "}
              <Link href="/sales/square-menu" className="underline underline-offset-2 hover:text-ink">Every Square item</Link>
            </div>
          </>
        )}
      </div>
      <LinkButton href="/sales/link" variant={onTarget || cov.share == null ? "secondary" : "primary"} className="shrink-0">Link your sales</LinkButton>
    </Card>
  );
}

export function SquareItemsSkeleton() {
  return <Bone className="mb-8 h-20 rounded-xl" />;
}
