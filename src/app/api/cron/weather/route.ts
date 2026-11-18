import { env } from "@/server/env";
import { refreshWeather } from "@/server/services/forecasting";
import { logForecasts } from "@/server/services/forecastScore";

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
  // Then keep tonight's forecast so it can be scored later. It may not fail the weather refresh.
  const logged = await logForecasts().catch((e) => {
    console.error("forecast log failed", e);
    return 0;
  });
  return Response.json({ ...r, logged });
}
