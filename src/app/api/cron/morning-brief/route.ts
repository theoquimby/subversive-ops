import { env } from "@/server/env";
import { runMorningBrief } from "@/server/services/morningNotify";

export const maxDuration = 120;

/**
 * Vercel Cron (Bearer CRON_SECRET) runs this a few times each morning, in UTC
 * (see vercel.json: 11:04–16:04 UTC covers 7–11am New York in summer and
 * winter time). It sends the morning brief once, when the business-local
 * hour reaches the time chosen on /brief (default 9am). `?force=1` sends now.
 */
export async function GET(req: Request) {
  if (!env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const force = new URL(req.url).searchParams.get("force") === "1";
  const result = await runMorningBrief(new Date(), { force });
  return Response.json(result, { status: "errors" in result && result.errors?.length && !result.emailed && !result.pushed ? 500 : 200 });
}
