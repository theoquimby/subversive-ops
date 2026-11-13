import { PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { businessToday } from "@/server/services/sales";
import { ImportWizard } from "./import-wizard";

export const metadata = { title: "Import price sheet" };

export default async function ImportPage() {
  await requireUser("MANAGER");
  const suppliers = await db.supplier.findMany({ where: { active: true }, orderBy: [{ kind: "asc" }, { name: "asc" }], select: { id: true, name: true, kind: true } });
  return (
    <>
      <PageHeader
        help="prices.import"
        title="Import price sheet"
        description="Upload the distributor's download as-is. You'll see every price change before anything is saved."
        back={{ href: "/prices", label: "Prices" }}
      />
      <ImportWizard suppliers={suppliers} today={businessToday()} />
    </>
  );
}
