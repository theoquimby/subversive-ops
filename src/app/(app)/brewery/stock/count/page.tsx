import { PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { brewStockRows } from "@/server/services/brewStock";
import { CountSheet } from "../count-sheet";

export const metadata = { title: "Count brewing stock" };

export default async function Page() {
  await requireUser("MANAGER");
  const { rows } = await brewStockRows();
  return (
    <>
      <PageHeader
        help="brewery.stock.count"
        title="Count brewing stock"
        back={{ href: "/brewery/stock", label: "Brewing stock" }}
        description="Type what's on the shelf now, in whatever unit is easiest: lb, oz, kg, packs, or a sack or box when the ingredient has one. Blank rows are left as they are."
      />
      <CountSheet rows={rows} mode="count" />
    </>
  );
}
