import { HelpZone } from "@/components/help";
import { PageHeader } from "@/components/ui";
import { EVENT_TYPE_LABEL } from "@/domain/privateEvents";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { emailReady } from "@/server/integrations/email";
import { clashesFor, getPrivateEvent, quoteCatalog } from "@/server/services/privateEvents";
import { businessToday } from "@/server/services/sales";
import { isSquareConnected } from "@/server/services/square";
import { notFound } from "next/navigation";
import { DangerZone, DetailsCard, PaymentsCard, QuoteBuilder, ShareCard, StageStepper, TotalsCard } from "./detail-client";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const e = await db.privateEvent.findUnique({ where: { id }, select: { clientName: true, company: true } });
  return { title: e ? e.company || e.clientName : "Private event" };
}

export default async function PrivateEventPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser("MANAGER");
  const { id } = await params;
  const [ev, catalog, users, canEmail, square] = await Promise.all([
    getPrivateEvent(id),
    quoteCatalog(),
    db.user.findMany({ where: { active: true, role: "MANAGER" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    emailReady(),
    isSquareConnected().catch(() => false),
  ]);
  if (!ev) notFound();
  const today = businessToday();
  const r = ev.row;
  const clashes = r.stage === "LOST" ? [] : await clashesFor({ id: r.id, date: r.date, space: r.space, startTime: r.startTime, endTime: r.endTime, type: r.type });

  return (
    <>
      <PageHeader
        help="events.private.detail"
        back={{ href: "/events/private", label: "Private events" }}
        title={r.title}
        description={[EVENT_TYPE_LABEL[r.type], r.company ? r.clientName : null, r.headcount ? `${r.headcount} guests` : null, r.space].filter(Boolean).join(" · ")}
      />
      <HelpZone id="events.private.stages" tour="private.stages" className="mb-6">
        <StageStepper id={r.id} stage={r.stage} />
      </HelpZone>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-8">
          <DetailsCard row={r} spaces={ev.config.spaces} owners={users} today={today} clashes={clashes} />
          <HelpZone id="events.private.quote" tour="private.quote">
            <QuoteBuilder ev={ev} catalog={catalog} />
          </HelpZone>
        </div>
        <div className="min-w-0 space-y-6 lg:sticky lg:top-4 lg:self-start">
          <HelpZone id="events.private.totals" tour="private.totals">
            <TotalsCard ev={ev} />
          </HelpZone>
          <HelpZone id="events.private.share" tour="private.share">
            <ShareCard ev={ev} canEmail={canEmail} />
          </HelpZone>
          <HelpZone id="events.private.payments" tour="private.payments">
            <PaymentsCard ev={ev} today={today} square={square} canEmail={canEmail} />
          </HelpZone>
          <DangerZone id={r.id} stage={r.stage} title={r.title} />
        </div>
      </div>
    </>
  );
}
