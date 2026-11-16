import { PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { brewStockRows } from "@/server/services/brewStock";
import { CountSheet } from "../count-sheet";

export const metadata = { title: "Brewing delivery" };

export default async function Page() {
  await requireUser("MANAGER");
  const { rows } = await brewStockRows();
  const suppliers = [...new Set(rows.map((r) => r.supplier).filter((s): s is string => !!s))].sort();
  return (
    <>
      <PageHeader
        help="brewery.stock.received"
        title="Received a delivery"
        back={{ href: "/brewery/stock", label: "Brewing stock" }}
        description="Type what came in. When a brewing supplier's invoice is approved under Invoices, its malt, hops and yeast are added on their own, so only use this for deliveries without one."
      />
      <CountSheet rows={rows} mode="received" suppliers={suppliers} />
    </>
  );
}
