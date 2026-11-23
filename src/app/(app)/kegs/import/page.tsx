import { PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { KegImportFlow } from "./import-flow";
import { SinceFix } from "./since-fix";

export const metadata = { title: "Import kegs" };

export default async function KegImportPage() {
  await requireUser("MANAGER");
  return (
    <>
      <PageHeader help="kegs.import" title="Import from your old keg app" description="Bring in every keg, beer, batch, account and the whole history from Distribrewtion or any other keg app. Old stickers keep working." />
      <KegImportFlow />
      <SinceFix />
    </>
  );
}
