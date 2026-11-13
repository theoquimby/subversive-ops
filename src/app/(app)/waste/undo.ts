/** How long staff can take back their own waste entry. Managers can delete any time. */
export const WASTE_UNDO_MINUTES = 15;

export function canDeleteWaste(w: { loggedBy: string | null; loggedAt: Date }, user: { name: string; role: string }, now = Date.now()) {
  if (user.role === "MANAGER") return true;
  return w.loggedBy === user.name && now - w.loggedAt.getTime() < WASTE_UNDO_MINUTES * 60_000;
}
