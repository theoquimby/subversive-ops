import { PageHeader } from "@/components/ui";
import { addDays } from "@/domain/dates";
import { weekStartOf } from "@/domain/schedule";
import { requireUser } from "@/server/auth";
import { lastLaborSync } from "@/server/services/labor";
import { businessToday } from "@/server/services/sales";
import { tipPeriodView } from "@/server/services/tips";
import { TipPool } from "./tip-pool";

export const metadata = { title: "Tips" };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export default async function TipsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  await requireUser("MANAGER");
  const sp = await searchParams;
  const lastMonday = addDays(weekStartOf(businessToday()), -7);
  const from = sp.from && ISO.test(sp.from) ? sp.from : lastMonday;
  const to = sp.to && ISO.test(sp.to) && sp.to >= from ? sp.to : sp.from && ISO.test(sp.from) ? from : addDays(lastMonday, 6);
  const [view, synced] = await Promise.all([tipPeriodView(from, to), lastLaborSync()]);
  return (
    <>
      <PageHeader help="tips.page" title="Tips" description="Card tips and declared cash tips come in from Square. Check them, then split the pool by hours or points. Finalized pools flow into the payroll export." />
      <TipPool key={`${from}|${to}|${view.saved?.id ?? ""}|${view.saved?.finalized ?? ""}`} from={from} to={to} {...view} lastSync={synced?.toISOString() ?? null} />
    </>
  );
}
