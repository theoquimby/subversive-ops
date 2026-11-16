import { EmptyState, PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth";

export const metadata = { title: "Brewery schedule" };

export default async function Page() {
  await requireUser("MANAGER");
  return (
    <>
      <PageHeader help="brewery.schedule" title="Tank schedule" description="Every tank over the coming weeks: what is planned where, when each brew moves to a brite tank and when it is packaged." />
      <EmptyState title="Coming together">This part of the brewery is being built.</EmptyState>
    </>
  );
}
