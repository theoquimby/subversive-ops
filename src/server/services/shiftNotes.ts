import "server-only";
import { addDays, parseISODate, toISODate, type ISODate } from "@/domain/dates";
import { frequentItems, lastNightNotes, matchesQuery, type NoteLike } from "@/domain/shiftNotes";
import { db, num } from "../db";

/**
 * Shift notes: the end-of-shift handoff anyone can write. Read by the
 * /notes page, the morning brief ("Last night") and the Overview.
 */

export interface ShiftNoteView extends NoteLike {
  id: string;
  authorId: string | null;
  handledBy: string | null;
  createdAt: string;
  updatedAt: string;
}

type Row = Awaited<ReturnType<typeof db.shiftNote.findFirst>>;

export function toNoteView(r: NonNullable<Row>): ShiftNoteView {
  return {
    id: r.id,
    date: toISODate(r.date),
    shift: r.shift,
    authorId: r.authorId,
    authorName: r.authorName,
    eightySixed: r.eightySixed,
    issues: r.issues,
    comps: r.comps,
    compsAmount: num(r.compsAmount),
    cash: r.cash,
    cashOverShort: num(r.cashOverShort),
    maintenance: r.maintenance,
    notes: r.notes,
    tags: r.tags,
    handledAt: r.handledAt ? r.handledAt.toISOString() : null,
    handledBy: r.handledBy,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

const ORDER = [{ date: "desc" as const }, { createdAt: "desc" as const }];

/** Notes from the last few nights that the brief and the Overview call "last night". */
export async function lastNight(today: ISODate): Promise<ShiftNoteView[]> {
  const rows = await db.shiftNote.findMany({ where: { date: { gte: parseISODate(addDays(today, -3)), lte: parseISODate(today) } }, orderBy: ORDER });
  return lastNightNotes(rows.map(toNoteView), today);
}

/** Notes on given business dates (e.g. yesterday, for the brief's one-liner). */
export async function notesOn(dates: ISODate[]): Promise<ShiftNoteView[]> {
  if (!dates.length) return [];
  const rows = await db.shiftNote.findMany({ where: { date: { in: dates.map(parseISODate) } }, orderBy: ORDER });
  return rows.map(toNoteView);
}

/**
 * History, newest first. A search looks through every text field and chip
 * (all words must match) over the last year; without one, the latest `limit`.
 */
export async function noteHistory(opts: { q?: string; limit?: number; followUps?: boolean } = {}): Promise<{ notes: ShiftNoteView[]; total: number }> {
  const q = opts.q?.trim() ?? "";
  const limit = opts.limit ?? 60;
  if (!q && !opts.followUps) {
    const [rows, total] = await Promise.all([db.shiftNote.findMany({ orderBy: ORDER, take: limit }), db.shiftNote.count()]);
    return { notes: rows.map(toNoteView), total };
  }
  const since = new Date(Date.now() - 400 * 86_400_000);
  const rows = (await db.shiftNote.findMany({ where: { createdAt: { gte: since }, ...(opts.followUps ? { handledAt: null } : {}) }, orderBy: ORDER, take: 2000 })).map(toNoteView);
  const hits = rows.filter((n) => matchesQuery(n, q));
  return { notes: hits.slice(0, limit), total: hits.length };
}

/** The 86'd items people log most, from the last six weeks, for one-tap chips. */
export async function usual86(): Promise<string[]> {
  const rows = await db.shiftNote.findMany({ where: { createdAt: { gte: new Date(Date.now() - 42 * 86_400_000) } }, select: { eightySixed: true }, take: 400 });
  return frequentItems(rows, 8);
}

export interface NoteInput {
  date: ISODate;
  shift: string;
  eightySixed: string[];
  issues: string | null;
  comps: string | null;
  compsAmount: number | null;
  cash: string | null;
  cashOverShort: number | null;
  maintenance: string | null;
  notes: string | null;
  tags: string[];
}

const data = (i: NoteInput) => ({
  date: parseISODate(i.date),
  shift: i.shift,
  eightySixed: i.eightySixed,
  issues: i.issues,
  comps: i.comps,
  compsAmount: i.compsAmount,
  cash: i.cash,
  cashOverShort: i.cashOverShort,
  maintenance: i.maintenance,
  notes: i.notes,
  tags: i.tags,
});

export async function createNote(author: { userId: string; name: string }, input: NoteInput) {
  return toNoteView(await db.shiftNote.create({ data: { ...data(input), authorId: author.userId, authorName: author.name } }));
}

export async function updateNote(id: string, input: NoteInput) {
  return toNoteView(await db.shiftNote.update({ where: { id }, data: data(input) }));
}

export async function getNote(id: string) {
  const r = await db.shiftNote.findUnique({ where: { id } });
  return r ? toNoteView(r) : null;
}

export async function deleteNote(id: string) {
  await db.shiftNote.delete({ where: { id } });
}

export async function setHandled(id: string, by: string | null) {
  await db.shiftNote.update({ where: { id }, data: by ? { handledAt: new Date(), handledBy: by } : { handledAt: null, handledBy: null } });
}
