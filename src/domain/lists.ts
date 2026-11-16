/**
 * Short lists that can grow: how many to show before "Show N more". Pure; the
 * ShowMore component (src/components/show-more.tsx) uses it.
 */

/**
 * How many of `total` items to show at first. Everything when it's within
 * `limit + slack` — "Show 1 more" is a button that costs more than the row.
 */
export function shownCount(total: number, limit: number, slack = 2): number {
  if (total <= 0) return 0;
  const cap = Math.max(1, Math.floor(limit));
  return total <= cap + Math.max(0, slack) ? total : cap;
}

/** "Show 12 more", "Show 1 more kegs" reads wrong: the noun follows the count. */
export function moreLabel(hidden: number, noun?: [string, string]): string {
  if (!noun) return `Show ${hidden} more`;
  return `Show ${hidden} more ${hidden === 1 ? noun[0] : noun[1]}`;
}
