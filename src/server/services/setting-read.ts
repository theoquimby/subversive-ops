import "server-only";
import { cache } from "react";
import { db } from "../db";

/**
 * A Setting's raw value, read at most once per server render. Pages pull the
 * same few settings (labor rules, opening hours, forecast adjustments, revenue
 * classes) from a dozen services each, which was 20–50 identical queries a page.
 *
 * React `cache` only memoizes inside a server render; in server actions and
 * route handlers every call reads fresh, so read-modify-write in an action is
 * unaffected. Use it only for settings that a page doesn't write while it renders.
 */
export const settingValue = cache(async (key: string): Promise<string | null> => {
  const row = await db.setting.findUnique({ where: { key }, select: { value: true } });
  return row?.value ?? null;
});
