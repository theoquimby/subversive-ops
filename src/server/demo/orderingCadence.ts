import type { PrismaClient } from "@prisma/client";

/**
 * Ordering cadence demo: a mix of suppliers ordered every delivery and ones
 * ordered only when stock runs low, each taking orders a different way
 * (their website, a text, a phone call), and brewing suppliers kept on the
 * Brewery side. Run after the brewing recipes demo. Only updates rows that exist.
 */
export async function seedOrderingCadence(db: PrismaClient): Promise<void> {
  const byName = async (name: string) => db.supplier.findUnique({ where: { name }, select: { id: true } });
  const prefs: Record<string, unknown> = {};

  const hvf = await byName("Hudson Valley Foodservice");
  if (hvf) {
    await db.supplier.update({ where: { id: hvf.id }, data: { orderCadence: "regular" } });
    prefs[hvf.id] = { sendBy: "portal", portal: "HVF online ordering", portalUrl: "https://example.com/order", first: "24h", lastCallMins: 60, recipients: "managers" };
  }
  const bread = await byName("Catskill Bread Co.");
  if (bread) {
    await db.supplier.update({ where: { id: bread.id }, data: { orderCadence: "as_needed" } });
    prefs[bread.id] = { sendBy: "text", phone: "(518) 555-0142", first: "morning", lastCallMins: 60, recipients: "shift" };
  }
  const beef = await byName("Greene County Beef");
  if (beef) {
    await db.supplier.update({ where: { id: beef.id }, data: { orderCadence: "as_needed" } });
    prefs[beef.id] = { sendBy: "phone", phone: "(518) 555-0177", first: "4h", lastCallMins: 120, recipients: "managers" };
  }
  const house = await byName("House brewery");
  if (house) await db.supplier.update({ where: { id: house.id }, data: { orderCadence: "as_needed" } });

  // Brewing suppliers and their malt, hops and yeast belong to the Brewery's own ordering.
  const brewing = await db.supplier.findMany({ where: { name: { in: ["Valley Maltings", "Northeast Hop Co.", "Yeast Lab Supply"] } }, select: { id: true } });
  if (brewing.length) {
    await db.supplier.updateMany({ where: { id: { in: brewing.map((s) => s.id) } }, data: { department: "brewery" } });
    await db.ingredient.updateMany({ where: { products: { some: { supplierId: { in: brewing.map((s) => s.id) } } } }, data: { department: "brewery" } });
  }

  const value = JSON.stringify(prefs);
  await db.setting.upsert({ where: { key: "ordering.supplierPrefs" }, create: { key: "ordering.supplierPrefs", value }, update: { value } });
  await db.setting.upsert({ where: { key: "ordering.cadenceNotice" }, create: { key: "ordering.cadenceNotice", value: "show" }, update: { value: "show" } });
}
