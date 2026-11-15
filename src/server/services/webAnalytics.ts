import "server-only";
import { randomBytes } from "node:crypto";
import { addDays, parseISODate, toISODate, type ISODate } from "@/domain/dates";
import { BOOKED_STAGES } from "@/domain/privateEvents";
import { decryptJSON, deriveKey, encryptJSON } from "@/domain/squareSecurity";
import {
  ACTIONS,
  classifySource,
  continuesVisit,
  createRateLimiter,
  daysToRoll,
  deviceClass,
  expandOrigins,
  hostOf,
  isBot,
  normalizeOrigin,
  normalizePath,
  parsePayload,
  retentionCutoff,
  rollupDay,
  saltIsCurrent,
  sessionId,
  visitorHash,
  type Attribution,
  type DailySalt,
  type EventName,
} from "@/domain/webAnalytics";
import { Prisma } from "@prisma/client";
import { db } from "../db";
import { env } from "../env";
import { getSecret } from "./secrets";
import { businessToday } from "./sales";

/**
 * The website's own analytics: the collector behind POST /api/public/collect,
 * conversions Ops records itself (recordConversion), daily rollups and the
 * 400-day retention. No cookies and no raw IPs: a visitor is a hash of IP +
 * browser with a salt that is replaced every day (Setting
 * `webAnalytics.salt.<day>`, encrypted; older days are deleted).
 */

const ORIGINS_KEY = "webAnalytics.origins";
const ROLLED_KEY = "webAnalytics.rolledAt";
const BUILT_KEY = "webAnalytics.builtThrough";
const PURGED_KEY = "webAnalytics.purgedOn";
const SALT_PREFIX = "webAnalytics.salt.";

const saltKey = () => deriveKey(env.SESSION_SECRET, "webAnalytics.salt");

// ---- Settings ------------------------------------------------------------------------------

async function readSetting(key: string): Promise<string | null> {
  return (await db.setting.findUnique({ where: { key }, select: { value: true } }))?.value ?? null;
}
const writeSetting = (key: string, value: string) => db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });

/** Extra addresses the website is served from (previews, the old domain). The main one is WEBSITE_URL. */
export async function extraOrigins(): Promise<string[]> {
  try {
    const v = JSON.parse((await readSetting(ORIGINS_KEY)) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export async function saveExtraOrigins(list: string[]): Promise<string[]> {
  const clean = [...new Set(list.map((s) => normalizeOrigin(s)).filter((s): s is string => !!s))].slice(0, 10);
  await writeSetting(ORIGINS_KEY, JSON.stringify(clean));
  originsCache = null;
  return clean;
}

let originsCache: { at: number; list: string[] } | null = null;

/** Every origin the collector accepts beacons from (with www / bare twins). */
export async function websiteOrigins(): Promise<string[]> {
  if (originsCache && Date.now() - originsCache.at < 60_000) return originsCache.list;
  const [main, extra] = await Promise.all([getSecret("WEBSITE_URL"), extraOrigins()]);
  const fromEnv = (process.env.WEB_ANALYTICS_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const list = expandOrigins([...(main ? [main] : []), ...extra, ...fromEnv]);
  if (process.env.NODE_ENV === "development") list.push("http://localhost:3000", "http://localhost:3100", "http://127.0.0.1:3100");
  originsCache = { at: Date.now(), list };
  return list;
}

export async function mainWebsiteOrigin(): Promise<string | null> {
  const main = await getSecret("WEBSITE_URL");
  return main ? normalizeOrigin(main) : null;
}

// ---- Daily salt ------------------------------------------------------------------------------

let saltCache: DailySalt | null = null;

/** Today's salt: created on the first hit of the day; yesterday's is deleted so old hashes can't be recomputed. */
export async function dailySalt(day: ISODate): Promise<string> {
  if (saltIsCurrent(saltCache, day)) return saltCache.salt;
  const key = `${SALT_PREFIX}${day}`;
  const read = async () => {
    const v = await readSetting(key);
    if (!v) return null;
    try {
      const s = decryptJSON<DailySalt>(saltKey(), v);
      return saltIsCurrent(s, day) ? s : null;
    } catch {
      return null;
    }
  };
  let s = await read();
  if (!s) {
    const fresh: DailySalt = { day, salt: randomBytes(32).toString("base64url") };
    try {
      await db.setting.create({ data: { key, value: encryptJSON(saltKey(), fresh) } });
      s = fresh;
    } catch (e) {
      // Another instance made today's salt at the same moment: use theirs.
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
      s = await read();
      if (!s) throw new Error("Couldn't read today's analytics salt.");
    }
    await db.setting.deleteMany({ where: { key: { startsWith: SALT_PREFIX, not: key } } });
  }
  saltCache = s;
  return s.salt;
}

// ---- Collect --------------------------------------------------------------------------------

const limiter = createRateLimiter(60, 60_000);

export interface CollectRequest {
  body: string;
  ua: string | null;
  ip: string | null;
  origin: string | null;
  acceptLanguage: string | null;
  purpose: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
}

export type CollectResult = { stored: true } | { stored: false; reason: "bot" | "bad" | "origin" | "rate" };

const geo = (v: string | null) => {
  if (!v) return null;
  try {
    return decodeURIComponent(v).slice(0, 80) || null;
  } catch {
    return v.slice(0, 80);
  }
};

/** Find the visit a hit belongs to, or start one. */
async function visitFor(visitor: string, now: Date, a: Attribution): Promise<{ session: string; source: string; medium: string; campaign: string | null; content: string | null; term: string | null; referrer: string | null }> {
  const last = await db.webHit.findFirst({
    where: { visitor, at: { gte: new Date(now.getTime() - 30 * 60_000) } },
    orderBy: { at: "desc" },
    select: { at: true, session: true, source: true, medium: true, campaign: true, content: true, term: true, referrer: true },
  });
  if (last && continuesVisit(last, now, a)) return last;
  // A new visit that starts on an internal page (a reopened tab) counts as direct.
  const medium = a.medium === "internal" ? "direct" : a.medium;
  return { session: sessionId(visitor, now), source: a.source, medium, campaign: a.campaign, content: a.content, term: a.term, referrer: a.referrer };
}

export async function collect(r: CollectRequest): Promise<CollectResult> {
  if (isBot({ ua: r.ua, acceptLanguage: r.acceptLanguage, purpose: r.purpose })) return { stored: false, reason: "bot" };
  const p = parsePayload(r.body);
  if (!p) return { stored: false, reason: "bad" };
  const origins = await websiteOrigins();
  const url = new URL(p.u);
  if (!origins.includes(url.origin) || (r.origin && !origins.includes(r.origin))) return { stored: false, reason: "origin" };

  const now = new Date();
  const day = businessToday();
  const site = hostOf(url.origin);
  const visitor = visitorHash(await dailySalt(day), site, r.ip ?? "", r.ua ?? "");
  if (!limiter(visitor)) return { stored: false, reason: "rate" };

  const a = classifySource({ url: p.u, referrer: p.r, siteHosts: origins.map(hostOf) });
  const v = await visitFor(visitor, now, a);
  // An event's page is where it happened; its own `path` prop (if any) is ignored for safety.
  const props = p.p ? (p.p as Prisma.InputJsonValue) : undefined;
  await db.webHit.create({
    data: {
      at: now,
      day: parseISODate(day),
      kind: p.n,
      path: normalizePath(url.pathname),
      visitor,
      session: v.session,
      source: v.source,
      medium: v.medium,
      campaign: v.campaign,
      content: v.content,
      term: v.term,
      referrer: v.referrer,
      device: deviceClass(r.ua ?? "", p.w),
      country: geo(r.country)?.slice(0, 2) ?? null,
      region: geo(r.region),
      city: geo(r.city),
      props,
    },
  });
  return { stored: true };
}

// ---- Conversions recorded by Ops ---------------------------------------------------------------

export type ConversionKind = Extract<EventName, "inquiry_submit" | "newsletter_signup" | "ticket_click" | "rsvp_click">;

export interface ConversionProps {
  /** The PrivateEvent created from an inquiry (for inquiry → quote → booking attribution). */
  privateEventId?: string | null;
  /** The website page the form was on. */
  path?: string | null;
  /** If the browser posted straight to Ops: its headers, to find the visit (and its source) it belongs to. */
  headers?: Headers | null;
  /** Or, if the website's server forwarded the form: the page's URL (with any UTM tags) and document.referrer. */
  url?: string | null;
  referrer?: string | null;
  /** Anything else worth keeping (short strings and numbers). */
  props?: Record<string, string | number | boolean | null>;
}

/**
 * Record a conversion that happened on Ops' side, e.g. a private-event
 * inquiry created by POST /api/public/inquiry:
 *
 *   await recordConversion("inquiry_submit", { privateEventId: pe.id, headers: req.headers, path: "/private-events" })
 *
 * The source is the visit's (when the same browser sent beacons today),
 * otherwise worked out from `url` / `referrer`, otherwise "(not set)".
 * Never throws: analytics must not break the form.
 */
export async function recordConversion(kind: ConversionKind, props: ConversionProps = {}): Promise<void> {
  try {
    const day = businessToday();
    const origins = await websiteOrigins();
    let source = "(not set)";
    let medium = "other";
    let campaign: string | null = null;
    let path = props.path ? normalizePath(props.path) : null;
    const h = props.headers;
    if (h) {
      const ua = h.get("user-agent") ?? "";
      const ip = (h.get("x-forwarded-for") ?? h.get("x-real-ip") ?? "").split(",")[0].trim();
      const main = (await mainWebsiteOrigin()) ?? origins[0] ?? "";
      const visitor = visitorHash(await dailySalt(day), hostOf(main), ip, ua);
      const last = await db.webHit.findFirst({ where: { visitor, day: parseISODate(day) }, orderBy: { at: "desc" }, select: { source: true, medium: true, campaign: true, path: true } });
      if (last) {
        source = last.source;
        medium = last.medium;
        campaign = last.campaign;
        path ??= last.path;
      }
    }
    if (source === "(not set)" && props.url) {
      const a = classifySource({ url: props.url, referrer: props.referrer, siteHosts: origins.map(hostOf) });
      source = a.source;
      medium = a.medium === "internal" ? "direct" : a.medium;
      campaign = a.campaign;
      try {
        path ??= normalizePath(new URL(props.url).pathname);
      } catch {
        /* ignore */
      }
    }
    const extra = props.props ? Object.fromEntries(Object.entries(props.props).filter(([, v]) => v != null).slice(0, 8).map(([k, v]) => [k.slice(0, 24), typeof v === "string" ? v.slice(0, 200) : v])) : undefined;
    await db.webConversion.create({
      data: { day: parseISODate(day), kind, source, medium, campaign, path, privateEventId: props.privateEventId ?? null, props: extra as Prisma.InputJsonValue | undefined },
    });
  } catch (e) {
    console.error("recordConversion skipped", (e as Error).message);
  }
}

// ---- Rollups and retention ----------------------------------------------------------------------

/** Rebuild one business day's rollup rows from its raw hits. */
export async function rollupOne(day: ISODate): Promise<number> {
  const hits = await db.webHit.findMany({
    where: { day: parseISODate(day) },
    select: { at: true, kind: true, path: true, visitor: true, session: true, source: true, medium: true, campaign: true, referrer: true, device: true, country: true, region: true, city: true },
  });
  const rows = rollupDay(hits);
  const d = parseISODate(day);
  await db.$transaction([db.webDaily.deleteMany({ where: { day: d } }), ...(rows.length ? [db.webDaily.createMany({ data: rows.map((r) => ({ day: d, ...r, key: r.key.slice(0, 300) })) })] : [])]);
  return rows.length;
}

/** Rebuild every day in [from, to] (used after a backfill or synthetic data). */
export async function rollupRange(from: ISODate, to: ISODate) {
  for (let d = from; d <= to; d = addDays(d, 1)) await rollupOne(d);
  await writeSetting(BUILT_KEY, to);
}

/**
 * Keep the rollups current: today and yesterday (and any day since the last
 * build) at most every 10 minutes. Called by the dashboard and nightly.
 */
export async function refreshRollups(opts: { force?: boolean } = {}): Promise<void> {
  const [rolled, built] = await Promise.all([readSetting(ROLLED_KEY), readSetting(BUILT_KEY)]);
  if (!opts.force && rolled && Date.now() - Date.parse(rolled) < 10 * 60_000) return;
  await writeSetting(ROLLED_KEY, new Date().toISOString());
  const today = businessToday();
  for (const d of daysToRoll(today, built)) await rollupOne(d);
  await writeSetting(BUILT_KEY, today);
}

/** Delete raw hits older than 400 days (rollups are kept). Once a day. */
export async function purgeOldHits(): Promise<number> {
  const today = businessToday();
  if ((await readSetting(PURGED_KEY)) === today) return 0;
  const cutoff = retentionCutoff(today);
  const r = await db.webHit.deleteMany({ where: { day: { lt: parseISODate(cutoff) } } });
  await db.webConversion.deleteMany({ where: { day: { lt: parseISODate(cutoff) }, privateEventId: null } });
  await writeSetting(PURGED_KEY, today);
  return r.count;
}

/** The nightly job: rollups (forced), retention. Google syncs separately. */
export async function nightlyWebAnalytics() {
  await refreshRollups({ force: true });
  const purged = await purgeOldHits();
  return { purged };
}

// ---- Reading -----------------------------------------------------------------------------------

export interface DailyRow {
  day: ISODate;
  dim: string;
  key: string;
  views: number;
  visitors: number;
  sessions: number;
  entries: number;
  bounces: number;
  engaged: number;
  converted: number;
  count: number;
}

export async function dailyRows(from: ISODate, to: ISODate, dims: string[]): Promise<DailyRow[]> {
  const rows = await db.webDaily.findMany({ where: { day: { gte: parseISODate(from), lte: parseISODate(to) }, dim: { in: dims } } });
  return rows.map((r) => ({ ...r, day: toISODate(r.day) }));
}

export async function firstHitDay(): Promise<ISODate | null> {
  const r = await db.webDaily.findFirst({ where: { dim: "total" }, orderBy: { day: "asc" }, select: { day: true } });
  return r ? toISODate(r.day) : null;
}

export async function conversionsBetween(from: ISODate, to: ISODate) {
  return db.webConversion.findMany({ where: { day: { gte: parseISODate(from), lte: parseISODate(to) } }, orderBy: { at: "asc" } });
}

/** Website-sourced inquiries with their bookings, for "inquiries → quotes → booked revenue by source". */
export async function inquiryFunnelRows(from: ISODate, to: ISODate) {
  const convs = await db.webConversion.findMany({ where: { kind: "inquiry_submit", day: { gte: parseISODate(from), lte: parseISODate(to) } }, select: { source: true, medium: true, privateEventId: true } });
  const ids = convs.map((c) => c.privateEventId).filter((x): x is string => !!x);
  if (!ids.length) return { convs, events: [] as { id: string; stage: string; quoted: boolean; booked: boolean; total: number }[] };
  const { listPrivateEvents } = await import("./privateEvents");
  const all = await listPrivateEvents();
  const want = new Set(ids);
  const events = all
    .filter((e) => want.has(e.id))
    .map((e) => ({ id: e.id, stage: e.stage, quoted: e.quoteSent || e.stage === "QUOTED" || (BOOKED_STAGES as readonly string[]).includes(e.stage), booked: (BOOKED_STAGES as readonly string[]).includes(e.stage), total: e.total }));
  return { convs, events };
}

export const ACTION_KINDS = ACTIONS;
