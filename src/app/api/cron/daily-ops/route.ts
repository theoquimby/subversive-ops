import { env } from "@/server/env";
import { alertPriceSpikes } from "@/server/services/notify";
import { autoDraftOrders } from "@/server/services/planning";
import { importGoogleReviewsDaily } from "@/server/services/reviews";
import { autoDraftNextWeek } from "@/server/services/scheduling";
import { certificateReminders } from "@/server/services/training";
import { refreshAnalytics } from "@/server/services/analytics";
import { refreshLearned } from "@/server/services/learned";
import { weekday } from "@/domain/dates";
import { businessToday } from "@/server/services/sales";

export const maxDuration = 300;

/**
 * Morning housekeeping (Vercel Cron, Bearer CRON_SECRET): draft supplier orders
 * whose cutoff is coming up, pull new Google reviews (managers hear about new 1–2★
 * ones), alert managers to supplier price increases over the threshold that
 * haven't been sent yet, remind people and managers about certificates
 * expiring in 30/7 days or just expired, refresh learned settings
 * suggestions (hours, delivery days, minimums), and (Fri/Sat) draft next
 * week's schedule if auto-draft is on, and last, recompute Insights (the
 * Python analytics service) on the fresh data. Each job is isolated
 * so one failing doesn't stop the others.
 */
export async function GET(req: Request) {
  if (!env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const run = async <T,>(name: string, fn: () => Promise<T>) => {
    try {
      return { [name]: await fn() };
    } catch (e) {
      console.error(`daily-ops ${name} failed`, e);
      return { [name]: { error: (e as Error).message } };
    }
  };
  const results = Object.assign(
    {},
    await run("orders", () => autoDraftOrders()),
    await run("reviews", () => importGoogleReviewsDaily()),
    await run("priceSpikes", () => alertPriceSpikes()),
    await run("certificates", () => certificateReminders()),
    // Settings that learn: hours from sales and Square, delivery days from invoices, minimums from buying.
    await run("learned", () => refreshLearned()),
  );
  // Next week's schedule is drafted at the end of the week (only if that's switched on and it's still empty).
  if ([5, 6].includes(weekday(businessToday()))) Object.assign(results, await run("schedule", () => autoDraftNextWeek()));
  Object.assign(results, await run("insights", () => refreshAnalytics()));
  return Response.json(results);
}
