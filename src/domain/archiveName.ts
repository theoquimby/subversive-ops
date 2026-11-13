/**
 * Recipe and ingredient names are unique (including archived ones), so archiving appends a
 * readable suffix — "Burger · archived Nov 13" — that restoring strips again.
 * Also understands the old "Burger (archived 1794…)" form.
 */

const SUFFIX = / · archived [^·]*$/;
const LEGACY = / \(archived \d+\)$/;

export const archivedName = (name: string, label: string, n = 1) => `${name} · archived ${label}${n > 1 ? ` (${n})` : ""}`;

export const baseName = (name: string) => name.replace(SUFFIX, "").replace(LEGACY, "");

/** The "Nov 13" part of an archived name, or null for legacy/unknown names. */
export const archivedLabel = (name: string) => name.match(/ · archived ([^·(]*?)(?: \(\d+\))?$/)?.[1] ?? null;
