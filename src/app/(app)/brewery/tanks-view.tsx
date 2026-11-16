"use client";

import { Card, cx } from "@/components/ui";
import type { NextAction, TankKind } from "@/domain/tankPlan";
import { shortDate } from "@/lib/format";
import type { BatchView, FloorView } from "@/server/services/brewery";
import { ChevronRight, LayoutGrid, List } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BeerDot, KIND_PLURAL } from "./bits";
import { TankCard } from "./floor-client";

type View = "list" | "floor";
const KEY = "brewery.tanksView";

/** The list or the floor plan, remembered in this browser. Until picked: the list on a phone, the floor plan on bigger screens. */
function useView(): [View | null, (v: View) => void] {
  const [view, setView] = useState<View | null>(null);
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(KEY);
    } catch {
      /* private mode */
    }
    setView(saved === "list" || saved === "floor" ? saved : window.matchMedia("(min-width: 768px)").matches ? "floor" : "list");
  }, []);
  const pick = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(KEY, v);
    } catch {
      /* private mode */
    }
  };
  return [view, pick];
}

/** Every tank: as a list of cards (fermenters, then brites), or laid out as they stand on the floor. */
export function TanksView({ f }: { f: FloorView }) {
  const [view, setView] = useView();
  const [selected, setSelected] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const byTank = new Map(f.tanks.map((t) => [t.tank.id, t]));

  // "Needs doing" links point at #tank-<id>: on the floor plan, open that tank.
  useEffect(() => {
    const open = () => {
      const m = /^#tank-(.+)$/.exec(window.location.hash);
      if (m) setSelected(m[1]);
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);
  useEffect(() => {
    if (selected && view === "floor") panel.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selected, view]);

  const card = (id: string, anchor = true) => {
    const t = byTank.get(id);
    if (!t) return null;
    return (
      <TankCard
        key={id}
        anchor={anchor}
        tank={t}
        today={f.today}
        batch={t.now ? f.batches[t.now.batchId] : null}
        next={t.next ? f.batches[t.next.batchId] : null}
        transferTo={f.transferTo}
        plannedBrite={t.now ? f.plannedBrite[t.now.batchId] ?? null : null}
        recipes={f.recipes}
        beers={f.beers}
        unit={f.unit}
        action={f.actions[id] ?? null}
      />
    );
  };
  const groups = (["FERMENTER", "BRITE", "OTHER"] as TankKind[]).map((k) => ({ kind: k, tanks: f.tanks.filter((t) => t.tank.kind === k) })).filter((g) => g.tanks.length);
  // Before the saved choice is read: the list on phones, the plan from tablets up (CSS), so nothing jumps.
  const showList = view === "list" ? "" : view === "floor" ? "hidden" : "md:hidden";
  const showFloor = view === "floor" ? "" : view === "list" ? "hidden" : "hidden md:block";

  return (
    <>
      <div className="mb-4 flex justify-end">
        <div role="tablist" aria-label="How to show the tanks" className="inline-grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1">
          {([["list", "List", List], ["floor", "Floor plan", LayoutGrid]] as const).map(([v, label, Icon]) => {
            const on = view ? view === v : false;
            return (
              <button key={v} role="tab" aria-selected={on} onClick={() => setView(v)} className={cx("inline-flex h-10 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors duration-120 sm:h-8", on ? "bg-surface text-ink shadow-sm" : "text-ink-2 hover:text-ink")}>
                <Icon className="size-4" aria-hidden />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {view !== "list" && (
        <div className={showFloor}>
          <FloorPlan f={f} selected={selected} onSelect={(id) => setSelected(selected === id ? null : id)} />
          <div ref={panel} className="mt-4 scroll-mt-24">
            {selected && byTank.has(selected) ? (
              <div className="max-w-md">{card(selected, false)}</div>
            ) : (
              <p className="text-sm text-muted">Tap a tank to see it and what to do with it.</p>
            )}
          </div>
        </div>
      )}

      {view !== "floor" && (
        <div className={showList}>
          {groups.map((g) => (
            <section key={g.kind} className="mb-10">
              <h2 className="mb-3 text-[0.95rem] font-semibold">{KIND_PLURAL[g.kind]}</h2>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{g.tanks.map((t) => card(t.tank.id))}</div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

const ACTION_TONE: Record<NextAction["tone"], string> = { bad: "bg-bad-bg text-bad", warn: "bg-warn-bg text-warn", neutral: "bg-surface text-ink-2 ring-1 ring-border" };

/** Tile colours by where the brew is: fermenting, conditioning in its fermenter, in a brite, or empty (status tones only). */
function tileTone(stage: "ferment" | "condition" | null, b: BatchView | null) {
  if (!stage || !b) return "border-dashed border-border-strong bg-surface";
  if (stage === "condition") return "border-ink-2/30 bg-surface-2";
  return b.status === "CONDITIONING" ? "border-warn/40 bg-warn-bg" : "border-good/35 bg-good-bg";
}

/** The tanks where they stand, zone by zone, with the brew house first. Scrolls sideways inside its own box on a phone. */
function FloorPlan({ f, selected, onSelect }: { f: FloorView; selected: string | null; onSelect: (id: string) => void }) {
  const byTank = new Map(f.tanks.map((t) => [t.tank.id, t]));
  return (
    <Card className="overflow-x-auto overscroll-x-contain p-4">
      <div className="flex min-w-max flex-wrap items-start gap-x-8 gap-y-6">
        <BrewHouseTile f={f} />
        {f.zones.map((z) => (
          <section key={z.zone ?? "none"} aria-label={z.zone ?? "Not placed yet"} className={cx(z.zone === null && "border-l-2 border-dashed border-border-strong pl-4")}>
            <h3 className="mb-2 text-[0.72rem] font-semibold tracking-wide text-muted uppercase">{z.zone ?? "Not placed yet"}</h3>
            <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${z.cols}, 6.75rem)`, gridTemplateRows: `repeat(${z.rows}, auto)` }}>
              {z.cells.map((c) => {
                const t = byTank.get(c.tankId);
                if (!t) return null;
                const b = t.now ? f.batches[t.now.batchId] ?? null : null;
                const a = f.actions[t.tank.id] ?? null;
                const label = `${t.tank.name}, ${t.tank.capacityBbl} bbl: ${b ? `${b.name}, day ${t.now!.day}` : "empty"}${a ? `. Next: ${a.label}` : ""}`;
                return (
                  <button
                    key={c.tankId}
                    type="button"
                    aria-pressed={selected === c.tankId}
                    aria-label={label}
                    onClick={() => onSelect(c.tankId)}
                    style={{ gridRow: c.row, gridColumn: c.col }}
                    className={cx(
                      "relative flex min-h-[5.75rem] flex-col items-start overflow-hidden rounded-xl border px-2.5 pt-2 pb-2 text-left transition-[box-shadow,transform] duration-120 active:scale-[0.98]",
                      tileTone(t.now?.stage ?? null, b),
                      selected === c.tankId && "ring-2 ring-ink ring-offset-2 ring-offset-surface",
                    )}
                  >
                    <span className="num text-[0.7rem] font-semibold text-ink-2">{t.tank.name} · {t.tank.capacityBbl}</span>
                    {b ? (
                      <>
                        <span className="mt-1 flex w-full min-w-0 items-center gap-1.5">
                          <BeerDot color={b.color} className="size-2.5" />
                          <span className="truncate text-[0.8rem] leading-tight font-medium">{b.name}</span>
                        </span>
                        <span className="num mt-0.5 text-[0.7rem] text-muted">Day {t.now!.day}</span>
                      </>
                    ) : (
                      <span className="mt-1 text-[0.8rem] text-muted">{t.next ? `Next ${shortDate(t.next.start)}` : "Empty"}</span>
                    )}
                    {a && <span className={cx("mt-auto inline-flex max-w-full truncate rounded-md px-1.5 py-0.5 text-[0.68rem] font-medium", ACTION_TONE[a.tone])}>{a.label}</span>}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      <ul className="mt-5 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted" aria-label="Key">
        <li className="flex items-center gap-1.5"><span className="size-3 rounded border border-good/35 bg-good-bg" />Fermenting</li>
        <li className="flex items-center gap-1.5"><span className="size-3 rounded border border-warn/40 bg-warn-bg" />Conditioning in its fermenter</li>
        <li className="flex items-center gap-1.5"><span className="size-3 rounded border border-ink-2/30 bg-surface-2" />In a brite</li>
        <li className="flex items-center gap-1.5"><span className="size-3 rounded border border-dashed border-border-strong bg-surface" />Empty</li>
      </ul>
    </Card>
  );
}

/** The brew house: a brew day under way (resume it), else the next planned brew (start it). */
function BrewHouseTile({ f }: { f: FloorView }) {
  const h = f.brewHouse;
  return (
    <section aria-label="Brew house">
      <h3 className="mb-2 text-[0.72rem] font-semibold tracking-wide text-muted uppercase">Brew house</h3>
      <div className="flex w-[13.75rem] flex-col gap-2">
        {h.inProgress ? (
          <Link href={`/brewery/brew/${h.inProgress.id}`} className="flex min-h-[5.75rem] flex-col rounded-xl border border-warn/40 bg-warn-bg px-3 py-2 transition-transform duration-120 active:scale-[0.98]">
            <span className="text-[0.7rem] font-semibold text-warn">Brew day under way</span>
            <span className="mt-1 truncate text-sm font-medium">{h.inProgress.name}</span>
            <span className="num text-[0.7rem] text-muted">{h.inProgress.code}</span>
            <span className="mt-auto inline-flex items-center gap-0.5 text-xs font-medium text-ink">Resume<ChevronRight className="size-3.5" /></span>
          </Link>
        ) : h.next ? (
          <Link href={`/brewery/brew?batch=${h.next.id}`} className="flex min-h-[5.75rem] flex-col rounded-xl border border-border-strong bg-surface px-3 py-2 transition-transform duration-120 hover:bg-surface-2 active:scale-[0.98]">
            <span className="text-[0.7rem] font-semibold text-ink-2">Next brew · {h.next.on === f.today ? "today" : shortDate(h.next.on)}</span>
            <span className="mt-1 truncate text-sm font-medium">{h.next.name}</span>
            <span className="num text-[0.7rem] text-muted">{h.next.code}{h.next.on < f.today ? " · day passed" : ""}</span>
            <span className="mt-auto inline-flex items-center gap-0.5 text-xs font-medium text-ink">Start brew day<ChevronRight className="size-3.5" /></span>
          </Link>
        ) : (
          <div className="flex min-h-[5.75rem] flex-col justify-center rounded-xl border border-dashed border-border-strong px-3 py-2 text-sm text-muted">Nothing planned.</div>
        )}
        <Link href="/brewery/brew" className="inline-flex min-h-10 items-center text-xs font-medium text-ink-2 underline-offset-2 hover:text-ink hover:underline">Start a brew day</Link>
      </div>
    </section>
  );
}
