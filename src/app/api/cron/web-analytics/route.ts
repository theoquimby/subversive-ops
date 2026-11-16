import { env } from "@/server/env";
import { syncGoogle } from "@/server/services/googleSearch";
import { syncMeta } from "@/server/services/metaChannels";
import { nightlyWebAnalytics } from "@/server/services/webAnalytics";
import { computeWebFindings } from "@/server/services/webInsights";

export const maxDuration = 300;

/**
 * Nightly (Vercel Cron, Bearer CRON_SECRET): rebuild the website analytics
 * rollups, delete raw hits older than 400 days, and sync Google Search
 * Console and Business Profile, and work out the website findings for the
 * Insights feed, then sync Instagram and the Facebook Page. Each part is
 * isolated: one failing never stops the next.
 */
export async function GET(req: Request) {
  if (!env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const started = Date.now();
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
  try {
    // Last, with what is left of the five minutes (less a margin to save its progress): a month of days the first night, a few days after that.
    const r = await syncMeta({ budgetMs: Math.max(20_000, 255_000 - (Date.now() - started)) });
    out.meta = { ok: r.ok, skipped: r.skipped, errors: r.errors, steps: r.steps.map((s) => `${s.name}: ${s.status}`) };
  } catch (e) {
    console.error("web-analytics meta sync failed", e);
    out.meta = { error: (e as Error).message };
  }
  return Response.json(out);
}
