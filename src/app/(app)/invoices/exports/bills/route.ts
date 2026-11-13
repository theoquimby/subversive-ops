import { buildBill, qboBillsCsv, xeroBillsCsv } from "@/domain/accountingExport";
import { getSession } from "@/server/auth";
import { approvedBills, loadAccounts } from "@/server/services/accounting";
import { businessToday } from "@/server/services/sales";
import { readRange } from "../range";

/** Approved invoices as a bills import file: ?format=qbo|xero&from&to&detail=1 */
export async function GET(req: Request) {
  const s = await getSession();
  if (s?.role !== "MANAGER") return new Response("Forbidden", { status: 403 });
  const url = new URL(req.url);
  const { from, to, toExclusive } = readRange({ from: url.searchParams.get("from"), to: url.searchParams.get("to") }, businessToday());
  const format = url.searchParams.get("format") === "xero" ? "xero" : "qbo";
  const detail = url.searchParams.get("detail") === "1";
  const [rows, accounts] = await Promise.all([approvedBills(from, toExclusive), loadAccounts()]);
  const bills = rows.map((r) => buildBill(r, accounts, !detail));
  const csv = format === "xero" ? xeroBillsCsv(bills) : qboBillsCsv(bills, accounts.termsDays);
  const name = `bills-${format === "xero" ? "xero" : "quickbooks"}-${from}-to-${to}.csv`;
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } });
}
