import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { documentScope } from "@/server/services/documents";

/** A stored document (staff see staff documents; managers see all). Lives under /my so staff can reach it. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await requireUser();
  const { id } = await params;
  const doc = await db.document.findFirst({ where: { id, ...documentScope(s.role) }, select: { bytes: true, mime: true, title: true, filename: true } });
  if (!doc) return new Response("Not found", { status: 404 });
  const download = new URL(req.url).searchParams.get("download") === "1";
  const name = (doc.filename ?? doc.title).replace(/[^\w.\- ]/g, "").trim() || "document";
  return new Response(new Uint8Array(doc.bytes), {
    headers: {
      "Content-Type": doc.mime,
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${name}"`,
      "Cache-Control": "private, no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
