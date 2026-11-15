import { db } from "@/server/db";

export const dynamic = "force-dynamic";

/** An image uploaded on Website (event pictures). Public: it's on the website. A new upload is a new id. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const img = await db.webImage.findUnique({ where: { id: String(id).slice(0, 40) } });
  if (!img) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(new Uint8Array(img.bytes), {
    headers: {
      "Content-Type": img.mime,
      "Cache-Control": "public, max-age=31536000, immutable",
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
