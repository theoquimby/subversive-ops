import { EmptyState, PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth";

export const metadata = { title: "Brewery setup" };

export default async function Page() {
  await requireUser("MANAGER");
  return (
    <>
      <PageHeader help="brewery.setup" title="Brewery setup" description="The tanks in the brewery and the usual days a beer spends in each." />
      <EmptyState title="Coming together">This part of the brewery is being built.</EmptyState>
    </>
  );
}
