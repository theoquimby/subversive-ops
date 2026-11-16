import { EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { batchList } from "@/server/services/brewery";
import { Plus } from "lucide-react";
import { redirect } from "next/navigation";
import { BatchTable } from "./batches-client";

export const metadata = { title: "Brews" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser("MANAGER");
  const [rows, sp] = await Promise.all([batchList(), searchParams]);
  // Old links said ?show=all; every brew is now simply no tab filter.
  if (sp.show === "all") {
    const u = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === "string" && e[0] !== "show"));
    redirect(`/brewery/batches${u.toString() ? `?${u}` : ""}`);
  }
  return (
    <>
      <PageHeader
        help="brewery.batches"
        title="Brews"
        description="Every brew, planned or done: when it was brewed and packaged, its strength, and what it cost."
        actions={<LinkButton href="/brewery/schedule#plan"><Plus className="size-4" />Plan a brew</LinkButton>}
      />
      {rows.length ? (
        <BatchTable rows={rows} />
      ) : (
        <EmptyState title="No brews yet" action={<LinkButton href="/brewery/schedule#plan" variant="primary">Plan a brew</LinkButton>}>
          Brews show here once you plan one, brew into a tank from the Tanks page, or import them from Brew Manager.
        </EmptyState>
      )}
    </>
  );
}
