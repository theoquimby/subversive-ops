"use client";

import { DataTable, type Column, type Filter, type GroupBy } from "@/components/data-table";
import { Badge } from "@/components/ui";
import { WEEKDAYS } from "@/domain/dates";
import { WEATHER_KIND_LABEL, WEATHER_KINDS, type WeatherKind } from "@/domain/weatherHistory";
import { dayDate, money, signedPct } from "@/lib/format";
import { useMemo } from "react";

export interface DayRow {
  date: string;
  weekday: number;
  actual: number;
  forecast: number;
  /** (forecast − actual) ÷ actual */
  miss: number;
  weekAhead: number | null;
  lastWeek: number | null;
  weather: WeatherKind | null;
  event: boolean;
}

const WEEKDAY_OPTIONS = [1, 2, 3, 4, 5, 6, 0].map((d) => ({ value: String(d), label: WEEKDAYS[d] }));
const missTone = (m: number) => (Math.abs(m) <= 0.15 ? "text-ink-2" : Math.abs(m) <= 0.3 ? "text-warn" : "text-bad");
const DEFAULT_VIEW = { sort: [{ id: "date", dir: "desc" as const }] };

/** Every scored day: what was forecast the evening before, what sold, and what the day was like. */
export function ScoreDaysTable({ rows }: { rows: DayRow[] }) {
  const columns = useMemo<Column<DayRow>[]>(() => [
    { id: "date", header: "Day", hideable: false, width: 150, firstDir: "desc", sort: (r) => r.date, csv: (r) => r.date, cell: (r) => <span className="num font-medium text-ink">{dayDate(r.date)}, {r.date.slice(0, 4)}</span> },
    { id: "forecast", header: "Forecast", align: "right", width: 100, firstDir: "desc", sort: (r) => r.forecast, csv: (r) => r.forecast.toFixed(2), cell: (r) => <span className="num text-ink-2">{money(r.forecast, { whole: true })}</span> },
    { id: "actual", header: "Sold", align: "right", width: 100, firstDir: "desc", sort: (r) => r.actual, csv: (r) => r.actual.toFixed(2), cell: (r) => <span className="num font-medium text-ink">{money(r.actual, { whole: true })}</span> },
    { id: "miss", header: "Forecast was", align: "right", width: 110, firstDir: "desc", sort: (r) => Math.abs(r.miss), csv: (r) => r.miss.toFixed(4), cell: (r) => <span className={`num ${missTone(r.miss)}`}>{signedPct(r.miss, 0)}</span> },
    { id: "weekAhead", header: "A week ahead", align: "right", width: 110, defaultHidden: true, sort: (r) => (r.weekAhead == null ? null : Math.abs(r.weekAhead / r.actual - 1)), csv: (r) => (r.weekAhead == null ? "" : r.weekAhead.toFixed(2)), cell: (r) => (r.weekAhead == null ? <span className="text-muted">—</span> : <span className="num text-ink-2">{signedPct(r.weekAhead / r.actual - 1, 0)}</span>) },
    { id: "lastWeek", header: "Same day last week", align: "right", width: 130, defaultHidden: true, sort: (r) => (r.lastWeek == null ? null : Math.abs(r.lastWeek / r.actual - 1)), csv: (r) => (r.lastWeek == null ? "" : r.lastWeek.toFixed(2)), cell: (r) => (r.lastWeek == null ? <span className="text-muted">—</span> : <span className="num text-ink-2">{signedPct(r.lastWeek / r.actual - 1, 0)}</span>) },
    { id: "weather", header: "Weather", width: 110, sort: (r) => (r.weather ? WEATHER_KIND_LABEL[r.weather] : ""), csv: (r) => (r.weather ? WEATHER_KIND_LABEL[r.weather] : ""), cell: (r) => (r.weather ? <span className="text-ink-2">{WEATHER_KIND_LABEL[r.weather]}</span> : <span className="text-muted">Not on file</span>) },
    { id: "event", header: "Event", width: 80, sort: (r) => (r.event ? 1 : 0), csv: (r) => (r.event ? "yes" : ""), cell: (r) => (r.event ? <Badge tone="neutral">Event</Badge> : null) },
  ], []);

  const filters = useMemo<Filter<DayRow>[]>(() => [
    { id: "big", label: "Missed by over 25%", kind: "toggle", test: (r) => Math.abs(r.miss) > 0.25, tone: "warn" },
    { id: "weekday", label: "Weekday", kind: "facet", values: (r) => String(r.weekday), options: WEEKDAY_OPTIONS },
    { id: "weather", label: "Weather", kind: "facet", values: (r) => r.weather, options: WEATHER_KINDS.map((k) => ({ value: k, label: WEATHER_KIND_LABEL[k] })) },
    { id: "year", label: "Year", kind: "facet", values: (r) => r.date.slice(0, 4) },
    { id: "event", label: "Event days", kind: "toggle", test: (r) => r.event },
    { id: "normal", label: "Normal days", kind: "toggle", test: (r) => !r.event },
  ], []);

  const groups = useMemo<GroupBy<DayRow>[]>(() => [
    { id: "month", label: "Month", key: (r) => r.date.slice(0, 7), order: (a, b) => b.localeCompare(a) },
    { id: "weekday", label: "Weekday", key: (r) => String(r.weekday), title: (k) => WEEKDAYS[Number(k)], order: (a, b) => ((Number(a) + 6) % 7) - ((Number(b) + 6) % 7) },
    { id: "weather", label: "Weather", key: (r) => r.weather, title: (k) => WEATHER_KIND_LABEL[k as WeatherKind] ?? "Not on file" },
  ], []);

  return (
    <DataTable
      id="sales-scorecard-days"
      rows={rows}
      rowKey={(r) => r.date}
      columns={columns}
      filters={filters}
      groups={groups}
      defaultView={DEFAULT_VIEW}
      noun={["day", "days"]}
      searchText={(r) => `${r.date} ${dayDate(r.date)} ${WEEKDAYS[r.weekday]} ${r.weather ? WEATHER_KIND_LABEL[r.weather] : ""}`}
      searchPlaceholder="Search days, e.g. 2026-07 or Sat"
      csvName="forecast-scorecard-days"
      urlSearch={false}
      help="sales.scorecard.days"
      maxHeight="34rem"
      summary={(vis) => {
        const sold = vis.reduce((s, r) => s + r.actual, 0);
        const off = vis.reduce((s, r) => s + Math.abs(r.forecast - r.actual), 0);
        return [
          { value: vis.length, label: vis.length === 1 ? "day" : "days" },
          ...(sold > 0 ? [{ value: `${Math.round((off / sold) * 100)}%`, label: "typical miss in view" }] : []),
          { value: vis.filter((r) => Math.abs(r.miss) > 0.25).length, label: "missed by over 25%", filter: { id: "big" } },
        ];
      }}
      card={(r) => ({
        title: `${dayDate(r.date)}, ${r.date.slice(0, 4)}`,
        subtitle: [r.weather ? WEATHER_KIND_LABEL[r.weather] : null, r.event ? "Event" : null].filter(Boolean).join(" · ") || undefined,
        value: money(r.actual, { whole: true }),
        sub: `forecast ${signedPct(r.miss, 0)}`,
      })}
    />
  );
}
