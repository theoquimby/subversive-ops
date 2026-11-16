import { Button, cx, EmptyState, Input, LinkButton, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { ACTION_DONE, displayCode, placeLabel } from "@/domain/kegs";
import { businessDateTime } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { findKegByScan } from "@/server/services/kegs";
import { Search } from "lucide-react";
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

const NO_SPOT = placeLabel({ area: null });
const LIMIT = 300;

/** "Somewhere — no spot yet" is the app's words for an unknown place; in a dense table it's just noise. */
const place = (p: string | null) => (!p || p === NO_SPOT ? null : p);
/** The import writes "Imported (old code <long id>)"; the id is on the keg's own page. */
const note = (n: string | null) => (n && /^Imported \(old code /.test(n) ? "Brought in from the old keg app" : n);

export default async function KegHistory({ searchParams }: { searchParams: Promise<{ action?: string; keg?: string; q?: string }> }) {
  await requireUser("MANAGER");
  const sp = await searchParams;
  const action = FILTERS.some((f) => f.id === sp.action) ? sp.action ?? "" : "";
  const q = String(sp.q ?? "").trim().slice(0, 300);
  // One keg's history: by a typed code or old sticker, or the keg id a link carries.
  const found = q ? await findKegByScan(q) : null;
  const kegId = found?.id ?? (sp.keg || null);
  const noSuchKeg = !!q && !found;
  const events = noSuchKeg
    ? []
    : await db.kegEvent.findMany({
        where: { ...(action ? { action } : {}), ...(kegId ? { kegId } : {}) },
        orderBy: { at: "desc" },
        take: LIMIT,
        include: { keg: { select: { code: true } }, account: { select: { name: true } } },
      });
  const beers = new Map((await db.beer.findMany({ select: { id: true, name: true, color: true } })).map((b) => [b.id, b]));
  const href = (a: string) => {
    const u = new URLSearchParams();
    if (a) u.set("action", a);
    if (q) u.set("q", q);
    else if (sp.keg) u.set("keg", sp.keg);
    const s = u.toString();
    return s ? `/kegs/history?${s}` : "/kegs/history";
  };
  return (
    <>
      <PageHeader help="kegs.history" title="Keg history" back={{ href: "/kegs", label: "Kegs" }} description="Every scan and change: who, when, and from where to where. Nothing here is ever deleted; undone entries are struck through." />
      <form action="/kegs/history" method="get" role="search" className="mb-3 flex max-w-md gap-2">
        {action && <input type="hidden" name="action" value={action} />}
        <div className="relative min-w-0 flex-1">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <Input name="q" defaultValue={q} placeholder="One keg: its code or old sticker" aria-label="Show one keg's history" autoComplete="off" autoCapitalize="characters" spellCheck={false} className="pl-9" />
        </div>
        <Button type="submit" className="h-10 shrink-0 sm:h-9">Show</Button>
        {(q || sp.keg) && <LinkButton href={action ? `/kegs/history?action=${action}` : "/kegs/history"} variant="ghost" className="h-10 shrink-0 sm:h-9">All kegs</LinkButton>}
      </form>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <Link key={f.id} href={href(f.id)} scroll={false} className={cx("inline-flex h-10 items-center rounded-full border px-3 text-sm sm:h-8", action === f.id ? "border-ink bg-ink text-bg" : "border-border bg-surface text-ink-2 hover:bg-surface-2")}>{f.label}</Link>
        ))}
      </div>
      {noSuchKeg ? (
        <EmptyState title={`No keg with the code ${q.slice(0, 40)}`}>Check the code on the sticker, or find the keg on All kegs.</EmptyState>
      ) : events.length === 0 ? (
        <EmptyState title="Nothing yet">{kegId || action ? "Nothing matches. Try another filter." : "Scans show up here as staff use them."}</EmptyState>
      ) : (
        <>
          {found && <p className="mb-2 text-sm text-ink-2">Showing keg <Link href={`/kegs/k/${found.code}`} className="num font-medium hover:underline">{displayCode(found.code)}</Link>.</p>}
          <Table>
            <thead><tr><Th>When</Th><Th>Keg</Th><Th>What</Th><Th className="hidden md:table-cell">Where</Th><Th className="hidden sm:table-cell">Who</Th></tr></thead>
            <tbody>
              {events.map((e) => {
                const b = e.beerId ? beers.get(e.beerId) : null;
                const from = place(e.fromPlace), to = place(e.toPlace);
                const extra = [e.account?.name, note(e.note)].filter(Boolean).join(" · ");
                return (
                  <Tr key={e.id} className={e.undoneAt ? "text-muted line-through" : ""}>
                    <Td className="num whitespace-nowrap text-ink-2">{businessDateTime(e.at)}</Td>
                    <Td className="num whitespace-nowrap"><Link href={`/kegs/k/${e.keg.code}`} className="hover:underline">{displayCode(e.keg.code)}</Link></Td>
                    <Td>
                      <div className="flex items-center gap-2">{b && <BeerDot color={b.color} />}<span className="font-medium">{ACTION_DONE[e.action] ?? e.action}</span>{b && <span className="text-ink-2">{b.name}</span>}</div>
                      {extra && <div className="text-xs text-muted">{extra}</div>}
                    </Td>
                    <Td className="hidden text-xs text-ink-2 md:table-cell">{from && to && from !== to ? `${from} → ${to}` : to ?? from ?? ""}</Td>
                    <Td className="hidden text-ink-2 sm:table-cell">{e.userName ?? (e.importKey ? "Imported" : "—")}</Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
          {events.length === LIMIT && <p className="mt-2 text-xs text-muted">The latest {LIMIT}. Pick a filter or one keg to go further back.</p>}
        </>
      )}
    </>
  );
}
