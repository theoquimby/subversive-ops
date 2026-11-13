import { env } from "@/server/env";
import { dailySync } from "@/server/services/square-sync";

export const maxDuration = 300;

/** Vercel Cron calls this nightly with `Authorization: Bearer $CRON_SECRET`. */
export async function GET(req: Request) {
  if (!env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  try {
    return Response.json(await dailySync());
  } catch (e) {
    console.error("square-sync failed", e);
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
