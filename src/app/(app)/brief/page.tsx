import Link from "next/link";
import { cx } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { getMorningHour } from "@/server/services/morningBrief";
import { refreshIfStale } from "@/server/services/square-sync";
import { MorningView } from "./morning";
import { SendTime } from "./send-time";
import { WeeklyView } from "./weekly";

export const metadata = { title: "Brief" };

/** /brief: the morning brief by default; ?view=week is the weekly brief. */
export default async function BriefPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const session = await requireUser("MANAGER");
  const view = (await searchParams).view === "week" ? "week" : "today";
  await refreshIfStale();
  const hour = view === "today" ? await getMorningHour().catch(() => 9) : null;

  const tab = (v: "today" | "week", label: string) => (
    <Link
      role="tab"
      aria-selected={view === v}
      href={v === "week" ? "/brief?view=week" : "/brief"}
      className={cx("inline-flex h-10 items-center rounded-md px-4 text-sm font-medium transition-colors sm:h-8", view === v ? "bg-primary text-primary-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink")}
    >
      {label}
    </Link>
  );

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Brief" data-tour="brief.tabs" className="inline-flex gap-0.5 rounded-lg border border-border-strong bg-surface p-0.5">
          {tab("today", "Today")}
          {tab("week", "This week")}
        </div>
        {hour != null && <SendTime hour={hour} />}
      </div>
      {view === "week" ? <WeeklyView name={session.name} /> : <MorningView name={session.name} viewer={{ userId: session.userId, role: session.role }} />}
    </div>
  );
}
