import "server-only";
import { dayDate } from "@/lib/format";
import { shiftLabel } from "@/domain/schedule";
import { db } from "../db";
import { teamNoteEmail } from "../email/templates/team-note";
import { appUrl, notify, notifyStaffRequest, notifySwapDecided, type Delivery, type NotifyResult, type Recipient } from "./notify";
import { shiftView } from "./scheduling";
import { candidatesFor, weekCache } from "./swaps";

/**
 * Notifications for swaps, shout-outs, onboarding and team messages. Same
 * pipe as everything else (services/notify → prefs → email + push), so local
 * dev without Resend keys or VAPID keys just skips sending.
 */

const quiet = async (event: Parameters<typeof notify>[0], build: () => Promise<Delivery[]>): Promise<NotifyResult | null> => {
  try {
    return await notify(event, await build());
  } catch (e) {
    console.error(`notify ${event} failed`, e);
    return null;
  }
};

const who = (e: { userId: string | null; name: string; email: string | null }): Recipient => ({ userId: e.userId, name: e.name, email: e.email });

async function managers(): Promise<Recipient[]> {
  const users = await db.user.findMany({ where: { role: "MANAGER", active: true }, select: { id: true, name: true } });
  const emps = await db.employee.findMany({ where: { userId: { in: users.map((u) => u.id) } }, select: { userId: true, email: true } });
  return users.map((u) => ({ userId: u.id, name: u.name, email: emps.find((e) => e.userId === u.id)?.email ?? null }));
}

const shiftRow = (s: { start: Date; end: Date; breakMinutes: number; id: string; employeeId: string | null; positionId: string; notes: string | null; published: boolean }, position: string) => {
  const v = shiftView(s);
  return { title: dayDate(v.date), detail: position, value: shiftLabel(v.startMin, v.endMin) };
};

/** A shift was posted: the person asked, or every coworker who could take it. */
export function notifyShiftOffer(swapId: string) {
  return quiet("shiftOffers", async () => {
    const sw = await db.shiftSwap.findUnique({ where: { id: swapId }, include: { shift: { include: { position: true } }, requester: { select: { name: true } }, taker: { select: { id: true, name: true, email: true, userId: true } } } });
    if (!sw || sw.status !== "PENDING" || sw.kind === "PICKUP") return [];
    const from = sw.requester.name.split(" ")[0];
    const row = shiftRow(sw.shift, sw.shift.position.name);
    const base = appUrl();
    const trade = sw.kind === "SWAP";
    const build = (to: Recipient, asked: boolean): Delivery => {
      const title = asked ? `${from} asked you to ${trade ? "trade" : "cover"}` : trade ? "A shift up for trade" : "A shift you could take";
      const line = asked ? `${from} asked you to ${trade ? "trade shifts" : "take this shift"}. Open it to say yes or no.` : `${from} can't make this one${trade ? " and wants to trade" : ""}. You're free and set up for it.`;
      return {
        to,
        email: teamNoteEmail({ name: to.name, subject: `${from} ${trade ? "wants to trade" : "is giving away"} ${row.title}`, title, lines: [line, ...(sw.note ? [`“${sw.note}”`] : [])], rows: [row], action: { path: "/my/shifts#board", label: "See the shift" }, audience: "staff", baseUrl: base }),
        push: { title, body: `${row.title} · ${row.value} · ${row.detail}`, url: "/my/shifts#board", tag: `swap-offer-${sw.id}` },
      };
    };
    if (sw.taker) return [build(who(sw.taker), true)];
    if (sw.kind === "DROP") return [];
    const cands = (await candidatesFor(shiftView(sw.shift), [sw.requesterId], weekCache())).filter((c) => c.check.eligible);
    const people = await db.employee.findMany({ where: { id: { in: cands.map((c) => c.id) } }, select: { name: true, email: true, userId: true } });
    return people.map((p) => build(who(p), false));
  });
}

/** Someone claimed (or a drop/pickup is waiting): managers hear it; the requester hears who's taking it. */
export function notifySwapClaimed(swapId: string, auto: boolean) {
  return Promise.all([
    auto ? notifySwapOutcome(swapId) : notifyStaffRequest({ swapId }),
    quiet("shiftOffers", async () => {
      const sw = await db.shiftSwap.findUnique({ where: { id: swapId }, include: { shift: { include: { position: true } }, requester: { select: { name: true, email: true, userId: true } }, taker: { select: { name: true } } } });
      if (!sw || auto || sw.kind === "PICKUP" || sw.kind === "DROP" || !sw.taker) return [];
      const row = shiftRow(sw.shift, sw.shift.position.name);
      const title = `${sw.taker.name.split(" ")[0]} will take your shift`;
      return [{ to: who(sw.requester), email: teamNoteEmail({ name: sw.requester.name, subject: title, title, lines: ["A manager just needs to approve it — it's yours until then."], rows: [row], action: { path: "/my/shifts", label: "Open my shifts" }, audience: "staff", baseUrl: appUrl() }), push: { title, body: `${row.title} · ${row.value}. Waiting on a manager.`, url: "/my/shifts", tag: `swap-${sw.id}` } }];
    }),
  ]);
}

/** Approved or not: everyone involved hears it (a pickup only tells the person who picked it up). */
export function notifySwapOutcome(swapId: string) {
  return (async () => {
    const sw = await db.shiftSwap.findUnique({ where: { id: swapId }, include: { shift: { include: { position: true } }, taker: { select: { name: true, email: true, userId: true } }, requester: { select: { name: true, email: true, userId: true } } } });
    if (!sw || sw.status === "PENDING" || sw.status === "CANCELLED") return null;
    if (sw.kind === "GIVE" || sw.kind === "SWAP") return notifySwapDecided(swapId);
    return quiet("shiftChanges", async () => {
      const row = shiftRow(sw.shift, sw.shift.position.name);
      const ok = sw.status === "APPROVED";
      if (sw.kind === "DROP") {
        const title = ok ? "You're off that shift" : "Your drop wasn't approved";
        return [{ to: who(sw.requester), email: teamNoteEmail({ name: sw.requester.name, subject: `${title}: ${row.title}`, title, status: { label: ok ? "Approved" : "Not approved", tone: ok ? "good" : "bad" }, lines: [ok ? "It's off your schedule and open for others to pick up." : "You're still on it. Talk to a manager if you can't make it."], rows: [row], action: { path: "/my/shifts", label: "Open my shifts" }, audience: "staff", baseUrl: appUrl() }), push: { title, body: `${row.title} · ${row.value}`, url: "/my/shifts", tag: `swap-${sw.id}` } }];
      }
      if (!sw.taker) return [];
      const title = ok ? "The shift is yours" : "That pickup wasn't approved";
      return [{ to: who(sw.taker), email: teamNoteEmail({ name: sw.taker.name, subject: `${title}: ${row.title}`, title, status: { label: ok ? "Approved" : "Not approved", tone: ok ? "good" : "bad" }, lines: [ok ? "It's on your schedule." : "It stays open for now — talk to a manager if you'd like it."], rows: [row], action: { path: "/my/shifts", label: "Open my shifts" }, audience: "staff", baseUrl: appUrl() }), push: { title, body: `${row.title} · ${row.value}`, url: "/my/shifts", tag: `swap-${sw.id}` } }];
    });
  })();
}

/** A shout-out lands: the person thanked hears it. */
export function notifyShoutout(id: string) {
  return quiet("recognition", async () => {
    const s = await db.shoutout.findUnique({ where: { id }, include: { employee: { select: { name: true, email: true, userId: true } } } });
    if (!s || s.hidden) return [];
    const title = `${s.fromName.split(" ")[0]} gave you a shout-out`;
    return [{ to: who(s.employee), email: teamNoteEmail({ name: s.employee.name, subject: title, title: "You got a shout-out", status: s.value ? { label: s.value, tone: "good" } : undefined, lines: [`“${s.body}” — ${s.fromName}`], action: { path: "/my/kudos", label: "See it" }, audience: "staff", baseUrl: appUrl() }), push: { title, body: s.body.slice(0, 140), url: "/my/kudos", tag: `shoutout-${s.id}` } }];
  });
}

export function notifyRedemptionDecided(id: string) {
  return quiet("recognition", async () => {
    const r = await db.rewardRedemption.findUnique({ where: { id }, include: { reward: { select: { name: true } }, employee: { select: { name: true, email: true, userId: true } } } });
    if (!r || r.status === "PENDING") return [];
    const ok = r.status === "APPROVED";
    const title = ok ? `${r.reward.name} is yours` : `${r.reward.name} wasn't approved`;
    return [{ to: who(r.employee), email: teamNoteEmail({ name: r.employee.name, subject: title, title, lines: [ok ? "Ask a manager to hand it over." : "Your points are back in your balance."], action: { path: "/my/kudos", label: "Open" }, audience: "staff", baseUrl: appUrl() }), push: { title, body: ok ? "Ask a manager to hand it over." : "Your points are back.", url: "/my/kudos", tag: `reward-${r.id}` } }];
  });
}

/** A staff message (or a reward request, or a finished new-hire checklist) for managers. */
export function notifyManagersNote(args: { subject: string; title: string; line: string; path: string; tag: string }) {
  return quiet("teamMessages", async () => {
    const base = appUrl();
    return (await managers()).map((m) => ({ to: m, email: teamNoteEmail({ name: m.name, subject: args.subject, title: args.title, lines: [args.line], action: { path: args.path, label: "Open" }, audience: "manager", baseUrl: base }), push: { title: args.title, body: args.line.slice(0, 160), url: args.path, tag: args.tag } }));
  });
}

/** A manager replied to a staff message. */
export function notifyMessageReply(id: string) {
  return quiet("recognition", async () => {
    const m = await db.staffMessage.findUnique({ where: { id }, include: { employee: { select: { name: true, email: true, userId: true } } } });
    if (!m?.reply) return [];
    const title = `${m.repliedBy?.split(" ")[0] ?? "A manager"} replied`;
    return [{ to: who(m.employee), email: teamNoteEmail({ name: m.employee.name, subject: title, title, lines: [m.reply], action: { path: "/my/message", label: "Open" }, audience: "staff", baseUrl: appUrl() }), push: { title, body: m.reply.slice(0, 160), url: "/my/message", tag: `msg-${m.id}` } }];
  });
}
