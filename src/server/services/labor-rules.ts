import "server-only";
import { todayIn, type ISODate } from "@/domain/dates";
import { LaborRules, NY_DEFAULT_RULES } from "@/domain/labor";
import { applyWageTable, reviewDue, wageRulesOn } from "@/domain/wageRules";
import { DEFAULT_WEEK_HOURS, hoursOn, parseSeasons, parseWeek, type SeasonalHours, type WeekHours } from "@/domain/openingHours";
import { db } from "../db";
import { env } from "../env";

const KEY = "labor.rules";
/** "off" = use the minimum wages typed in Settings; anything else follows the NY table (src/domain/wageRules.ts). */
const WAGE_AUTO_KEY = "labor.wageAuto";
const REVIEWED_KEY = "labor.rulesReviewed";

const today = () => todayIn(env.BUSINESS_TIMEZONE);

async function storedRules(): Promise<LaborRules> {
  const s = await db.setting.findUnique({ where: { key: KEY } });
  return s ? { ...NY_DEFAULT_RULES, ...(JSON.parse(s.value) as Partial<LaborRules>) } : NY_DEFAULT_RULES;
}

export async function wageAutoOn(): Promise<boolean> {
  const s = await db.setting.findUnique({ where: { key: WAGE_AUTO_KEY } });
  return s?.value !== "off";
}

/**
 * Operator-configured labor rules (NY defaults until changed in Settings).
 * Unless turned off, the minimum and tipped wage follow the versioned NY table
 * for `asOf` (today by default), so they switch by themselves on January 1.
 */
export async function getLaborRules(asOf: ISODate = today()): Promise<LaborRules> {
  const [rules, auto] = await Promise.all([storedRules(), wageAutoOn()]);
  return auto ? applyWageTable(rules, asOf) : rules;
}

export async function saveLaborRules(patch: Partial<LaborRules>) {
  // Typing a minimum wage by hand means "use mine", so stop following the table.
  if (("minimumWage" in patch || "tippedMinimumWage" in patch) && (await wageAutoOn())) {
    const cur = wageRulesOn(today()).current;
    const differs = (patch.minimumWage != null && patch.minimumWage !== cur?.minimumWage) || (patch.tippedMinimumWage != null && patch.tippedMinimumWage !== cur?.tippedMinimumWage);
    if (differs) await setWageAuto(false);
  }
  const value = JSON.stringify({ ...(await getLaborRules()), ...patch });
  await db.setting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
}

export async function setWageAuto(on: boolean) {
  const value = on ? "on" : "off";
  await db.setting.upsert({ where: { key: WAGE_AUTO_KEY }, create: { key: WAGE_AUTO_KEY, value }, update: { value } });
}

export async function markRulesReviewed(by: string) {
  const value = JSON.stringify({ date: today(), by });
  await db.setting.upsert({ where: { key: REVIEWED_KEY }, create: { key: REVIEWED_KEY, value }, update: { value } });
}

/** For Settings → Labor rules: the table entry in force, the next change, and when someone last checked. */
export async function wageReview() {
  const [auto, s] = await Promise.all([wageAutoOn(), db.setting.findUnique({ where: { key: REVIEWED_KEY } })]);
  const reviewed = s ? (JSON.parse(s.value) as { date: ISODate; by: string }) : null;
  const t = today();
  return { auto, reviewed, today: t, ...wageRulesOn(t), due: reviewDue(reviewed?.date ?? null, t) };
}

const HOURS_KEY = "openingHours";
const SEASONS_KEY = "openingHours.seasons";

/** The regular week, as set in Settings → Business (Subversive's taproom hours until changed). */
export async function getRegularHours(): Promise<WeekHours> {
  const s = await db.setting.findUnique({ where: { key: HOURS_KEY } });
  if (!s) return DEFAULT_WEEK_HOURS;
  try {
    return parseWeek(JSON.parse(s.value)) ?? DEFAULT_WEEK_HOURS;
  } catch {
    return DEFAULT_WEEK_HOURS;
  }
}

/** Seasonal hours (Setting `openingHours.seasons`); none until someone adds one. */
export async function getSeasonalHours(): Promise<SeasonalHours[]> {
  const s = await db.setting.findUnique({ where: { key: SEASONS_KEY } });
  if (!s) return [];
  try {
    return parseSeasons(JSON.parse(s.value));
  } catch {
    return [];
  }
}

/**
 * Opening hours per weekday (0=Sun) as [openHour, closeHour); missing = closed.
 * The regular week, or a season's hours when `asOf` (today by default) falls in one.
 */
export async function getOpeningHours(asOf: ISODate = today()): Promise<Record<number, [number, number]>> {
  const [regular, seasons] = await Promise.all([getRegularHours(), getSeasonalHours()]);
  return hoursOn(asOf, regular, seasons);
}

export async function saveOpeningHours(hours: Record<number, [number, number]>) {
  const value = JSON.stringify(hours);
  await db.setting.upsert({ where: { key: HOURS_KEY }, create: { key: HOURS_KEY, value }, update: { value } });
}

export async function saveSeasonalHours(seasons: SeasonalHours[]) {
  if (seasons.length === 0) {
    await db.setting.deleteMany({ where: { key: SEASONS_KEY } });
    return;
  }
  const value = JSON.stringify(seasons);
  await db.setting.upsert({ where: { key: SEASONS_KEY }, create: { key: SEASONS_KEY, value }, update: { value } });
}
