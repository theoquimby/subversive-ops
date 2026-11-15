"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { businessToday } from "@/server/services/sales";
import { requireUser } from "@/server/auth";
import { CHIPS, isShiftKind, parseAmount, parseItems, parseOverShort } from "@/domain/shiftNotes";
import { addDays } from "@/domain/dates";
import { createNote, deleteNote, getNote, setHandled, updateNote, type ShiftNoteView } from "@/server/services/shiftNotes";

const revalidate = () => {
  for (const p of ["/notes", "/brief", "/"]) revalidatePath(p);
};

const text = (max: number) => z.string().max(max).transform((s) => (s.trim() ? s.trim() : null));

const schema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  shift: z.string().refine(isShiftKind),
  eightySixed: z.array(z.string().max(80)).max(30),
  issues: text(2000),
  comps: text(500),
  compsAmount: z.string().max(20),
  cash: text(500),
  cashOverShort: z.string().max(30),
  maintenance: text(2000),
  notes: text(4000),
  tags: z.array(z.string().max(40)).max(20),
});

export type NoteForm = z.input<typeof schema>;

/** Any signed-in person can write a note; only its author or a manager can change it. */
export async function saveNote(id: string | null, form: NoteForm): Promise<{ error?: string; note?: ShiftNoteView }> {
  const s = await requireUser();
  const v = schema.safeParse(form);
  if (!v.success) return { error: "Something in the note couldn't be saved. Check the fields and try again." };
  const today = businessToday();
  if (v.data.date > today || v.data.date < addDays(today, -14)) return { error: "Pick a date in the last two weeks." };
  const compsAmount = parseAmount(v.data.compsAmount);
  if (compsAmount === "invalid") return { error: "Comps: enter a dollar amount, like 24 or 24.50." };
  const cashOverShort = parseOverShort(v.data.cashOverShort);
  if (cashOverShort === "invalid") return { error: "Drawer: enter an amount, like 5 or \"5 short\"." };
  const known = new Set(CHIPS.map((c) => c.label));
  const input = {
    date: v.data.date,
    shift: v.data.shift,
    eightySixed: parseItems(v.data.eightySixed),
    issues: v.data.issues,
    comps: v.data.comps,
    compsAmount,
    cash: v.data.cash,
    cashOverShort,
    maintenance: v.data.maintenance,
    notes: v.data.notes,
    tags: v.data.tags.filter((t) => known.has(t)),
  };
  const empty = !input.eightySixed.length && !input.issues && !input.comps && input.compsAmount == null && !input.cash && input.cashOverShort == null && !input.maintenance && !input.notes && !input.tags.length;
  if (empty) return { error: "Add something first: a chip, an 86'd item or a few words." };

  let note: ShiftNoteView;
  if (id) {
    const cur = await getNote(id);
    if (!cur) return { error: "That note was deleted." };
    if (s.role !== "MANAGER" && cur.authorId !== s.userId) return { error: "Only the person who wrote it or a manager can change this note." };
    note = await updateNote(id, input);
  } else note = await createNote({ userId: s.userId, name: s.name }, input);
  revalidate();
  return { note };
}

export async function removeNote(id: string): Promise<{ error?: string }> {
  const s = await requireUser();
  const cur = await getNote(id);
  if (!cur) return {};
  if (s.role !== "MANAGER" && cur.authorId !== s.userId) return { error: "Only the person who wrote it or a manager can delete this note." };
  await deleteNote(id);
  revalidate();
  return {};
}

/** A manager ticks off the follow-ups (issues, maintenance, a short drawer) on a note. */
export async function markHandled(id: string, handled: boolean): Promise<{ error?: string }> {
  const s = await requireUser("MANAGER");
  if (!(await getNote(id))) return { error: "That note was deleted." };
  await setHandled(id, handled ? s.name : null);
  revalidate();
  return {};
}
