import { env } from "@/server/env";
import { notifyInsightsDigest, notifyWeeklyBrief } from "@/server/services/notify";

export const maxDuration = 120;

/** Vercel Cron calls this weekly with `Authorization: Bearer $CRON_SECRET`; emails/pushes the brief and the insights digest to managers. */
export async function GET(req: Request) {
  if (!env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const result = await notifyWeeklyBrief();
  const insights = await notifyInsightsDigest();
  return Response.json({ ...result, insights }, { status: result.errors.length && !result.emailed && !result.pushed ? 500 : 200 });
}
