import "server-only";

/**
 * Minimal stand-in: the stock and ordering work owns this file and replaces
 * it at merge. The schedule's year view asks it which supplier orders each
 * brew needs.
 */

/** For each brew: the supplier orders it needs, the day to order by, and when it was placed (null = not yet). */
export async function brewOrderNeeds(batchIds: string[]): Promise<Map<string, { supplier: string; orderBy: string; placedOn: string | null }[]>> {
  void batchIds;
  return new Map();
}
