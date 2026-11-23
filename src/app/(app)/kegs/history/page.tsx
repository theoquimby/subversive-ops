import { PageHeader } from "@/components/ui";
import { parseHistoryParams } from "@/domain/kegHistory";
import { displayCode } from "@/domain/kegs";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { historyPage } from "@/server/services/kegHistory";
import { businessToday } from "@/server/services/sales";
import Link from "next/link";
import { HistoryTable } from "./history-table";

export const metadata = { title: "Keg history" };

/**
 * Every scan and change, newest first. The address says what to show (search,
 * what, beer, who, account, dates, one keg) and the server pages through it,
 * so any entry can be reached however long the history gets.
 */
export default async function KegHistory({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser("MANAGER");
  const p = parseHistoryParams(await searchParams);
  const [page, linked] = await Promise.all([
    historyPage(p),
    // A link from a keg carries its id: name it, with a way back to every keg.
    p.keg ? db.keg.findUnique({ where: { id: p.keg }, select: { code: true } }) : null,
  ]);
  const keep = new URLSearchParams();
  for (const [k, v] of Object.entries({ action: p.actions.join(","), beer: p.beers.join(","), who: p.who.join(","), account: p.accounts.join(","), from: p.from ?? "", to: p.to ?? "", q: p.q })) if (v) keep.set(k, v);
  const everyKeg = `/kegs/history${keep.toString() ? `?${keep}` : ""}`;
  const shownKeg = page.keg ?? (linked ? { code: linked.code } : null);

  return (
    <>
      <PageHeader help="kegs.history" title="Keg history" description="Every scan and change: who, when, and from where to where. Nothing here is ever deleted; undone entries are struck through. Search for a keg's code or old sticker to see just that keg." />
      {shownKeg && (
        <p className="mb-3 text-sm text-ink-2">
          Showing keg <Link href={`/kegs/k/${shownKeg.code}`} className="num font-medium hover:underline">{displayCode(shownKeg.code)}</Link>
          {page.keg ? <span className="text-muted"> (from the search)</span> : <> · <Link href={everyKeg} scroll={false} className="underline decoration-border-strong underline-offset-2 hover:text-ink">Every keg</Link></>}
        </p>
      )}
      <HistoryTable
        initial={{ rows: page.rows, next: page.next, total: page.total, counts: page.counts, options: page.options }}
        today={businessToday()}
        from={p.from}
        to={p.to}
        narrowedOutside={!!(p.from || p.to || p.keg)}
      />
    </>
  );
}
