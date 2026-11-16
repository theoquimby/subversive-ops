import { env } from "@/server/env";
import { runMorningBrief } from "@/server/services/morningNotify";
import { runOrderReminders } from "@/server/services/orderAlerts";

export const maxDuration = 120;

/**
 * Vercel Cron (Bearer CRON_SECRET) runs this every hour of the working day, in
 * UTC (see vercel.json). Two jobs:
 *
 * - The morning brief, once, when the business-local hour reaches the time
 *   chosen on /brief (default 9am). Only the morning runs (11:04–16:04 UTC,
 *   7–11am New York in summer and winter time) try it; the afternoon and evening
 *   runs pass `only=orders`. `?force=1` sends the brief now.
 * - Supplier order reminders (every run): a heads-up before each cutoff, a last
 *   call when nothing is placed, and one push when a cutoff passes with no order.
 *   Reminders only; nothing is ever sent to a supplier.
 */
export async function GET(req: Request) {
  if (!env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const params = new URL(req.url).searchParams;
  const force = params.get("force") === "1";
  const ordersOnly = params.get("only") === "orders";
  const orders = await runOrderReminders(new Date()).catch((e) => {
    console.error("order reminders failed", e);
    return { error: (e as Error).message };
  });
  if (ordersOnly) return Response.json({ orders });
  const result = await runMorningBrief(new Date(), { force });
  return Response.json({ ...result, orders }, { status: "errors" in result && result.errors?.length && !result.emailed && !result.pushed ? 500 : 200 });
}
