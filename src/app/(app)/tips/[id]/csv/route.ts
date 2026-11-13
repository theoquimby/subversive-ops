import { requireUser } from "@/server/auth";
import { periodCsv } from "@/server/services/tips";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUser("MANAGER");
  const { id } = await params;
  const csv = await periodCsv(id);
  if (!csv) return new Response("Not found", { status: 404 });
  return new Response(csv.body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${csv.filename}"` } });
}
