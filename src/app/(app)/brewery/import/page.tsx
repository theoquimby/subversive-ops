import { EmptyState, PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth";

export const metadata = { title: "Import brewing data" };

export default async function Page() {
  await requireUser("MANAGER");
  return (
    <>
      <PageHeader help="brewery.import" title="Import" description="Bring in recipes and brews from the Brew Manager app's backup file." />
      <EmptyState title="Coming together">This part of the brewery is being built.</EmptyState>
    </>
  );
}
