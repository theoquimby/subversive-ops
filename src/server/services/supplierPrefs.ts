import "server-only";
import { redirect } from "next/navigation";
import { DEFAULT_SUPPLIER_PREFS, patchSupplierPrefs, PREFS_COLUMNS, prefsFromColumns, prefsToColumns, type SupplierPrefs } from "@/domain/supplierPrefs";
import { getSession } from "../auth";
import { db } from "../db";
import type { Session } from "../session";

/**
 * Per-supplier reminder and "send orders by" settings, on the supplier's own
 * columns (they used to be the Setting `ordering.supplierPrefs`, kept but no
 * longer read), and which staff logins may place orders.
 */

export const STAFF_ORDERERS_KEY = "ordering.staffOrderers";
/** Set by the cadence-defaults migration; the board shows its note until someone dismisses it. */
export const CADENCE_NOTICE_KEY = "ordering.cadenceNotice";

/** Every supplier's preferences, by supplier id. */
export async function loadSupplierPrefs(): Promise<Record<string, SupplierPrefs>> {
  const rows = await db.supplier.findMany({ select: { id: true, ...PREFS_COLUMNS } });
  return Object.fromEntries(rows.map((r) => [r.id, prefsFromColumns(r)]));
}

export const prefsOf = (all: Record<string, SupplierPrefs>, id: string): SupplierPrefs => all[id] ?? DEFAULT_SUPPLIER_PREFS;

export async function saveSupplierPrefs(supplierId: string, patch: Partial<SupplierPrefs>): Promise<SupplierPrefs> {
  const row = await db.supplier.findUnique({ where: { id: supplierId }, select: PREFS_COLUMNS });
  const next = patchSupplierPrefs(row ? prefsFromColumns(row) : DEFAULT_SUPPLIER_PREFS, patch);
  if (row) await db.supplier.update({ where: { id: supplierId }, data: prefsToColumns(next) });
  return next;
}

/** Staff logins (by user id) allowed to place orders. Managers always can. */
export async function staffOrderers(): Promise<string[]> {
  const row = await db.setting.findUnique({ where: { key: STAFF_ORDERERS_KEY } });
  try {
    const v = row ? JSON.parse(row.value) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export async function saveStaffOrderers(ids: string[]) {
  const value = JSON.stringify([...new Set(ids)].slice(0, 50));
  await db.setting.upsert({ where: { key: STAFF_ORDERERS_KEY }, create: { key: STAFF_ORDERERS_KEY, value }, update: { value } });
}

export async function canOrder(s: Pick<Session, "role" | "userId"> | null): Promise<boolean> {
  if (!s) return false;
  if (s.role === "MANAGER") return true;
  return (await staffOrderers()).includes(s.userId);
}

/** For staff ordering pages and actions: a manager, or staff a manager allowed to place orders. */
export async function requireOrderer(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!(await canOrder(s))) redirect("/my");
  return s;
}

export async function cadenceNoticeOpen(): Promise<boolean> {
  const row = await db.setting.findUnique({ where: { key: CADENCE_NOTICE_KEY } });
  return row?.value === "show";
}

export async function dismissCadenceNotice() {
  await db.setting.upsert({ where: { key: CADENCE_NOTICE_KEY }, create: { key: CADENCE_NOTICE_KEY, value: "dismissed" }, update: { value: "dismissed" } });
}
