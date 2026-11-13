import { HelpTip } from "@/components/help";
import { cx, EmptyState, LinkButton, PageHeader, Section, Table, Td, Th, Tr } from "@/components/ui";
import { displayCode, KEG_STATUSES, OWNER_LABEL, placeLabel, sinceLabel, STATUS_META, type KegStatus } from "@/domain/kegs";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { kegAreas } from "@/server/services/kegs";
import { Printer } from "lucide-react";
import Link from "next/link";
import { BeerDot, sizeShort, StatusBadge } from "../bits";
import { AddKegs } from "./add-kegs";

export const metadata = { title: "All kegs" };

export default async function AllKegsPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; retired?: string }> }) {
  await requireUser("MANAGER");
  const sp = await searchParams;
  const status = KEG_STATUSES.includes(sp.status as KegStatus) ? (sp.status as KegStatus) : null;
  const retired = sp.retired === "1";
  const [kegs, counts, areas] = await Promise.all([
    db.keg.findMany({
      where: { active: !retired, ...(status ? { status } : {}) },
      include: { beer: { select: { name: true, color: true } }, spot: { select: { name: true } }, account: { select: { name: true } } },
      orderBy: [{ status: "asc" }, { code: "asc" }],
      take: 500,
    }),
    db.keg.groupBy({ by: ["status"], where: { active: true }, _count: { _all: true } }),
    kegAreas(),
  ]);
  const total = counts.reduce((s, c) => s + c._count._all, 0);
  const chip = (href: string, on: boolean, label: React.ReactNode) => (
    <Link href={href} className={cx("inline-flex h-10 items-center gap-1.5 rounded-full border px-3 text-sm sm:h-8", on ? "border-ink bg-ink text-bg" : "border-border bg-surface text-ink-2 hover:bg-surface-2")}>{label}</Link>
  );
  const labelHref = `/print/kegs?${status ? `status=${status}` : "all=1"}`;
  return (
    <>
      <PageHeader help="kegs.all" title="All kegs" back={{ href: "/kegs", label: "Kegs" }} description="Every keg, its sticker code and where it is. Add new kegs and print their QR stickers here." actions={<LinkButton href={labelHref}><Printer className="size-4" /> Print labels</LinkButton>} />

      <Section help="kegs.labels" title={<span className="inline-flex items-center gap-1">Add kegs <HelpTip id="kegs.labels" /></span>} description="Each new keg gets a short code and a QR sticker. Kegs you already have stickers for can keep them: bring them in with Import.">
        <AddKegs areas={areas} />
      </Section>

      <Section title={`${total} kegs`}>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {chip("/kegs/all", !status && !retired, "All")}
          {KEG_STATUSES.map((s) => {
            const n = counts.find((c) => c.status === s)?._count._all ?? 0;
            return n ? <span key={s}>{chip(`/kegs/all?status=${s}`, status === s, <>{STATUS_META[s].short} <span className="num opacity-70">{n}</span></>)}</span> : null;
          })}
          {chip("/kegs/all?retired=1", retired, "Retired")}
        </div>
        {kegs.length === 0 ? (
          <EmptyState title={total ? "None here" : "No kegs yet"}>{total ? "Try another filter." : "Add your kegs above, or import them from your old keg app."}</EmptyState>
        ) : (
          <Table>
            <thead><tr><Th>Code</Th><Th>Beer</Th><Th>Status</Th><Th className="hidden md:table-cell">Where</Th><Th className="hidden sm:table-cell">Size</Th><Th className="hidden lg:table-cell">Owner</Th><Th className="hidden lg:table-cell">Old sticker</Th><Th align="right" className="hidden sm:table-cell">Since</Th></tr></thead>
            <tbody>
              {kegs.map((k) => (
                <Tr key={k.id}>
                  <Td className="num font-medium whitespace-nowrap"><Link href={`/kegs/k/${k.code}`} className="hover:underline">{displayCode(k.code)}</Link></Td>
                  <Td>{k.beer ? <span className="inline-flex items-center gap-2"><BeerDot color={k.beer.color} />{k.beer.name}</span> : <span className="text-muted">—</span>}</Td>
                  <Td><StatusBadge status={k.status as KegStatus} /></Td>
                  <Td className="hidden text-ink-2 md:table-cell">{placeLabel({ area: k.area, spot: k.spot?.name, spotNote: k.spotNote, tapLine: k.tapLine, account: k.account?.name, status: k.status as KegStatus })}</Td>
                  <Td className="hidden text-muted sm:table-cell">{sizeShort(k.sizeId)}</Td>
                  <Td className="hidden text-muted lg:table-cell">{OWNER_LABEL[k.owner]}</Td>
                  <Td className="hidden text-muted lg:table-cell">{k.legacyCode ?? "—"}</Td>
                  <Td align="right" className="hidden text-muted sm:table-cell">{sinceLabel(k.statusAt)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>
    </>
  );
}
