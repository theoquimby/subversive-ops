"use server";

import type { BrewProposal } from "@/domain/tankPlan";
import { requireUser } from "@/server/auth";
import {
  brewIntoTank,
  cancelPlannedBrew,
  deleteReading,
  dumpBatch,
  editStay,
  markBrewed,
  movePlannedBrew,
  packageBatch,
  parseGravity,
  planNewBrew,
  proposeBrew,
  recordGravity,
  setBatchField,
  transferBatch,
  type BatchField,
  type Res,
} from "@/server/services/breweryWrite";
import { revalidatePath } from "next/cache";
import { z } from "zod";

/** Every brewery page, the Overview and the brief (they show what's due), and Kegs (new keg batches to fill from). */
function refresh() {
  revalidatePath("/brewery", "layout");
  revalidatePath("/");
  revalidatePath("/brief");
  revalidatePath("/kegs", "layout");
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date").refine((s) => !Number.isNaN(Date.parse(s)), "Pick a date");
const id = z.string().min(1).max(60);
const bbl = z.coerce.number({ message: "Barrels, like 7" }).positive("Barrels, like 7").max(1000, "Barrels, like 7");
const optId = z.string().max(60).nullish().transform((v) => v || null);
const code = z.string().trim().max(40).nullish();
const gravity = z.string().max(12).nullish().transform((v, ctx) => {
  const g = parseGravity(v ?? "");
  if (g === "bad") {
    ctx.addIssue({ code: "custom", message: "Gravity like 1.052" });
    return z.NEVER;
  }
  return g;
});

type Out = Promise<Res>;

async function run<T>(schema: z.ZodType<T>, input: unknown, fn: (d: T) => Out): Out {
  await requireUser("MANAGER");
  const p = schema.safeParse(input);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Check the details" };
  const r = await fn(p.data);
  if ("ok" in r) refresh();
  return r;
}

// ---- Planning ------------------------------------------------------------------------------------

const proposeSchema = z.object({ brewOn: isoDate, bbl, recipeId: optId, beerId: optId, fermenterId: optId, exceptBatchId: optId });

/** Where a brew would go (nothing saved). */
export async function proposeBrewAction(input: z.input<typeof proposeSchema>): Promise<{ proposal: BrewProposal; fermentDays: number; conditionDays: number } | { error: string }> {
  await requireUser("MANAGER");
  const p = proposeSchema.safeParse(input);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Check the details" };
  if (!p.data.recipeId && !p.data.beerId) return { error: "Pick a recipe or a beer" };
  const { proposal, fermentDays, conditionDays } = await proposeBrew(p.data);
  return { proposal, fermentDays, conditionDays };
}

export async function planBrewAction(input: unknown): Out {
  return run(z.object({ brewOn: isoDate, bbl, recipeId: optId, beerId: optId, fermenterId: optId, code, notes: z.string().max(2000).nullish() }), input, (d) => {
    if (!d.recipeId && !d.beerId) return Promise.resolve({ error: "Pick a recipe or a beer" });
    return planNewBrew(d);
  });
}

export async function moveBrewAction(input: unknown): Out {
  return run(z.object({ batchId: id, brewOn: isoDate, bbl: bbl.nullish(), fermenterId: optId }), input, (d) => movePlannedBrew(d.batchId, d));
}

export async function cancelBrewAction(batchId: string): Out {
  return run(id, batchId, cancelPlannedBrew);
}

// ---- On the floor --------------------------------------------------------------------------------

export async function brewIntoTankAction(input: unknown): Out {
  return run(z.object({ tankId: id, recipeId: optId, beerId: optId, brewedOn: isoDate, bbl, code, og: gravity }), input, brewIntoTank);
}

export async function markBrewedAction(input: unknown): Out {
  return run(z.object({ batchId: id, brewedOn: isoDate, bbl: bbl.nullish(), og: gravity, tankId: optId }), input, (d) => markBrewed(d.batchId, d));
}

export async function transferAction(input: unknown): Out {
  return run(z.object({ batchId: id, tankId: id, on: isoDate }), input, (d) => transferBatch(d.batchId, d));
}

export async function packageAction(input: unknown): Out {
  return run(z.object({ batchId: id, on: isoDate }), input, (d) => packageBatch(d.batchId, d));
}

export async function dumpAction(input: unknown): Out {
  return run(z.object({ batchId: id, on: isoDate, reason: z.string().trim().min(1, "Say why").max(300) }), input, (d) => dumpBatch(d.batchId, d));
}

export async function gravityAction(input: unknown): Out {
  return run(
    z.object({ batchId: id, on: isoDate, sg: gravity, kind: z.enum(["og", "fg", "reading"]), note: z.string().trim().max(200).nullish() }),
    input,
    (d) => (d.sg == null ? Promise.resolve({ error: "Type the gravity, like 1.012" }) : recordGravity(d.batchId, { on: d.on, sg: d.sg, kind: d.kind, note: d.note || null })),
  );
}

export async function deleteReadingAction(batchId: string, index: number): Out {
  return run(z.object({ batchId: id, index: z.number().int().min(0) }), { batchId, index }, (d) => deleteReading(d.batchId, d.index));
}

export async function editStayAction(input: unknown): Out {
  return run(z.object({ stayId: id, start: isoDate, end: isoDate.nullish().transform((v) => v || null) }), input, (d) => editStay(d.stayId, d));
}

// ---- A brew's details ----------------------------------------------------------------------------

const batchFields = z.enum(["code", "bbl", "og", "fg", "cost", "notes", "beerId", "recipeId", "brewedOn", "packagedOn", "plannedOn"]);

export async function setBatchFieldAction(batchId: string, field: BatchField, raw: string): Promise<{ error?: string } | void> {
  const r = await run(z.object({ batchId: id, field: batchFields, raw: z.string().max(4000) }), { batchId, field, raw }, (d) => setBatchField(d.batchId, d.field, d.raw));
  if ("error" in r) return { error: r.error };
}
