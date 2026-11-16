/**
 * Lists of position ids kept on other records (which certificates a position
 * needs, which checklists, training and onboarding are for it). When a position
 * is deleted its id comes out of every list. Pure.
 */

export interface DropResult {
  ids: string[];
  /** The id was there. */
  changed: boolean;
  /** It was the only one: the list is now empty. */
  emptied: boolean;
}

export function dropPosition(ids: readonly string[], positionId: string): DropResult {
  const next = ids.filter((x) => x !== positionId);
  const changed = next.length !== ids.length;
  return { ids: next, changed, emptied: changed && next.length === 0 };
}
