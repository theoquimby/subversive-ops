import { PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { BrewImportFlow } from "./import-flow";

export const metadata = { title: "Import brewing data" };

export default async function Page() {
  await requireUser("MANAGER");
  return (
    <>
      <PageHeader help="brewery.import" title="Import" description="Bring in recipes and brews from the Brew Manager app's backup file. Importing again updates them instead of adding copies." />
      <BrewImportFlow />
    </>
  );
}
