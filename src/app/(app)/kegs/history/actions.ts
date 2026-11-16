"use server";

import { decodeCursor, parseHistoryParams } from "@/domain/kegHistory";
import { requireUser } from "@/server/auth";
import { historyCsv, historyOlder, type HistoryRow } from "@/server/services/kegHistory";

/** The address's query string, as the page sees it (filters are re-read and checked here). */
const paramsOf = (search: unknown) => parseHistoryParams(new URLSearchParams(typeof search === "string" ? search.slice(0, 4000) : ""));

/** The next, older page of history under the same filters. */
export async function loadOlderHistory(search: string, cursor: string): Promise<{ rows: HistoryRow[]; next: string | null } | { error: string }> {
  await requireUser("MANAGER");
  if (!decodeCursor(cursor)) return { error: "Couldn't tell where the list ended. Reload the page and try again." };
  try {
    return await historyOlder(paramsOf(search), cursor);
  } catch (e) {
    console.error("keg history: older page failed", (e as Error).message);
    return { error: "Couldn't load older entries. Check the connection and try again." };
  }
}

/** Every entry under these filters as a spreadsheet. */
export async function exportHistoryCsv(search: string): Promise<{ csv: string; count: number; capped: boolean } | { error: string }> {
  await requireUser("MANAGER");
  try {
    return await historyCsv(paramsOf(search));
  } catch (e) {
    console.error("keg history: export failed", (e as Error).message);
    return { error: "Couldn't make the spreadsheet. Check the connection and try again." };
  }
}
