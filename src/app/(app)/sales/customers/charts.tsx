"use client";

import { cx } from "@/components/ui";
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";

/*
 * Customers page charts. One colour per job, the same on every chart here:
 *   locals        blue    (--series-1)
 *   visitors      pink    (--series-2)
 *   came back     violet, a three-step ramp: the darker, the more often (lighter in dark mode)
 *   everyone else warm grey; hatched when it's too soon to say
 *   gone quiet    the warn colour, always with its name beside it
 * Blue and pink are the app's validated two-series pair. The violet ramp passes the
 * ordinal checks (dataviz validate_palette --ordinal) in both modes: light
 * #a99ff0 · #7a68e0 · #4a3aa7 on #fff, dark #5a4fb5 · #8b7fe8 · #c2bbf6 on #1a1a18.
 * Blue and violet never share a chart. Text stays in text tokens; a share printed
 * inside a block is white or near-black by the block's lightness.
 */
export const GUEST_VIZ = [
  "[--viz-local:var(--series-1)] [--viz-local-ink:#fff]",
  "[--viz-visitor:var(--series-2)] [--viz-visitor-ink:#fff] dark:[--viz-visitor-ink:#1b1a18]",
  "[--viz-back-1:#a99ff0] [--viz-back-1-ink:#1b1a18] dark:[--viz-back-1:#5a4fb5] dark:[--viz-back-1-ink:#fff]",
  "[--viz-back-2:#7a68e0] [--viz-back-2-ink:#fff] dark:[--viz-back-2:#8b7fe8] dark:[--viz-back-2-ink:#1b1a18]",
  "[--viz-back-3:#4a3aa7] [--viz-back-3-ink:#fff] dark:[--viz-back-3:#c2bbf6] dark:[--viz-back-3-ink:#1b1a18]",
  "[--viz-rest:#b5b2aa] [--viz-rest-ink:#1b1a18] dark:[--viz-rest:#55534e] dark:[--viz-rest-ink:#fff]",
  "[--viz-quiet:var(--warn)] [--viz-quiet-ink:#fff] dark:[--viz-quiet-ink:#1b1a18]",
  "[--viz-seen:var(--ink-2)] [--viz-seen-ink:var(--surface)]",
].join(" ");

export type VizTone = "local" | "visitor" | "back-1" | "back-2" | "back-3" | "rest" | "quiet" | "seen";
const fill = (t: VizTone) => `var(--viz-${t})`;
const ink = (t: VizTone) => `var(--viz-${t}-ink)`;
/** "Too soon to say": the grey, hatched. */
const hatched: CSSProperties = {
  backgroundColor: "color-mix(in oklab, var(--viz-rest) 30%, transparent)",
  backgroundImage: "repeating-linear-gradient(135deg, var(--viz-rest) 0 1.5px, transparent 1.5px 5px)",
};

function useWidth(min = 220) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(320);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(min, Math.round(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [min]);
  return { ref, w };
}

export function Swatch({ tone, hatch, round }: { tone: VizTone; hatch?: boolean; round?: boolean }) {
  return <span aria-hidden className={cx("inline-block size-2.5 shrink-0", round ? "rounded-full" : "rounded-[3px]")} style={hatch ? hatched : { background: fill(tone) }} />;
}

/** What each colour means, said once for the whole page. */
export function ColourKey({ items }: { items: { tone: VizTone; label: string; hint: string }[] }) {
  return (
    <ul className={cx("flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-muted", GUEST_VIZ)}>
      {items.map((i) => (
        <li key={i.label} className="inline-flex items-center gap-1.5">
          <Swatch tone={i.tone} />
          <span>
            <span className="font-medium text-ink-2">{i.label}</span> {i.hint}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ---- One whole, split into parts; two of them linked ------------------------------------------

export interface SharePart {
  key: string;
  label: string;
  tone: VizTone;
  hatch?: boolean;
  /** What this part says, in a sentence. Shown under the bars when it's pointed at. */
  readout: string;
}

export interface ShareRow {
  label: string;
  /** Each part's share of this row (0 to 1), by key. */
  shares: Record<string, number>;
}

const BAR = 28;
const LINK = 30;
const GAP = 2;

/** Lay parts out along `w`, with a 2px gap between them and nothing thinner than 3px. */
function layout(parts: SharePart[], shares: Record<string, number>, w: number) {
  const shown = parts.filter((p) => (shares[p.key] ?? 0) > 0);
  const total = shown.reduce((s, p) => s + shares[p.key], 0) || 1;
  const room = w - GAP * Math.max(0, shown.length - 1);
  const widths = shown.map((p) => Math.max(3, (shares[p.key] / total) * room));
  const over = widths.reduce((s, x) => s + x, 0) - room;
  if (over > 0) widths[widths.indexOf(Math.max(...widths))] -= over;
  const out = new Map<string, { x: number; w: number; share: number }>();
  let x = 0;
  shown.forEach((p, i) => {
    out.set(p.key, { x, w: widths[i], share: shares[p.key] / total });
    x += widths[i] + GAP;
  });
  return out;
}

/**
 * The same people counted two ways, one bar under the other, with each group
 * joined across: a sliver of the cards can be a thick slice of the money.
 * With one row it's a plain split bar. Point at a part (or its name in the key)
 * and the line underneath says what it is.
 */
export function ShareBars({ parts, rows, lead, ariaLabel }: { parts: SharePart[]; rows: ShareRow[]; lead: string; ariaLabel: string }) {
  const { ref, w: W } = useWidth(200);
  const [hover, setHover] = useState<string | null>(null);
  const id = useId();
  const lay = rows.map((r) => layout(parts, r.shares, W));
  const two = rows.length > 1;
  const H = two ? BAR * 2 + LINK : BAR;
  const hv = parts.find((p) => p.key === hover) ?? null;
  const pctText = (x: number) => (x > 0 && x < 0.005 ? "<1%" : `${Math.round(x * 100)}%`);
  const dim = (key: string) => (hover && hover !== key ? 0.35 : 1);

  return (
    <div className={GUEST_VIZ} onMouseLeave={() => setHover(null)}>
      {two && <div className="mb-1.5 text-xs text-muted">{rows[0].label}</div>}
      <div ref={ref}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block" role="group" aria-label={ariaLabel}>
          <defs>
            <pattern id={`${id}-hatch`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="5" height="5" fill="var(--viz-rest)" fillOpacity={0.3} />
              <rect width="1.5" height="5" fill="var(--viz-rest)" />
            </pattern>
          </defs>
          {two &&
            parts.map((p) => {
              const a = lay[0].get(p.key);
              const b = lay[1].get(p.key);
              if (!a || !b) return null;
              return (
                <path
                  key={`link-${p.key}`}
                  d={`M${a.x},${BAR}H${a.x + a.w}L${b.x + b.w},${BAR + LINK}H${b.x}Z`}
                  fill={fill(p.tone)}
                  opacity={hover === p.key ? 0.34 : hover ? 0.06 : 0.16}
                  className="transition-opacity duration-180"
                  onMouseEnter={() => setHover(p.key)}
                />
              );
            })}
          {rows.map((r, ri) =>
            parts.map((p) => {
              const g = lay[ri].get(p.key);
              if (!g) return null;
              const y = ri === 0 ? 0 : BAR + LINK;
              return (
                <g key={`${ri}-${p.key}`} opacity={dim(p.key)} className="transition-opacity duration-180">
                  <rect
                    x={g.x}
                    y={y}
                    width={g.w}
                    height={BAR}
                    rx={Math.min(4, g.w / 2)}
                    fill={p.hatch ? `url(#${id}-hatch)` : fill(p.tone)}
                    tabIndex={0}
                    role="img"
                    aria-label={`${r.label}: ${p.label}, ${pctText(g.share)}. ${p.readout}`}
                    onMouseEnter={() => setHover(p.key)}
                    onFocus={() => setHover(p.key)}
                    onBlur={() => setHover(null)}
                    onTouchStart={() => setHover(p.key)}
                    className="outline-none focus-visible:stroke-[var(--focus)] focus-visible:stroke-2"
                  />
                  {g.w >= 44 && (
                    <text x={g.x + 8} y={y + BAR / 2} dy="0.34em" className="num pointer-events-none text-xs font-medium" fill={p.hatch ? "var(--ink-2)" : ink(p.tone)}>
                      {pctText(g.share)}
                    </text>
                  )}
                </g>
              );
            }),
          )}
        </svg>
      </div>
      {two && <div className="mt-1.5 text-xs text-muted">{rows[1].label}</div>}
      <div className="mt-3 flex flex-wrap gap-x-1 gap-y-1 text-xs text-muted">
        {parts.map((p) => (
          <button
            key={p.key}
            type="button"
            onMouseEnter={() => setHover(p.key)}
            onFocus={() => setHover(p.key)}
            onBlur={() => setHover(null)}
            onClick={() => setHover(hover === p.key ? null : p.key)}
            aria-pressed={hover === p.key}
            className={cx("-ml-1.5 inline-flex min-h-7 items-center gap-1.5 rounded-md px-1.5 transition-colors duration-120 hover:bg-surface-2", hover === p.key && "bg-surface-2 text-ink")}
          >
            <Swatch tone={p.tone} hatch={p.hatch} />
            {p.label}
          </button>
        ))}
      </div>
      <p className="mt-2 min-h-10 text-sm leading-snug text-ink-2 sm:min-h-5" aria-live="polite">
        {hv ? hv.readout : lead}
      </p>
    </div>
  );
}

// ---- Stacked columns ---------------------------------------------------------------------------

export interface Col {
  key: string;
  label: string;
  /** A second line under the label, when there's room for one. */
  sub?: string;
  /** The column the story is about. */
  mark?: boolean;
  /** One value per series, bottom first. */
  parts: number[];
  tip: { title: string; rows: { tone?: VizTone; label: string; value: string; strong?: boolean }[] };
}

const compactMoney = (n: number) => (n >= 10_000 ? `$${Math.round(n / 1000)}K` : n >= 1_000 ? `$${(n / 1000).toFixed(1).replace(/\.0$/, "")}K` : `$${Math.round(n)}`);
const plain = (n: number) => Math.round(n).toLocaleString("en-US");

function niceTicks(max: number): number[] {
  const raw = Math.max(max, 1e-9) / 3;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = 0; v < max + step * 0.001; v += step) out.push(v);
  if (out.at(-1)! < max) out.push(out.at(-1)! + step);
  return out;
}

function roundTop(x: number, y: number, w: number, h: number, r: number) {
  if (h <= 0) return "";
  if (r <= 0) return `M${x},${y}h${w}v${h}h${-w}z`;
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}z`;
}

/**
 * Columns split into who or what they're made of, with a line of detail on
 * hover or tap. The marked column sits on a soft band; a second label line
 * (a share, say) shows when the columns are wide enough to carry it.
 */
export function Columns({ cols, series, money = true, height = 200, ariaLabel, caption }: { cols: Col[]; series: { tone: VizTone; label: string }[]; money?: boolean; height?: number; ariaLabel: string; caption: string }) {
  const { ref, w: W } = useWidth(240);
  const [hover, setHover] = useState<number | null>(null);
  const fmt = money ? compactMoney : plain;
  const band0 = (W - 44) / Math.max(1, cols.length);
  const subs = cols.some((c) => c.sub) && band0 >= 46;
  const H = height + (subs ? 14 : 0);
  const pad = { top: 10, right: 4, bottom: subs ? 36 : 22, left: 40 };
  const max = Math.max(1, ...cols.map((c) => c.parts.reduce((s, v) => s + Math.max(0, v), 0))) * 1.06;
  const ticks = niceTicks(max);
  const top = ticks.at(-1)!;
  const band = (W - pad.left - pad.right) / Math.max(1, cols.length);
  const barW = Math.max(5, Math.min(24, band * 0.62));
  const x = (i: number) => pad.left + band * i + band / 2;
  const y = (v: number) => pad.top + (1 - v / top) * (H - pad.top - pad.bottom);
  const labelEvery = Math.max(1, Math.ceil(Math.max(...cols.map((c) => c.label.length)) * 6.5 / band));
  const hv = hover == null ? null : cols[hover];

  return (
    <div className={GUEST_VIZ}>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        {series.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <Swatch tone={s.tone} /> {s.label}
          </span>
        ))}
      </div>
      <div className="relative" ref={ref}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block" role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
              <text x={pad.left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="num fill-muted text-[11px]">{fmt(t)}</text>
            </g>
          ))}
          {cols.map((c, i) => {
            const segs = c.parts.map((v, k) => ({ v: Math.max(0, v), tone: series[k].tone })).filter((s) => s.v > 0);
            let acc = 0;
            const last = segs.length - 1;
            return (
              <g key={c.key} opacity={hover == null || hover === i ? 1 : 0.55} className="transition-opacity duration-180">
                {c.mark && <rect x={x(i) - band / 2 + 1} y={pad.top - 6} width={band - 2} height={H - pad.top + 4} rx={6} fill="var(--surface-2)" />}
                {segs.map((s, k) => {
                  const y0 = y(acc);
                  acc += s.v;
                  const y1 = y(acc);
                  const h = Math.max(0, y0 - y1 - (k < last ? GAP : 0));
                  return <path key={k} d={roundTop(x(i) - barW / 2, y1, barW, h, k === last ? Math.min(4, h) : 0)} fill={fill(s.tone)} />;
                })}
                {i % labelEvery === (cols.length - 1) % labelEvery && (
                  <text x={x(i)} y={H - (subs ? 20 : 6)} textAnchor="middle" className={cx("text-[11px]", c.mark ? "fill-ink font-medium" : "fill-muted")}>{c.label}</text>
                )}
                {subs && c.sub && (
                  <text x={x(i)} y={H - 6} textAnchor="middle" className={cx("num text-[11px]", c.mark ? "fill-ink font-semibold" : "fill-muted")}>{c.sub}</text>
                )}
              </g>
            );
          })}
          <line x1={pad.left} x2={W - pad.right} y1={y(0)} y2={y(0)} stroke="var(--border-strong)" strokeWidth={1} />
          {cols.map((c, i) => (
            <rect
              key={`hit-${c.key}`}
              x={x(i) - band / 2}
              y={0}
              width={band}
              height={H}
              fill="transparent"
              tabIndex={0}
              aria-label={`${c.tip.title}: ${c.tip.rows.map((r) => `${r.label} ${r.value}`).join(", ")}`}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              onTouchStart={() => setHover(i)}
              className="outline-none"
            />
          ))}
        </svg>
        {hv && (
          <div className="pointer-events-none absolute top-0 z-10 w-56 -translate-x-1/2 rounded-lg border border-border bg-surface px-2.5 py-2 text-xs shadow-md" style={{ left: Math.min(Math.max(x(hover!), 116), W - 116) }}>
            <div className="mb-1 text-muted">{hv.tip.title}</div>
            {hv.tip.rows.map((r) => (
              <div key={r.label} className="flex items-center justify-between gap-3 py-0.5">
                <span className="inline-flex items-center gap-1.5 text-muted">
                  {r.tone ? <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: fill(r.tone) }} /> : <span className="w-3" />}
                  {r.label}
                </span>
                <span className={cx("num text-ink", r.strong ? "font-semibold" : "font-medium")}>{r.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="sr-only">
        <table data-no-resize="">
          <caption>{caption}</caption>
          <thead>
            <tr>
              <th>{caption}</th>
              {series.map((s) => <th key={s.label}>{s.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {cols.map((c) => (
              <tr key={c.key}>
                <td>{c.tip.title}</td>
                {c.parts.map((v, k) => <td key={k}>{money ? `$${plain(v)}` : plain(v)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- Who buys what -----------------------------------------------------------------------------

export interface LeanRow {
  key: string;
  name: string;
  hint?: string | null;
  /** Share of this item's card sales from locals, and from visitors (the rest is everyone else). */
  local: number;
  visitor: number;
  /** The figure the row is about, printed at the end. */
  value: string;
  /** The first row: everything on the menu, the yardstick for the rest. */
  base?: boolean;
}

/**
 * Each item as one thin bar of who bought it: locals from the left, visitors
 * from the right. Two small notches mark where the split falls for everything
 * sold, so a bar that runs past a notch is something that group buys more of.
 */
export function LeanRows({ groups, baseLocal, baseVisitor }: { groups: { title?: string; valueLabel: string; rows: LeanRow[] }[]; baseLocal: number; baseVisitor: number }) {
  const notch = (left: number) => <span aria-hidden className="absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-ink" style={{ left: `${left * 100}%` }} />;
  return (
    <div className={GUEST_VIZ}>
      <div className="grid gap-x-10 gap-y-6 lg:grid-cols-2">
      {groups.map((g, gi) => (
        <div key={g.title ?? gi}>
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h4 className="text-sm font-medium text-ink">{g.title}</h4>
            <span className="text-xs text-muted">{g.valueLabel}</span>
          </div>
          <ul className="space-y-3 sm:space-y-2">
            {g.rows.map((r) => {
              const rest = Math.max(0, 1 - r.local - r.visitor);
              return (
                <li key={r.key} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5 sm:grid-cols-[11rem_1fr_3rem]">
                  <div className="min-w-0">
                    <span className={cx("block truncate text-sm", r.base ? "text-ink-2" : "font-medium text-ink")}>{r.name}</span>
                    {r.hint && <span className="block truncate text-xs text-muted">{r.hint}</span>}
                  </div>
                  <div className="relative col-span-2 flex h-2 gap-[2px] sm:col-span-1 sm:col-start-2 sm:row-start-1" role="img" aria-label={`${r.name}: ${Math.round(r.local * 100)}% from locals, ${Math.round(r.visitor * 100)}% from visitors`}>
                    {r.local > 0 && <span className="rounded-full" style={{ flexGrow: r.local, flexBasis: 0, background: fill("local"), opacity: r.base ? 0.55 : 1 }} />}
                    {rest > 0.004 && <span className="rounded-full" style={{ flexGrow: rest, flexBasis: 0, background: fill("rest"), opacity: r.base ? 0.55 : 1 }} />}
                    {r.visitor > 0 && <span className="rounded-full" style={{ flexGrow: r.visitor, flexBasis: 0, background: fill("visitor"), opacity: r.base ? 0.55 : 1 }} />}
                    {!r.base && notch(baseLocal)}
                    {!r.base && notch(1 - baseVisitor)}
                  </div>
                  <div className={cx("num col-start-2 row-start-1 text-right text-sm whitespace-nowrap sm:col-start-3", r.base ? "text-muted" : "font-semibold text-ink")}>{r.value}</div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5"><Swatch tone="local" /> From locals</span>
        <span className="inline-flex items-center gap-1.5"><Swatch tone="rest" /> Now and then</span>
        <span className="inline-flex items-center gap-1.5"><Swatch tone="visitor" /> From visitors</span>
        <span className="inline-flex items-center gap-1.5"><span aria-hidden className="inline-block h-3 w-0.5 rounded-full bg-ink" /> Where the split falls for everything sold</span>
      </div>
    </div>
  );
}

// ---- Two groups, side by side ------------------------------------------------------------------

export interface PairRow {
  name: string;
  hint?: string;
  local: number;
  visitor: number;
}

/** Locals' share and visitors' share of their own spending, one thin bar each, value at the tip. */
export function PairBars({ rows, mark }: { rows: PairRow[]; mark?: string | null }) {
  const max = Math.max(0.01, ...rows.map((r) => Math.max(r.local, r.visitor)));
  const bar = (v: number, tone: VizTone, who: string) => (
    <div className="flex items-center gap-2">
      <div className="h-2 min-w-[2px] rounded-r-[4px]" style={{ width: `calc((100% - 2.75rem) * ${(v / max).toFixed(4)})`, background: fill(tone) }} />
      <span className="num w-9 shrink-0 text-xs text-ink-2">
        {Math.round(v * 100)}%<span className="sr-only"> of {who}&apos; spend</span>
      </span>
    </div>
  );
  return (
    <div className={GUEST_VIZ}>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5"><Swatch tone="local" /> Of what locals spend</span>
        <span className="inline-flex items-center gap-1.5"><Swatch tone="visitor" /> Of what visitors spend</span>
      </div>
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.name} className={cx("grid grid-cols-1 items-center gap-x-4 gap-y-1 sm:grid-cols-[11rem_1fr]", mark === r.name && "-mx-2 rounded-lg bg-surface-2 px-2 py-1.5")}>
            <div className="min-w-0">
              <span className="block truncate text-sm font-medium text-ink">{r.name}</span>
              {r.hint && <span className="block text-xs text-muted">{r.hint}</span>}
            </div>
            <div className="space-y-1 border-l border-border-strong">
              {bar(r.local, "local", "locals")}
              {bar(r.visitor, "visitor", "visitors")}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---- Of every hundred --------------------------------------------------------------------------

export interface WafflePart {
  key: string;
  label: string;
  tone: VizTone;
  /** How many of the hundred. */
  count: number;
  note?: string;
}

/** A hundred dots, coloured by what became of them. */
export function Waffle({ parts, ariaLabel }: { parts: WafflePart[]; ariaLabel: string }) {
  const dots: VizTone[] = [];
  for (const p of parts) for (let i = 0; i < p.count && dots.length < 100; i++) dots.push(p.tone);
  return (
    <div className={cx("flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-8", GUEST_VIZ)}>
      <div className="grid w-fit shrink-0 grid-cols-10 gap-[5px]" role="img" aria-label={ariaLabel}>
        {dots.map((t, i) => (
          <span key={i} className="size-3 rounded-full sm:size-3.5" style={{ background: fill(t), opacity: t === "rest" ? 0.5 : 1 }} />
        ))}
      </div>
      <ul className="space-y-2 text-sm">
        {parts.map((p) => (
          <li key={p.key} className="flex items-baseline gap-2.5">
            <span className="translate-y-px"><Swatch tone={p.tone} round /></span>
            <span className="num w-7 shrink-0 text-right font-semibold text-ink">{p.count}</span>
            <span className="text-ink-2">
              {p.label}
              {p.note && <span className="block text-xs text-muted">{p.note}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
