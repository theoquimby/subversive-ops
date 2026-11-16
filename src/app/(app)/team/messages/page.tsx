import { PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { MessagesInbox } from "./messages-client";

export const metadata = { title: "Team messages" };

/** Questions, ideas and concerns staff sent from their phones. Reply here; they see it on Message a manager. */
export default async function TeamMessagesPage() {
  await requireUser("MANAGER");
  const rows = await db.staffMessage.findMany({ orderBy: [{ createdAt: "desc" }], take: 60, include: { employee: { select: { name: true } } } });
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader help="team.messages" back={{ href: "/team", label: "Team" }} title="Team messages" description="What staff sent from Message a manager. Ideas and concerns can come without a name. Reply and they see it on their phone." />
      <MessagesInbox
        items={rows.map((m) => ({ id: m.id, kind: m.kind, body: m.body, from: m.anonymous ? null : m.employee.name, read: !!m.readAt, reply: m.reply, repliedBy: m.repliedBy, at: m.createdAt.toISOString() }))}
      />
    </div>
  );
}
