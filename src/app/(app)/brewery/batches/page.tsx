import { EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { batchList } from "@/server/services/brewery";
import { Plus } from "lucide-react";
import { BatchTable } from "./batches-client";

export const metadata = { title: "Brews" };

export default async function Page({ searchParams }: { searchParams: Promise<{ show?: string; q?: string }> }) {
  await requireUser("MANAGER");
  const [rows, sp] = await Promise.all([batchList(), searchParams]);
  const show = (["planned", "tanks", "packaged", "all"] as const).find((s) => s === sp.show) ?? "all";
  return (
    <>
      <PageHeader
        help="brewery.batches"
        title="Brews"
        description="Every brew, planned or done: when it was brewed and packaged, its strength, and what it cost."
        actions={<LinkButton href="/brewery/schedule#plan"><Plus className="size-4" />Plan a brew</LinkButton>}
      />
      {rows.length ? (
        <BatchTable rows={rows} initialShow={show} initialQuery={sp.q ?? ""} />
      ) : (
        <EmptyState title="No brews yet" action={<LinkButton href="/brewery/schedule#plan" variant="primary">Plan a brew</LinkButton>}>
          Brews show here once you plan one, brew into a tank from the Tanks page, or import them from Brew Manager.
        </EmptyState>
      )}
    </>
  );
}
