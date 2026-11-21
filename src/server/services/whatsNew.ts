import "server-only";
import { existsSync } from "node:fs";
import path from "node:path";
import { cache } from "react";
import { db } from "../db";
import { env } from "../env";
import { businessDate } from "@/domain/dates";
import { PLACES_READY_KEY } from "@/domain/places";
import { unseenEntries, whatsNewFor, type WhatsNewData, type WhatsNewEntry, type WhatsNewSeen } from "@/help/whatsNew";

/**
 * What's new, per person. What someone has seen is kept in the Setting table
 * as JSON under `whatsnew.seen.<userId>` (like notification prefs), so it
 * follows them from phone to laptop.
 */

const key = (userId: string) => `whatsnew.seen.${userId}`;

/**
 * Whether a page exists in this build, for entries about features still
 * landing. Looks for the page source (dev) or its compiled output; when
 * neither tree is there to look in, assumes yes.
 */
const routeCache = new Map<string, boolean>();
export function hasAppRoute(route: string): boolean {
  const hit = routeCache.get(route);
  if (hit != null) return hit;
  const rel = route.replace(/^\/+/, "");
  const roots = [path.join(process.cwd(), "src", "app", "(app)"), path.join(process.cwd(), process.env.NEXT_DIST_DIR || ".next", "server", "app", "(app)")];
  const looked = roots.filter((r) => existsSync(r));
  const ok = looked.length === 0 || looked.some((r) => existsSync(path.join(r, rel, "page.tsx")) || existsSync(path.join(r, rel, "page.js")));
  routeCache.set(route, ok);
  return ok;
}

export async function whatsNewSeen(userId: string): Promise<WhatsNewSeen | null> {
  const row = await db.setting.findUnique({ where: { key: key(userId) } });
  if (!row) return null;
  try {
    const v = JSON.parse(row.value) as Partial<WhatsNewSeen>;
    return { ids: Array.isArray(v.ids) ? v.ids.filter((x): x is string => typeof x === "string") : [], at: typeof v.at === "string" ? v.at : "" };
  } catch {
    return null;
  }
}

export interface WhatsNewState {
  entries: WhatsNewEntry[];
  /** Ids shown with a "New" mark (and the reason the sheet opens by itself). */
  unseen: string[];
}

/** Which of the data What's new cards can wait for is there now (one small lookup per render). */
export const whatsNewData = cache(async (): Promise<(d: WhatsNewData) => boolean> => {
  const placesReady = !!(await db.setting.findUnique({ where: { key: PLACES_READY_KEY }, select: { key: true } }));
  return (d) => (d === "guestPlaces" ? placesReady : true);
});

/** The entries this person may see and which of them are new to them. Read once per render. */
export const whatsNewState = cache(async (userId: string, role: "MANAGER" | "STAFF"): Promise<WhatsNewState> => {
  const [seen, user, hasData] = await Promise.all([whatsNewSeen(userId), db.user.findUnique({ where: { id: userId }, select: { createdAt: true } }), whatsNewData()]);
  const entries = whatsNewFor(role, hasAppRoute, hasData);
  const joined = user ? businessDate(user.createdAt, env.BUSINESS_TIMEZONE) : "";
  return { entries, unseen: unseenEntries(entries, seen, joined).map((e) => e.id) };
});

/** Remember that this person has now seen these entries (plus whatever they'd seen before). */
export async function markWhatsNewSeen(userId: string, ids: string[]) {
  const prev = await whatsNewSeen(userId);
  const value = JSON.stringify({ ids: [...new Set([...(prev?.ids ?? []), ...ids])], at: new Date().toISOString() } satisfies WhatsNewSeen);
  await db.setting.upsert({ where: { key: key(userId) }, create: { key: key(userId), value }, update: { value } });
}
