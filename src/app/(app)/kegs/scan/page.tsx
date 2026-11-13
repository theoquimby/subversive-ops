import { PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { panelContext } from "@/server/services/kegs";
import { Scanner } from "../scanner";

export const metadata = { title: "Scan a keg" };

export default async function ScanPage() {
  const me = await requireUser();
  const ctx = await panelContext();
  return (
    <>
      <div className="mx-auto max-w-md">
        <PageHeader help="kegs.scan" title="Scan a keg" description="Point at the sticker. When a keg kicks, it's one tap." />
      </div>
      <Scanner ctx={ctx} role={me.role} />
    </>
  );
}
