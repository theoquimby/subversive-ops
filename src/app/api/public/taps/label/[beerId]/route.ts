import { db } from "@/server/db";

export const dynamic = "force-dynamic";

/** A beer's label image for the tap list (public: it's on the board and the website). */
export async function GET(_req: Request, { params }: { params: Promise<{ beerId: string }> }) {
  const { beerId } = await params;
  const img = await db.beerLabel.findUnique({ where: { beerId: String(beerId).slice(0, 40) } });
  if (!img) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(img.bytes), {
    headers: {
      "Content-Type": img.mime,
      // The URL carries ?v=<upload time>, so a new upload is a new URL.
      "Cache-Control": "public, max-age=86400, s-maxage=86400",
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
