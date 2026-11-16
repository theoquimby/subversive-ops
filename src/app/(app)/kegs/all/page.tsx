import { HelpTip } from "@/components/help";
import { Button, cx, EmptyState, Input, LinkButton, PageHeader, Section, Table, Td, Th, Tr } from "@/components/ui";
import { displayCode, KEG_STATUSES, normalizeCode, OWNER_LABEL, placeLabel, sinceLabel, STATUS_META, type KegStatus } from "@/domain/kegs";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { kegAreas } from "@/server/services/kegs";
import type { Prisma } from "@prisma/client";
import { Plus, Printer, Search } from "lucide-react";
import Link from "next/link";
import { BeerDot, sizeShort, StatusBadge } from "../bits";
import { AddKegs } from "./add-kegs";

export const metadata = { title: "All kegs" };

const NO_SPOT = placeLabel({ area: null });

export default async function AllKegsPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; retired?: string }> }) {
  await requireUser("MANAGER");
  const sp = await searchParams;
  const status = KEG_STATUSES.includes(sp.status as KegStatus) ? (sp.status as KegStatus) : null;
  const retired = sp.retired === "1";
  const q = String(sp.q ?? "").trim().slice(0, 60);
  // A search looks at our code, the old sticker's code, the beer and the account.
  const code = normalizeCode(q);
  const search: Prisma.KegWhereInput = q
    ? {
        OR: [
          ...(code ? [{ code: { contains: code } }] : []),
          { legacyCode: { contains: q, mode: "insensitive" } },
          { beer: { name: { contains: q, mode: "insensitive" } } },
          { account: { name: { contains: q, mode: "insensitive" } } },
          { label: { contains: q, mode: "insensitive" } },
        ],
      }
    : {};
  const [kegs, counts, areas] = await Promise.all([
    db.keg.findMany({
      where: { active: !retired, ...(status ? { status } : {}), ...search },
      include: { beer: { select: { name: true, color: true } }, spot: { select: { name: true } }, account: { select: { name: true } } },
      orderBy: [{ status: "asc" }, { code: "asc" }],
      take: 500,
    }),
    db.keg.groupBy({ by: ["status"], where: { active: true }, _count: { _all: true } }),
    kegAreas(),
  ]);
  const total = counts.reduce((s, c) => s + c._count._all, 0);
  const href = (p: { status?: string; retired?: boolean }, keepSearch = true) => {
    const u = new URLSearchParams();
    if (p.status) u.set("status", p.status);
    if (p.retired) u.set("retired", "1");
    if (q && keepSearch) u.set("q", q);
    const s = u.toString();
    return s ? `/kegs/all?${s}` : "/kegs/all";
  };
  const chip = (to: string, on: boolean, label: React.ReactNode) => (
    <Link href={to} scroll={false} className={cx("inline-flex h-10 items-center gap-1.5 rounded-full border px-3 text-sm sm:h-8", on ? "border-ink bg-ink text-bg" : "border-border bg-surface text-ink-2 hover:bg-surface-2")}>{label}</Link>
  );
  const labelHref = `/print/kegs?${status ? `status=${status}` : "all=1"}`;
  const filtered = !!(q || status || retired);
  return (
    <>
      <PageHeader
        help="kegs.all"
        title="All kegs"
        back={{ href: "/kegs", label: "Kegs" }}
        description="Every keg, its sticker code and where it is. Search by code, beer or account; tap a keg to open it."
        actions={
          <div className="flex gap-2">
            <LinkButton href={labelHref}><Printer className="size-4" /> Print labels</LinkButton>
            <LinkButton href="#add" variant="primary"><Plus className="size-4" /> Add kegs</LinkButton>
          </div>
        }
      />

      <Section title={filtered ? `${kegs.length}${kegs.length === 500 ? "+" : ""} of ${total} kegs` : `${total} kegs`}>
        <form action="/kegs/all" method="get" role="search" className="mb-3 flex max-w-md gap-2">
          {status && <input type="hidden" name="status" value={status} />}
          {retired && <input type="hidden" name="retired" value="1" />}
          <div className="relative min-w-0 flex-1">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <Input name="q" defaultValue={q} placeholder="Code, beer or account" aria-label="Search kegs" autoComplete="off" autoCapitalize="off" spellCheck={false} className="pl-9" />
          </div>
          <Button type="submit" className="h-10 shrink-0 sm:h-9">Search</Button>
          {q && <LinkButton href={href({ status: status ?? undefined, retired }, false)} variant="ghost" className="h-10 shrink-0 sm:h-9">Clear</LinkButton>}
        </form>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {chip(href({}), !status && !retired, "All")}
          {KEG_STATUSES.map((s) => {
            const n = counts.find((c) => c.status === s)?._count._all ?? 0;
            return n ? <span key={s}>{chip(href({ status: s }), status === s, <>{STATUS_META[s].short} <span className="num opacity-70">{n}</span></>)}</span> : null;
          })}
          {chip(href({ retired: true }), retired, "Retired")}
        </div>
        {kegs.length === 0 ? (
          <EmptyState title={total ? "No kegs match" : "No kegs yet"}>{total ? "Try another search or filter." : "Add your kegs below, or import them from your old keg app."}</EmptyState>
        ) : (
          <Table>
            <thead><tr><Th>Code</Th><Th>Beer</Th><Th>Status</Th><Th className="hidden md:table-cell">Where</Th><Th className="hidden sm:table-cell">Size</Th><Th className="hidden lg:table-cell">Owner</Th><Th align="right" className="hidden sm:table-cell">For</Th></tr></thead>
            <tbody>
              {kegs.map((k) => {
                const where = placeLabel({ area: k.area, spot: k.spot?.name, spotNote: k.spotNote, tapLine: k.tapLine, account: k.account?.name, status: k.status as KegStatus });
                return (
                  <Tr key={k.id}>
                    <Td className="num font-medium whitespace-nowrap"><Link href={`/kegs/k/${k.code}`} className="hover:underline">{displayCode(k.code)}</Link>{k.label && <span className="ml-2 font-normal text-muted">{k.label}</span>}</Td>
                    <Td>{k.beer ? <span className="inline-flex items-center gap-2"><BeerDot color={k.beer.color} />{k.beer.name}</span> : <span className="text-muted">—</span>}</Td>
                    <Td><StatusBadge status={k.status as KegStatus} /></Td>
                    <Td className="hidden md:table-cell">{where === NO_SPOT ? <span className="text-muted">No spot yet</span> : <span className="text-ink-2">{where}</span>}</Td>
                    <Td className="hidden text-muted sm:table-cell">{sizeShort(k.sizeId)}</Td>
                    <Td className="hidden text-muted lg:table-cell">{OWNER_LABEL[k.owner]}</Td>
                    <Td align="right" className="num hidden text-muted whitespace-nowrap sm:table-cell">{sinceLabel(k.statusAt)}</Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
        {kegs.length === 500 && <p className="mt-2 text-xs text-muted">Showing the first 500. Search or pick a status to narrow it.</p>}
      </Section>

      <div id="add" className="scroll-mt-24">
        <Section help="kegs.labels" title={<span className="inline-flex items-center gap-1">Add kegs <HelpTip id="kegs.labels" /></span>} description="Each new keg gets a short code and a QR sticker. Kegs that already have stickers can keep them: bring them in with Import, or scan them from Scan.">
          <AddKegs areas={areas} />
        </Section>
      </div>
    </>
  );
}
