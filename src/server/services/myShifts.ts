import "server-only";
import { positionColor } from "@/domain/positionColors";
import { shiftLabel, shiftPaidHours } from "@/domain/schedule";
import { parseSwapLog, swapStage, type SwapKind, type SwapStage } from "@/domain/swaps";
import { db } from "../db";
import { shiftView } from "./scheduling";
import { checkTaker, getSwapRules, weekCache } from "./swaps";

/**
 * Everything the staff swap board needs for one person: their upcoming
 * shifts (and what they've offered), shifts they could take with a yes/no
 * and why, what's waiting on them or a manager, and their swap history.
 */

export interface BoardShift {
  id: string;
  date: string;
  startMin: number;
  endMin: number;
  hours: number;
  position: string;
  positionId: string;
  color: string;
  notes: string | null;
}

type DbShift = { id: string; employeeId: string | null; positionId: string; start: Date; end: Date; breakMinutes: number; notes: string | null; published: boolean; position: { name: string; color: string } };

const asBoard = (s: DbShift): BoardShift => {
  const v = shiftView(s);
  return { id: s.id, date: v.date, startMin: v.startMin, endMin: v.endMin, hours: shiftPaidHours(v), position: s.position.name, positionId: s.positionId, color: positionColor(s.position.color), notes: s.notes };
};

const label = (s: BoardShift) => `${new Date(`${s.date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })} · ${shiftLabel(s.startMin, s.endMin)}`;

export async function myShiftsBoard(me: { id: string; positions: { positionId: string }[] }, now = new Date()) {
  const posIds = me.positions.map((p) => p.positionId);
  const shiftInclude = { position: { select: { name: true, color: true } } } as const;
  const [mineRaw, openRaw, postedRaw, asksRaw, waitingRaw, historyRaw, rules] = await Promise.all([
    db.shift.findMany({
      where: { employeeId: me.id, published: true, end: { gte: now } },
      orderBy: { start: "asc" },
      take: 40,
      include: { ...shiftInclude, swaps: { where: { status: "PENDING", kind: { not: "PICKUP" } }, include: { taker: { select: { name: true } }, offeredShift: { include: shiftInclude } } } },
    }),
    db.shift.findMany({ where: { employeeId: null, published: true, start: { gte: now }, positionId: { in: posIds }, swaps: { none: { status: "PENDING", kind: "PICKUP" } } }, orderBy: { start: "asc" }, take: 30, include: shiftInclude }),
    db.shiftSwap.findMany({
      where: { status: "PENDING", takerId: null, kind: { in: ["GIVE", "SWAP"] }, requesterId: { not: me.id }, shift: { start: { gte: now }, positionId: { in: posIds } } },
      include: { shift: { include: shiftInclude }, requester: { select: { name: true } } },
      orderBy: { shift: { start: "asc" } },
      take: 30,
    }),
    db.shiftSwap.findMany({ where: { status: "PENDING", takerId: me.id, claimedAt: null, requesterId: { not: me.id }, shift: { start: { gte: now } } }, include: { shift: { include: shiftInclude }, requester: { select: { name: true } } } }),
    db.shiftSwap.findMany({ where: { status: "PENDING", takerId: me.id, claimedAt: { not: null }, shift: { start: { gte: now } } }, include: { shift: { include: shiftInclude }, requester: { select: { name: true } }, offeredShift: { include: shiftInclude } } }),
    db.shiftSwap.findMany({
      where: { status: { not: "PENDING" }, OR: [{ requesterId: me.id }, { takerId: me.id }] },
      orderBy: { createdAt: "desc" },
      take: 15,
      include: { shift: { include: shiftInclude }, requester: { select: { name: true } }, taker: { select: { name: true } } },
    }),
    getSwapRules(),
  ]);

  const cache = weekCache();
  const mine = mineRaw.map((s) => {
    const sw = s.swaps[0];
    return {
      ...asBoard(s),
      swap: sw ? { id: sw.id, kind: sw.kind as SwapKind, stage: swapStage(sw), taker: sw.taker?.name ?? null, offered: sw.offeredShift ? label(asBoard(sw.offeredShift)) : null } : null,
    };
  });
  // My shifts I could give back in a trade: upcoming, not already offered.
  const tradeable = mine.filter((s) => !s.swap);

  const open = await Promise.all(openRaw.map(async (s) => ({ ...asBoard(s), check: await checkTaker(shiftView(s), me.id, cache) })));
  const posted = await Promise.all(
    postedRaw.map(async (w) => {
      const shift = asBoard(w.shift);
      const check = await checkTaker(shiftView(w.shift), me.id, cache);
      // For a trade: which of my shifts they could take in return (and I could give up).
      const trades = w.kind === "SWAP"
        ? (await Promise.all(tradeable.map(async (t) => {
            const theirs = mineRaw.find((m) => m.id === t.id)!;
            const back = await checkTaker(shiftView(theirs), w.requesterId, cache, w.shiftId);
            const meCheck = await checkTaker(shiftView(w.shift), me.id, cache, t.id);
            return back.eligible && meCheck.eligible ? { id: t.id, label: label(t) } : null;
          }))).filter((x): x is { id: string; label: string } => !!x)
        : [];
      return { swapId: w.id, kind: w.kind as SwapKind, from: w.requester.name, note: w.note, shift, check, trades };
    }),
  );
  const asks = await Promise.all(
    asksRaw.map(async (w) => {
      const check = await checkTaker(shiftView(w.shift), me.id, cache);
      const trades = w.kind === "SWAP"
        ? (await Promise.all(tradeable.map(async (t) => {
            const theirs = mineRaw.find((m) => m.id === t.id)!;
            const back = await checkTaker(shiftView(theirs), w.requesterId, cache, w.shiftId);
            return back.eligible ? { id: t.id, label: label(t) } : null;
          }))).filter((x): x is { id: string; label: string } => !!x)
        : [];
      return { swapId: w.id, kind: w.kind as SwapKind, from: w.requester.name, note: w.note, shift: asBoard(w.shift), check, trades };
    }),
  );
  const waiting = waitingRaw.map((w) => ({ swapId: w.id, kind: w.kind as SwapKind, from: w.kind === "PICKUP" ? null : w.requester.name, shift: asBoard(w.shift), giving: w.offeredShift ? label(asBoard(w.offeredShift)) : null }));
  const history = historyRaw.map((w) => {
    const log = parseSwapLog(w.log);
    const mineOut = w.requesterId === me.id && w.kind !== "PICKUP";
    return {
      id: w.id,
      kind: w.kind as SwapKind,
      stage: swapStage(w) as SwapStage,
      shift: label(asBoard(w.shift)),
      position: w.shift.position.name,
      other: mineOut ? (w.taker?.name ?? null) : w.kind === "PICKUP" ? null : w.requester.name,
      direction: mineOut ? ("out" as const) : ("in" as const),
      at: (w.decidedAt ?? w.createdAt).toISOString(),
      auto: w.autoApproved,
      log: log.slice(-4),
    };
  });
  return { mine, open, posted, asks, waiting, history, rules };
}

export type MyShiftsBoard = Awaited<ReturnType<typeof myShiftsBoard>>;
