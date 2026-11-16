import { parseItemKey } from "@/domain/countPlan";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";

/** An item's photo for the count sheet (staff can see it; only managers set it). `id` is an ingredient id or "p_<recipeId>". */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const { kind, id: raw } = parseItemKey(String(id).slice(0, 44));
  const img = await db.countPhoto.findUnique({ where: kind === "prep" ? { recipeId: raw } : { ingredientId: raw } });
  if (!img) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(img.bytes), {
    headers: {
      "Content-Type": img.mime,
      // The URL carries ?v=<upload time>, so a new photo is a new URL.
      "Cache-Control": "private, max-age=604800",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
