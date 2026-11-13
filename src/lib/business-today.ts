import { todayIn } from "@/domain/dates";

/**
 * Today's business date ("YYYY-MM-DD") on the client. The business timezone is
 * published by the root layout as <meta name="business-tz">, so a phone in a
 * different timezone (or just after midnight UTC) still agrees with the server.
 */
export function businessTodayClient(timeZone?: string): string {
  const tz = timeZone ?? (typeof document !== "undefined" ? document.querySelector<HTMLMetaElement>('meta[name="business-tz"]')?.content : undefined);
  try {
    return todayIn(tz || "America/New_York");
  } catch {
    return todayIn("America/New_York");
  }
}
