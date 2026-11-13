import "server-only";
import { LaborRules, NY_DEFAULT_RULES } from "@/domain/labor";
import { db } from "../db";

const KEY = "labor.rules";

/** Operator-configured labor rules (NY defaults until changed in Settings). */
export async function getLaborRules(): Promise<LaborRules> {
  const s = await db.setting.findUnique({ where: { key: KEY } });
  return s ? { ...NY_DEFAULT_RULES, ...(JSON.parse(s.value) as Partial<LaborRules>) } : NY_DEFAULT_RULES;
}

export async function saveLaborRules(patch: Partial<LaborRules>) {
  const value = JSON.stringify({ ...(await getLaborRules()), ...patch });
  await db.setting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
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
