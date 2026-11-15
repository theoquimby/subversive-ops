import "server-only";
import { morningDue, morningPush } from "@/domain/morningBrief";
import { db } from "../db";
import { env } from "../env";
import { morningDigest } from "../email/morning-digest";
import { morningBriefEmail } from "../email/templates/morning-brief";
import { insightFeed } from "./analytics";
import { getMorningHour, MORNING_SENT_KEY, morningBrief } from "./morningBrief";
import { appUrl, notify, type NotifyResult, type Recipient } from "./notify";
import { businessToday, localHour } from "./sales";

/** Managers only: staff don't get a brief (their shifts already come by push). */
async function managers(): Promise<Recipient[]> {
  const users = await db.user.findMany({ where: { role: "MANAGER", active: true }, select: { id: true, name: true } });
  const emps = await db.employee.findMany({ where: { userId: { in: users.map((u) => u.id) } }, select: { userId: true, email: true } });
  return users.map((u) => ({ userId: u.id, name: u.name, email: emps.find((e) => e.userId === u.id)?.email ?? null }));
}

/** Push (and, for anyone who turned it on, email) today's morning brief to every manager. */
export async function notifyMorningBrief(now = new Date()): Promise<NotifyResult> {
  try {
    const b = await morningBrief(now);
    const insight = await insightFeed({ limit: 1 })
      .then((r) => r.items[0] ?? null)
      .catch(() => null);
    const digest = morningDigest(b, insight ? { title: insight.title, action: insight.action, monthly: insight.monthly, oneOff: insight.oneOff ?? null } : null);
    const push = morningPush({
      weekdayName: b.weekdayName,
      forecast: b.day.forecast,
      busy: b.day.busy?.label ?? null,
      tonight: b.tonight.length,
      yesterday: b.y && !b.y.closed ? b.y.line.split(". ")[0].replace(/ in sales/, "") : null,
      closed: b.day.closed,
    });
    const base = appUrl();
    return await notify(
      "morning",
      (await managers()).map((m) => ({
        to: m,
        email: morningBriefEmail({ name: m.name, digest, baseUrl: base }),
        push: { ...push, url: "/brief", tag: `morning-${b.today}` },
      })),
    );
  } catch (e) {
    console.error("morning brief: building messages failed", e);
    return { event: "morning", recipients: 0, emailed: 0, pushed: 0, skipped: [], errors: [(e as Error).message] };
  }
}

/**
 * The scheduled job (runs a few times each morning, UTC): sends once the
 * business-local hour reaches the chosen send time, once per day. Marks the
 * day sent before sending so an overlapping run can't double up.
 */
export async function runMorningBrief(now = new Date(), opts: { force?: boolean } = {}) {
  const today = businessToday();
  const hour = localHour(now, env.BUSINESS_TIMEZONE);
  const [sendHour, sent] = await Promise.all([getMorningHour(), db.setting.findUnique({ where: { key: MORNING_SENT_KEY } })]);
  if (!opts.force && !morningDue({ today, localHour: hour, sendHour, lastSent: sent?.value ?? null })) {
    return { skipped: sent?.value === today ? "Already sent today" : `Not time yet (${hour}:00 local, sends at ${sendHour}:00)` };
  }
  await db.setting.upsert({ where: { key: MORNING_SENT_KEY }, create: { key: MORNING_SENT_KEY, value: today }, update: { value: today } });
  const r = await notifyMorningBrief(now);
  return { sent: today, recipients: r.recipients, emailed: r.emailed, pushed: r.pushed, skipped: r.skipped, errors: r.errors };
}

