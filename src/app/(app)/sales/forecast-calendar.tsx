"use client";

import { Badge, Button, cx, Input } from "@/components/ui";
import { displayTime, EVENT_KIND_LABEL } from "@/domain/events";
import { dayDate, money } from "@/lib/format";
import { ChevronLeft, ChevronRight, Cloud, CloudFog, CloudLightning, CloudRain, CloudSnow, Sun, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { saveAdjustment } from "./actions";

export type WeatherIcon = "sun" | "cloud" | "rain" | "snow" | "storm" | "fog";

export interface CalDay {
  date: string;
  dayOfMonth: number;
  weekdayName: string; // "Saturday"
  past: boolean;
  today: boolean;
  closed: boolean;
  forecast: number | null;
  actual: number | null;
  /** Past days: what we'd have forecast the evening before. */
  backtest: number | null;
  baseline: number;
  samples: number;
  trend: number;
  manual: number;
  reason: string | null;
  eventFactor: number;
  weatherFactor: number;
  rain: { factor: number; wetSamples: number };
  events: {
    id: string;
    title: string;
    kind: string;
    impact: number;
    startTime: string | null;
  }[];
  weather: {
    icon: WeatherIcon;
    label: string;
    highF: number;
    lowF: number;
    precipMm: number;
  } | null;
  hours: number[];
  shapeLearned: boolean;
}

const ICONS = {
  sun: Sun,
  cloud: Cloud,
  rain: CloudRain,
  snow: CloudSnow,
  storm: CloudLightning,
  fog: CloudFog,
};

const compact = (n: number) => (n >= 1000 ? `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `$${Math.round(n)}`);
const signed = (m: number) => {
  const p = Math.round((m - 1) * 100);
  return `${p > 0 ? "+" : p < 0 ? "−" : "±"}${Math.abs(p)}%`;
};
const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 || h === 24 ? "am" : "pm"}`;

function WeatherBadge({ w, className }: { w: NonNullable<CalDay["weather"]>; className?: string }) {
  const Icon = ICONS[w.icon];
  return (
    <span className={cx("inline-flex items-center gap-0.5 text-muted", className)} title={`${w.label}, ${w.highF}°/${w.lowF}°F${w.precipMm ? `, ${w.precipMm} mm` : ""}`}>
      <Icon className="size-3.5 shrink-0" strokeWidth={1.75} />
      <span className="num text-[11px]">{w.highF}°</span>
    </span>
  );
}

export function ForecastCalendar({ days, weatherNote }: { days: CalDay[]; weatherNote: string | null }) {
  const [selected, setSelected] = useState<string | null>(null);
  const idx = days.findIndex((d) => d.date === selected);
  const day = idx >= 0 ? days[idx] : null;

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="grid grid-cols-7 border-b border-border text-center text-[11px] font-medium text-muted">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="py-2">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((d, i) => {
            const value = d.past ? d.actual : d.forecast;
            const showMonth = i === 0 || d.dayOfMonth === 1;
            return (
              <button
                key={d.date}
                type="button"
                onClick={() => setSelected(d.date)}
                aria-label={`${dayDate(d.date)}: ${d.closed ? "closed" : value != null ? money(value, { whole: true }) : "no forecast"}`}
                className={cx(
                  "group relative flex min-h-[4.5rem] flex-col items-stretch gap-0.5 border-border p-1.5 text-left transition-colors sm:min-h-[7.25rem] sm:p-2.5",
                  i % 7 !== 6 && "border-r",
                  i < days.length - 7 && "border-b",
                  d.closed ? "bg-surface-2/70" : "hover:bg-surface-2/60",
                  selected === d.date && "ring-2 ring-ink ring-inset",
                )}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className={cx("num text-xs", d.today ? "inline-grid size-5 place-items-center rounded-full bg-primary font-semibold text-primary-ink" : d.past ? "text-muted" : "text-ink-2")}>
                    {d.dayOfMonth}
                  </span>
                  {showMonth && <span className="hidden text-[11px] text-muted lg:inline">{dayDate(d.date).split(", ")[1]?.split(" ")[0]}</span>}
                  {d.weather && (<span className="ml-auto hidden sm:block"><WeatherBadge w={d.weather} /></span>)}
                </div>
                {d.closed ? (
                  <span className="mt-0.5 text-xs text-muted sm:text-sm">Closed</span>
                ) : value != null ? (
                  <>
                    <span className={cx("num font-semibold tracking-tight sm:hidden", d.past ? "text-[12px] text-ink-2" : "text-[12px] text-ink")}>{compact(value)}</span>
                    <span className={cx("num hidden text-[1.05rem] font-semibold tracking-tight sm:inline", d.past ? "text-ink-2" : "text-ink")}>{money(value, { whole: true })}</span>
                    <span className="hidden text-[11px] text-muted sm:inline">{d.past ? "actual" : "forecast"}</span>
                  </>
                ) : (
                  <span className="text-xs text-muted">—</span>
                )}
                {/* Phone: dots for events / override. Larger screens: chips. */}
                <div className="mt-auto flex items-center gap-1 sm:hidden">
                  {d.weather &&
                    ICONS[d.weather.icon] &&
                    (() => {
                      const I = ICONS[d.weather.icon];
                      return <I className="size-3 text-muted" strokeWidth={1.75} />;
                    })()}
                  {d.events.length > 0 && <span className="size-1.5 rounded-full bg-ink-2" />}
                  {d.manual !== 1 && <span className="size-1.5 rounded-full bg-warn" />}
                </div>
                <div className="mt-auto hidden min-w-0 flex-col gap-0.5 sm:flex">
                  {d.events.slice(0, 2).map((e) => (
                    <span key={e.id} className={cx("truncate rounded px-1 py-px text-[11px] leading-4", e.kind === "CLOSURE" ? "bg-surface-2 text-muted" : "bg-surface-2 text-ink-2")}>
                      {e.title}
                    </span>
                  ))}
                  {d.events.length > 2 && <span className="text-[11px] text-muted">+{d.events.length - 2} more</span>}
                  {d.manual !== 1 && !d.closed && (
                    <span
                      className={cx("w-fit rounded px-1 py-px text-[11px] leading-4 font-medium", d.manual > 1 ? "bg-good-bg text-good" : "bg-warn-bg text-warn")}
                      title={d.reason ?? "Manual adjustment"}
                    >
                      {signed(d.manual)}
                      {d.reason ? ` · ${d.reason}` : ""}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
      {weatherNote && <p className="mt-2 text-xs text-muted">{weatherNote}</p>}
      {day && (
        <DayPanel
          key={day.date}
          day={day}
          onClose={() => setSelected(null)}
          onPrev={idx > 0 ? () => setSelected(days[idx - 1].date) : undefined}
          onNext={idx < days.length - 1 ? () => setSelected(days[idx + 1].date) : undefined}
        />
      )}
    </>
  );
}

// ---- Day panel ------------------------------------------------------------------------

function DayPanel({ day, onClose, onPrev, onNext }: { day: CalDay; onClose: () => void; onPrev?: () => void; onNext?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && ["INPUT", "TEXTAREA"].includes(e.target.tagName);
      if (e.key === "Escape") onClose();
      else if (!typing && e.key === "ArrowLeft" && onPrev) onPrev();
      else if (!typing && e.key === "ArrowRight" && onNext) onNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onPrev, onNext]);
  useEffect(() => ref.current?.focus(), []);

  const closedByEvent = day.events.some((e) => e.kind === "CLOSURE");

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={dayDate(day.date)}>
      <div className="absolute inset-0 bg-black/20" onMouseDown={onClose} />
      <div
        ref={ref}
        tabIndex={-1}
        className={cx(
          "absolute flex flex-col overflow-hidden border-border bg-surface shadow-2xl outline-none",
          "inset-x-0 bottom-0 max-h-[88dvh] rounded-t-2xl border-t pb-[env(safe-area-inset-bottom)]",
          "sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-none sm:w-[30rem] sm:rounded-none sm:border-t-0 sm:border-l",
        )}
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-border-strong sm:hidden" />
        <div className="flex items-center gap-1 border-b border-border px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-base font-semibold">{dayDate(day.date)}</div>
            <div className="text-xs text-muted">{day.today ? "Today" : day.past ? "Already happened" : `Forecast · usual ${day.weekdayName}`}</div>
          </div>
          <button
            type="button"
            onClick={onPrev}
            disabled={!onPrev}
            className="grid size-10 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-30 sm:size-8"
            aria-label="Previous day"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={!onNext}
            className="grid size-10 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-30 sm:size-8"
            aria-label="Next day"
          >
            <ChevronRight className="size-4" />
          </button>
          <button type="button" onClick={onClose} className="grid size-10 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink sm:size-8" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {day.past ? (
            <PastSummary day={day} />
          ) : (
            <>
              <div className="flex items-end justify-between gap-3">
                <div>
                  <div className="text-[0.8rem] font-medium text-muted">Forecast sales</div>
                  <div className="num mt-1 text-[1.75rem] font-semibold tracking-tight">{day.closed ? "Closed" : money(day.forecast ?? 0, { whole: true })}</div>
                </div>
                {day.weather && (
                  <div className="text-right text-sm text-ink-2">
                    <WeatherBadge w={day.weather} className="text-ink-2 [&_span]:text-sm" />
                    <div className="text-xs text-muted">
                      {day.weather.label}
                      {day.weather.precipMm >= 1 ? ` · ${day.weather.precipMm} mm` : ""}
                    </div>
                  </div>
                )}
              </div>

              {!day.closed && (
                <div className="mt-4">
                  <div className="mb-1 flex items-baseline justify-between">
                    <span className="text-[0.8rem] font-medium text-ink-2">By hour</span>
                    {!day.shapeLearned && <span className="text-[11px] text-muted">shape from opening hours until hourly sales sync</span>}
                  </div>
                  <HourlyChart hours={day.hours} />
                </div>
              )}

              {day.closed && !closedByEvent ? (
                <p className="mt-4 text-sm text-muted">
                  We haven&apos;t been open on a {day.weekdayName} in recent weeks, so nothing is forecast. If you&apos;re opening, add an event on the events page and the forecast will use it.
                </p>
              ) : (
                <>
                  <h3 className="mt-6 mb-2 text-[0.8rem] font-medium text-ink-2">Why this number</h3>
                  <dl className="divide-y divide-border rounded-lg border border-border text-sm">
                    <Row
                      label={`Usual ${day.weekdayName}`}
                      hint={
                        day.samples
                          ? `Weighted average of the last ${day.samples} open ${day.weekdayName}s, recent weeks count most; past event days left out.`
                          : `No open ${day.weekdayName}s in recent history.`
                      }
                      value={money(day.baseline, { whole: true })}
                    />
                    <Row label="Trend" hint="Last 4 weeks against the 4 before, damped." value={signed(day.trend)} muted={Math.round((day.trend - 1) * 100) === 0} />
                    <Row
                      label="Weather"
                      hint={
                        !day.weather
                          ? "No weather forecast this far out yet."
                          : day.weatherFactor !== 1
                            ? day.rain.wetSamples >= 3
                              ? `Rain day. Learned from ${day.rain.wetSamples} rainy days: we sell ${Math.round((1 - day.rain.factor) * 100)}% less.`
                              : "Rain day. Using a mild default until we've seen a few rainy days."
                            : `${day.weather.label}, high ${day.weather.highF}°F — no effect.`
                      }
                      value={signed(day.weatherFactor)}
                      muted={day.weatherFactor === 1}
                    />
                    {day.events.length === 0 ? (
                      <Row label="Events" hint="Nothing on the calendar." value="±0%" muted />
                    ) : (
                      day.events.map((e) => (
                        <Row
                          key={e.id}
                          label={e.title}
                          hint={`${EVENT_KIND_LABEL[e.kind as keyof typeof EVENT_KIND_LABEL] ?? e.kind}${e.startTime ? ` · ${displayTime(e.startTime)}` : ""}`}
                          value={e.kind === "CLOSURE" ? "Closed" : signed(e.impact)}
                        />
                      ))
                    )}
                    <Row label="Your adjustment" hint={day.reason ?? (day.manual === 1 ? "None." : "No reason given.")} value={signed(day.manual)} muted={day.manual === 1} />
                    <div className="flex items-baseline justify-between gap-3 bg-surface-2/60 px-3 py-2.5">
                      <dt className="font-medium">Forecast</dt>
                      <dd className="num font-semibold">{day.closed ? "Closed" : money(day.forecast ?? 0, { whole: true })}</dd>
                    </div>
                  </dl>

                  {!closedByEvent && <OverrideForm day={day} />}
                </>
              )}
              <a href="/events" className="mt-4 inline-block text-sm text-ink-2 hover:text-ink">
                Add or edit events →
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, hint, value, muted }: { label: string; hint?: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 px-3 py-2.5">
      <dt className="min-w-0">
        <div className="font-medium text-ink">{label}</div>
        {hint && <div className="text-xs text-muted">{hint}</div>}
      </dt>
      <dd className={cx("num shrink-0 font-medium", muted ? "text-muted" : "text-ink")}>{value}</dd>
    </div>
  );
}

function PastSummary({ day }: { day: CalDay }) {
  const err = day.actual && day.backtest != null ? (day.backtest - day.actual) / day.actual : null;
  return (
    <div className="space-y-4">
      <div>
        <div className="text-[0.8rem] font-medium text-muted">Actual sales</div>
        <div className="num mt-1 text-[1.75rem] font-semibold tracking-tight">{day.closed ? "Closed" : money(day.actual ?? 0, { whole: true })}</div>
        {day.backtest != null && !day.closed && (
          <div className="mt-1 text-sm text-muted">
            Forecast the day before: <span className="num text-ink-2">{money(day.backtest, { whole: true })}</span>
            {err != null && <> · {Math.abs(err) < 0.005 ? "spot on" : `${Math.round(Math.abs(err) * 100)}% ${err > 0 ? "high" : "low"}`}</>}
          </div>
        )}
      </div>
      {day.events.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {day.events.map((e) => (
            <Badge key={e.id}>{e.title}</Badge>
          ))}
        </div>
      )}
      {day.weather && (
        <div className="text-sm text-ink-2">
          {day.weather.label}, high {day.weather.highF}°F
          {day.weather.precipMm >= 1 ? `, ${day.weather.precipMm} mm rain` : ""}
        </div>
      )}
    </div>
  );
}

function OverrideForm({ day }: { day: CalDay }) {
  const initialPct = day.manual === 1 ? "" : String(Math.round((day.manual - 1) * 100));
  const [pct, setPct] = useState(initialPct);
  const [reason, setReason] = useState(day.reason ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const dirty = pct !== initialPct || reason !== (day.reason ?? "");
  const save = (p = pct, r = reason) =>
    start(async () => {
      const res = await saveAdjustment({ date: day.date, pct: p, reason: r });
      setError(res.error ?? null);
      if (!res.error) {
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      }
    });
  return (
    <div className="mt-5">
      <h3 className="mb-2 text-[0.8rem] font-medium text-ink-2">Adjust this day</h3>
      <div className="flex gap-2">
        <div className="relative w-24 shrink-0">
          <Input value={pct} onChange={(e) => setPct(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} placeholder="±0" aria-label="Adjustment percent" className="num pr-7 text-right" />
          <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted">%</span>
        </div>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} placeholder="Why? e.g. bus tour booked" aria-label="Reason" maxLength={200} />
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Button variant="primary" size="sm" disabled={pending || !dirty} onClick={() => save()} className="h-10 sm:h-8">
          {pending ? "Saving…" : "Save"}
        </Button>
        {day.manual !== 1 && (
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => {
              setPct("");
              setReason("");
              save("", "");
            }}
            className="h-10 sm:h-8"
          >
            Clear
          </Button>
        )}
        {error && <span className="text-sm text-bad">{error}</span>}
        {saved && <span className="text-sm text-good">Saved</span>}
      </div>
    </div>
  );
}

// ---- Hourly chart ----------------------------------------------------------------------

/** Single-series hourly line, same style as LineChart: 2px ink line, recessive grid, hover tooltip. */
export function HourlyChart({ hours, height = 170 }: { hours: number[]; height?: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(420);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  const { pts, first, last } = useMemo(() => {
    const open = hours.map((v, h) => (v > 0 ? h : -1)).filter((h) => h >= 0);
    if (open.length === 0) return { pts: [], first: 0, last: 0 };
    const first = Math.max(0, open[0] - 1);
    const last = Math.min(23, open[open.length - 1] + 1);
    const pts = [];
    for (let h = first; h <= last; h++) pts.push({ h, y: hours[h] });
    return { pts, first, last };
  }, [hours]);

  if (pts.length < 2)
    return (
      <div ref={wrap} className="grid h-24 place-items-center text-sm text-muted">
        No hourly shape yet.
      </div>
    );

  const H = height;
  const pad = { top: 12, right: 12, bottom: 24, left: 48 };
  const max = Math.max(...pts.map((p) => p.y)) * 1.15 || 1;
  const x = (i: number) => pad.left + (i / (pts.length - 1)) * (W - pad.left - pad.right);
  const y = (v: number) => pad.top + (1 - v / max) * (H - pad.top - pad.bottom);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join(" ");
  const step = (W - pad.left - pad.right) / (pts.length - 1);
  const labelEvery = pts.length > 10 ? 3 : 2;
  const hp = hover == null ? null : pts[hover];

  return (
    <div ref={wrap} className="relative">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block" role="img" aria-label={`Hourly forecast ${hourLabel(first)} to ${hourLabel(last)}`} onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={W - pad.right} y1={y(max * t)} y2={y(max * t)} stroke="var(--border)" strokeWidth={1} />
            <text x={pad.left - 8} y={y(max * t)} dy="0.32em" textAnchor="end" className="num fill-muted text-[11px]">
              {money(max * t, { whole: true })}
            </text>
          </g>
        ))}
        {pts.map((p, i) =>
          i % labelEvery === 0 ? (
            <text key={p.h} x={x(i)} y={H - 6} textAnchor="middle" className="fill-muted text-[11px]">
              {hourLabel(p.h)}
            </text>
          ) : null,
        )}
        <path d={path} fill="none" stroke="var(--ink)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {hp && (
          <>
            <line x1={x(hover!)} x2={x(hover!)} y1={pad.top} y2={H - pad.bottom} stroke="var(--border-strong)" strokeWidth={1} />
            <circle cx={x(hover!)} cy={y(hp.y)} r={4.5} fill="var(--ink)" stroke="var(--surface)" strokeWidth={2} />
          </>
        )}
        {pts.map((p, i) => (
          <rect key={`r${p.h}`} x={x(i) - step / 2} y={0} width={step} height={H} fill="transparent" onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)} />
        ))}
      </svg>
      {hp && (
        <div className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-md border border-border bg-surface px-2 py-1 text-xs shadow-sm" style={{ left: `${(x(hover!) / W) * 100}%` }}>
          <div className="text-muted">
            {hourLabel(hp.h)}–{hourLabel(hp.h + 1)}
          </div>
          <div className="num font-medium text-ink">{money(hp.y, { whole: true })}</div>
        </div>
      )}
    </div>
  );
}
