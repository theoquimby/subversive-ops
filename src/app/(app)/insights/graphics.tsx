"use client";

import { useMemo } from "react";
import { cx } from "@/components/ui";
import type { Evidence, EvidenceRow, InputRow } from "@/domain/analytics";
import { priceWhatIf } from "@/domain/analytics";
import { addDays, daysBetween } from "@/domain/dates";
import type { SlowDay, Visual } from "@/domain/lab";
import { shortDate } from "@/lib/format";
import type { DeckAction, FitLite } from "./deck-data";
import { DotStrip, Key, niceTicks, signedMoney, signedPct, SrTable, Takeaway, Tip, TipLabel, TipValue, tickMoney, useActive, useWidth, whole } from "./kit";

/**
 * Story graphics: one purpose-built picture per kind of insight, so the
 * "what's happening" reads at a glance. Each is drawn from what the finding
 * already carries (its visual, evidence and inputs) — no extra data needed.
 *
 *   price try / reprice → profit curve across prices, likely range shaded, $X and $X+1 marked
 *   staffing.over       → hour strip: people on vs needed, the fair range, the extra people
 *   slow days           → calendar of slow days (foreseeable vs surprise) + paid hours vs trimmed
 *   an hour that loses  → waterfall: sales − food & drink − wages, and the weeks it lost money
 *   price follow-up     → before → after per 100 orders, last year's same weeks, the expected band
 *   an unusual day      → expected (with its normal range) vs what happened
 *   anything else       → clean labelled bars
 */

export type GraphicSource = Pick<DeckAction, "kind" | "visual" | "evidence" | "inputs" | "how" | "title" | "monthly" | "low" | "high"> & { fit?: FitLite | null };

// ---- Parsing helpers (numbers out of the plain-English rows) -------------------------------

export const numOf = (s: string | undefined | null) => {
  if (!s) return null;
  const m = s.replace(/,/g, "").replace(/−/g, "-").match(/-?\$?\s?(-?\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) * (/^\s*[−-]/.test(s) && !m[0].startsWith("-") ? -1 : 1) : null;
};
const inputNum = (inputs: InputRow[] | undefined, re: RegExp) => numOf(inputs?.find((i) => re.test(i.label))?.value);
const rowNum = (rows: EvidenceRow[] | undefined, re: RegExp) => numOf(rows?.find((r) => re.test(r.label))?.value);
const ofCount = (text: string) => {
  const m = text.match(/(?:lost money|it was over|over) in (\d+) of (?:the last )?(\d+)/i);
  return m ? { hit: Number(m[1]), total: Number(m[2]) } : null;
};

const is = (kind: string, prefix: string) => kind === prefix || kind.startsWith(`${prefix}.`);

/** Which graphic tells this finding's story (null: none worth drawing). */
export function graphicFor(a: GraphicSource): string | null {
  if (is(a.kind, "price.test") || is(a.kind, "menu.reprice")) return priceFitOf(a) ? "price" : a.visual ? "compare" : null;
  if (is(a.kind, "feed.follow")) return followOf(a.evidence) ? "follow" : a.visual ? "compare" : null;
  if (is(a.kind, "anomaly.slowdays")) return "slowdays";
  if (is(a.kind, "feed.hours")) return a.visual?.type === "compare" ? "hour" : null;
  if (a.visual?.type === "hours") return "staff";
  if (is(a.kind, "staffing.over") && a.evidence?.chart?.type === "compare") return "staffCompare";
  if (a.visual?.type === "week") return "week";
  if (is(a.kind, "anomaly") && expectedOf(a.evidence)) return "expected";
  if (a.visual?.type === "compare") return "compare";
  return null;
}

export function StoryGraphic({ a, compact }: { a: GraphicSource; compact?: boolean }) {
  const g = graphicFor(a);
  if (g === "price") return <PriceCurve a={a} fit={priceFitOf(a)!} compact={compact} />;
  if (g === "follow") return <FollowSlope f={followOf(a.evidence)!} />;
  if (g === "slowdays") return <SlowDays a={a} />;
  if (g === "hour") return <HourWaterfall a={a} />;
  if (g === "staff") return <StaffHours rows={(a.visual as Extract<Visual, { type: "hours" }>).rows} comp={inputNum(a.inputs, /comparable hours/i) ?? rowNum(a.evidence?.rows, /other hours with about the same/i)} weeks={ofCount(a.evidence?.rows.map((r) => `${r.label} ${r.value ?? ""}`).join(" ") ?? "") ?? weeksOver(a.evidence)} />;
  if (g === "staffCompare") return <PeopleCompare chart={a.evidence!.chart as Extract<NonNullable<Evidence["chart"]>, { type: "compare" }>} />;
  if (g === "week") return <WeekStrip rows={(a.visual as Extract<Visual, { type: "week" }>).rows} />;
  if (g === "expected") return <ExpectedActual e={expectedOf(a.evidence)!} />;
  if (g === "compare" && a.visual?.type === "compare") return <CompareBars rows={a.visual.rows} unit={a.visual.unit} />;
  return null;
}

function weeksOver(ev: Evidence | null | undefined) {
  const r = ev?.rows.find((x) => /weeks it was over/i.test(x.label));
  const m = r?.value?.match(/(\d+) of (\d+)/);
  return m ? { hit: Number(m[1]), total: Number(m[2]) } : null;
}

// ---- Price: the profit curve -----------------------------------------------------------------

/** The model's fit when the page sent it, else one rebuilt from the finding (price, cost, sold a month, the expected drop from +$1). */
export function priceFitOf(a: GraphicSource): FitLite | null {
  if (a.fit && a.fit.price > 0) return a.fit;
  const price = inputNum(a.inputs, /^price now/i) ?? rowNum(a.evidence?.rows, /^price now/i);
  const qty = inputNum(a.inputs, /sold (per|a) month/i) ?? rowNum(a.evidence?.rows, /^sold a month/i);
  const cost = inputNum(a.inputs, /^cost/i) ?? 0;
  const eff = a.evidence?.effect;
  if (!price || !qty || !eff || price <= 1) return null;
  const k = Math.log((price + 1) / price);
  const e = Math.log(1 + Math.max(-0.95, eff.mid)) / k;
  const eLow = Math.log(1 + Math.max(-0.95, eff.low)) / k;
  return { price, unitCost: cost, qtyMonth: qty, elasticity: Math.min(-0.01, e), sd: Math.max(0.05, Math.abs(eLow - e) / 1.28), source: "typical" };
}

const money2 = (n: number) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);

export function PriceCurve({ a, fit, compact, mark = 1, name: givenName, from = -1, takeaway = true }: { a?: GraphicSource; fit: FitLite; compact?: boolean; mark?: number; name?: string; from?: number; takeaway?: boolean }) {
  const { ref, w } = useWidth(360);
  const { active, setActive } = useActive<number>();
  const H = compact ? 170 : 200;
  const pad = { l: 46, r: 14, t: 18, b: 30 };
  const steps = useMemo(() => {
    const out: { d: number; price: number; mid: number; low: number; high: number; qty: number }[] = [];
    for (let d = from; d <= 3.001; d += 0.25) {
      if (fit.price + d <= 0.25) continue;
      const r = priceWhatIf(fit, d);
      out.push({ d, price: fit.price + d, mid: r.profit, low: r.low, high: r.high, qty: r.qty });
    }
    return out;
  }, [fit, from]);
  const lo = Math.min(0, ...steps.map((s) => s.low));
  const hi = Math.max(0, ...steps.map((s) => s.high));
  const ticks = niceTicks(lo, hi, 3);
  const y0 = ticks[0];
  const y1 = ticks.at(-1)!;
  const X = (p: number) => pad.l + ((p - steps[0].price) / (steps.at(-1)!.price - steps[0].price)) * (w - pad.l - pad.r);
  const Y = (v: number) => pad.t + (1 - (v - y0) / (y1 - y0)) * (H - pad.t - pad.b);
  const line = steps.map((s, i) => `${i ? "L" : "M"}${X(s.price).toFixed(1)},${Y(s.mid).toFixed(1)}`).join(" ");
  const band = `${steps.map((s, i) => `${i ? "L" : "M"}${X(s.price).toFixed(1)},${Y(s.high).toFixed(1)}`).join(" ")} ${[...steps].reverse().map((s) => `L${X(s.price).toFixed(1)},${Y(s.low).toFixed(1)}`).join(" ")} Z`;
  const plus = Math.abs(mark) < 0.01 ? undefined : steps.find((s) => Math.abs(s.d - mark) < 0.01);
  const h = active == null ? null : steps[active];
  const step = (w - pad.l - pad.r) / Math.max(1, steps.length - 1);
  const name = givenName ?? (a?.title ?? "").replace(/^Try \$1 more on (the )?/i, "").replace(/^Raise (the )?/i, "");
  // The label sits above the likely band at that price (below it if there's no room), never on the line.
  const px = plus ? X(plus.price) : 0;
  const anchor: "start" | "middle" | "end" = px < pad.l + 40 ? "start" : px > w - 50 ? "end" : "middle";
  const lx = anchor === "start" ? px - 4 : anchor === "end" ? px + 4 : px;
  const above = plus ? Y(plus.high) - 24 : 0;
  const ly = plus ? (above > pad.t + 2 ? above : Y(plus.low) + 16) : 0;
  return (
    <figure className="min-w-0" aria-label={`Profit a month at each price for ${name}. At ${money2(fit.price + 1)}: ${plus ? signedMoney(plus.mid) : ""} a month, likely ${plus ? `${signedMoney(plus.low)} to ${signedMoney(plus.high)}` : ""}.`}>
      <figcaption className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <Key look="line">Extra profit a month</Key>
        <Key look="wash">Likely range</Key>
      </figcaption>
      <div ref={ref} className="relative w-full" onMouseLeave={() => setActive(null)}>
        <svg width={w} height={H} className="block overflow-visible" aria-hidden>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={w - pad.r} y1={Y(t)} y2={Y(t)} stroke={t === 0 ? "var(--border-strong)" : "var(--lab-grid)"} strokeWidth={1} />
              <text x={pad.l - 8} y={Y(t)} dy="0.32em" textAnchor="end" className="num fill-muted text-[10.5px]">{t === 0 ? "$0" : `${t > 0 ? "+" : "−"}${tickMoney(Math.abs(t))}`}</text>
            </g>
          ))}
          <path d={band} fill="var(--lab-accent-wash)" className="lab-fade" />
          <line x1={X(fit.price)} x2={X(fit.price)} y1={pad.t - 6} y2={H - pad.b} stroke="var(--border-strong)" strokeWidth={1} />
          <text x={X(fit.price) - 6} y={pad.t - 4} textAnchor="end" className="fill-muted text-[10.5px]">today</text>
          <path d={line} pathLength={1} fill="none" stroke="var(--lab-accent)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="lab-draw" />
          {plus && (
            <g>
              <line x1={X(plus.price)} x2={X(plus.price)} y1={Y(plus.mid)} y2={H - pad.b} stroke="var(--lab-accent-2)" strokeWidth={1} />
              <circle cx={X(plus.price)} cy={Y(plus.mid)} r={5} fill="var(--lab-accent)" stroke="var(--surface)" strokeWidth={2} className={takeaway ? "lab-pop" : undefined} style={{ animationDelay: "650ms" }} />
              <text x={lx} y={ly} textAnchor={anchor} className="num fill-ink text-[12px] font-semibold">{signedMoney(plus.mid)}/mo</text>
              <text x={lx} y={ly + 13} textAnchor={anchor} className="fill-muted text-[10.5px]">at {money2(plus.price)}</text>
            </g>
          )}
          {steps.filter((s) => Number.isInteger(s.d)).map((s) => (
            <text key={s.d} x={X(s.price)} y={H - 10} textAnchor="middle" className={cx("num text-[10.5px]", s.d === 0 || s.d === 1 ? "fill-ink-2 font-medium" : "fill-muted")}>{money2(s.price)}</text>
          ))}
          {h && (
            <g>
              <line x1={X(h.price)} x2={X(h.price)} y1={pad.t} y2={H - pad.b} stroke="var(--ink-2)" strokeWidth={1} />
              <circle cx={X(h.price)} cy={Y(h.mid)} r={4} fill="var(--lab-accent)" stroke="var(--surface)" strokeWidth={2} />
            </g>
          )}
          {steps.map((s, i) => (
            <rect key={s.d} x={X(s.price) - step / 2} y={0} width={step} height={H} fill="transparent" onMouseEnter={() => setActive(i)} onClick={() => setActive(i)} style={{ pointerEvents: "all" }} />
          ))}
        </svg>
        {h && (
          <Tip x={X(h.price)} y={Y(Math.max(h.mid, h.high))} w={w}>
            <TipValue>{h.d === 0 ? "Today's price" : `${signedMoney(h.mid)} a month`}</TipValue>
            <TipLabel>
              At {money2(h.price)}{h.d !== 0 && <> · likely {signedMoney(h.low)} to {signedMoney(h.high)}</>}
              <br />~{Math.round(h.qty)} sold a month (now {Math.round(fit.qtyMonth)})
            </TipLabel>
          </Tip>
        )}
      </div>
      <SrTable caption={`Extra profit a month at each price, ${name}`} head={["Price", "Best guess", "Likely low", "Likely high"]} rows={steps.filter((s) => Number.isInteger(s.d * 2)).map((s) => [money2(s.price), signedMoney(s.mid), signedMoney(s.low), signedMoney(s.high)])} />
      {plus && takeaway && (
        <Takeaway>
          {plus.low > 0
            ? <>At {money2(plus.price)} even the cautious end of the range keeps <span className="num font-medium text-ink">{whole(plus.low)}</span> a month — about {Math.round(fit.qtyMonth - plus.qty)} fewer sold, each earning {money2(plus.d)} more.</>
            : <>At {money2(plus.price)} the best guess is <span className="num font-medium text-ink">{signedMoney(plus.mid)}</span> a month, but the cautious end is {signedMoney(plus.low)} — try it and we&apos;ll measure.</>}
        </Takeaway>
      )}
    </figure>
  );
}

// ---- Staffing: the hour strip --------------------------------------------------------------

type HourRow = { label: string; sales: number; people: number; need: number; flag: boolean };

function StaffHours({ rows, comp, weeks }: { rows: HourRow[]; comp: number | null; weeks: { hit: number; total: number } | null }) {
  const { ref, w } = useWidth(360);
  const { active, setActive } = useActive<number>();
  const H = 168;
  const pad = { l: 26, r: 8, t: 22, b: 8 };
  const top = Math.max(2, ...rows.map((r) => Math.max(r.people, r.need, comp ?? 0))) * 1.12;
  const ticks = niceTicks(0, top, 3).filter((t) => t <= top * 1.05);
  const Y = (v: number) => pad.t + (1 - v / top) * (H - pad.t - pad.b);
  const band = (w - pad.l - pad.r) / rows.length;
  const bw = Math.min(24, band * 0.46);
  const cx_ = (i: number) => pad.l + band * (i + 0.5);
  const flagged = rows.map((r, i) => (r.flag ? i : -1)).filter((i) => i >= 0);
  const f = flagged.length ? rows[flagged[0]] : null;
  const fair = f ? Math.max(f.need, comp ?? 0) : 0;
  const extra = f ? Math.max(0, f.people - fair) : 0;
  const h = active == null ? null : rows[active];
  return (
    <figure className="min-w-0" aria-label={f ? `${f.label}: ${f.people} people on the clock for ${whole(f.sales)} of sales an hour; the sales need about ${f.need}${comp ? `, and hours this quiet usually get ${comp.toFixed(1)}` : ""}.` : "People on the clock against what the sales need, each hour"}>
      <figcaption className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <Key look="context">People on</Key>
        <span className="inline-flex items-center gap-1.5 text-[0.72rem] text-ink-2"><span className="inline-block h-[2px] w-3.5 rounded bg-ink" />Needed for the sales</span>
        {f && <Key look="hot">Extra people</Key>}
        {f && comp != null && <Key look="wash">Fair range</Key>}
      </figcaption>
      <div ref={ref} className="relative w-full" onMouseLeave={() => setActive(null)}>
        <svg width={w} height={H} className="block overflow-visible" aria-hidden>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={w - pad.r} y1={Y(t)} y2={Y(t)} stroke="var(--lab-grid)" strokeWidth={1} />
              <text x={pad.l - 7} y={Y(t)} dy="0.32em" textAnchor="end" className="num fill-muted text-[10px]">{t}</text>
            </g>
          ))}
          {rows.map((r, i) => {
            const x = cx_(i);
            const fairTop = r.flag ? Math.max(r.need, comp ?? 0) : r.people;
            const fairLow = r.flag && comp != null ? Math.min(r.need, comp) : null;
            const solidTop = Math.min(r.people, fairTop);
            const on = active === i;
            return (
              <g key={r.label} className="lab-mark" opacity={active == null || on ? 1 : 0.5}>
                {r.flag && fairLow != null && <rect x={x - band * 0.42} width={band * 0.84} y={Y(fairTop)} height={Math.max(2, Y(fairLow) - Y(fairTop))} rx={4} fill="var(--lab-accent-wash)" stroke="var(--lab-accent-2)" strokeWidth={1} className="lab-fade" />}
                <path d={roundTop(x - bw / 2, Y(solidTop), bw, Y(0) - Y(solidTop), r.flag && r.people > fairTop ? 0 : 4)} fill={r.flag ? "var(--lab-strong)" : "var(--lab-context)"} className="lab-grow-y" style={{ animationDelay: `${i * 50}ms` }} />
                {r.flag && r.people > fairTop && <path d={roundTop(x - bw / 2, Y(r.people), bw, Y(fairTop) - Y(r.people) - 2, 4)} fill="var(--lab-hot)" className="lab-grow-y" style={{ animationDelay: `${320 + i * 50}ms` }} />}
                <line x1={x - bw / 2 - 5} x2={x + bw / 2 + 5} y1={Y(r.need)} y2={Y(r.need)} stroke="var(--ink)" strokeWidth={2} strokeLinecap="round" />
              </g>
            );
          })}
          {f && (() => {
            const i = flagged[0];
            const x = cx_(i);
            const right = x < w * 0.62;
            return (
              <g className="lab-fade" style={{ animationDelay: "500ms" }}>
                <text x={x + (right ? band * 0.42 + 6 : -band * 0.42 - 6)} y={Y(f.people) + 4} textAnchor={right ? "start" : "end"} className="num fill-ink text-[11.5px] font-semibold">{f.people} on</text>
                <text x={x + (right ? band * 0.42 + 6 : -band * 0.42 - 6)} y={Y(f.need) + 4} textAnchor={right ? "start" : "end"} className="num fill-ink-2 text-[10.5px]">{f.need} needed</text>
              </g>
            );
          })()}
          {rows.map((r, i) => (
            <rect key={`h${r.label}`} x={cx_(i) - band / 2} y={0} width={band} height={H} fill="transparent" onMouseEnter={() => setActive(i)} onClick={() => setActive(i)} />
          ))}
        </svg>
        <div className="mt-1 grid" style={{ gridTemplateColumns: `${pad.l}px repeat(${rows.length}, minmax(0,1fr)) ${pad.r}px` }} aria-hidden>
          <span />
          {rows.map((r) => (
            <span key={r.label} className={cx("truncate text-center text-[11px]", r.flag ? "font-semibold text-ink" : "text-muted")}>{r.label}</span>
          ))}
          <span />
          <span className="pt-1 text-[9.5px] leading-tight text-muted">$/h</span>
          {rows.map((r) => (
            <span key={`s${r.label}`} className={cx("num truncate pt-1 text-center text-[10.5px]", r.flag ? "text-ink-2" : "text-muted")}>{tickMoney(r.sales)}</span>
          ))}
          <span />
        </div>
        {h && (
          <Tip x={cx_(active!)} y={Y(Math.max(h.people, h.need))} w={w}>
            <TipValue>{h.people} on · {h.need} needed</TipValue>
            <TipLabel>{h.label} · {whole(h.sales)} of sales an hour{h.flag && comp != null ? ` · hours this quiet usually get ${comp.toFixed(1)}` : ""}</TipLabel>
          </Tip>
        )}
      </div>
      <SrTable caption="People on the clock and people needed, each hour" head={["Hour", "Sales an hour", "People on", "Needed"]} rows={rows.map((r) => [r.label, whole(r.sales), r.people, r.need])} />
      {f && (
        <Takeaway>
          At {f.label} you have <span className="num font-medium text-ink">{f.people}</span> on for {whole(f.sales)} an hour. The sales need about {f.need}{comp != null ? <>, and hours this quiet usually get {comp.toFixed(1)}</> : null} — so roughly <span className="num font-medium text-ink">{extra >= 0.95 ? Math.round(extra) : extra.toFixed(1)}</span> {Math.round(extra) === 1 ? "person is" : "people are"} waiting for guests{weeks ? <>, in {weeks.hit} of the last {weeks.total} weeks</> : null}.
        </Takeaway>
      )}
    </figure>
  );
}

/** A bar path with rounded top corners only (square at the baseline). */
export function roundTop(x: number, y: number, w: number, h: number, r: number) {
  if (h <= 0) return "";
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`;
}
/** Rounded right end, square at the left baseline. */
export function roundRight(x: number, y: number, w: number, h: number, r: number) {
  if (w <= 0) return "";
  const rr = Math.min(r, h / 2, w);
  return `M${x},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h - rr} Q${x + w},${y + h} ${x + w - rr},${y + h} L${x},${y + h} Z`;
}

function PeopleCompare({ chart }: { chart: { unit: string; rows: { label: string; value: number; tone?: "good" | "bad" | null }[] } }) {
  return <CompareBars rows={chart.rows} unit={chart.unit === "people" ? "people" : "number"} />;
}

// ---- Slow days: the calendar ------------------------------------------------------------------

function SlowDays({ a }: { a: GraphicSource }) {
  const v = a.visual?.type === "compare" ? a.visual : null;
  const n = inputNum(a.inputs, /^slow days/i) ?? v?.days?.length ?? 0;
  const fore = inputNum(a.inputs, /^foreseeable/i) ?? v?.days?.filter((d) => d.foreseen).length ?? 0;
  const trimmed = inputNum(a.inputs, /^trimmed/i) ?? v?.days?.filter((d) => d.trimmed).length ?? 0;
  return (
    <div className="flex min-w-0 flex-col gap-5">
      {v?.days?.length && v.since && v.through ? (
        <SlowCalendar days={v.days} since={v.since} through={v.through} />
      ) : n > 0 ? (
        <div>
          <div className="mb-2 text-[0.78rem] font-medium text-ink-2">The {n} slow days</div>
          <DotStrip
            size={13}
            groups={[
              { n: Math.max(0, fore - Math.min(trimmed, fore)), label: "foreseeable — the schedule could have known", look: "accent" },
              { n: Math.max(0, n - fore - Math.max(0, trimmed - Math.min(trimmed, fore))), label: "surprises — only a mid-shift call", look: "ring" },
              { n: trimmed, label: "cut back already", look: "check" },
            ]}
          />
        </div>
      ) : null}
      {v && v.rows.length >= 3 && <HoursBullet rows={v.rows} />}
    </div>
  );
}

function SlowCalendar({ days, since, through }: { days: SlowDay[]; since: string; through: string }) {
  const { ref, w } = useWidth(340);
  const { active, setActive } = useActive<string>();
  const by = new Map(days.map((d) => [d.date, d]));
  // Weeks start Monday; columns are weeks, rows Mon..Sun.
  const dow = (iso: string) => (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;
  const start = addDays(since, -dow(since));
  const weeks = Math.ceil((daysBetween(start, through) + 1) / 7);
  const labelW = 16;
  const gap = 3;
  const cell = Math.max(7, Math.min(18, Math.floor((w - labelW - gap * weeks) / weeks)));
  const H = 7 * (cell + gap) + 18;
  const months: { x: number; label: string }[] = [];
  for (let k = 0; k < weeks; k++) {
    const d = addDays(start, k * 7);
    const m = new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
    if (!months.length || months.at(-1)!.label !== m) months.push({ x: labelW + k * (cell + gap), label: m });
  }
  const cur = active ? by.get(active) : null;
  const pos = (iso: string) => {
    const k = Math.floor(daysBetween(start, iso) / 7);
    return { x: labelW + k * (cell + gap), y: 18 + dow(iso) * (cell + gap) };
  };
  const fore = days.filter((d) => d.foreseen && !d.trimmed).length;
  const surprise = days.filter((d) => !d.foreseen && !d.trimmed).length;
  const trimmed = days.filter((d) => d.trimmed).length;
  return (
    <figure className="min-w-0" aria-label={`${days.length} slow days since ${shortDate(since)}: ${fore + days.filter((d) => d.foreseen && d.trimmed).length} foreseeable, ${trimmed} already cut back.`}>
      <div ref={ref} className="relative w-full" onMouseLeave={() => setActive(null)}>
        <svg width={w} height={H} className="block overflow-visible" aria-hidden>
          {months.map((m, i) => (
            <text key={i} x={m.x} y={10} className="fill-muted text-[10px]">{m.label}</text>
          ))}
          {["M", "", "W", "", "F", "", "S"].map((l, i) => (
            <text key={i} x={0} y={18 + i * (cell + gap) + cell / 2} dy="0.32em" className="fill-muted text-[9.5px]">{l}</text>
          ))}
          {Array.from({ length: weeks * 7 }, (_, k) => {
            const iso = addDays(start, k);
            if (iso < since || iso > through) return null;
            const p = pos(iso);
            const d = by.get(iso);
            const r = cell / 2;
            if (!d) return <circle key={iso} cx={p.x + r} cy={p.y + r} r={Math.max(1.5, r * 0.28)} fill="var(--lab-context-2)" />;
            const on = active === iso;
            return (
              <g key={iso} className="lab-pop" style={{ animationDelay: `${Math.min(900, k * 4)}ms` }}>
                {d.trimmed ? (
                  <>
                    <circle cx={p.x + r} cy={p.y + r} r={r - 0.5} fill="var(--lab-context)" />
                    <circle cx={p.x + r} cy={p.y + r} r={r * 0.36} fill="var(--surface)" />
                  </>
                ) : d.foreseen ? (
                  <circle cx={p.x + r} cy={p.y + r} r={r - 0.5} fill="var(--lab-accent)" />
                ) : (
                  <circle cx={p.x + r} cy={p.y + r} r={r - 1.5} fill="var(--surface)" stroke="var(--lab-accent)" strokeWidth={2} />
                )}
                {on && <circle cx={p.x + r} cy={p.y + r} r={r + 2} fill="none" stroke="var(--ink)" strokeWidth={1.5} />}
                <rect x={p.x - gap / 2} y={p.y - gap / 2} width={cell + gap} height={cell + gap} fill="transparent" onMouseEnter={() => setActive(iso)} onClick={() => setActive(iso)} />
              </g>
            );
          })}
        </svg>
        {cur && (
          <Tip x={pos(cur.date).x + cell / 2} y={pos(cur.date).y} w={w}>
            <TipValue>{new Date(`${cur.date}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}{cur.pct != null ? ` · ${Math.round(cur.pct * 100)}% of normal` : ""}</TipValue>
            <TipLabel>{cur.trimmed ? "Crew was cut back — nicely done" : `${cur.foreseen ? "Foreseeable a week ahead" : "A surprise on the day"}${cur.extra ? ` · ${cur.extra} paid hours over a trimmed day` : ""}`}</TipLabel>
          </Tip>
        )}
      </div>
      <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        <Key look="accent"><span className="num font-semibold text-ink">{fore}</span> foreseeable</Key>
        <Key look="ring"><span className="num font-semibold text-ink">{surprise}</span> surprises</Key>
        <span className="inline-flex items-center gap-1.5 text-[0.72rem] text-ink-2"><span className="relative inline-block size-2.5 rounded-full bg-[var(--lab-context)]"><span className="absolute inset-[30%] rounded-full bg-surface" /></span><span className="num font-semibold text-ink">{trimmed}</span> already cut back</span>
      </figcaption>
      <SrTable caption="Slow days" head={["Date", "Share of a normal day", "Foreseeable", "Cut back"]} rows={days.map((d) => [shortDate(d.date), d.pct != null ? `${Math.round(d.pct * 100)}%` : "", d.foreseen ? "yes" : "no", d.trimmed ? "yes" : "no"])} />
    </figure>
  );
}

/** Paid hours: a normal day, a slow day as it ran (the part over a trimmed day in the hot colour), and the trimmed target. */
function HoursBullet({ rows }: { rows: { label: string; value: number; tone?: "good" | "bad" | null }[] }) {
  const [normal, slow, trim] = rows;
  const max = Math.max(normal.value, slow.value, trim.value) * 1.04;
  const x = (v: number) => `${(v / max) * 100}%`;
  const excess = Math.max(0, slow.value - trim.value);
  return (
    <figure className="min-w-0" aria-label={`${normal.label}: ${normal.value} hours. ${slow.label}: ${slow.value}. ${trim.label}: ${trim.value}.`}>
      <div className="mb-2 text-[0.78rem] font-medium text-ink-2">Paid hours in a day</div>
      <div className="flex flex-col gap-3">
        <BulletRow label={normal.label} value={`${normal.value} h`}>
          <div className="lab-grow-x absolute inset-y-0 left-0 rounded-r-[4px] bg-[var(--lab-context)]" style={{ width: x(normal.value) }} />
        </BulletRow>
        <BulletRow label={slow.label} value={`${slow.value} h`}>
          <div className="lab-grow-x absolute inset-y-0 left-0 bg-[var(--lab-strong)]" style={{ width: x(trim.value) }} />
          <div className="lab-grow-x absolute inset-y-0 rounded-r-[4px] bg-[var(--lab-hot)]" style={{ left: `calc(${x(trim.value)} + 2px)`, width: `calc(${x(excess)} - 2px)`, animationDelay: "300ms" }} />
          <div className="absolute -inset-y-1.5 w-[2px] rounded bg-ink" style={{ left: x(trim.value) }} />
        </BulletRow>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        <span className="inline-flex items-center gap-1.5 text-[0.72rem] text-ink-2"><span className="inline-block h-3 w-[2px] rounded bg-ink" />Trimmed to follow sales: <span className="num font-semibold text-ink">{trim.value} h</span></span>
        <Key look="hot">About <span className="num font-semibold text-ink">{excess.toFixed(1)} h</span> that could go</Key>
      </div>
    </figure>
  );
}

function BulletRow({ label, value, children }: { label: string; value: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
        <span className="min-w-0 truncate text-ink-2">{label}</span>
        <span className="num font-semibold text-ink">{value}</span>
      </div>
      <div className="relative h-3.5">{children}</div>
    </div>
  );
}

// ---- An hour that loses money: the waterfall -----------------------------------------------

function HourWaterfall({ a }: { a: GraphicSource }) {
  const v = a.visual as Extract<Visual, { type: "compare" }>;
  const sales = v.rows.find((r) => /^sales/i.test(r.label))?.value ?? 0;
  const kept = v.rows.find((r) => /kept/i.test(r.label))?.value ?? sales;
  const wages = v.rows.find((r) => /wages/i.test(r.label))?.value ?? 0;
  const left = kept - wages;
  const weeks = ofCount(`${a.evidence?.summary ?? ""} ${a.how.join(" ")}`);
  const steps = [
    { label: "Sales", from: 0, to: sales, link: 0, look: "context" as const, text: whole(sales) },
    { label: "Food & drink", from: kept, to: sales, link: sales, look: "context2" as const, text: `−${whole(sales - kept)}` },
    { label: "Wages", from: left, to: kept, link: kept, look: "hot" as const, text: `−${whole(wages)}` },
    { label: left >= 0 ? "Left" : "Lost", from: Math.min(0, left), to: Math.max(0, left), link: left, look: left >= 0 ? ("accent" as const) : ("loss" as const), text: left >= 0 ? whole(left) : `−${whole(-left)}` },
  ];
  const { ref, w } = useWidth(340);
  const H = 150;
  const pad = { t: 22, b: 22 };
  const lo = Math.min(0, left);
  const hi = sales;
  const Y = (val: number) => pad.t + (1 - (val - lo) / Math.max(1, hi - lo)) * (H - pad.t - pad.b);
  const band = w / steps.length;
  const bw = Math.min(46, band * 0.56);
  const fill = { context: "var(--lab-context)", context2: "var(--lab-context-2)", hot: "var(--lab-hot)", accent: "var(--lab-accent)", loss: "var(--bad)" };
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <figure className="min-w-0" aria-label={`In that hour: sales ${whole(sales)}, food and drink ${whole(sales - kept)}, wages ${whole(wages)}, leaving ${left >= 0 ? whole(left) : `a loss of ${whole(-left)}`}.`}>
        <div ref={ref} className="relative w-full">
          <svg width={w} height={H} className="block overflow-visible" aria-hidden>
            <line x1={0} x2={w} y1={Y(0)} y2={Y(0)} stroke="var(--border-strong)" />
            {steps.map((s, i) => {
              const x = band * (i + 0.5) - bw / 2;
              const y = Y(s.to);
              const hgt = Math.max(2, Y(s.from) - Y(s.to));
              return (
                <g key={s.label}>
                  {i > 0 && <line x1={band * (i - 0.5) + bw / 2} x2={x} y1={Y(s.link)} y2={Y(s.link)} stroke="var(--border-strong)" strokeWidth={1} />}
                  <rect x={x} y={y} width={bw} height={hgt} rx={4} fill={fill[s.look]} className={s.to <= 0 ? "lab-grow-down" : "lab-grow-y"} style={{ animationDelay: `${i * 140}ms` }} />
                  <text x={band * (i + 0.5)} y={(i === steps.length - 1 && s.from < 0 ? Y(s.from) + 13 : y - 7)} textAnchor="middle" className="num fill-ink text-[12px] font-semibold">{s.text}</text>
                </g>
              );
            })}
          </svg>
          <div className="mt-1 grid" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0,1fr))` }} aria-hidden>
            {steps.map((s) => (
              <span key={s.label} className="truncate text-center text-[11px] text-muted">{s.label}</span>
            ))}
          </div>
        </div>
        <SrTable caption="That hour, on average" head={["Step", "Amount"]} rows={steps.map((s) => [s.label, s.text])} />
      </figure>
      {weeks && (
        <div>
          <div className="mb-2 text-[0.78rem] font-medium text-ink-2">Each of the last {weeks.total} weeks</div>
          <DotStrip groups={[{ n: weeks.hit, label: "lost money", look: "hot" }, { n: weeks.total - weeks.hit, label: "paid for itself", look: "context" }]} />
        </div>
      )}
    </div>
  );
}

// ---- Price follow-up: before → after, against last year and the expected band ---------------

export interface FollowSpec {
  item: string;
  before: number;
  after: number;
  lyBefore: number | null;
  lyAfter: number | null;
  effect: { mid: number; low: number; high: number };
  unit: string;
}

export function followOf(ev: Evidence | null | undefined): FollowSpec | null {
  if (!ev?.effect) return null;
  const main = ev.rows.find((r) => /per 100 orders/i.test(r.label) && !/last year/i.test(r.label) && r.before && r.after) ?? ev.rows.find((r) => r.strong && r.before && r.after);
  if (!main) return null;
  const ly = ev.rows.find((r) => /last year/i.test(r.label) && r.before && r.after);
  const before = numOf(main.before);
  const after = numOf(main.after);
  if (before == null || after == null) return null;
  const item = main.label.replace(/ per 100 orders.*$/i, "").replace(/ sold per open day.*$/i, "");
  return { item, before, after, lyBefore: numOf(ly?.before), lyAfter: numOf(ly?.after), effect: ev.effect, unit: /per 100 orders/i.test(main.label) ? "per 100 orders" : "" };
}

export function FollowSlope({ f, small }: { f: FollowSpec; small?: boolean }) {
  const { ref, w } = useWidth(340);
  const H = small ? 150 : 190;
  const pad = { t: 26, b: 24 };
  // What "after" would be with no price change, given the effect's likely range.
  const exp = { mid: f.after / (1 + f.effect.mid), lo: f.after / (1 + Math.max(f.effect.high, -0.9)), hi: f.effect.low > -0.95 ? f.after / (1 + f.effect.low) : f.after * 3 };
  const vals = [f.before, f.after, exp.lo, Math.min(exp.hi, Math.max(f.before, f.after) * 2.2), f.lyBefore ?? f.before, f.lyAfter ?? f.after];
  const top = Math.max(...vals) * 1.08;
  const bottom = Math.max(0, Math.min(...vals) * 0.85);
  const Y = (v: number) => pad.t + (1 - (Math.min(top, Math.max(bottom, v)) - bottom) / Math.max(1e-9, top - bottom)) * (H - pad.t - pad.b);
  const xa = Math.max(64, w * 0.2);
  const xb = Math.min(w - 120, w * 0.62);
  const inside = f.after >= exp.lo && f.after <= exp.hi;
  const fmt = (v: number) => (v >= 10 ? v.toFixed(0) : v.toFixed(v >= 1 ? 2 : 2));
  const hasLy = f.lyBefore != null && f.lyAfter != null;
  return (
    <figure className="min-w-0" aria-label={`${f.item} ${f.unit}: ${fmt(f.before)} before the change, ${fmt(f.after)} after. With no price change we'd expect ${fmt(exp.lo)} to ${fmt(exp.hi)}.${hasLy ? ` Same weeks last year: ${fmt(f.lyBefore!)} to ${fmt(f.lyAfter!)}.` : ""}`}>
      <div ref={ref} className="relative w-full">
        <svg width={w} height={H} className="block overflow-visible" aria-hidden>
          <text x={xa} y={11} textAnchor="middle" className="fill-muted text-[10.5px]">Before</text>
          <text x={xb} y={11} textAnchor="middle" className="fill-muted text-[10.5px]">After</text>
          <line x1={xa} x2={xa} y1={pad.t - 6} y2={H - pad.b + 4} stroke="var(--lab-grid)" />
          <line x1={xb} x2={xb} y1={pad.t - 6} y2={H - pad.b + 4} stroke="var(--lab-grid)" />
          {/* Expected band at "after" */}
          <rect x={xb - 13} width={26} y={Y(exp.hi)} height={Math.max(3, Y(exp.lo) - Y(exp.hi))} rx={6} fill="var(--lab-accent-wash)" stroke="var(--lab-accent-2)" strokeWidth={1} className="lab-fade" />
          <line x1={xb - 13} x2={xb + 13} y1={Y(exp.mid)} y2={Y(exp.mid)} stroke="var(--lab-accent-2)" strokeWidth={2} />
          {hasLy && (
            <g>
              <line x1={xa} x2={xb} y1={Y(f.lyBefore!)} y2={Y(f.lyAfter!)} stroke="var(--lab-context)" strokeWidth={2} strokeLinecap="round" pathLength={1} className="lab-draw" />
              <circle cx={xa} cy={Y(f.lyBefore!)} r={4} fill="var(--lab-context)" stroke="var(--surface)" strokeWidth={2} />
              <circle cx={xb} cy={Y(f.lyAfter!)} r={4} fill="var(--lab-context)" stroke="var(--surface)" strokeWidth={2} />
              {Math.abs(Y(f.lyBefore!) - Y(f.before)) > 14 && <text x={xa - 10} y={Y(f.lyBefore!)} dy="0.32em" textAnchor="end" className="num fill-muted text-[10.5px]">{fmt(f.lyBefore!)}</text>}
            </g>
          )}
          <line x1={xa} x2={xb} y1={Y(f.before)} y2={Y(f.after)} stroke="var(--lab-accent)" strokeWidth={2} strokeLinecap="round" pathLength={1} className="lab-draw" />
          <circle cx={xa} cy={Y(f.before)} r={5} fill="var(--lab-accent)" stroke="var(--surface)" strokeWidth={2} />
          <circle cx={xb} cy={Y(f.after)} r={5.5} fill="var(--lab-accent)" stroke="var(--surface)" strokeWidth={2} className="lab-pop" style={{ animationDelay: "700ms" }} />
          <text x={xa - 10} y={Y(f.before)} dy="0.32em" textAnchor="end" className="num fill-ink text-[11.5px] font-semibold">{fmt(f.before)}</text>
          <text x={xb + 20} y={Y(f.after)} dy="0.32em" className="num fill-ink text-[11.5px] font-semibold">{fmt(f.after)} <tspan className="fill-muted font-normal">now</tspan></text>
          {hasLy && Math.abs(Y(f.lyAfter!) - Y(f.after)) > 14 && <text x={xb + 20} y={Y(f.lyAfter!)} dy="0.32em" className="num fill-muted text-[10.5px]">{fmt(f.lyAfter!)} last yr</text>}
        </svg>
      </div>
      <figcaption className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
        <Key look="line">{f.item} {f.unit}</Key>
        {hasLy && <Key look="context-line">Same weeks last year</Key>}
        <Key look="wash">Expected with no price change</Key>
      </figcaption>
      <SrTable caption={`${f.item} ${f.unit}`} head={["", "Before", "After"]} rows={[["This year", fmt(f.before), fmt(f.after)], ...(hasLy ? [["Same weeks last year", fmt(f.lyBefore!), fmt(f.lyAfter!)]] : []), ["Expected with no price change", "", `${fmt(exp.lo)}–${fmt(exp.hi)}`]]} />
      {!small && (
        <Takeaway>
          {inside
            ? <>It landed inside what we&apos;d expect anyway, so far the price change looks like it did nothing either way — <span className="font-medium text-ink">{signedPct(f.effect.mid)}</span>, but anywhere from {signedPct(f.effect.low)} to {signedPct(f.effect.high)}.</>
            : f.after > exp.hi
              ? <>Above what the season alone explains: the price change did about <span className="font-medium text-ink">{signedPct(f.effect.mid)}</span> (likely {signedPct(f.effect.low)} to {signedPct(f.effect.high)}).</>
              : <>Below what the season explains: guests bought about <span className="font-medium text-ink">{signedPct(f.effect.mid)}</span> of it per order (likely {signedPct(f.effect.low)} to {signedPct(f.effect.high)}).</>}
        </Takeaway>
      )}
    </figure>
  );
}

// ---- An unusual day: expected (and its normal range) vs what happened -------------------------

export interface ExpectedSpec {
  expected: number;
  actual: number;
  spread: number | null;
}

export function expectedOf(ev: Evidence | null | undefined): ExpectedSpec | null {
  const c = ev?.chart;
  if (c?.type !== "compare") return null;
  const e = c.rows.find((r) => /^expected|^usual/i.test(r.label));
  const x = c.rows.find((r) => /^actual|^paid/i.test(r.label));
  if (!e || !x || c.unit !== "money") return null;
  const m = ev?.sure.match(/within about (\d+)%/i);
  return { expected: e.value, actual: x.value, spread: m ? Number(m[1]) / 100 : null };
}

export function ExpectedActual({ e, label }: { e: ExpectedSpec; label?: string }) {
  const lo = e.spread != null ? e.expected * (1 - e.spread) : null;
  const hi = e.spread != null ? e.expected * (1 + e.spread) : null;
  const max = Math.max(e.expected, e.actual, hi ?? 0) * 1.05;
  const x = (v: number) => `${(Math.max(0, v) / max) * 100}%`;
  const diff = e.actual - e.expected;
  return (
    <figure className="min-w-0" aria-label={`${label ?? "That day"}: expected ${whole(e.expected)}, it did ${whole(e.actual)} (${signedMoney(diff)}).`}>
      <div className="relative h-14">
        <div className="absolute inset-x-0 top-7 h-px bg-border" />
        {lo != null && hi != null && <div className="lab-fade absolute top-[22px] h-3 rounded-full bg-[var(--lab-context-2)]" style={{ left: x(lo), width: `calc(${x(hi)} - ${x(lo)})` }} />}
        <div className="absolute top-[18px] h-5 w-[2px] -translate-x-1/2 rounded bg-ink-2" style={{ left: x(e.expected) }} />
        <div className="absolute top-0 -translate-x-1/2 text-[10.5px] whitespace-nowrap text-muted" style={{ left: x(e.expected) }}>expected <span className="num text-ink-2">{whole(e.expected)}</span></div>
        <div className="lab-grow-x absolute top-[27px] h-[2px] bg-[var(--lab-hot)]" style={{ left: x(Math.min(e.actual, e.expected)), width: `calc(${x(Math.max(e.actual, e.expected))} - ${x(Math.min(e.actual, e.expected))})` }} />
        <div className="lab-pop absolute top-[22px] size-3 -translate-x-1/2 rounded-full border-2 border-surface bg-[var(--lab-hot)]" style={{ left: x(e.actual), animationDelay: "300ms" }} />
        <div className="absolute top-[38px] -translate-x-1/2 text-[11px] font-semibold whitespace-nowrap text-ink" style={{ left: `clamp(2.5rem, ${x(e.actual)}, calc(100% - 2.5rem))` }}><span className="num">{whole(e.actual)}</span> <span className="font-normal text-muted">actual</span></div>
      </div>
      {lo != null && <figcaption className="mt-1 text-[0.72rem] text-muted">The grey band is where a normal day usually lands.</figcaption>}
    </figure>
  );
}

// ---- Weekday strip (what each day leaves), the flagged day highlighted -------------------------

function WeekStrip({ rows }: { rows: { label: string; value: number; flag?: boolean }[] }) {
  const { ref, w } = useWidth(320);
  const { active, setActive } = useActive<number>();
  const H = 140;
  const pad = { t: 20, b: 6 };
  const lo = Math.min(0, ...rows.map((r) => r.value));
  const hi = Math.max(1, ...rows.map((r) => r.value));
  const Y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const band = w / rows.length;
  const bw = Math.min(24, band * 0.5);
  return (
    <figure className="min-w-0" aria-label={rows.map((r) => `${r.label} ${whole(r.value)}`).join(", ")}>
      <div ref={ref} className="relative w-full" onMouseLeave={() => setActive(null)}>
        <svg width={w} height={H} className="block overflow-visible" aria-hidden>
          <line x1={0} x2={w} y1={Y(0)} y2={Y(0)} stroke="var(--border-strong)" />
          {rows.map((r, i) => {
            const x = band * (i + 0.5) - bw / 2;
            const neg = r.value < 0;
            return (
              <g key={r.label} opacity={active == null || active === i ? 1 : 0.5} className="lab-mark">
                {neg ? (
                  <path d={`M${x},${Y(0)} L${x + bw},${Y(0)} L${x + bw},${Y(r.value) - 4} Q${x + bw},${Y(r.value)} ${x + bw - 4},${Y(r.value)} L${x + 4},${Y(r.value)} Q${x},${Y(r.value)} ${x},${Y(r.value) - 4} Z`} fill="var(--bad)" className="lab-grow-down" />
                ) : (
                  <path d={roundTop(x, Y(r.value), bw, Y(0) - Y(r.value), 4)} fill={r.flag ? "var(--lab-hot)" : "var(--lab-context)"} className="lab-grow-y" style={{ animationDelay: `${i * 50}ms` }} />
                )}
                {(r.flag || active === i) && <text x={band * (i + 0.5)} y={neg ? Y(r.value) + 13 : Y(r.value) - 6} textAnchor="middle" className="num fill-ink text-[11px] font-semibold">{tickMoney(r.value)}</text>}
                <rect x={band * i} y={0} width={band} height={H} fill="transparent" onMouseEnter={() => setActive(i)} onClick={() => setActive(i)} />
              </g>
            );
          })}
        </svg>
        <div className="grid" style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0,1fr))` }} aria-hidden>
          {rows.map((r) => (
            <span key={r.label} className={cx("text-center text-[11px]", r.flag ? "font-semibold text-ink" : "text-muted")}>{r.label}</span>
          ))}
        </div>
      </div>
      <SrTable caption="What an average day leaves after food, drink and wages" head={["Day", "Left"]} rows={rows.map((r) => [r.label, whole(r.value)])} />
    </figure>
  );
}

// ---- Fallback: clean labelled bars ---------------------------------------------------------

export function CompareBars({ rows, unit }: { rows: { label: string; value: number; tone?: "good" | "bad" | null }[]; unit: string }) {
  const max = Math.max(1e-9, ...rows.map((r) => Math.abs(r.value)));
  const fmt = (n: number) => (unit === "money" ? (Math.abs(n) < 50 ? `$${n.toFixed(2)}` : whole(n)) : unit === "hours" ? `${n} h` : unit === "people" ? n.toFixed(1) : `${n}`);
  return (
    <figure className="flex min-w-0 flex-col gap-3" aria-label={rows.map((r) => `${r.label} ${fmt(r.value)}`).join(", ")}>
      {rows.map((r, i) => (
        <div key={r.label} className="min-w-0">
          <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
            <span className="min-w-0 text-ink-2">{r.label}</span>
            <span className="num shrink-0 text-[0.82rem] font-semibold text-ink">{fmt(r.value)}</span>
          </div>
          <div className="h-3">
            <div className={cx("lab-grow-x h-full rounded-r-[4px]", r.tone === "bad" ? "bg-[var(--lab-hot)]" : r.tone === "good" ? "bg-[var(--lab-accent)]" : "bg-[var(--lab-context)]")} style={{ width: `${Math.max(1.5, (Math.abs(r.value) / max) * 100)}%`, animationDelay: `${i * 90}ms` }} />
          </div>
        </div>
      ))}
    </figure>
  );
}
