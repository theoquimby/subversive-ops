import { PageHeader } from "@/components/ui";
import { navItemFor } from "@/lib/areas";
import { requireUser } from "@/server/auth";
import { feedbackInbox } from "@/server/services/feedback";
import { FeedbackInbox, type InboxRow } from "./inbox";

export const metadata = { title: "Feedback" };

/** The part of the app a note came from, for the Page area filter ("Kegs & taps", "Settings"…). */
function areaOf(path: string | null): string {
  if (!path) return "Not recorded";
  const item = navItemFor(path);
  if (item) return item.heading ?? item.label;
  const first = path.split(/[?#]/)[0].split("/").filter(Boolean)[0];
  return first ? first[0].toUpperCase() + first.slice(1).replace(/-/g, " ") : "Overview";
}

export default async function FeedbackInboxPage() {
  await requireUser("MANAGER");
  const notes = await feedbackInbox();
  const rows: InboxRow[] = notes.map((n) => ({ ...n, area: areaOf(n.path) }));
  return (
    <div className="max-w-6xl">
      <PageHeader
        back={{ href: "/settings", label: "Settings" }}
        help="settings.feedback"
        title="Feedback"
        description="Ideas, problems, questions and praise sent from the Feedback button, each with the page it came from. Reply and the sender sees it."
      />
      <FeedbackInbox rows={rows} />
    </div>
  );
}
