import { PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { ImportFlow } from "./import-flow";

export const metadata = { title: "Import your sheets" };

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ for?: string }> }) {
  await requireUser("MANAGER");
  const recipes = (await searchParams).for === "recipes";
  return (
    <>
      <PageHeader
        help="import.page"
        title={recipes ? "Bulk add recipes" : "Import your sheets"}
        description={recipes
          ? "Copy just your recipe rows from Sheets or Excel and paste them here — no need to link the whole spreadsheet. Nothing is saved until you've reviewed it."
          : "Bring in your existing ingredient list, prices and recipes in one go. Nothing is saved until you've reviewed it, and re-importing the same sheet just updates what changed."}
      />
      <ImportFlow focus={recipes ? "recipes" : undefined} />
    </>
  );
}
