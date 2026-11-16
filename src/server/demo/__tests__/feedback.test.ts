import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { FEEDBACK_KINDS, FEEDBACK_STATUSES } from "@/domain/feedback";
import { seedFeedback } from "../feedback";

// A stand-in that only records what it was asked to write: no database.
type Row = { userId: string | null; userName: string; role: string; kind: string; status: string; note: string | null; photoMime: string | null; photo: Uint8Array | null; createdAt: Date };

function fakeDb() {
  const rows: Row[] = [];
  const db = {
    appFeedback: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      create: vi.fn(async ({ data }: { data: Row }) => (rows.push(data), data)),
    },
    user: {
      findMany: vi.fn(async () => [{ id: "u-max", name: "Max", role: "MANAGER" }, { id: "u-line", name: "Line", role: "STAFF" }]),
    },
  };
  return { db: db as unknown as PrismaClient, raw: db, rows };
}

describe("feedback demo", () => {
  it("clears its own rows, then adds notes in every state and kind", async () => {
    const { db, raw, rows } = fakeDb();
    await seedFeedback(db, new Date("2026-11-16T15:00:00Z"));
    expect(raw.appFeedback.deleteMany).toHaveBeenCalledOnce();
    for (const s of FEEDBACK_STATUSES) expect(rows.some((r) => r.status === s.value), s.value).toBe(true);
    for (const k of FEEDBACK_KINDS) expect(rows.some((r) => r.kind === k.value), k.value).toBe(true);
    expect(rows.filter((r) => r.status === "new").length).toBeGreaterThanOrEqual(2);
  });

  it("links staff notes to the staff login, has a reply to show, and one screenshot", async () => {
    const { db, rows } = fakeDb();
    await seedFeedback(db, new Date("2026-11-16T15:00:00Z"));
    expect(rows.some((r) => r.userId === "u-line" && r.note)).toBe(true);
    const shot = rows.filter((r) => r.photo);
    expect(shot).toHaveLength(1);
    expect(shot[0].photoMime).toBe("image/png");
    expect(shot[0].photo![0]).toBe(0x89);
    for (const r of rows) expect(r.createdAt.getTime()).toBeLessThan(Date.parse("2026-11-16T15:00:00Z"));
  });
});
