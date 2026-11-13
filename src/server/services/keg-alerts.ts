import "server-only";
import { db } from "../db";
import { kegAlertEmail, kegAlertSummary, type KegAlert } from "../email/templates/kegs";
import { appUrl, inBackground, notify, type Recipient } from "./notify";
import { businessToday } from "./sales";

/**
 * Keg alerts for managers (notification event "kegs"): a keg kicked with no
 * full keg of that beer behind it, and a beer whose full kegs dropped below
 * its minimum. Low-stock alerts go out once per beer per day.
 */

async function managers(): Promise<Recipient[]> {
  const users = await db.user.findMany({ where: { role: "MANAGER", active: true }, select: { id: true, name: true } });
  const emps = await db.employee.findMany({ where: { userId: { in: users.map((u) => u.id) } }, select: { userId: true, email: true } });
  return users.map((u) => ({ userId: u.id, name: u.name, email: emps.find((e) => e.userId === u.id)?.email ?? null }));
}

const SENT_KEY = "kegs.alerts.sent";

async function send(alert: KegAlert, tag: string) {
  const base = appUrl();
  const s = kegAlertSummary(alert);
  const to = await managers();
  return notify("kegs", to.map((m) => ({ to: m, email: kegAlertEmail({ name: m.name, alert, baseUrl: base }), push: { title: s.title, body: s.body, url: "/kegs", tag } })));
}

/** After a kick or a keg leaving cold storage: alert if that beer has nothing (or too little) full. Runs in the background; never throws. */
export function checkKegStock(beerId: string | null, ctx: { kicked?: { where: string | null; who: string | null } } = {}) {
  if (!beerId) return;
  inBackground(async () => {
    const beer = await db.beer.findUnique({ where: { id: beerId }, select: { name: true, minFull: true, active: true } });
    if (!beer?.active) return;
    const full = await db.keg.count({ where: { beerId, active: true, status: { in: ["COLD", "FILLED"] } } });
    if (ctx.kicked && full === 0) {
      await send({ kind: "kicked", beer: beer.name, where: ctx.kicked.where, fullLeft: 0, runsOut: null, who: ctx.kicked.who }, `keg-${beerId}`);
      return;
    }
    if (full >= beer.minFull) return;
    const today = businessToday();
    const row = await db.setting.findUnique({ where: { key: SENT_KEY } });
    let sent: Record<string, string> = {};
    try { sent = row ? JSON.parse(row.value) : {}; } catch { sent = {}; }
    if (sent[beerId] === today) return;
    sent[beerId] = today;
    const value = JSON.stringify(sent);
    await db.setting.upsert({ where: { key: SENT_KEY }, create: { key: SENT_KEY, value }, update: { value } });
    await send({ kind: "low", beer: beer.name, where: null, fullLeft: full, runsOut: null, who: null }, `keg-low-${beerId}`);
  });
}
