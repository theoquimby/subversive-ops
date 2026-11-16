import { HelpZone } from "@/components/help";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { employeeForUser } from "@/server/services/scheduling";
import { MessageForm } from "./message-form";

export const metadata = { title: "Message a manager" };

const KIND: Record<string, string> = { QUESTION: "Question", IDEA: "Idea", CONCERN: "Concern", OTHER: "Note" };
const when = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });

/** Staff: send a question, idea or concern to the managers, and read their replies. */
export default async function MessagePage() {
  const session = await requireUser();
  const me = await employeeForUser(session.userId);
  if (!me) {
    return (
      <div className="mx-auto max-w-xl">
        <PageHeader help="my.message" title="Message a manager" back={{ href: "/my", label: "Today" }} />
        <EmptyState title="Your login isn't linked to a team member yet">Ask a manager to connect it on the Team page.</EmptyState>
      </div>
    );
  }
  const sent = await db.staffMessage.findMany({ where: { employeeId: me.id }, orderBy: { createdAt: "desc" }, take: 20 });
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-8">
      <PageHeader help="my.message" title="Message a manager" back={{ href: "/my", label: "Today" }} description="A question, an idea, a heads-up about a guest or something broken. Managers get it on their phone. Something urgent on shift? Tell a manager in person too." />
      <HelpZone id="my.message.form"><MessageForm /></HelpZone>
      <section aria-labelledby="sent-h">
        <h2 id="sent-h" className="mb-2.5 px-1 text-[0.95rem] font-semibold">What you&apos;ve sent</h2>
        {sent.length === 0 ? (
          <Card className="px-4 py-5 text-sm text-muted">Nothing yet. Replies show up here.</Card>
        ) : (
          <Card className="divide-y divide-border">
            {sent.map((m) => (
              <article key={m.id} className="px-4 py-3.5">
                <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted"><Badge>{KIND[m.kind] ?? "Note"}</Badge>{when(m.createdAt)}{m.anonymous ? " · name hidden" : ""}{!m.reply && (m.readAt ? " · read" : " · not read yet")}</p>
                <p className="mt-1.5 text-[0.95rem] leading-snug whitespace-pre-line text-ink">{m.body}</p>
                {m.reply && (
                  <div className="mt-2.5 rounded-xl bg-surface-2 px-3 py-2.5">
                    <p className="text-[0.9rem] leading-snug whitespace-pre-line text-ink">{m.reply}</p>
                    <p className="mt-1 text-xs text-muted">{m.repliedBy ?? "Manager"}{m.repliedAt ? ` · ${when(m.repliedAt)}` : ""}</p>
                  </div>
                )}
              </article>
            ))}
          </Card>
        )}
      </section>
    </div>
  );
}
