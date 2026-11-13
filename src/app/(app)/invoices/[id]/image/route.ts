import { requireUser } from "@/server/auth";
import { db } from "@/server/db";

/** The stored invoice photo / PDF. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUser("MANAGER");
  const { id } = await params;
  const inv = await db.invoice.findUnique({ where: { id }, select: { image: true, imageType: true, invoiceNumber: true } });
  if (!inv?.image) return new Response("Not found", { status: 404 });
  const ext = inv.imageType === "application/pdf" ? "pdf" : "jpg";
  return new Response(new Uint8Array(inv.image), {
    headers: {
      "Content-Type": inv.imageType ?? "application/octet-stream",
      "Content-Disposition": `inline; filename="invoice-${(inv.invoiceNumber ?? id).replace(/[^\w-]/g, "")}.${ext}"`,
      "Cache-Control": "private, no-cache",
    },
  });
}
