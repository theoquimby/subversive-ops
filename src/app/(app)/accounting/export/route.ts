import { closePeriod, previousPeriod } from "@/domain/monthEnd";
import { requireUser } from "@/server/auth";
import { accountantPackXlsx, closeReport, salesTaxSettings } from "@/server/services/monthEnd";
import { journalOverview } from "@/server/services/monthEndJournal";
import { businessToday } from "@/server/services/sales";

/** The accountant pack: GET /accounting/export?period=month&month=2026-10 → one .xlsx with a tab per subject. */
export async function GET(req: Request) {
  await requireUser("MANAGER");
  const q = Object.fromEntries(new URL(req.url).searchParams);
  const tax = await salesTaxSettings();
  const p = closePeriod(q.period, businessToday(), q, tax.quarterStartMonth);
  const report = await closeReport(p, previousPeriod(p, tax.quarterStartMonth), journalOverview(p));
  const { bytes, name } = await accountantPackXlsx(report);
  return new Response(new Blob([new Uint8Array(bytes)]), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
