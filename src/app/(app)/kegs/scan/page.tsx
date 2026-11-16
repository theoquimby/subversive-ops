import { PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { panelContext } from "@/server/services/kegs";
import { Scanner } from "../scanner";

export const metadata = { title: "Scan a keg" };

export default async function ScanPage({ searchParams }: { searchParams: Promise<{ fill?: string; batch?: string }> }) {
  const me = await requireUser();
  const [ctx, sp] = await Promise.all([panelContext(), searchParams]);
  // From a packaged brew: scan many, filling with its beer and batch (?fill=<beer id>&batch=<code>).
  const fill = sp.batch || sp.fill ? { beerId: ctx.beers.some((b) => b.id === sp.fill) ? sp.fill! : "", batchCode: String(sp.batch ?? "").slice(0, 40) } : undefined;
  return (
    <>
      <div className="mx-auto max-w-md">
        <PageHeader help="kegs.scan" title="Scan a keg" description="Point at the sticker. When a keg kicks, it's one tap." />
      </div>
      <Scanner ctx={ctx} role={me.role} fill={fill} />
    </>
  );
}
