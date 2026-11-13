import { getSession } from "@/server/auth";
import { loadOrder, orderAsCsv } from "@/server/services/orders";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (s?.role !== "MANAGER") return new Response("Forbidden", { status: 403 });
  const o = await loadOrder((await params).id);
  if (!o) return new Response("Not found", { status: 404 });
  const name = `${o.supplier.name}-${o.deliveryDate.toISOString().slice(0, 10)}.csv`.replace(/[^\w.-]+/g, "-");
  return new Response(orderAsCsv(o), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"` } });
}
