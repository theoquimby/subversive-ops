import { EmptyState, PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth";

export const metadata = { title: "Brewery" };

export default async function Page() {
  await requireUser("MANAGER");
  return (
    <>
      <PageHeader help="brewery.tanks" title="Tanks" description="What is in each fermenter and brite tank right now, how many days it has been there, and what needs doing next." />
      <EmptyState title="Coming together">This part of the brewery is being built.</EmptyState>
    </>
  );
}
