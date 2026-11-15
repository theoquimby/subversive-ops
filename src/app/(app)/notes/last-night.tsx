import Link from "next/link";
import { ChevronRight, NotebookPen } from "lucide-react";
import { HelpTip, HelpZone } from "@/components/help";
import { Card, cx, Section } from "@/components/ui";
import { addDays } from "@/domain/dates";
import { needsFollowUp, noteSummary, shiftLabel } from "@/domain/shiftNotes";
import { dayDate } from "@/lib/format";
import { businessToday } from "@/server/services/sales";
import { lastNight } from "@/server/services/shiftNotes";

/**
 * Last night's shift notes for the Overview: one line per note, follow-ups
 * marked. Renders nothing when nobody wrote one.
 */
export async function LastNightNotes() {
  const today = businessToday();
  const notes = await lastNight(today).catch((e) => {
    console.error("overview: shift notes failed", e);
    return [];
  });
  if (!notes.length) return null;
  const date = notes.find((n) => n.date < today)?.date ?? today;
  const title = date === addDays(today, -1) ? "Last night" : date === today ? "Today's notes" : `Notes from ${dayDate(date)}`;
  const follow = notes.filter((n) => needsFollowUp(n)).length;
  return (
    <HelpZone id="overview.notes" tour="overview.notes" className="mb-10">
      <Section
        title={<span className="inline-flex items-center gap-1.5">{title} <HelpTip id="overview.notes" /></span>}
        actions={<Link href="/notes" className="relative text-sm text-muted transition-colors hover:text-ink after:absolute after:-inset-2 after:content-['']">All notes →</Link>}
        className="mb-0"
      >
        <Card className="divide-y divide-border">
          {notes.slice(0, 4).map((n) => {
            const f = needsFollowUp(n);
            return (
              <Link key={n.id} href={f ? "/notes?follow=1" : "/notes"} className="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors duration-120 first:rounded-t-xl last:rounded-b-xl hover:bg-surface-2/60">
                <span aria-hidden className={cx("grid size-8 shrink-0 place-items-center rounded-lg", f ? "bg-warn-bg text-warn" : "bg-surface-2 text-ink-2")}><NotebookPen className="size-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-sm font-medium text-ink">
                    <span className="truncate">{shiftLabel(n.shift)} · {n.authorName}</span>
                    {f && <span className="shrink-0 rounded-md bg-warn-bg px-1.5 py-0.5 text-[11px] font-medium text-warn">Follow up</span>}
                  </span>
                  <span className="block truncate text-xs text-muted">{noteSummary(n)}</span>
                </span>
                <ChevronRight aria-hidden className="size-4 shrink-0 text-muted" />
              </Link>
            );
          })}
        </Card>
        {follow > 1 && <p className="mt-2 text-xs text-muted">{follow} notes have something to follow up.</p>}
      </Section>
    </HelpZone>
  );
}
