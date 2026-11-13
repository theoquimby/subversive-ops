import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { employeeForUser } from "@/server/services/scheduling";

/** A certificate photo / PDF. Managers see any; staff only their own. Under /my so staff can reach it. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await requireUser();
  const { id } = await params;
  const cert = await db.certification.findUnique({ where: { id }, select: { employeeId: true, bytes: true, mime: true, filename: true, certType: { select: { name: true } } } });
  if (!cert?.bytes || !cert.mime) return new Response("Not found", { status: 404 });
  if (s.role !== "MANAGER") {
    const me = await employeeForUser(s.userId);
    if (!me || me.id !== cert.employeeId) return new Response("Not found", { status: 404 });
  }
  const download = new URL(req.url).searchParams.get("download") === "1";
  const name = (cert.filename ?? cert.certType.name).replace(/[^\w.\- ]/g, "").trim() || "certificate";
  return new Response(new Uint8Array(cert.bytes), {
    headers: {
      "Content-Type": cert.mime,
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${name}"`,
      "Cache-Control": "private, no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
