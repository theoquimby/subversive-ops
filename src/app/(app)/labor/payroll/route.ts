import { addDays } from "@/domain/dates";
import { mondayOf, toCsv } from "@/domain/pnl";
import { getSession } from "@/server/auth";
import { weeklyPay } from "@/server/services/labor";
import { businessToday } from "@/server/services/sales";

/** Weekly hours and gross wages per person, for entering into Square Payroll. */
export async function GET(req: Request) {
  const s = await getSession();
  if (s?.role !== "MANAGER") return new Response("Forbidden", { status: 403 });
  const w = new URL(req.url).searchParams.get("week");
  const week = mondayOf(w && /^\d{4}-\d{2}-\d{2}$/.test(w) ? w : businessToday());
  const { lines, rules } = await weeklyPay(week);
  const r2 = (n: number) => n.toFixed(2);
  const rows: (string | number | null)[][] = [
    ["Employee", "Square team member ID", "Week start", "Week end", "Regular hours", "Overtime hours", "Spread-of-hours (count)", "Spread-of-hours pay", "Gross wages", "Tips", "Missing rate", "Still clocked in"],
    ...lines.map((l) => [
      l.name,
      l.squareTeamMemberId ?? "",
      week,
      addDays(week, 6),
      r2(l.regularHours),
      r2(l.overtimeHours),
      l.spreadHours,
      r2(l.spreadHours * rules.minimumWage),
      r2(l.wages),
      "", // tips: filled from the tip pool / Square, not computed here
      l.missingRate ? "yes" : "",
      l.openCards ? "yes" : "",
    ]),
  ];
  return new Response(toCsv(rows), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="payroll-${week}.csv"`, "Cache-Control": "no-store" },
  });
}
