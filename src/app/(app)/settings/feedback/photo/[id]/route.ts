import { requireUser } from "@/server/auth";
import { feedbackPhoto } from "@/server/services/feedback";

/** The photo or screenshot sent with a feedback note (managers only). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUser("MANAGER");
  const { id } = await params;
  const img = await feedbackPhoto(String(id).slice(0, 64));
  if (!img) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(img.bytes), {
    headers: {
      "Content-Type": img.mime,
      "Cache-Control": "private, max-age=604800",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
