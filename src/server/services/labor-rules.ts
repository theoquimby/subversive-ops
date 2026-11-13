import "server-only";
import { todayIn, type ISODate } from "@/domain/dates";
import { LaborRules, NY_DEFAULT_RULES } from "@/domain/labor";
import { applyWageTable, reviewDue, wageRulesOn } from "@/domain/wageRules";
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

/** Opening hours per weekday (0=Sun) as [openHour, closeHour); missing = closed. */
export async function getOpeningHours(): Promise<Record<number, [number, number]>> {
  const s = await db.setting.findUnique({ where: { key: "openingHours" } });
  // Subversive's current taproom hours; closed Tuesdays.
  return s ? JSON.parse(s.value) : { 0: [12, 19], 1: [16, 20], 3: [16, 20], 4: [16, 20], 5: [16, 21], 6: [12, 21] };
}

export async function saveOpeningHours(hours: Record<number, [number, number]>) {
  const value = JSON.stringify(hours);
  await db.setting.upsert({ where: { key: "openingHours" }, create: { key: "openingHours", value }, update: { value } });
}
