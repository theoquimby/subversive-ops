"use client";

import { HelpZone } from "@/components/help";
import { RelativeTime } from "@/components/relative-time";
import { Badge, Card, EmptyState, LinkButton, Section } from "@/components/ui";
import { STAGE_LABEL, isStage } from "@/domain/privateEvents";
import { dayDate } from "@/lib/format";
import type { InquiryRow } from "@/server/services/websiteInquiries";
import { ChevronRight, Mail, Phone } from "lucide-react";
import { useEffect } from "react";
import { markInquiriesSeen } from "../actions";

/** Inquiries from the website form, newest first. Opening the tab marks them seen. */
export function InquiriesTab({ rows }: { rows: InquiryRow[] }) {
  useEffect(() => {
    const unseen = rows.filter((r) => !r.seen).map((r) => r.id);
    if (unseen.length) void markInquiriesSeen(unseen);
  }, [rows]);

  return (
    <HelpZone id="website.inquiries" tour="website.inquiries">
      <Section
        title="Private event inquiries"
        description="Sent from the form on the website. Each one is already on the private events board as an inquiry, so quoting, deposits and the calendar work as usual."
        actions={<LinkButton href="/events/private" variant="ghost" size="sm" className="hidden sm:inline-flex">Private events <ChevronRight className="size-4" /></LinkButton>}
      >
        {rows.length === 0 ? (
          <EmptyState title="No inquiries yet">When someone asks about a party or a buyout on the website, it shows up here and on Private events, and managers get a notification.</EmptyState>
        ) : (
          <div className="space-y-3">
            {rows.map((r) => (
              <Card key={r.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{r.name}</span>
                      {!r.seen && <Badge tone="warn">New</Badge>}
                      {r.stage && isStage(r.stage) && <Badge>{STAGE_LABEL[r.stage]}</Badge>}
                    </div>
                    <div className="mt-0.5 text-sm text-ink-2">{[r.type, r.date ? dayDate(r.date) : null, r.guests ? `${r.guests} guests` : null].filter(Boolean).join(" · ") || "No details given"}</div>
                  </div>
                  <RelativeTime at={r.createdAt} className="text-xs text-muted" />
                </div>
                {r.message && <p className="mt-2 text-sm whitespace-pre-line text-ink-2">{r.message}</p>}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {r.email && <a href={`mailto:${r.email}`} className="inline-flex h-10 items-center gap-1.5 rounded-lg px-2 text-sm text-ink-2 hover:bg-surface-2 sm:h-8"><Mail className="size-4" />{r.email}</a>}
                  {r.phone && <a href={`tel:${r.phone.replace(/[^\d+]/g, "")}`} className="inline-flex h-10 items-center gap-1.5 rounded-lg px-2 text-sm text-ink-2 hover:bg-surface-2 sm:h-8"><Phone className="size-4" />{r.phone}</a>}
                  <span className="flex-1" />
                  {r.privateEventId ? <LinkButton href={`/events/private/${r.privateEventId}`} size="sm">Open booking <ChevronRight className="size-4" /></LinkButton> : <span className="text-xs text-muted">Booking removed</span>}
                </div>
              </Card>
            ))}
          </div>
        )}
      </Section>
    </HelpZone>
  );
}
