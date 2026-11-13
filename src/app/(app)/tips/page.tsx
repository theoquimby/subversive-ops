import { PageHeader } from "@/components/ui";
import { addDays } from "@/domain/dates";
import { weekStartOf } from "@/domain/schedule";
import { TipMethod } from "@/domain/tips";
import { requireUser } from "@/server/auth";
import { businessToday } from "@/server/services/sales";
import { findPeriod, listPeriods, syncedTips, tipSharesFor } from "@/server/services/tips";
import { TipPool } from "./tip-pool";

export const metadata = { title: "Tips" };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export default async function TipsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  await requireUser("MANAGER");
  const sp = await searchParams;
  const lastMonday = addDays(weekStartOf(businessToday()), -7);
  const from = sp.from && ISO.test(sp.from) ? sp.from : lastMonday;
  const to = sp.to && ISO.test(sp.to) && sp.to >= from ? sp.to : sp.from && ISO.test(sp.from) ? from : addDays(lastMonday, 6);
  const [shares, synced, saved, periods] = await Promise.all([tipSharesFor(from, to), syncedTips(from, to), findPeriod(from, to), listPeriods()]);
  return (
    <>
      <PageHeader help="tips.page" title="Tips" description="Split the tip pool by hours worked, or by hours × position points. Hours come from timecards. Finalized pools flow into the payroll export." />
      <TipPool
        key={`${from}|${to}|${saved?.id ?? ""}|${saved?.totalTips.toString() ?? ""}|${saved?.method ?? ""}`}
        from={from}
        to={to}
        shares={shares.rows}
        excludedHours={shares.excludedHours}
        synced={synced}
        saved={saved ? { id: saved.id, total: saved.totalTips.toNumber(), method: saved.method as TipMethod, finalized: saved.finalized } : null}
        periods={periods}
      />
    </>
  );
}
