/**
 * Demo data for the final parity round: allergen tags, waste of prepped and
 * plated items, manager notes, onboarding documents with sign-offs, and the
 * labor-rules review date. Safe to run more than once (skips what exists).
 */

import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { deflateSync } from "node:zlib";
import { randomUUID } from "node:crypto";
import type { CostingContext } from "@/domain/costing";
import { explodeWaste } from "@/domain/prepWaste";
import type { BaseUnit } from "@/domain/units";

const ALLERGEN_TAGS: Record<string, string[]> = {
  "Burger bun": ["wheat", "milk", "eggs", "sesame"],
  "Sourdough loaf": ["wheat"],
  "Cheddar, sliced": ["milk"],
  Butter: ["milk"],
  Mayonnaise: ["eggs", "soy"],
  "All-purpose flour": ["wheat"],
  Buttermilk: ["milk"],
  "Pretzel, soft": ["wheat"],
};

const HANDBOOK = `Subversive Staff Handbook (demo)

Welcome to Subversive. This handbook covers how we work together. Ask a manager if anything is unclear.

Meal breaks
Anyone scheduled for a shift longer than six hours gets an unpaid 30 minute meal break. Tell the shift lead before you take it, and clock out and back in on Square.

Calling out
If you are sick or can't make a shift, call or text the manager on duty at least two hours before your shift starts. Don't just message a coworker. Paid sick leave can be requested on My shifts.

Shift swaps
You can offer a shift on My shifts. A swap is final only once a manager approves it. Until then you are still responsible for the shift.

Dress code
Black or dark shirt, clean apron, and closed-toe non-slip shoes. Kitchen staff wear a hat or hairnet. No open-toe shoes anywhere behind the bar or in the kitchen.

Staff drinks
One shift drink after you have clocked out, from the house taps only. No drinking on shift.

Tips
Tips are pooled by hours worked for tip-eligible positions and paid with your regular paycheck.

Respect at work
Harassment of any kind is not tolerated. Report anything that makes you uncomfortable to any manager or to the owner directly. Reports are kept confidential and there is no retaliation for reporting.`;

const SICK_POLICY = `Paid sick leave policy (demo)

Under New York State law you earn 1 hour of paid sick leave for every 30 hours worked, up to 40 hours a year. You can use it from your first day.

Use sick leave for your own illness or a family member's, medical appointments, or safe leave. Request it on My shifts, or tell the manager on duty if it's the same day.

Unused sick leave carries over to the next year, but you can use at most 40 hours in a calendar year.`;

const TAX_FORMS = `New hire paperwork (demo)

Before your first paycheck we need:
1. Federal Form W-4 (withholding).
2. New York Form IT-2104 (state withholding).
3. Form I-9 with your ID, completed in person on your first day.

Download the current blank forms from irs.gov and tax.ny.gov, fill them in, and hand them to a manager. Don't send ID photos by text or email.`;

/** A tiny one-page PDF (Helvetica, Flate-compressed content) so the demo handbook is a real PDF. */
export function simplePdf(text: string): Buffer {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\x7e]/g, "-");
  const wrap = (line: string, width = 92) => {
    if (!line) return [""];
    const out: string[] = [];
    let cur = "";
    for (const w of line.split(" ")) {
      if ((cur + " " + w).trim().length > width) { out.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w;
    }
    out.push(cur);
    return out;
  };
  const lines = text.split("\n").flatMap((l) => wrap(l));
  const content = `BT /F1 10 Tf 13 TL 56 760 Td ${lines.map((l) => `(${esc(l)}) Tj T*`).join(" ")} ET`;
  const stream = deflateSync(Buffer.from(content, "latin1"));
  const objs: Buffer[] = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>"),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
    Buffer.concat([Buffer.from(`<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`), stream, Buffer.from("\nendstream")]),
  ];
  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n")];
  const offsets: number[] = [];
  let pos = parts[0].length;
  objs.forEach((o, i) => {
    const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), o, Buffer.from("\nendobj\n")]);
    offsets.push(pos);
    parts.push(b);
    pos += b.length;
  });
  const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`;
  parts.push(Buffer.from(xref));
  return Buffer.concat(parts);
}

async function costingContext(db: PrismaClient): Promise<CostingContext> {
  const [ings, recipes] = await Promise.all([
    db.ingredient.findMany({ where: { active: true }, include: { conversions: true } }),
    db.recipe.findMany({ where: { active: true }, include: { lines: true } }),
  ]);
  return {
    ingredients: new Map(ings.map((i) => [i.id, { id: i.id, name: i.name, baseUnit: i.baseUnit as BaseUnit, yieldPct: i.yieldPct.toNumber(), conversions: i.conversions.map((c) => ({ unit: c.unit, baseQty: c.baseQty.toNumber() })), costPerBase: null }])),
    recipes: new Map(recipes.map((r) => [r.id, { id: r.id, name: r.name, yieldQty: r.yieldQty.toNumber(), yieldUnit: r.yieldUnit, yieldBase: r.yieldBase as BaseUnit, menuPrice: r.menuPrice?.toNumber() ?? null, lines: r.lines.map((l) => ({ ingredientId: l.ingredientId, subRecipeId: l.subRecipeId, qty: l.qty.toNumber(), unit: l.unit })) }])),
  };
}

export async function seedFinal(db: PrismaClient): Promise<void> {
  // Allergens
  for (const [name, tags] of Object.entries(ALLERGEN_TAGS)) {
    await db.ingredient.updateMany({ where: { name, allergens: { isEmpty: true } }, data: { allergens: tags } });
  }

  // Waste of a prep batch and plated items, exploded through the recipes.
  if ((await db.wasteLog.count({ where: { batchId: { not: null } } })) === 0) {
    const ctx = await costingContext(db);
    const entries = [
      { name: "Garlic aioli", kind: "PREP", qty: 1, unit: "qt", reason: "Expired", by: "Carlos", daysAgo: 3 },
      { name: "Subversive burger", kind: "MENU", qty: 2, unit: "each", reason: "Dropped", by: "Line", daysAgo: 1 },
      { name: "Beer cheese", kind: "PREP", qty: 0.5, unit: "l", reason: "Spoiled", by: "Max", daysAgo: 6 },
    ];
    for (const e of entries) {
      const r = await db.recipe.findFirst({ where: { name: e.name, active: true }, select: { id: true } });
      if (!r) continue;
      let usage: Map<string, number>;
      try {
        usage = explodeWaste(ctx, r.id, e.qty, e.unit, e.kind).usage;
      } catch {
        continue;
      }
      const batchId = randomUUID();
      const loggedAt = new Date(Date.now() - e.daysAgo * 86_400_000 - 3 * 3_600_000);
      await db.wasteLog.createMany({
        data: [...usage].map(([ingredientId, q]) => ({ ingredientId, qtyBase: new Prisma.Decimal(q.toFixed(4)), reason: e.reason, loggedBy: e.by, loggedAt, sourceRecipeId: r.id, sourceQty: new Prisma.Decimal(e.qty), sourceUnit: e.unit, batchId })),
      });
    }
  }

  // Manager notes
  const max = await db.user.findFirst({ where: { name: "Max" }, select: { id: true } });
  const emp = async (name: string) => (await db.employee.findFirst({ where: { name }, select: { id: true } }))?.id;
  if ((await db.employeeFeedback.count()) === 0) {
    const notes: { who: string; kind: "PRAISE" | "COACHING" | "NOTE"; body: string; visible: boolean; daysAgo: number }[] = [
      { who: "Carlos Mendez", kind: "PRAISE", body: "Saturday's festival rush: kept the line calm and tickets under 12 minutes all night. Thank you!", visible: true, daysAgo: 5 },
      { who: "Carlos Mendez", kind: "COACHING", body: "Remember to log prep waste at close (the aioli and beer cheese) so food cost stays honest.", visible: true, daysAgo: 2 },
      { who: "Hannah Lee", kind: "PRAISE", body: "Great upsell on flights this week — guests loved the walkthrough.", visible: true, daysAgo: 4 },
      { who: "Jake Brennan", kind: "NOTE", body: "Asked about more weekday hours from January. Check when building the first schedule of the year.", visible: false, daysAgo: 8 },
      { who: "Eli Park", kind: "COACHING", body: "Two late clock-ins this week. Talked it through; bus schedule changed — moved his start to 4:30.", visible: false, daysAgo: 3 },
    ];
    for (const n of notes) {
      const id = await emp(n.who);
      if (id) await db.employeeFeedback.create({ data: { employeeId: id, authorId: max?.id ?? null, kind: n.kind, body: n.body, visibleToEmployee: n.visible, createdAt: new Date(Date.now() - n.daysAgo * 86_400_000) } });
    }
  }

  // Documents
  if ((await db.document.count()) === 0) {
    const pdf = simplePdf(HANDBOOK);
    const handbook = await db.document.create({ data: { title: "Staff handbook", kind: "HANDBOOK", bytes: new Uint8Array(pdf), mime: "application/pdf", size: pdf.length, filename: "subversive-handbook.pdf", text: HANDBOOK, requiresAck: true, audience: "STAFF", uploadedBy: "Max", createdAt: new Date(Date.now() - 20 * 86_400_000) } });
    const sick = Buffer.from(SICK_POLICY, "utf8");
    const sickDoc = await db.document.create({ data: { title: "Paid sick leave policy", kind: "POLICY", bytes: new Uint8Array(sick), mime: "text/plain", size: sick.length, filename: "sick-leave.txt", text: SICK_POLICY, requiresAck: true, audience: "STAFF", uploadedBy: "Max", createdAt: new Date(Date.now() - 18 * 86_400_000) } });
    const tax = Buffer.from(TAX_FORMS, "utf8");
    await db.document.create({ data: { title: "New hire paperwork (W-4, IT-2104, I-9)", kind: "TAX_FORM", bytes: new Uint8Array(tax), mime: "text/plain", size: tax.length, filename: "new-hire-paperwork.txt", text: TAX_FORMS, requiresAck: false, audience: "STAFF", uploadedBy: "Max" } });
    for (const [who, docs] of [["Hannah Lee", [handbook.id, sickDoc.id]], ["Maya Ortiz", [handbook.id]], ["Jake Brennan", [handbook.id, sickDoc.id]], ["Sam Whitaker", [handbook.id]]] as const) {
      const id = await emp(who);
      if (!id) continue;
      for (const d of docs) await db.documentAck.create({ data: { documentId: d, employeeId: id, ackedAt: new Date(Date.now() - 10 * 86_400_000) } });
    }
  }

  // Labor rules reviewed after the 2026 rate change.
  await db.setting.upsert({ where: { key: "labor.rulesReviewed" }, create: { key: "labor.rulesReviewed", value: JSON.stringify({ date: "2026-01-05", by: "Max" }) }, update: {} });
}
