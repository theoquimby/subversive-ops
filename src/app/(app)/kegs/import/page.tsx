import { PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { KegImportFlow } from "./import-flow";

export const metadata = { title: "Import kegs" };

export default async function KegImportPage() {
  await requireUser("MANAGER");
  return (
    <>
      <PageHeader help="kegs.import" title="Import from your old keg app" back={{ href: "/kegs", label: "Kegs" }} description="Bring in every keg, beer, batch, account and the whole history. Old stickers keep working." />
      <KegImportFlow />
    </>
  );
}
