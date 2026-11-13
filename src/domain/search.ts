/**
 * Small fuzzy matcher for the command bar and quick-add: every query
 * character must appear in order; contiguous runs and word starts score higher.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase().replace(/\s+/g, "");
  const t = text.toLowerCase();
  if (!q) return 0;
  let score = 0;
  let ti = 0;
  let run = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return null;
    const wordStart = found === 0 || /[\s,/(-]/.test(t[found - 1]);
    run = found === ti ? run + 1 : 1;
    score += 1 + run * 2 + (wordStart ? 6 : 0) - Math.min(3, found - ti) * 0.5;
    ti = found + 1;
  }
  if (t.startsWith(query.toLowerCase())) score += 20;
  return score - t.length * 0.05;
}

export function fuzzyFilter<T>(items: T[], query: string, key: (t: T) => string, limit = 50): T[] {
  if (!query.trim()) return items.slice(0, limit);
  return items
    .map((it) => ({ it, s: fuzzyScore(query, key(it)) }))
    .filter((x): x is { it: T; s: number } => x.s != null)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.it);
}
