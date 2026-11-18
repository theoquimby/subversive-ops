"use server";

import { requireUser } from "@/server/auth";
import { backfillWeather } from "@/server/services/forecastScore";
import { refreshWeather } from "@/server/services/forecasting";
import { revalidatePath } from "next/cache";

/** Load the weather for every past day with sales from NOAA's record, and refresh the forecast. */
export async function loadWeatherHistory(): Promise<{ message: string } | { error: string }> {
  await requireUser("MANAGER");
  const forecast = await refreshWeather(true);
  const history = await backfillWeather();
  revalidatePath("/sales/scorecard");
  revalidatePath("/sales");
  if ("error" in history) return { error: history.error };
  const note = "error" in forecast ? ` The forecast couldn't refresh just now: ${forecast.error}.` : "";
  return { message: history.days ? `Loaded ${history.days.toLocaleString("en-US")} days of weather.${note}` : `Nothing new to load yet.${note}` };
}
