import { HelpTip } from "@/components/help";
import { LinkButton, PageHeader, Section } from "@/components/ui";
import { displayCode, kegSizeInfo, KEG_STATUSES, placeLabel, sinceLabel, type KegOwner, type KegStatus } from "@/domain/kegs";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { kegAreas } from "@/server/services/kegs";
import { Plus, Printer } from "lucide-react";
import { redirect } from "next/navigation";
import { AddKegs } from "./add-kegs";
import { KegsTable, type KegRow } from "./kegs-table";

export const metadata = { title: "All kegs" };

const NO_SPOT = placeLabel({ area: null });

/** Where filter values: on tap; at accounts and which one; or an area and its spot. */
function whereFacets(k: { status: KegStatus; area: string | null; spot: string | null; account: string | null }): string[] {
  if (k.status === "ON_TAP") return ["On tap"];
  if (k.status === "OUT") return ["At accounts", `At ${k.account ?? "an account not recorded"}`];
  if (!k.area) return ["No spot yet"];
  return k.spot ? [k.area, `${k.area} · ${k.spot}`] : [k.area];
}

export default async function AllKegsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser("MANAGER");
  const sp = await searchParams;
  // Links like ?status=EMPTY mean kegs in service, as they always did; retired ones are one tap away.
  if (sp.retired == null && Object.keys(sp).length > 0) {
    const u = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === "string"));
    u.set("retired", "0");
    redirect(`/kegs/all?${u.toString()}`);
  }
  const status = KEG_STATUSES.includes(sp.status as KegStatus) ? (sp.status as KegStatus) : null;
  const now = new Date();
  const [kegs, areas] = await Promise.all([
    db.keg.findMany({
      include: { beer: { select: { name: true, color: true } }, spot: { select: { name: true } }, account: { select: { name: true } } },
      orderBy: [{ status: "asc" }, { code: "asc" }],
    }),
    kegAreas(),
  ]);
  const rows: KegRow[] = kegs.map((k) => {
    const s = k.status as KegStatus;
    const where = placeLabel({ area: k.area, spot: k.spot?.name, spotNote: k.spotNote, tapLine: k.tapLine, account: k.account?.name, status: s });
    const size = kegSizeInfo(k.sizeId);
    return {
      id: k.id,
      code: k.code,
      display: displayCode(k.code),
      label: k.label,
      legacyCode: k.legacyCode,
      active: k.active,
      status: s,
      beerId: k.beerId,
      beer: k.beer?.name ?? null,
      color: k.beer?.color ?? null,
      sizeId: k.sizeId,
      size: size.short,
      gallons: size.gallons,
      owner: k.owner as KegOwner,
      where: where === NO_SPOT ? null : where,
      whereFacets: whereFacets({ status: s, area: k.area, spot: k.spot?.name ?? null, account: k.account?.name ?? null }),
      account: k.account?.name ?? null,
      since: sinceLabel(k.statusAt, now),
      minutes: Math.max(0, Math.round((now.getTime() - k.statusAt.getTime()) / 60000)),
    };
  });
  const inService = rows.filter((k) => k.active).length;
  const labelHref = `/print/kegs?${status ? `status=${status}` : "all=1"}`;
  return (
    <>
      <PageHeader
        help="kegs.all"
        title="All kegs"
        back={{ href: "/kegs", label: "Kegs" }}
        description="Every keg, its sticker code and where it is. Search by code, old sticker, beer or account; filter by status, beer, size or place; tap a keg to open it."
        actions={
          <div className="flex gap-2">
            <LinkButton href={labelHref}><Printer className="size-4" /> Print labels</LinkButton>
            <LinkButton href="#add" variant="primary"><Plus className="size-4" /> Add kegs</LinkButton>
          </div>
        }
      />

      <Section title={`${inService} kegs in service`} description={rows.length > inService ? `And ${rows.length - inService} retired, under the Retired tab. Tick kegs to print their labels.` : "Tick kegs to print their labels."}>
        <KegsTable rows={rows} />
      </Section>

      <div id="add" className="scroll-mt-24">
        <Section help="kegs.labels" title={<span className="inline-flex items-center gap-1">Add kegs <HelpTip id="kegs.labels" /></span>} description="Each new keg gets a short code and a QR sticker. Kegs that already have stickers can keep them: bring them in with Import, or scan them from Scan.">
          <AddKegs areas={areas} />
        </Section>
      </div>
    </>
  );
}
