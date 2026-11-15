import Link from "next/link";
import { HelpZone } from "@/components/help";
import { Card, cx, EmptyState, PageHeader, Section } from "@/components/ui";
import { addDays } from "@/domain/dates";
import { defaultShift, shiftDateFor } from "@/domain/shiftNotes";
import { dayDate } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { env } from "@/server/env";
import { businessToday, localHour } from "@/server/services/sales";
import { noteHistory, usual86 } from "@/server/services/shiftNotes";
import { NoteComposer } from "./composer";
import { NoteCard } from "./note-card";
import { NoteSearch } from "./search";

export const metadata = { title: "Shift notes" };

export default async function NotesPage({ searchParams }: { searchParams: Promise<{ q?: string; follow?: string }> }) {
  const s = await requireUser();
  const sp = await searchParams;
  const q = (sp.q ?? "").slice(0, 100);
  const follow = s.role === "MANAGER" && sp.follow === "1";
  const today = businessToday();
  const hour = localHour(new Date(), env.BUSINESS_TIMEZONE);
  const [{ notes, total }, usual] = await Promise.all([noteHistory({ q, followUps: follow, limit: 80 }), usual86()]);
  const viewer = { userId: s.userId, role: s.role };

  // Grouped by business date, newest first.
  const byDate = new Map<string, typeof notes>();
  for (const n of notes) byDate.set(n.date, [...(byDate.get(n.date) ?? []), n]);
  const label = (d: string) => (d === today ? "Today" : d === addDays(today, -1) ? `Yesterday · ${dayDate(d)}` : dayDate(d));

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader help="notes.page" title="Shift notes" description="The handoff from one shift to the next: what ran out, what broke, comps and the drawer. Managers see last night's in the morning brief." />

      <HelpZone id="notes.composer" tour="notes.composer" className="mb-10">
        <Section title={hour < 5 || hour >= 17 ? "Tonight's note" : "Your shift note"} description="Tap what fits, add a few words if you need to, save. Takes a minute.">
          <Card className="p-4 sm:p-5">
            <NoteComposer today={today} defaultDate={shiftDateFor(today, hour)} defaultShift={defaultShift(hour)} usual={usual} showDrawer />
          </Card>
        </Section>
      </HelpZone>

      <HelpZone id="notes.history" tour="notes.history">
        <section>
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-[0.95rem] font-semibold text-ink">History</h2>
            {s.role === "MANAGER" && (
              <div role="tablist" aria-label="Show" className="inline-flex gap-0.5 rounded-lg border border-border-strong bg-surface p-0.5">
                <Link role="tab" aria-selected={!follow} href={q ? `/notes?q=${encodeURIComponent(q)}` : "/notes"} scroll={false} className={cx("inline-flex h-9 items-center rounded-md px-3 text-sm sm:h-7", !follow ? "bg-primary text-primary-ink" : "text-ink-2 hover:bg-surface-2")}>All</Link>
                <Link role="tab" aria-selected={follow} href={`/notes?follow=1${q ? `&q=${encodeURIComponent(q)}` : ""}`} scroll={false} className={cx("inline-flex h-9 items-center rounded-md px-3 text-sm sm:h-7", follow ? "bg-primary text-primary-ink" : "text-ink-2 hover:bg-surface-2")}>To follow up</Link>
              </div>
            )}
          </div>
          <div className="mb-4">
            <NoteSearch initial={q} />
          </div>
          {notes.length === 0 ? (
            <EmptyState title={q ? `Nothing matches “${q}”` : follow ? "Nothing to follow up" : "No notes yet"}>
              {q ? "Try one word, like an item or a name." : follow ? "Every issue, fix and short drawer has been handled." : "The first one you save shows up here and in tomorrow's brief."}
            </EmptyState>
          ) : (
            <div className="space-y-8">
              {[...byDate].map(([date, list]) => (
                <div key={date}>
                  <h3 className="sticky top-14 z-[1] -mx-1 mb-2 bg-bg/90 px-1 py-1 text-xs font-medium tracking-wide text-muted uppercase backdrop-blur lg:top-0">{label(date)}</h3>
                  <div className="space-y-3">
                    {list.map((n) => <NoteCard key={n.id} note={n} viewer={viewer} today={today} usual={usual} showDate={false} />)}
                  </div>
                </div>
              ))}
              {total > notes.length && <p className="text-center text-xs text-muted">Showing the latest {notes.length} of {total}. Search to find older ones.</p>}
            </div>
          )}
        </section>
      </HelpZone>
    </div>
  );
}
