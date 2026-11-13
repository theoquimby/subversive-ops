/**
 * Training & certifications demo: the New York certificate presets, a card on
 * file for nearly everyone (two expiring within the month, one expired ATAP,
 * one person missing harassment training, one staff upload waiting to be
 * verified), a "New bartender" checklist half done and a kitchen checklist
 * (one overdue). Runs once: remembered in Setting `demo.training`.
 */

import type { PrismaClient } from "@prisma/client";
import { addMonths, expiryFor, NY_CERT_PRESETS, presetPositions } from "../../domain/certs";
import { addDays, parseISODate, todayIn } from "../../domain/dates";

const TZ = process.env.BUSINESS_TIMEZONE || "America/New_York";
const MARK = "demo.training";

export async function seedTraining(db: PrismaClient): Promise<void> {
  if (await db.setting.findUnique({ where: { key: MARK } })) return;
  const today = todayIn(TZ);
  const positions = await db.position.findMany({ select: { id: true, name: true, area: true } });

  // Presets (same as the first visit to /team/training would add).
  let sort = 0;
  for (const p of NY_CERT_PRESETS) {
    sort++;
    const exists = await db.certType.findFirst({ where: { name: { equals: p.name, mode: "insensitive" } } });
    if (exists) continue;
    await db.certType.create({
      data: { name: p.name, description: p.description, issuer: p.issuer, validityMonths: p.validityMonths, appliesTo: presetPositions(p, positions), requiredForAll: !!p.requiredForAll, requiredForMinors: !!p.requiredForMinors, isAnnualTraining: !!p.isAnnualTraining, sort },
    });
  }
  await db.setting.upsert({ where: { key: "training.presetsSeeded" }, create: { key: "training.presetsSeeded", value: new Date().toISOString() }, update: {} });

  const types = await db.certType.findMany({ where: { active: true } });
  const employees = await db.employee.findMany({ where: { active: true }, select: { id: true, name: true, isMinor: true, positions: { select: { positionId: true } } }, orderBy: { name: "asc" } });
  const byName = (n: string) => types.find((t) => t.name.toLowerCase().startsWith(n.toLowerCase()));
  const atap = byName("ATAP");
  const food = byName("ServSafe Food Handler");
  const harass = byName("Sexual harassment");
  const cpr = byName("First aid");

  /** Issue date that makes the certificate expire `daysFromToday` from now. */
  const issuedFor = (months: number, daysFromToday: number) => addMonths(addDays(today, daysFromToday), -months);
  // Spread "comfortably in date" expiries over the next 3–30 months, deterministic per person × type.
  const spread = (seed: string, max: number) => 75 + ([...seed].reduce((a, c) => a + c.charCodeAt(0), 0) % Math.max(1, max - 75));

  const special: Record<string, Record<string, number | "skip">> = {
    "Maya Ortiz": atap ? { [atap.id]: 11 } : {},
    "Eli Park": food ? { [food.id]: 22 } : {},
    "Jake Brennan": atap ? { [atap.id]: -11 } : {},
    "Tom Keller": harass ? { [harass.id]: "skip" } : {},
  };

  const rows: { employeeId: string; certTypeId: string; issuedOn: string; expiresOn: string | null; number: string | null; verified: boolean }[] = [];
  for (const e of employees) {
    const pos = e.positions.map((p) => p.positionId);
    for (const t of types) {
      const required = t.requiredForAll || (t.requiredForMinors && e.isMinor) || t.appliesTo.some((p) => pos.includes(p));
      const optionalHeld = t.id === cpr?.id && ["Hannah Lee", "Lena Fischer", "Dana Russo"].includes(e.name);
      if (!required && !optionalHeld) continue;
      const s = special[e.name]?.[t.id];
      if (s === "skip") continue;
      const months = t.validityMonths;
      const maxDays = months ? Math.min(months * 30 - 10, 900) : 900;
      const days = typeof s === "number" ? s : spread(e.name + t.name, maxDays);
      const issuedOn = months ? issuedFor(months, days) : addDays(today, -200);
      const expiresOn = expiryFor(issuedOn, months);
      const number = t.id === atap?.id ? `ATAP-${String(41000 + rows.length * 37).slice(0, 5)}` : t.id === food?.id ? `FH${String(8800000 + rows.length * 113)}` : null;
      rows.push({ employeeId: e.id, certTypeId: t.id, issuedOn, expiresOn, number, verified: true });
      // Jake's lapsed ATAP had an earlier card too: history.
      if (e.name === "Jake Brennan" && t.id === atap?.id && months) {
        const older = issuedFor(months, days - months * 30);
        rows.push({ employeeId: e.id, certTypeId: t.id, issuedOn: older, expiresOn: expiryFor(older, months), number: "ATAP-30112", verified: true });
      }
    }
  }
  // Priya uploaded her renewed allergen card herself: waiting for a manager.
  const priya = employees.find((e) => e.name === "Priya Shah");
  const allergen = byName("Allergen");
  if (priya && allergen?.validityMonths) {
    const issued = addDays(today, -3);
    rows.push({ employeeId: priya.id, certTypeId: allergen.id, issuedOn: issued, expiresOn: expiryFor(issued, allergen.validityMonths), number: null, verified: false });
  }
  await db.certification.createMany({
    data: rows.map((r) => ({
      employeeId: r.employeeId,
      certTypeId: r.certTypeId,
      issuedOn: parseISODate(r.issuedOn),
      expiresOn: r.expiresOn ? parseISODate(r.expiresOn) : null,
      number: r.number,
      uploadedBy: r.verified ? "Max" : "Priya Shah",
      ...(r.verified ? { verifiedBy: "Max", verifiedAt: new Date(`${r.issuedOn}T15:00:00Z`) } : {}),
    })),
  });

  // Checklists.
  const pos = (n: string) => positions.find((p) => p.name.toLowerCase() === n.toLowerCase())?.id;
  const handbook = await db.document.findFirst({ where: { active: true, audience: "STAFF", title: { contains: "handbook", mode: "insensitive" } }, select: { id: true } });
  const bartender = await db.trainingModule.create({
    data: {
      title: "New bartender",
      description: "First two weeks behind the bar. Tick each one once you've done it on a real shift.",
      positionIds: [pos("Bartender")].filter((x): x is string => !!x),
      steps: {
        create: [
          { sort: 1, title: "Read the staff handbook", detail: "Especially breaks, call-outs and the alcohol service policy.", documentId: handbook?.id ?? null },
          { sort: 2, title: "Pour a pint with the right head on every tap", detail: "About an inch of foam on lagers, a little less on IPAs." },
          { sort: 3, title: "Describe each beer on the tap list in a sentence" },
          { sort: 4, title: "Check IDs: acceptable NY IDs and when to refuse", detail: "Under-21 IDs are vertical. When in doubt, get a manager." },
          { sort: 5, title: "Open and split a tab in Square" },
          { sort: 6, title: "Change a keg and clean the coupler" },
          { sort: 7, title: "Close the bar: line cleaning and drawer count" },
          { sort: 8, title: "ATAP certificate uploaded", detail: "Upload it under My training." },
        ],
      },
    },
    include: { steps: { orderBy: { sort: "asc" } } },
  });
  const kitchen = await db.trainingModule.create({
    data: {
      title: "Kitchen basics",
      description: "Food safety and the line, for anyone new in the kitchen.",
      positionIds: [pos("Line cook"), pos("Dishwasher")].filter((x): x is string => !!x),
      steps: {
        create: [
          { sort: 1, title: "Handwashing and glove changes", detail: "Before starting, after raw proteins, after breaks." },
          { sort: 2, title: "Date and label everything in the walk-in" },
          { sort: 3, title: "Temp log: coolers at open and close" },
          { sort: 4, title: "Allergen tickets: what to do when one comes in" },
          { sort: 5, title: "Dish machine: chemicals and the sanitizer test strip" },
        ],
      },
    },
    include: { steps: { orderBy: { sort: "asc" } } },
  });
  const emp = (n: string) => employees.find((e) => e.name === n);
  const assign = async (moduleId: string, steps: { id: string }[], name: string, done: number, dueIn: number | null, daysAgo: number) => {
    const e = emp(name);
    if (!e) return;
    const a = await db.trainingAssignment.create({ data: { employeeId: e.id, moduleId, assignedBy: "Max", assignedAt: new Date(`${addDays(today, -daysAgo)}T14:00:00Z`), dueOn: dueIn == null ? null : parseISODate(addDays(today, dueIn)) } });
    if (done) await db.trainingStepCompletion.createMany({ data: steps.slice(0, done).map((s, i) => ({ assignmentId: a.id, stepId: s.id, completedBy: name, completedAt: new Date(`${addDays(today, -daysAgo + 1 + i)}T20:00:00Z`) })) });
  };
  await assign(bartender.id, bartender.steps, "Lena Fischer", 4, 7, 6);
  await assign(kitchen.id, kitchen.steps, "Carlos Mendez", 1, 14, 2);
  await assign(kitchen.id, kitchen.steps, "Sam Whitaker", 2, -3, 12);

  await db.setting.create({ data: { key: MARK, value: new Date().toISOString() } });
}
