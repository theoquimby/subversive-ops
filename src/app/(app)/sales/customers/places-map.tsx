"use client";

import { cx } from "@/components/ui";
import { useMemo, useState } from "react";
import { GUEST_VIZ, Swatch, type VizTone } from "./charts";

/**
 * Where the cards that paid here come from: a bubble per town, its area by the
 * number of cards, on a map drawn on the server (state and county lines only).
 * Pick close-to-home or the region, and everyone, locals or visitors. Point at
 * or tap a bubble to read it; the biggest few are named on the map.
 */

type Who = "all" | "local" | "visitor";

export interface MapTown {
  key: string;
  name: string;
  state: string;
  miles: number;
  people: { all: number; local: number; visitor: number; occasional: number };
}

export interface MapViewData {
  key: string;
  label: string;
  w: number;
  h: number;
  land: string;
  stateLines: string;
  countyLines: string | null;
  stateLabels: { name: string; x: number; y: number }[];
  home: { x: number; y: number };
  towns: { key: string; x: number; y: number }[];
  /** Cards from towns outside this map, and a line saying where they are. */
  outside: { people: number; note: string } | null;
}

const WHO: { key: Who; label: string; tone: VizTone }[] = [
  { key: "all", label: "Everyone", tone: "seen" },
  { key: "local", label: "Locals", tone: "local" },
  { key: "visitor", label: "Visitors", tone: "visitor" },
];
const R_MAX = 26;
const LABELS = 6;
const n = (x: number) => Math.round(x).toLocaleString("en-US");
const milesText = (m: number) => (m < 1.5 ? "right here" : `${m < 20 ? Math.round(m) : Math.round(m / 10) * 10} miles away`);

function Chips<T extends string>({ value, options, onChange, label }: { value: T; options: { key: T; label: string; tone?: VizTone }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={o.key === value}
          onClick={() => onChange(o.key)}
          className={cx(
            "inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors duration-120",
            o.key === value ? "border-ink bg-ink text-surface" : "border-border-strong bg-surface text-ink-2 hover:bg-surface-2 hover:text-ink",
          )}
        >
          {o.tone && <Swatch tone={o.tone} round />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function PlacesMap({ views, towns, homeLabel }: { views: MapViewData[]; towns: MapTown[]; homeLabel: string }) {
  const [viewKey, setViewKey] = useState(views[0]?.key ?? "near");
  const [who, setWho] = useState<Who>("all");
  const [active, setActive] = useState<string | null>(null);
  const byKey = useMemo(() => new Map(towns.map((t) => [t.key, t])), [towns]);
  const view = views.find((v) => v.key === viewKey) ?? views[0];
  const tone = WHO.find((w) => w.key === who)!.tone;

  const marks = useMemo(() => {
    if (!view) return [];
    const placed = view.towns.flatMap((p) => {
      const t = byKey.get(p.key);
      return t ? [{ ...p, t }] : [];
    });
    // One scale for every filter, so locals and visitors can be compared bubble for bubble.
    const max = Math.max(1, ...placed.map((m) => m.t.people.all));
    return placed
      .map((m) => ({ ...m, v: m.t.people[who], r: m.t.people[who] > 0 ? Math.max(2.5, Math.sqrt(m.t.people[who] / max) * R_MAX) : 0 }))
      .filter((m) => m.v > 0)
      .sort((a, b) => b.v - a.v);
  }, [view, byKey, who]);

  // Name the biggest few, skipping any that would sit on top of one already named.
  const labelled = useMemo(() => {
    const out: typeof marks = [];
    for (const m of marks) {
      if (out.length >= LABELS) break;
      if (out.some((o) => Math.abs(o.x - m.x) < 70 && Math.abs(o.y - m.y) < 16)) continue;
      out.push(m);
    }
    return out;
  }, [marks]);

  if (!view) return null;
  const shown = marks.reduce((s, m) => s + m.v, 0);
  const hv = active ? byKey.get(active) : null;
  const readout = hv
    ? `${hv.name}, ${hv.state} · ${milesText(hv.miles)} · ${n(hv.people.all)} card${hv.people.all === 1 ? "" : "s"}: ${n(hv.people.local)} local, ${n(hv.people.visitor)} visitor${hv.people.visitor === 1 ? "" : "s"}, ${n(hv.people.occasional)} now and then.`
    : `${n(shown)} ${who === "all" ? "cards" : who === "local" ? "local cards" : "visitor cards"} on this map. Point at or tap a bubble to read it.`;

  return (
    <div className={GUEST_VIZ}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Chips label="Which map" value={viewKey} onChange={(v) => { setViewKey(v); setActive(null); }} options={views.map((v) => ({ key: v.key, label: v.label }))} />
        <Chips label="Whose cards" value={who} onChange={(v) => { setWho(v); setActive(null); }} options={WHO} />
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-surface" onMouseLeave={() => setActive(null)}>
        <svg viewBox={`0 0 ${view.w} ${view.h}`} className="block h-auto w-full" role="img" aria-label={`Map of where ${who === "all" ? "cards" : who === "local" ? "local cards" : "visitor cards"} come from, ${view.label.toLowerCase()}: one bubble per town, sized by the number of cards.`}>
          <path d={view.land} fill="color-mix(in oklab, var(--ink) 7%, var(--surface))" />
          {view.countyLines && <path d={view.countyLines} fill="none" stroke="var(--border-strong)" strokeOpacity={0.55} strokeWidth={0.6} />}
          <path d={view.stateLines} fill="none" stroke="var(--border-strong)" strokeWidth={1.1} />
          {view.stateLabels.map((s) => (
            <text key={s.name} x={s.x} y={s.y} textAnchor="middle" className="pointer-events-none fill-[var(--muted)] text-[11px] font-medium tracking-[0.12em]">
              {s.name}
            </text>
          ))}
          {marks.map((m) => (
            <circle
              key={m.key}
              cx={m.x}
              cy={m.y}
              r={m.r}
              fill={`var(--viz-${tone})`}
              fillOpacity={active && active !== m.key ? 0.35 : 0.72}
              stroke={active === m.key ? "var(--ink)" : "var(--surface)"}
              strokeWidth={active === m.key ? 2 : 1}
              className="cursor-pointer transition-[fill-opacity] duration-150"
              onMouseEnter={() => setActive(m.key)}
              onClick={() => setActive(m.key)}
            />
          ))}
          <g className="pointer-events-none">
            <rect x={view.home.x - 5} y={view.home.y - 5} width={10} height={10} transform={`rotate(45 ${view.home.x} ${view.home.y})`} fill="var(--ink)" stroke="var(--surface)" strokeWidth={1.5} />
            <text x={view.home.x - 10} y={view.home.y} dy="0.34em" textAnchor="end" className="fill-[var(--ink)] text-[12px] font-semibold" paintOrder="stroke" stroke="var(--surface)" strokeWidth={3} strokeLinejoin="round">
              {homeLabel}
            </text>
          </g>
          <g className="pointer-events-none">
            {labelled.map((m) => {
              const text = `${byKey.get(m.key)?.name ?? ""} ${n(m.v)}`;
              // Right of the bubble, unless that would run off the map; then left of it.
              const left = m.x + m.r + 4 + text.length * 6.3 > view.w;
              return (
                <text key={`l-${m.key}`} x={left ? m.x - m.r - 4 : m.x + m.r + 4} y={m.y} dy="0.34em" textAnchor={left ? "end" : "start"} className="fill-[var(--ink-2)] text-[11px] font-medium" paintOrder="stroke" stroke="var(--surface)" strokeWidth={3} strokeLinejoin="round">
                  {text}
                </text>
              );
            })}
          </g>
        </svg>
      </div>
      <p className="mt-2 min-h-10 text-sm leading-snug text-ink-2 sm:min-h-5" aria-live="polite">
        {readout}
      </p>
      {view.outside && view.outside.people > 0 && <p className="mt-1 text-xs text-muted">{view.outside.note}</p>}
      <table className="sr-only">
        <caption>Cards by town, {view.label.toLowerCase()}</caption>
        <thead>
          <tr>
            <th>Town</th>
            <th>Miles</th>
            <th>Cards</th>
            <th>Locals</th>
            <th>Visitors</th>
          </tr>
        </thead>
        <tbody>
          {marks.slice(0, 40).map((m) => (
            <tr key={m.key}>
              <td>{m.t.name}, {m.t.state}</td>
              <td>{Math.round(m.t.miles)}</td>
              <td>{m.t.people.all}</td>
              <td>{m.t.people.local}</td>
              <td>{m.t.people.visitor}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
