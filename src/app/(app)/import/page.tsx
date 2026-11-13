import { PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { ImportFlow } from "./import-flow";

export const metadata = { title: "Import your sheets" };

export default async function ImportPage() {
  await requireUser("MANAGER");
  return (
    <>
      <PageHeader
        title="Import your sheets"
        description="Bring in your existing ingredient list, prices and recipes in one go. Nothing is saved until you've reviewed it, and re-importing the same sheet just updates what changed."
      />
      <ImportFlow />
    </>
  );
}
