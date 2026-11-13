import { payPeriodFor, payrollCsv, PayrollSnapshot } from "@/domain/payroll";
import { getSession } from "@/server/auth";
import { getLaborRules } from "@/server/services/labor-rules";
import { computePayroll, findPayPeriod } from "@/server/services/payroll";
import { businessToday } from "@/server/services/sales";

/**
 * The payroll file for a pay period. An approved period returns its frozen
 * snapshot; anything else is a live DRAFT (marked in the Status column and
 * the file name) so it can't be mistaken for the approved one.
 */
export async function GET(req: Request) {
  const s = await getSession();
  if (s?.role !== "MANAGER") return new Response("Forbidden", { status: 403 });
  const sp = new URL(req.url).searchParams;
  const asked = [sp.get("start"), sp.get("week")].find((d) => d && /^\d{4}-\d{2}-\d{2}$/.test(d)) ?? businessToday();
  const period = payPeriodFor(asked, await getLaborRules());
  const saved = await findPayPeriod(period);
  const snap = saved?.status === "APPROVED" ? (saved.snapshot as unknown as PayrollSnapshot | null) : null;
  const rows = snap?.rows ?? (await computePayroll(period)).rows;
  const status = snap ? "APPROVED" : "DRAFT";
  const body = payrollCsv(rows, { start: period.start, end: period.end, status });
  const name = `payroll-${period.start}-to-${period.end}${snap ? "" : "-DRAFT"}.csv`;
  return new Response(body, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" },
  });
}
