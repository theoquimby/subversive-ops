"use client";

import { cx, Select } from "@/components/ui";
import { beerColor, displayCode, isFull, kegSizeInfo, STATUS_META, type KegStatus } from "@/domain/kegs";
import type { BoardKeg } from "@/server/services/kegs";
import { Crosshair, X } from "lucide-react";
import { shortDate } from "@/lib/format";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { sendOrQueue } from "../queue";

interface Spot { id: string; area: string; name: string }

/**
 * The walk-in as a board: one column per spot, kegs as tiles in the beer's
 * color (full = solid, empty = outline). Filter by beer, or "Find the next…"
 * to light up the oldest full keg of it. On a tablet or desktop, drag a tile
 * to another spot (or tap a tile, then tap a spot); on a phone it's a list
 * grouped by spot.
 */
export function CoolerBoard({ areas, boardAreas, spots, kegs, beers, initialBeer, manager }: { areas: string[]; boardAreas: string[]; spots: Spot[]; kegs: BoardKeg[]; beers: { id: string; name: string; color: string }[]; initialBeer: string | null; manager: boolean }) {
  const router = useRouter();
  const [beer, setBeer] = useState<string>(initialBeer ?? "");
  const [find, setFind] = useState<string>(initialBeer ?? "");
  const [picked, setPicked] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const shownAreas = boardAreas.length ? boardAreas : areas.slice(0, 1);
  const [area, setArea] = useState(shownAreas[0] ?? "");

  // The next keg of a beer: cold before filled, oldest fill first.
  const nextId = useMemo(() => {
    if (!find) return null;
    const c = kegs.filter((k) => k.beerId === find && isFull(k.status)).sort((a, b) => (a.status === b.status ? 0 : a.status === "COLD" ? -1 : 1) || (a.filledOn ?? "").localeCompare(b.filledOn ?? "") || +new Date(a.since) - +new Date(b.since));
    return c[0]?.id ?? null;
  }, [find, kegs]);
  const next = kegs.find((k) => k.id === nextId) ?? null;

  const visible = (k: BoardKeg) => !beer || k.beerId === beer;
  const inArea = kegs.filter((k) => k.area === area);
  const columns: { key: string; spotId: string | null; name: string; kegs: BoardKeg[] }[] = [
    ...spots.filter((s) => s.area === area).map((s) => ({ key: s.id, spotId: s.id, name: s.name, kegs: inArea.filter((k) => k.spotId === s.id) })),
    { key: `${area}-none`, spotId: null, name: spots.some((s) => s.area === area) ? "No spot" : area, kegs: inArea.filter((k) => !k.spotId || !spots.some((s) => s.id === k.spotId)) },
  ];
  const elsewhere = kegs.filter((k) => !k.area || !shownAreas.includes(k.area));

  const move = (kegId: string, spotId: string | null) => {
    const k = kegs.find((x) => x.id === kegId);
    if (!k || (k.spotId === spotId && k.area === area)) { setPicked(null); return; }
    start(async () => {
      const r = await sendOrQueue({ kegId, action: "MOVE", area, spotId, label: `Moved ${k.beer ?? displayCode(k.code)}` });
      setPicked(null);
      if ("error" in r) setMsg(r.error);
      else { setMsg(r.queued ? "Saved on this device; it sends when there's signal." : `Moved ${k.beer ?? displayCode(k.code)}.`); router.refresh(); }
    });
  };

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const k of kegs) if (k.beerId && isFull(k.status)) m.set(k.beerId, (m.get(k.beerId) ?? 0) + 1);
    return m;
  }, [kegs]);
  const empties = kegs.filter((k) => k.status === "EMPTY").length;
  const dirty = kegs.filter((k) => k.status === "CLEANING" || k.status === "KICKED").length;

  return (
    <div className="space-y-5">
      {/* Find + filter */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center" data-tour="kegs.find">
        <div className="flex-1 sm:max-w-xs">
          <Select value={find} onChange={(e) => { setFind(e.target.value); setBeer(""); }} placeholder="Find the next keg of…" aria-label="Find the next keg of a beer" options={beers.map((b) => ({ value: b.id, label: b.name, hint: `${counts.get(b.id) ?? 0} full` }))} searchable />
        </div>
        {find && (
          <div className={cx("flex min-h-11 flex-1 items-center gap-2 rounded-xl px-3.5 py-2 text-sm", next ? "bg-good-bg text-good" : "bg-bad-bg text-bad")}>
            <Crosshair className="size-4 shrink-0" />
            <span className="min-w-0 flex-1">{next ? <>Next {next.beer}: <b>{[next.area, spots.find((s) => s.id === next.spotId)?.name, next.spotNote].filter(Boolean).join(" · ")}</b> <span className="num opacity-80">({displayCode(next.code)})</span></> : `No full keg of ${beers.find((b) => b.id === find)?.name ?? "it"} in storage.`}</span>
            {next && <Link href={`/kegs/k/${next.code}`} className="shrink-0 font-medium underline">Open</Link>}
            <button aria-label="Clear" onClick={() => setFind("")} className="grid size-8 shrink-0 place-items-center rounded-lg hover:bg-black/5"><X className="size-4" /></button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5" aria-label="Filter by beer">
        <FilterChip on={!beer} onClick={() => setBeer("")}>All beers</FilterChip>
        {beers.filter((b) => kegs.some((k) => k.beerId === b.id)).map((b) => (
          <FilterChip key={b.id} on={beer === b.id} onClick={() => setBeer(beer === b.id ? "" : b.id)} color={b.color}>{b.name} <span className="num opacity-70">{counts.get(b.id) ?? 0}</span></FilterChip>
        ))}
        <span className="ml-auto self-center text-xs text-muted">{empties} empty · {dirty} to clean</span>
      </div>

      {shownAreas.length > 1 && (
        <div className="flex gap-1 overflow-x-auto rounded-xl bg-surface-2 p-1" role="tablist">
          {shownAreas.map((a) => (
            <button key={a} role="tab" aria-selected={a === area} onClick={() => setArea(a)} className={cx("h-10 shrink-0 rounded-lg px-3.5 text-sm font-medium transition-colors duration-120", a === area ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink")}>
              {a} <span className="num text-xs text-muted">{kegs.filter((k) => k.area === a).length}</span>
            </button>
          ))}
        </div>
      )}

      {msg && <p className="text-sm text-ink-2">{msg}</p>}
      {picked && <p className="rounded-xl bg-surface-2 px-4 py-2.5 text-sm">Tap the spot it moved to. <button className="ml-2 font-medium underline" onClick={() => setPicked(null)}>Cancel</button></p>}

      {/* Tablet/desktop: spots side by side, drag or tap to move */}
      <div className="hidden gap-3 md:grid" style={{ gridTemplateColumns: `repeat(${Math.min(columns.length, 5)}, minmax(0, 1fr))` }} data-tour="kegs.board">
        {columns.map((c) => (
          <div
            key={c.key}
            onDragOver={(e) => { e.preventDefault(); setOver(c.key); }}
            onDragLeave={() => setOver((o) => (o === c.key ? null : o))}
            onDrop={(e) => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData("text/keg"); if (id) move(id, c.spotId); }}
            onClick={() => picked && move(picked, c.spotId)}
            className={cx("min-h-40 rounded-2xl border bg-surface p-2.5 transition-colors duration-120", over === c.key ? "border-ink bg-surface-2" : picked ? "cursor-pointer border-dashed border-ink-2/50" : "border-border")}
          >
            <div className="mb-2 flex items-center justify-between px-1 text-xs font-semibold text-ink-2"><span className="truncate">{c.name}</span><span className="num font-normal text-muted">{c.kegs.length}</span></div>
            <div className="grid grid-cols-2 gap-1.5 xl:grid-cols-3">
              {c.kegs.map((k) => (
                <KegTile key={k.id} k={k} dim={!visible(k)} highlight={k.id === nextId} picked={picked === k.id} draggable={!pending} onPick={() => setPicked(picked === k.id ? null : k.id)} />
              ))}
            </div>
            {c.kegs.length === 0 && <div className="px-1 py-4 text-center text-xs text-muted">Empty</div>}
          </div>
        ))}
      </div>

      {/* Phone: list grouped by spot */}
      <div className="space-y-4 md:hidden">
        {columns.filter((c) => c.kegs.some(visible) || (!beer && c.kegs.length)).map((c) => (
          <section key={c.key}>
            <h3 className="mb-1.5 flex items-center justify-between px-1 text-xs font-semibold text-ink-2">{c.name}<span className="num font-normal text-muted">{c.kegs.filter(visible).length}</span></h3>
            <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
              {c.kegs.filter(visible).map((k) => <KegRow key={k.id} k={k} highlight={k.id === nextId} />)}
            </div>
          </section>
        ))}
        {columns.every((c) => !c.kegs.some(visible)) && <p className="py-6 text-center text-sm text-muted">No kegs here{beer ? " for that beer" : ""}.</p>}
      </div>

      {elsewhere.filter(visible).length > 0 && (
        <section>
          <h3 className="mb-1.5 px-1 text-xs font-semibold text-ink-2">Elsewhere</h3>
          <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
            {elsewhere.filter(visible).map((k) => <KegRow key={k.id} k={k} highlight={k.id === nextId} showArea />)}
          </div>
        </section>
      )}
      {manager && <p className="text-xs text-muted">Spots are set on <Link className="underline" href="/kegs/setup#spots">Kegs → Setup</Link>.</p>}
    </div>
  );
}

function FilterChip({ on, onClick, color, children }: { on: boolean; onClick: () => void; color?: string; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={cx("inline-flex h-10 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors duration-120 sm:h-8", on ? "border-ink bg-ink text-bg" : "border-border bg-surface text-ink-2 hover:bg-surface-2")}>
      {color && <span className="size-2.5 rounded-full ring-1 ring-black/10 dark:ring-white/30" style={{ background: beerColor(color).bg }} />}
      {children}
    </button>
  );
}

function KegTile({ k, dim, highlight, picked, draggable, onPick }: { k: BoardKeg; dim: boolean; highlight: boolean; picked: boolean; draggable: boolean; onPick: () => void }) {
  const c = beerColor(k.color);
  const full = isFull(k.status);
  return (
    <button
      type="button"
      draggable={draggable}
      onDragStart={(e) => { e.dataTransfer.setData("text/keg", k.id); e.dataTransfer.effectAllowed = "move"; }}
      onClick={(e) => { e.stopPropagation(); onPick(); }}
      title={`${k.beer ?? "Empty"} · ${STATUS_META[k.status].label} · ${displayCode(k.code)}`}
      className={cx(
        "relative flex h-16 cursor-grab flex-col justify-between rounded-xl border-2 p-1.5 text-left text-[11px] leading-tight transition-[opacity,transform,box-shadow] duration-180 active:cursor-grabbing",
        dim && "opacity-25",
        highlight && "ring-4 ring-ink ring-offset-2 ring-offset-surface",
        picked && "scale-[0.96] ring-2 ring-focus",
      )}
      style={full ? { background: c.bg, color: c.fg, borderColor: c.bg } : { borderColor: k.status === "EMPTY" ? "var(--border-strong)" : c.bg, color: "var(--ink-2)", borderStyle: "dashed" }}
    >
      <span className="line-clamp-2 font-semibold">{k.beer ?? (k.status === "EMPTY" ? "Empty" : "—")}</span>
      <span className="num flex justify-between gap-1 truncate opacity-80"><span className="whitespace-nowrap">{kegSizeInfo(k.sizeId).short}</span>{!full && k.status !== "EMPTY" && <span className="truncate">{STATUS_META[k.status as KegStatus].short}</span>}</span>
    </button>
  );
}

function KegRow({ k, highlight, showArea }: { k: BoardKeg; highlight: boolean; showArea?: boolean }) {
  const c = beerColor(k.color);
  const full = isFull(k.status);
  return (
    <Link href={`/kegs/k/${k.code}`} className={cx("flex min-h-14 items-center gap-3 px-3.5 py-2.5 transition-colors duration-120 active:bg-surface-2", highlight && "bg-good-bg")}>
      <span className="h-8 w-5 shrink-0 rounded-md border-2" style={full ? { background: c.bg, borderColor: c.bg } : { borderColor: c.bg, borderStyle: "dashed" }} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{k.beer ?? "Empty keg"}{highlight && <span className="ml-2 text-xs font-semibold text-good">Take this one</span>}</div>
        <div className="num truncate text-xs text-muted">{[showArea ? k.area : null, k.spotNote, kegSizeInfo(k.sizeId).short, STATUS_META[k.status].short, k.filledOn ? `filled ${shortDate(k.filledOn)}` : null].filter(Boolean).join(" · ")}</div>
      </div>
      <span className="num shrink-0 text-xs text-muted">{displayCode(k.code)}</span>
    </Link>
  );
}
