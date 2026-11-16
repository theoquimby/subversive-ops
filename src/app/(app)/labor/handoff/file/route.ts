import { isExportFormat } from "@/domain/payrollHandoff";
import { payPeriodFor } from "@/domain/payroll";
import { getSession } from "@/server/auth";
import { getLaborRules } from "@/server/services/labor-rules";
import { buildExport } from "@/server/services/payrollHandoff";
import { businessToday } from "@/server/services/sales";

/** Download a payroll file for a period in a provider's format; each download is logged on the period. */
export async function GET(req: Request) {
  const s = await getSession();
  if (s?.role !== "MANAGER") return new Response("Forbidden", { status: 403 });
  const sp = new URL(req.url).searchParams;
  const format = sp.get("format") ?? "GENERIC";
  if (!isExportFormat(format)) return new Response("Unknown format", { status: 400 });
  const asked = sp.get("start");
  const period = payPeriodFor(asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : businessToday(), await getLaborRules());
  const file = await buildExport(period, format, s.name);
  return new Response(file.body, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file.filename}"`, "Cache-Control": "no-store" },
  });
}
