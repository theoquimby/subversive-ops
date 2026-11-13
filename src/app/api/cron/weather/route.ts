import { env } from "@/server/env";
import { refreshWeather } from "@/server/services/forecasting";

export const maxDuration = 60;

/** Vercel Cron calls this nightly with `Authorization: Bearer $CRON_SECRET`. */
export async function GET(req: Request) {
  if (!env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const r = await refreshWeather(true);
  if ("error" in r) {
    console.error("weather refresh failed", r.error);
    return Response.json(r, { status: 502 });
  }
  return Response.json(r);
}
