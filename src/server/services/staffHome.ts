import "server-only";
import { positionColor } from "@/domain/positionColors";
import type { ISODate } from "@/domain/dates";
import { localParts, shiftPaidHours } from "@/domain/schedule";
import { firstName, quickActionOrder, sortTodos, type QuickAction, type Todo } from "@/domain/staffHome";
import { shortDate } from "@/lib/format";
import { db } from "../db";
import { documentScope } from "./documents";
import { businessToday } from "./sales";
import { listAnnouncements, shiftView, TZ } from "./scheduling";
import { myTraining } from "./training";
import { onboardingsWithProgress } from "./newHires";

export interface HomeShift {
  id: string;
  date: ISODate;
  startMin: number;
  endMin: number;
  /** Epoch ms, for the live countdown. */
  startAt: number;
  endAt: number;
  hours: number;
  position: string;
  color: string;
  notes: string | null;
  swapPending: boolean;
}

export interface CrewMember {
  name: string;
  position: string;
  color: string;
  startMin: number;
  endMin: number;
}

export interface StaffHome {
  name: string;
  today: ISODate;
  hour: number;
  next: HomeShift | null;
  crew: CrewMember[];
  later: HomeShift[];
  /** Your shifts in the next 7 days. */
  week: { shifts: number; hours: number };
  todos: Todo[];
  waiting: string[];
  actions: QuickAction[];
  announcements: { id: string; body: string; author: string | null; pinned: boolean; createdAt: string }[];
  kudos: { body: string; author: string | null; createdAt: string } | null;
  /** Their new-hire checklist, while it's open. */
  onboarding: { done: number; total: number; requiredLeft: number; seen: boolean; dueOn: ISODate | null } | null;
}

/** Everything the staff "Today" view shows, in one round of queries. */
export async function staffHome(employee: { id: string; name: string; positions: { positionId: string; position: { name: string } }[] }, now = new Date()): Promise<StaffHome> {
  const today = businessToday();
  const posIds = employee.positions.map((p) => p.positionId);
  const weekEnd = new Date(now.getTime() + 7 * 86_400_000);
  const ackDocs = { ...documentScope("STAFF"), requiresAck: true, acks: { none: { employeeId: employee.id } } };

  const [asks, onboarding] = await Promise.all([
    db.shiftSwap.findMany({ where: { status: "PENDING", takerId: employee.id, claimedAt: null, requesterId: { not: employee.id }, shift: { start: { gte: now } } }, select: { kind: true, requester: { select: { name: true } }, shift: { select: { start: true } } }, orderBy: { shift: { start: "asc" } } }),
    onboardingsWithProgress({ employeeId: employee.id }).then((l) => l[0] ?? null).catch(() => null),
  ]);
  const [mine, openCount, board, toSign, training, myPendingSwaps, pendingOff, notes, kudos] = await Promise.all([
    db.shift.findMany({
      where: { employeeId: employee.id, published: true, end: { gt: now } },
      orderBy: { start: "asc" },
      take: 12,
      include: { position: { select: { name: true, color: true } }, swaps: { where: { status: "PENDING" }, select: { id: true } } },
    }),
    db.shift.count({ where: { employeeId: null, published: true, start: { gte: now }, positionId: { in: posIds }, swaps: { none: { status: "PENDING", kind: "PICKUP" } } } }),
    db.shiftSwap.findMany({
      where: { status: "PENDING", takerId: null, kind: { in: ["GIVE", "SWAP"] }, requesterId: { not: employee.id }, shift: { start: { gte: now }, positionId: { in: posIds } } },
      select: { requester: { select: { name: true } }, shift: { select: { start: true } } },
      orderBy: { shift: { start: "asc" } },
      take: 5,
    }),
    db.document.findMany({ where: ackDocs, select: { id: true, title: true }, orderBy: { createdAt: "asc" } }),
    myTraining(employee.id, today),
    db.shiftSwap.count({ where: { status: "PENDING", OR: [{ requesterId: employee.id, kind: { not: "PICKUP" } }, { takerId: employee.id, claimedAt: { not: null } }], shift: { start: { gte: now } } } }),
    db.timeOffRequest.count({ where: { employeeId: employee.id, status: "PENDING" } }),
    listAnnouncements(3),
    db.employeeFeedback.findFirst({
      where: { employeeId: employee.id, visibleToEmployee: true, kind: "PRAISE", createdAt: { gte: new Date(now.getTime() - 21 * 86_400_000) } },
      orderBy: { createdAt: "desc" },
      include: { author: { select: { name: true } } },
    }),
  ]);

  const view = (s: (typeof mine)[number]): HomeShift => {
    const v = shiftView(s);
    return { id: s.id, date: v.date, startMin: v.startMin, endMin: v.endMin, startAt: s.start.getTime(), endAt: s.end.getTime(), hours: shiftPaidHours(v), position: s.position.name, color: positionColor(s.position.color), notes: s.notes, swapPending: s.swaps.length > 0 };
  };
  const shifts = mine.map(view);
  const next = shifts[0] ?? null;

  // Who else is on: anyone whose published shift overlaps yours.
  const crewRows = next
    ? await db.shift.findMany({
        where: { published: true, employeeId: { not: null }, NOT: { employeeId: employee.id }, start: { lt: new Date(next.endAt) }, end: { gt: new Date(next.startAt) } },
        orderBy: { start: "asc" },
        include: { employee: { select: { name: true } }, position: { select: { name: true, color: true } } },
        take: 20,
      })
    : [];
  const crew = crewRows.map((s) => {
    const v = shiftView(s);
    return { name: s.employee!.name, position: s.position.name, color: positionColor(s.position.color), startMin: v.startMin, endMin: v.endMin };
  });

  const thisWeek = mine.filter((s) => s.start < weekEnd);
  const todos: Todo[] = [];
  if (toSign.length) {
    todos.push({
      kind: "sign",
      tone: "warn",
      title: toSign.length === 1 ? `Read and sign: ${toSign[0].title}` : `${toSign.length} documents to read and sign`,
      detail: toSign.length === 1 ? "Open it, then tap I've read this." : toSign.map((d) => d.title).join(" · "),
      href: "/my/me#documents",
    });
  }
  // Certificates: one row for everything missing or expired (it's one trip to the drawer), one per renewal coming up.
  const certsDue = training.certs.filter((c) => c.required && !(c.latest && !c.latest.verifiedAt) && c.status !== "valid" && c.status !== "not-required");
  const lacking = certsDue.filter((c) => c.status === "missing" || c.status === "expired");
  if (lacking.length === 1) {
    const c = lacking[0];
    todos.push({ kind: "cert", tone: "bad", title: c.status === "missing" ? `Upload your ${c.name}` : `${c.name} has expired`, detail: c.status === "missing" ? "Snap a photo of the card or certificate." : "Upload the renewal — a photo is fine.", href: "/my/me#training" });
  } else if (lacking.length > 1) {
    todos.push({ kind: "cert", tone: "bad", title: `${lacking.length} certificates to upload`, detail: lacking.map((c) => c.name).join(" · "), href: "/my/me#training" });
  }
  for (const c of certsDue.filter((x) => x.status === "expiring")) {
    todos.push({ kind: "cert", tone: "warn", title: `${c.name} expires ${c.daysLeft === 0 ? "today" : `in ${c.daysLeft} day${c.daysLeft === 1 ? "" : "s"}`}`, detail: "Upload the renewal — a photo is fine.", href: "/my/me#training" });
  }
  for (const a of training.checklists) {
    if (a.state === "signed-off" || a.state === "ready") continue;
    todos.push({
      kind: "training",
      tone: a.state === "overdue" ? "bad" : "warn",
      title: a.title,
      detail: `${a.done} of ${a.total} steps done${a.dueOn ? ` · ${a.state === "overdue" ? "was due" : "due"} ${shortDate(a.dueOn)}` : ""}`,
      href: "/my/me#training",
    });
  }
  for (const a of asks) {
    todos.push({
      kind: "swap",
      tone: "warn",
      title: `${firstName(a.requester.name)} asked you to ${a.kind === "SWAP" ? "trade" : "cover"} ${shortDate(localParts(a.shift.start, TZ).date)}`,
      detail: "Say yes or no — it only takes a tap.",
      href: "/my/shifts",
    });
  }
  if (board.length) {
    const first = board[0];
    const d = localParts(first.shift.start, TZ).date;
    todos.push({
      kind: "swap",
      tone: "neutral",
      title: board.length === 1 ? `${firstName(first.requester.name)} wants to give away ${shortDate(d)}` : `${board.length} teammates want to give away a shift`,
      detail: "Take it if you can — we check your hours for you.",
      href: "/my/shifts#open",
    });
  }
  if (openCount) {
    todos.push({ kind: "open", tone: "neutral", title: `${openCount} open shift${openCount === 1 ? "" : "s"} you can pick up`, detail: "First to tap gets it.", href: "/my/shifts#open" });
  }

  const waiting: string[] = [];
  if (myPendingSwaps) waiting.push(`${myPendingSwaps} swap${myPendingSwaps === 1 ? "" : "s"}`);
  if (pendingOff) waiting.push(`${pendingOff} time-off request${pendingOff === 1 ? "" : "s"}`);

  return {
    name: firstName(employee.name),
    today,
    hour: Math.floor(localParts(now, TZ).minutes / 60),
    next,
    crew,
    later: shifts.slice(1, 4),
    week: { shifts: thisWeek.length, hours: thisWeek.reduce((a, s) => a + shiftPaidHours(shiftView(s)), 0) },
    todos: sortTodos(todos),
    waiting,
    actions: quickActionOrder(employee.positions.map((p) => p.position.name)),
    // Scheduled notes are left out until they start; then they're dated from the start.
    announcements: notes.map((n) => ({ id: n.id, body: n.body, author: n.author, pinned: n.pinned, createdAt: n.shownAt.toISOString() })),
    kudos: kudos ? { body: kudos.body, author: kudos.author?.name ?? null, createdAt: kudos.createdAt.toISOString() } : null,
    onboarding: onboarding && onboarding.status === "ACTIVE" ? { done: onboarding.progress.done, total: onboarding.progress.total, requiredLeft: onboarding.progress.requiredTotal - onboarding.progress.requiredDone, seen: !!onboarding.seenAt, dueOn: onboarding.dueOn } : null,
  };
}
