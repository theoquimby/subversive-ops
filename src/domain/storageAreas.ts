/**
 * Storage areas: the saved list (in walking order) merged with any area an
 * ingredient already uses, so nothing ever disappears from the Count page.
 */
export function orderAreas(saved: readonly string[], inUse: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of [...saved, ...[...inUse].sort((x, y) => x.localeCompare(y))]) {
    const name = cleanAreaName(a);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
  }
  return out;
}

export function cleanAreaName(raw: string): string {
  return String(raw ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
}

/** Move one area up or down in the list. */
export function moveArea(list: readonly string[], name: string, dir: -1 | 1): string[] {
  const i = list.indexOf(name);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return [...list];
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}
