"use server";

import type { BrewProposal } from "@/domain/tankPlan";
import { requireUser } from "@/server/auth";
import {
  brewIntoTank,
  cancelPlannedBrew,
  deleteReading,
  dumpBatch,
  editStay,
  gravityFromText,
  markBrewed,
  markConditioning,
  moveBatch,
  movePlannedBrew,
  packageBatch,
  planNewBrew,
  proposeBrew,
  recordGravityText,
  setBatchField,
  setReleaseLock,
  splitBatch,
  type BatchField,
  type ProposedTiming,
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
/** Gravity as typed, in the brewery's unit; read on the server. */
const gravityText = z.string().max(16).nullish();
const note = z.string().trim().max(300).nullish();
const profile = z.string().trim().max(40).nullish().transform((v) => v || null);
/** Blank → null; otherwise a number checked by `n`. */
const blankOr = (n: z.ZodNumber) => z.preprocess((v) => (v === "" || v == null ? null : Number(String(v).trim())), n.nullable());
const count = blankOr(z.number({ message: "Kegs and cases are whole numbers" }).int("Kegs and cases are whole numbers").min(0, "Kegs and cases are whole numbers").max(10_000, "That's a lot: check the count"));

type Out = Promise<Res>;

async function run<T>(schema: z.ZodType<T>, input: unknown, fn: (d: T) => Out): Out {
  await requireUser("MANAGER");
  const p = schema.safeParse(input);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Check the details" };
  const r = await fn(p.data);
  if ("ok" in r) refresh();
  return r;
}

/** Typed gravity → SG for a handler, or its error. */
async function sgOf(text: string | null | undefined): Promise<{ sg: number | null } | { error: string }> {
  return gravityFromText(text);
}

// ---- Planning ------------------------------------------------------------------------------------

const proposeSchema = z.object({ brewOn: isoDate, bbl, recipeId: optId, beerId: optId, fermenterId: optId, exceptBatchId: optId, profile });

/** Where a brew would go and its dates (nothing saved). */
export async function proposeBrewAction(input: z.input<typeof proposeSchema>): Promise<{ proposal: BrewProposal; fermentDays: number; conditionDays: number; timing: ProposedTiming } | { error: string }> {
  await requireUser("MANAGER");
  const p = proposeSchema.safeParse(input);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Check the details" };
  if (!p.data.recipeId && !p.data.beerId) return { error: "Pick a recipe or a beer" };
  const { proposal, fermentDays, conditionDays, timing } = await proposeBrew(p.data);
  return { proposal, fermentDays, conditionDays, timing };
}

export async function planBrewAction(input: unknown): Out {
  return run(z.object({ brewOn: isoDate, bbl, recipeId: optId, beerId: optId, fermenterId: optId, code, notes: z.string().max(2000).nullish(), profile }), input, (d) => {
    if (!d.recipeId && !d.beerId) return Promise.resolve({ error: "Pick a recipe or a beer" });
    return planNewBrew(d);
  });
}

export async function moveBrewAction(input: unknown): Out {
  return run(z.object({ batchId: id, brewOn: isoDate, bbl: bbl.nullish(), fermenterId: optId, profile }), input, (d) => movePlannedBrew(d.batchId, d));
}

export async function cancelBrewAction(batchId: string): Out {
  return run(id, batchId, cancelPlannedBrew);
}

export async function releaseLockAction(input: unknown): Out {
  return run(z.object({ batchId: id, locked: z.boolean(), tapOn: isoDate.nullish(), reason: z.string().trim().max(120).nullish() }), input, (d) => setReleaseLock(d.batchId, d));
}

// ---- On the floor --------------------------------------------------------------------------------

export async function brewIntoTankAction(input: unknown): Out {
  return run(z.object({ tankId: id, recipeId: optId, beerId: optId, brewedOn: isoDate, bbl, code, og: gravityText }), input, async (d) => {
    const g = await sgOf(d.og);
    if ("error" in g) return g;
    return brewIntoTank({ ...d, og: g.sg });
  });
}

export async function markBrewedAction(input: unknown): Out {
  return run(z.object({ batchId: id, brewedOn: isoDate, bbl: bbl.nullish(), og: gravityText, tankId: optId }), input, async (d) => {
    const g = await sgOf(d.og);
    if ("error" in g) return g;
    return markBrewed(d.batchId, { ...d, og: g.sg });
  });
}

/** Move to another tank (fermenter, brite) with the gravity and a note; `force` goes ahead into a tank in use. */
export async function moveAction(input: unknown): Out {
  return run(z.object({ batchId: id, tankId: id, on: isoDate, gravity: gravityText, note, force: z.boolean().optional() }), input, (d) => moveBatch(d.batchId, d));
}

/** Kept for older callers. */
export async function transferAction(input: unknown): Out {
  return moveAction(input);
}

export async function conditioningAction(input: unknown): Out {
  return run(z.object({ batchId: id, on: isoDate, gravity: gravityText, note }), input, (d) => markConditioning(d.batchId, d));
}

export async function packageAction(input: unknown): Out {
  return run(
    z.object({
      batchId: id,
      on: isoDate,
      fg: gravityText,
      halfKegs: count,
      sixthKegs: count,
      cases: count,
      co2Vols: blankOr(z.number({ message: "CO₂ in volumes, like 2.5" }).min(0, "CO₂ in volumes, like 2.5").max(9.99, "CO₂ in volumes, like 2.5")),
      note: z.string().trim().max(1000).nullish(),
    }),
    input,
    (d) => packageBatch(d.batchId, d),
  );
}

export async function splitAction(input: unknown): Out {
  return run(z.object({ batchId: id, recipeId: optId, beerId: optId, bbl, tankId: id, on: isoDate, force: z.boolean().optional() }), input, (d) => splitBatch(d.batchId, d));
}

export async function dumpAction(input: unknown): Out {
  return run(z.object({ batchId: id, on: isoDate, reason: z.string().trim().min(1, "Say why").max(300) }), input, (d) => dumpBatch(d.batchId, d));
}

export async function gravityAction(input: unknown): Out {
  return run(
    z.object({ batchId: id, on: isoDate, sg: gravityText, kind: z.enum(["og", "fg", "reading"]), note: z.string().trim().max(200).nullish() }),
    input,
    (d) => recordGravityText(d.batchId, { on: d.on, text: d.sg ?? "", kind: d.kind, note: d.note || null }),
  );
}

export async function deleteReadingAction(batchId: string, index: number): Out {
  return run(z.object({ batchId: id, index: z.number().int().min(0) }), { batchId, index }, (d) => deleteReading(d.batchId, d.index));
}

export async function editStayAction(input: unknown): Out {
  return run(z.object({ stayId: id, start: isoDate, end: isoDate.nullish().transform((v) => v || null) }), input, (d) => editStay(d.stayId, d));
}

// ---- A brew's details ----------------------------------------------------------------------------

const batchFields = z.enum(["code", "bbl", "og", "fg", "cost", "notes", "beerId", "recipeId", "brewedOn", "packagedOn", "plannedOn", "dryHopOn", "tapOn", "lockedReason", "halfKegs", "sixthKegs", "cases", "co2Vols"]);

export async function setBatchFieldAction(batchId: string, field: BatchField, raw: string): Promise<{ error?: string } | void> {
  const r = await run(z.object({ batchId: id, field: batchFields, raw: z.string().max(4000) }), { batchId, field, raw }, (d) => setBatchField(d.batchId, d.field, d.raw));
  if ("error" in r) return { error: r.error };
}
