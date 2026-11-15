import { HelpZone } from "@/components/help";
import { cx, LinkButton, PageHeader, Section, Stat } from "@/components/ui";
import { addDays } from "@/domain/dates";
import { OPEN_STAGES } from "@/domain/privateEvents";
import { money } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { getPrivateEventConfig, listPrivateEvents } from "@/server/services/privateEvents";
import { businessToday } from "@/server/services/sales";
import Link from "next/link";
import { NewInquiry, PipelineBoard, PipelineTable } from "./pipeline-client";

export const metadata = { title: "Private events" };

export default async function PrivateEventsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  await requireUser("MANAGER");
  const { view: v } = await searchParams;
  const view = v === "board" ? "board" : "table";
  const today = businessToday();
  const [rows, cfg, users] = await Promise.all([
    listPrivateEvents(),
    getPrivateEventConfig(),
    db.user.findMany({ where: { active: true, role: "MANAGER" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const open = rows.filter((r) => (OPEN_STAGES as readonly string[]).includes(r.stage) && (!r.date || r.date >= today));
  const pipeline = open.filter((r) => r.stage === "INQUIRY" || r.stage === "QUOTED");
  const booked = open.filter((r) => (r.stage === "DEPOSIT" || r.stage === "CONFIRMED") && r.date && r.date < addDays(today, 60));
  const owed = rows.filter((r) => r.stage !== "LOST" && r.paid > 0 && r.balance > 0.005).reduce((s, r) => s + r.balance, 0);
  const depositsOut = open.filter((r) => r.stage === "QUOTED" && r.deposit > r.paid + 0.005);
  const decided = rows.filter((r) => r.stage === "LOST" || r.stage === "DONE" || r.stage === "CONFIRMED" || r.stage === "DEPOSIT");
  const winRate = decided.length >= 3 ? decided.filter((r) => r.stage !== "LOST").length / decided.length : null;

  return (
    <>
      <PageHeader
        help="events.private.page"
        back={{ href: "/events", label: "Events" }}
        title="Private events"
        description="Parties, buyouts, rehearsal dinners and corporate nights — from first inquiry to paid in full. Confirmed bookings go on the events calendar and into the forecast."
        actions={
          <>
            <LinkButton href="/events/private/setup" data-tour="private.setup-link">Packages & defaults</LinkButton>
          </>
        }
      />

      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="In the pipeline" value={money(pipeline.reduce((s, r) => s + r.total, 0), { whole: true })} hint={`${pipeline.length} inquir${pipeline.length === 1 ? "y" : "ies"} and quotes`} help="events.private.stats" />
        <Stat label="Booked, next 60 days" value={booked.length} hint={booked.length ? `${booked.reduce((s, r) => s + r.headcount, 0)} guests · ${money(booked.reduce((s, r) => s + r.total, 0), { whole: true })}` : "Nothing booked yet"} />
        <Stat label="Deposits waiting" value={depositsOut.length} hint={depositsOut.length ? money(depositsOut.reduce((s, r) => s + r.deposit - r.paid, 0), { whole: true }) : "All caught up"} tone={depositsOut.length ? "warn" : undefined} />
        <Stat label="Balances owed" value={money(owed, { whole: true })} hint={winRate != null ? `Win rate ${Math.round(winRate * 100)}%` : "After deposits"} />
      </div>

      <Section title="New inquiry" description="Just the basics — fill in the rest as it firms up.">
        <HelpZone id="events.private.new" tour="private.new">
          <NewInquiry spaces={cfg.spaces.map((s) => s.name)} today={today} />
        </HelpZone>
      </Section>

      <Section
        title="Bookings"
        actions={
          <div role="tablist" aria-label="View" className="inline-flex rounded-lg border border-border-strong bg-surface p-0.5" data-tour="private.view">
            {(["table", "board"] as const).map((k) => (
              <Link key={k} role="tab" aria-selected={view === k} href={k === "table" ? "/events/private" : "/events/private?view=board"} scroll={false} className={cx("inline-flex h-9 items-center rounded-md px-3 text-sm sm:h-8", view === k ? "bg-primary text-primary-ink" : "text-ink-2 hover:bg-surface-2")}>
                {k === "table" ? "Table" : "Board"}
              </Link>
            ))}
          </div>
        }
      >
        <HelpZone id={view === "board" ? "events.private.board" : "events.private.table"} tour="private.bookings">
          {view === "board" ? <PipelineBoard rows={rows} today={today} /> : <PipelineTable rows={rows} today={today} spaces={cfg.spaces.map((s) => s.name)} owners={users} />}
        </HelpZone>
      </Section>
    </>
  );
}
