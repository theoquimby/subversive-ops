import { requireUser } from "@/server/auth";
import { db } from "@/server/db";

/** The stored invoice photo / PDF. `?page=2` (3, …) serves the extra pages of a multi-page invoice. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUser("MANAGER");
  const { id } = await params;
  const page = Number(new URL(req.url).searchParams.get("page") ?? "1");
  const inv = await db.invoice.findUnique({ where: { id }, select: { invoiceNumber: true, ...(page > 1 ? {} : { image: true, imageType: true }) } });
  if (!inv) return new Response("Not found", { status: 404 });
  let bytes: Uint8Array | null = null;
  let type: string | null = null;
  if (Number.isInteger(page) && page > 1) {
    const p = await db.invoicePage.findFirst({ where: { invoiceId: id, position: page }, select: { bytes: true, type: true } });
    bytes = p?.bytes ?? null;
    type = p?.type ?? null;
  } else {
    bytes = "image" in inv ? (inv.image ?? null) : null;
    type = "imageType" in inv ? (inv.imageType ?? null) : null;
  }
  if (!bytes) return new Response("Not found", { status: 404 });
  const ext = type === "application/pdf" ? "pdf" : "jpg";
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": type ?? "application/octet-stream",
      "Content-Disposition": `inline; filename="invoice-${(inv.invoiceNumber ?? id).replace(/[^\w-]/g, "")}${page > 1 ? `-p${page}` : ""}.${ext}"`,
      "Cache-Control": "private, no-cache",
    },
  });
}
