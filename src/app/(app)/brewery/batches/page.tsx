import { EmptyState, PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth";

export const metadata = { title: "Brews" };

export default async function Page() {
  await requireUser("MANAGER");
  return (
    <>
      <PageHeader help="brewery.batches" title="Brews" description="Every brew, planned or done: when it was brewed, where it sat, what it cost and the kegs it filled." />
      <EmptyState title="Coming together">This part of the brewery is being built.</EmptyState>
    </>
  );
}
