import { qboJournalCsv, salesJournal, xeroJournalCsv } from "@/domain/accountingExport";
import { getSession } from "@/server/auth";
import { loadAccounts, salesDays } from "@/server/services/accounting";
import { businessToday } from "@/server/services/sales";
import { readRange } from "../range";

/** Daily sales journal: ?format=qbo|xero&from&to */
export async function GET(req: Request) {
  const s = await getSession();
  if (s?.role !== "MANAGER") return new Response("Forbidden", { status: 403 });
  const url = new URL(req.url);
  const { from, to, toExclusive } = readRange({ from: url.searchParams.get("from"), to: url.searchParams.get("to") }, businessToday());
  const format = url.searchParams.get("format") === "xero" ? "xero" : "qbo";
  const [{ days }, accounts] = await Promise.all([salesDays(from, toExclusive), loadAccounts()]);
  const journals = salesJournal(days, accounts);
  const csv = format === "xero" ? xeroJournalCsv(journals) : qboJournalCsv(journals);
  const name = `sales-journal-${format === "xero" ? "xero" : "quickbooks"}-${from}-to-${to}.csv`;
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } });
}
