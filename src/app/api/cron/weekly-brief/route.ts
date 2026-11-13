import { env } from "@/server/env";
import { notifyWeeklyBrief } from "@/server/services/notify";

export const maxDuration = 120;

/** Vercel Cron calls this weekly with `Authorization: Bearer $CRON_SECRET`; emails/pushes the brief to managers. */
export async function GET(req: Request) {
  if (!env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const result = await notifyWeeklyBrief();
  return Response.json(result, { status: result.errors.length && !result.emailed && !result.pushed ? 500 : 200 });
}
