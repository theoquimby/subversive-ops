import { env } from "@/server/env";
import { syncGoogle } from "@/server/services/googleSearch";
import { nightlyWebAnalytics } from "@/server/services/webAnalytics";
import { computeWebFindings } from "@/server/services/webInsights";

export const maxDuration = 300;

/**
 * Nightly (Vercel Cron, Bearer CRON_SECRET): rebuild the website analytics
 * rollups, delete raw hits older than 400 days, and sync Google Search
 * Console and Business Profile, and work out the website findings for the
 * Insights feed. Each part is isolated.
 */
export async function GET(req: Request) {
  if (!env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const out: Record<string, unknown> = {};
  try {
    out.rollups = await nightlyWebAnalytics();
  } catch (e) {
    console.error("web-analytics rollups failed", e);
    out.rollups = { error: (e as Error).message };
  }
  try {
    out.findings = (await computeWebFindings()).length;
  } catch (e) {
    console.error("web-analytics findings failed", e);
    out.findings = { error: (e as Error).message };
  }
  try {
    out.google = await syncGoogle();
  } catch (e) {
    console.error("web-analytics google sync failed", e);
    out.google = { error: (e as Error).message };
  }
  return Response.json(out);
}
