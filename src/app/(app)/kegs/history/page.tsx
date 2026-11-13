import { cx, EmptyState, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { ACTION_DONE, displayCode } from "@/domain/kegs";
import { businessDateTime } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import Link from "next/link";
import { BeerDot } from "../bits";

export const metadata = { title: "Keg history" };

const FILTERS = [
  { id: "", label: "Everything" },
  { id: "KICKED", label: "Kicks" },
  { id: "TAPPED", label: "Tapped" },
  { id: "MOVED", label: "Moves" },
  { id: "OUT", label: "Out" },
  { id: "RETURNED", label: "Back" },
  { id: "FILLED", label: "Fills" },
  { id: "CLEANED", label: "Cleaned" },
];

export default async function KegHistory({ searchParams }: { searchParams: Promise<{ action?: string; keg?: string }> }) {
  await requireUser("MANAGER");
  const sp = await searchParams;
  const action = FILTERS.some((f) => f.id === sp.action) ? sp.action : "";
  const events = await db.kegEvent.findMany({
    where: { ...(action ? { action } : {}), ...(sp.keg ? { kegId: sp.keg } : {}) },
    orderBy: { at: "desc" },
    take: 300,
    include: { keg: { select: { code: true } }, account: { select: { name: true } } },
  });
  const beers = new Map((await db.beer.findMany({ select: { id: true, name: true, color: true } })).map((b) => [b.id, b]));
  return (
    <>
      <PageHeader help="kegs.history" title="Keg history" back={{ href: "/kegs", label: "Kegs" }} description="Every scan and change: who, when, and from where to where. Nothing here is ever deleted; undone entries are struck through." />
      <div className="mb-4 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <Link key={f.id} href={f.id ? `/kegs/history?action=${f.id}` : "/kegs/history"} className={cx("inline-flex h-10 items-center rounded-full border px-3 text-sm sm:h-8", action === f.id ? "border-ink bg-ink text-bg" : "border-border bg-surface text-ink-2 hover:bg-surface-2")}>{f.label}</Link>
        ))}
      </div>
      {events.length === 0 ? (
        <EmptyState title="Nothing yet">Scans show up here as staff use them.</EmptyState>
      ) : (
        <Table>
          <thead><tr><Th>When</Th><Th>Keg</Th><Th>What</Th><Th className="hidden md:table-cell">From → to</Th><Th className="hidden sm:table-cell">Who</Th></tr></thead>
          <tbody>
            {events.map((e) => {
              const b = e.beerId ? beers.get(e.beerId) : null;
              return (
                <Tr key={e.id} className={e.undoneAt ? "text-muted line-through" : ""}>
                  <Td className="num whitespace-nowrap text-ink-2">{businessDateTime(e.at)}</Td>
                  <Td className="num whitespace-nowrap"><Link href={`/kegs/k/${e.keg.code}`} className="hover:underline">{displayCode(e.keg.code)}</Link></Td>
                  <Td>
                    <div className="flex items-center gap-2">{b && <BeerDot color={b.color} />}<span className="font-medium">{ACTION_DONE[e.action] ?? e.action}</span>{b && <span className="text-ink-2">{b.name}</span>}</div>
                    {(e.note || e.account) && <div className="text-xs text-muted">{[e.account?.name, e.note].filter(Boolean).join(" · ")}</div>}
                  </Td>
                  <Td className="hidden text-xs text-ink-2 md:table-cell">{e.fromPlace || e.toPlace ? `${e.fromPlace ?? "—"} → ${e.toPlace ?? "—"}` : ""}</Td>
                  <Td className="hidden text-ink-2 sm:table-cell">{e.userName ?? (e.importKey ? "Imported" : "—")}</Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </>
  );
}
