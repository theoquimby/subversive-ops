import type { PrismaClient } from "@prisma/client";
import { CHECKLIST_PRESETS } from "@/domain/checklists";
import { addDays, parseISODate, todayIn } from "@/domain/dates";
import { UPKEEP_PRESETS } from "@/domain/upkeep";

/**
 * Demo for checklists, upkeep and beer tax: the preset lists with two weeks of
 * history (mostly signed, a couple partly done or missed), the preset jobs with
 * last-done dates (two overdue), a walk-in repair still open, a service visit,
 * and a few cases of cans typed in for beer tax.
 */
export async function seedRoutines(db: PrismaClient) {
  const tz = process.env.BUSINESS_TIMEZONE || "America/New_York";
  const today = todayIn(tz);
  const names = ["Max", "Line", "Sam", "Jo"];

  // ---- Checklists
  const positions = await db.position.findMany({ select: { id: true, area: true } });
  await db.setting.upsert({ where: { key: "checklists.seeded" }, create: { key: "checklists.seeded", value: "demo" }, update: {} });
  if ((await db.checklistTemplate.count()) === 0) {
    for (const [i, p] of CHECKLIST_PRESETS.entries()) {
      const kitchen = /kitchen/i.test(p.name);
      await db.checklistTemplate.create({
        data: {
          name: p.name, shift: p.shift, sort: i,
          positionIds: positions.filter((x) => (kitchen ? x.area === "BOH" : x.area !== "BOH")).map((x) => x.id),
          items: { create: p.items.map((it, j) => ({ sort: j, title: it.title, detail: it.detail ?? null, href: it.href ?? null, weekdays: it.weekdays ?? [] })) },
        },
      });
    }
  }
  const templates = await db.checklistTemplate.findMany({ include: { items: true } });
  await db.checklistTemplate.updateMany({ data: { createdAt: parseISODate(addDays(today, -30)) } });
  for (let d = 13; d >= 1; d--) {
    const date = addDays(today, -d);
    for (const [ti, t] of templates.entries()) {
      // A partly done close two nights ago, an untouched kitchen open last Tuesday-ish.
      const skip = d === 6 && ti === 1;
      if (skip) continue;
      const partial = d === 2 && t.shift === "close" && /kitchen/i.test(t.name);
      const who = names[(d + ti) % names.length];
      const run = await db.checklistRun.upsert({
        where: { templateId_date: { templateId: t.id, date: parseISODate(date) } },
        create: { templateId: t.id, date: parseISODate(date), ...(partial || d === 9 ? {} : { signedOffAt: parseISODate(date), signedOffName: who }) },
        update: {},
      });
      const items = partial ? t.items.slice(0, 3) : t.items;
      for (const it of items) {
        await db.checklistTick.upsert({ where: { runId_itemId: { runId: run.id, itemId: it.id } }, create: { runId: run.id, itemId: it.id, userName: who, doneAt: parseISODate(date) }, update: {} });
      }
    }
  }

  // ---- Upkeep
  await db.setting.upsert({ where: { key: "upkeep.seeded" }, create: { key: "upkeep.seeded", value: "demo" }, update: {} });
  if ((await db.equipment.count()) === 0) {
    let sort = 0;
    for (const e of UPKEEP_PRESETS) {
      await db.equipment.create({ data: { name: e.name, area: e.area, tasks: { create: e.tasks.map((t) => ({ title: t.title, everyDays: t.everyDays, staffCanDo: !!t.staffCanDo, howTo: t.howTo ?? null, sort: sort++ })) } } });
    }
  }
  const lastDone: Record<string, number> = {
    "Clean draft lines (caustic)": 17, "Take apart and clean faucets and couplers": 12, "Acid clean draft lines": 80, "Check gas lines and regulators for leaks": 20,
    "Check glycol level and strength": 33, "Clean the condenser coil": 40, "Clean condenser coil and check door gaskets": 70, "Clean and sanitize, change the water filter": 150,
    "Professional hood and duct cleaning": 120, "Fire suppression system inspection": 120, "Boil out": 9, "Delime": 25, "Pump out": 60,
    "Fire extinguishers inspected and tagged": 200, "Pest control visit": 26,
  };
  for (const t of await db.upkeepTask.findMany()) {
    const ago = lastDone[t.title];
    if (ago == null || t.lastDoneOn) continue;
    const date = parseISODate(addDays(today, -ago));
    await db.upkeepTask.update({ where: { id: t.id }, data: { lastDoneOn: date } });
    await db.upkeepLog.create({ data: { date, kind: "done", taskId: t.id, equipmentId: t.equipmentId, title: t.title, userName: names[ago % names.length], cost: /Professional|Fire suppression|Pump out|Pest/.test(t.title) ? 385 : null } });
  }
  const walkIn = await db.equipment.findFirst({ where: { name: "Walk-in cooler" } });
  if (walkIn && !(await db.upkeepLog.count({ where: { kind: "repair" } }))) {
    await db.equipment.update({ where: { id: walkIn.id }, data: { make: "Kolpak", model: "QS7-0810-CT", vendor: "Hudson Valley Refrigeration", vendorPhone: "(518) 555-0142", warrantyUntil: parseISODate(addDays(today, 40)) } });
    await db.upkeepLog.create({ data: { date: parseISODate(addDays(today, -1)), kind: "repair", equipmentId: walkIn.id, title: "Evaporator fan noisy, box running warm", down: true, vendor: "Hudson Valley Refrigeration", note: "Tech coming Tuesday with a fan motor.", userName: "Max" } });
    await db.upkeepLog.create({ data: { date: parseISODate(addDays(today, -95)), kind: "repair", equipmentId: walkIn.id, title: "Door gasket replaced", cost: 240, fixedOn: parseISODate(addDays(today, -95)), vendor: "Hudson Valley Refrigeration", userName: "Max" } });
  }

  // ---- Beer tax: cans from the tank
  if (!(await db.beerTaxAdjustment.count())) {
    const ipa = await db.beer.findFirst({ where: { house: true, name: { contains: "IPA" } } });
    await db.beerTaxAdjustment.create({ data: { date: parseISODate(addDays(today, -20)), kind: "removed", gallons: 23.25, beerId: ipa?.id ?? null, note: "4 cases of 16 oz cans to go", userName: "Max" } });
  }
}
