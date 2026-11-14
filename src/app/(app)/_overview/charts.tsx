"use client";

import { cx } from "@/components/ui";
import { dayDate, money, pct } from "@/lib/format";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const whole = (n: number) => money(n, { whole: true });
const compact = (n: number) => (n >= 10_000 ? `$${Math.round(n / 1000)}K` : n >= 1_000 ? `$${(n / 1000).toFixed(1).replace(/\.0$/, "")}K` : whole(n));
const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "am" : "pm"}`;

function useWidth(min = 200) {
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

// ---- Today, hour by hour ---------------------------------------------------------------

export interface TodayHour {
  hour: number;
  sales: number;
  forecast: number;
}

/**
 * Today's sales by hour (solid columns) over what the forecast expected for
 * each hour (pale columns behind), with a hairline at the current time. One
 * measured series plus its expectation, so the legend is two small keys.
 */
export function TodayChart({ hours, hour, minute, height }: { hours: TodayHour[]; hour: number; minute: number; height?: number }) {
  const { ref, w: W } = useWidth(220);
  const [hover, setHover] = useState<number | null>(null);
  const active = hours.filter((h) => h.sales > 0 || h.forecast > 0.5).map((h) => h.hour);
  if (!active.length) return <div ref={ref} className="grid h-24 place-items-center text-sm text-muted">No sales or forecast for today yet.</div>;
  const lo = Math.min(...active);
  const hi = Math.max(...active, Math.min(23, hour));
  const shown = hours.filter((h) => h.hour >= lo && h.hour <= hi);
  const H = height ?? (W >= 440 ? 196 : 132);
  const pad = { top: 8, right: 2, bottom: 20, left: 2 };
  const max = Math.max(1, ...shown.map((h) => Math.max(h.sales, h.forecast))) * 1.1;
  const band = (W - pad.left - pad.right) / shown.length;
  const barW = Math.max(6, Math.min(22, band * 0.6));
  const x = (i: number) => pad.left + band * i + band / 2;
  const y = (v: number) => pad.top + (1 - v / max) * (H - pad.top - pad.bottom);
  const nowI = shown.findIndex((h) => h.hour === hour);
  const nowX = nowI >= 0 ? pad.left + band * (nowI + minute / 60) : null;
  const labelEvery = band < 30 ? 2 : 1;
  const hv = hover == null ? null : shown[hover];
  return (
    <div>
      <div className="relative" ref={ref}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block" role="img" aria-label="Sales by hour today against the forecast" onMouseLeave={() => setHover(null)}>
          <line x1={pad.left} x2={W - pad.right} y1={y(0)} y2={y(0)} stroke="var(--border-strong)" strokeWidth={1} />
          {shown.map((h, i) => {
            const past = h.hour < hour || (h.hour === hour && minute > 0);
            return (
              <g key={h.hour}>
                {h.forecast > 0 && <path d={col(x(i) - barW / 2, y(h.forecast), barW, y(0) - y(h.forecast))} fill="var(--surface-2)" stroke="var(--border-strong)" strokeWidth={1} />}
                {h.sales > 0 && <path d={col(x(i) - barW / 2 + 3, y(h.sales), barW - 6, y(0) - y(h.sales))} fill="var(--series-1)" opacity={hover == null || hover === i ? 1 : 0.55} className="transition-opacity duration-120" />}
                {i % labelEvery === 0 && <text x={x(i)} y={H - 5} textAnchor="middle" className={cx("text-[10.5px]", past ? "fill-muted" : "fill-muted/70")}>{hourLabel(h.hour)}</text>}
              </g>
            );
          })}
          {nowX != null && <line x1={nowX} x2={nowX} y1={pad.top - 4} y2={y(0)} stroke="var(--ink)" strokeWidth={1} opacity={0.5} />}
          {shown.map((h, i) => (
            <rect key={`hit-${h.hour}`} x={x(i) - band / 2} y={0} width={band} height={H} fill="transparent" onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)} />
          ))}
        </svg>
        {hv && (
          <div className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-surface px-2 py-1 text-xs whitespace-nowrap shadow-sm" style={{ left: Math.min(Math.max(x(hover!), 70), W - 70) }}>
            <div className="text-muted">{hourLabel(hv.hour)}–{hourLabel((hv.hour + 1) % 24)}</div>
            <div className="num"><span className="font-medium text-ink">{whole(hv.sales)}</span> <span className="text-muted">sold · {whole(hv.forecast)} expected</span></div>
          </div>
        )}
      </div>
      <div className="mt-2 flex items-center gap-4 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-[3px] bg-series-1" /> Sold</span>
        <span className="inline-flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-[3px] border border-border-strong bg-surface-2" /> Forecast</span>
      </div>
    </div>
  );
}

function col(x: number, y: number, w: number, h: number) {
  if (h <= 0 || w <= 0) return "";
  const r = Math.min(3, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}z`;
}

// ---- The week in one strip ----------------------------------------------------------------

export interface StripDay {
  date: string;
  sales: number;
  forecast: number | null;
  profit: number;
  closed: boolean;
}

/**
 * Seven days side by side: each day's sales as a column with a tick where the
 * forecast was, the weekday under it and the amount beneath. Tap a day to see
 * it against the forecast and its profit; each day links to its P&L.
 */
export function WeekStrip({ days, height = 92 }: { days: StripDay[]; height?: number }) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(1, ...days.map((d) => Math.max(d.sales, d.forecast ?? 0)));
  const best = days.reduce<StripDay | null>((a, d) => (!a || d.sales > a.sales ? d : a), null);
  return (
    <div className="grid grid-cols-7 gap-1.5 sm:gap-3" onMouseLeave={() => setHover(null)}>
      {days.map((d, i) => {
        const hgt = (d.sales / max) * height;
        const fc = d.forecast != null && d.forecast > 0 ? (d.forecast / max) * height : null;
        const off = d.forecast && d.forecast > 0 ? d.sales / d.forecast - 1 : null;
        const isHover = hover === d.date;
        const wd = dayDate(d.date).slice(0, 3);
        return (
          <Link
            key={d.date}
            href={`/pnl?period=custom&from=${d.date}&to=${d.date}`}
            className="group relative flex min-w-0 flex-col items-center rounded-lg pt-1 pb-1.5 outline-offset-2 hover:bg-surface-2/60"
            onMouseEnter={() => setHover(d.date)}
            onFocus={() => setHover(d.date)}
            onBlur={() => setHover(null)}
            aria-label={`${dayDate(d.date)}: ${d.closed ? "closed" : `${whole(d.sales)} sales${d.forecast ? `, forecast ${whole(d.forecast)}` : ""}`}`}
          >
            <div className="relative flex w-full items-end justify-center" style={{ height }}>
              {d.closed ? (
                <span className="mb-0.5 h-0.5 w-5 rounded-full bg-border-strong" />
              ) : (
                <span
                  className={cx("w-[min(24px,70%)] rounded-t-[4px] transition-opacity duration-120", hover && !isHover ? "opacity-55" : "")}
                  style={{ height: Math.max(2, hgt), background: "var(--series-1)" }}
                />
              )}
              {fc != null && !d.closed && <span aria-hidden className="absolute left-1/2 h-0.5 w-[min(34px,92%)] -translate-x-1/2 rounded-full bg-ink" style={{ bottom: fc - 1 }} />}
            </div>
            <div className={cx("mt-1.5 text-[0.7rem] font-medium", best?.date === d.date ? "text-ink" : "text-muted")}>{wd}</div>
            <div className="num text-[0.7rem] text-ink-2 sm:text-xs">{d.closed ? "Closed" : compact(d.sales)}</div>
            {isHover && !d.closed && (
              <div className={cx("pointer-events-none absolute bottom-full z-10 mb-1 rounded-md", i < 2 ? "left-0" : i > 4 ? "right-0" : "left-1/2 -translate-x-1/2")} ><div className="border border-border bg-surface px-2 py-1 text-xs whitespace-nowrap shadow-sm rounded-md">
                <div className="text-muted">{dayDate(d.date)}</div>
                <div className="num"><span className="font-medium text-ink">{whole(d.sales)}</span>{d.forecast ? <span className="text-muted"> · forecast {whole(d.forecast)}{off != null ? ` (${off >= 0 ? "+" : "−"}${pct(Math.abs(off), 0)})` : ""}</span> : null}</div>
                <div className="num text-muted">Profit {d.profit < 0 ? `−${whole(-d.profit)}` : whole(d.profit)} before overhead</div>
              </div></div>
            )}
          </Link>
        );
      })}
    </div>
  );
}
