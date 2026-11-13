import "server-only";
import { db } from "../db";
import { documentScope } from "./documents";

/** Feedback, documents and acknowledgements per person, for /team. */
export async function teamPeopleData() {
  const [employees, feedback, docs] = await Promise.all([
    db.employee.findMany({ where: { active: true }, select: { id: true, name: true, userId: true }, orderBy: { name: "asc" } }),
    db.employeeFeedback.findMany({ orderBy: { createdAt: "desc" }, include: { author: { select: { name: true } } }, take: 500 }),
    db.document.findMany({ where: { active: true, requiresAck: true, audience: "STAFF" }, select: { id: true, title: true, createdAt: true, acks: { select: { employeeId: true, ackedAt: true } } }, orderBy: { createdAt: "asc" } }),
  ]);
  return {
    docs: docs.map((d) => ({ id: d.id, title: d.title })),
    people: employees.map((e) => {
      const mine = feedback.filter((f) => f.employeeId === e.id);
      return {
        id: e.id,
        name: e.name,
        hasLogin: !!e.userId,
        feedback: mine.map((f) => ({ id: f.id, kind: f.kind, body: f.body, visible: f.visibleToEmployee, author: f.author?.name ?? null, createdAt: f.createdAt.toISOString() })),
        acks: docs.map((d) => ({ docId: d.id, title: d.title, ackedAt: d.acks.find((a) => a.employeeId === e.id)?.ackedAt.toISOString() ?? null })),
      };
    }),
  };
}
export type TeamPeople = Awaited<ReturnType<typeof teamPeopleData>>;

/** What an employee sees on /my: shared feedback and staff documents with their ack state. */
export async function myPeopleData(employeeId: string) {
  const [feedback, docs] = await Promise.all([
    db.employeeFeedback.findMany({ where: { employeeId, visibleToEmployee: true }, orderBy: { createdAt: "desc" }, take: 20, include: { author: { select: { name: true } } } }),
    db.document.findMany({ where: documentScope("STAFF"), select: { id: true, title: true, kind: true, requiresAck: true, mime: true, size: true, createdAt: true, acks: { where: { employeeId }, select: { ackedAt: true } } }, orderBy: [{ requiresAck: "desc" }, { createdAt: "asc" }] }),
  ]);
  return {
    feedback: feedback.map((f) => ({ id: f.id, kind: f.kind, body: f.body, author: f.author?.name ?? null, createdAt: f.createdAt.toISOString() })),
    docs: docs.map((d) => ({ id: d.id, title: d.title, kind: d.kind, requiresAck: d.requiresAck, mime: d.mime, size: d.size, ackedAt: d.acks[0]?.ackedAt.toISOString() ?? null })),
  };
}
export type MyPeople = Awaited<ReturnType<typeof myPeopleData>>;

/** Manager list for /team/documents with ack counts. */
export async function documentList() {
  const [docs, staff] = await Promise.all([
    db.document.findMany({ where: { active: true }, select: { id: true, title: true, kind: true, mime: true, size: true, requiresAck: true, audience: true, uploadedBy: true, createdAt: true, filename: true, text: true, _count: { select: { acks: true } } }, orderBy: { createdAt: "desc" } }),
    db.employee.count({ where: { active: true } }),
  ]);
  return {
    staff,
    docs: docs.map((d) => ({ ...d, text: d.text ?? "", hasText: !!d.text?.trim(), createdAt: d.createdAt.toISOString(), acks: d._count.acks })),
  };
}
