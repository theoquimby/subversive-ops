import { EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { displayCode } from "@/domain/kegs";
import { requireUser } from "@/server/auth";
import { findKegByScan, kegCard, panelContext } from "@/server/services/kegs";
import { KegPanel } from "../../keg-panel";
import { KegAdmin } from "../../keg-admin";
import { QueueWatcher } from "../../scanner";

export const metadata = { title: "Keg" };

/** Where a sticker's QR lands when scanned with the phone's own camera. */
export default async function KegPage({ params }: { params: Promise<{ code: string }> }) {
  const me = await requireUser();
  const { code } = await params;
  const hit = await findKegByScan(decodeURIComponent(code));
  const card = hit ? await kegCard(hit.id) : null;
  if (!card) {
    return (
      <div className="mx-auto max-w-md">
        <PageHeader title="Keg not found" back={{ href: "/kegs/scan", label: "Scan" }} />
        <EmptyState title={`No keg with the code ${displayCode(decodeURIComponent(code))}`} action={<LinkButton href="/kegs/scan" variant="primary">Scan again</LinkButton>}>
          Check the sticker. {me.role === "MANAGER" ? "New kegs are added on Kegs → All kegs." : "A manager can add it."}
        </EmptyState>
      </div>
    );
  }
  const ctx = await panelContext();
  return (
    <div className="mx-auto max-w-md">
      <PageHeader title={`Keg ${displayCode(card.code)}`} back={{ href: me.role === "MANAGER" ? "/kegs/all" : "/kegs", label: me.role === "MANAGER" ? "All kegs" : "Kegs" }} />
      <div className="mb-4"><QueueWatcher /></div>
      <KegPanel card={card} ctx={ctx} role={me.role} />
      {me.role === "MANAGER" && <KegAdmin card={card} />}
      <div className="mt-6">
        <LinkButton href="/kegs/scan" size="lg" className="h-12 w-full">Scan another keg</LinkButton>
      </div>
    </div>
  );
}
