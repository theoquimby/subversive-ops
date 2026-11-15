"use client";

import { DataTable, type Column, type Filter, type GroupBy } from "@/components/data-table";
import { GridCell, GridSelect } from "@/components/grid";
import { HelpTip } from "@/components/help";
import { Badge, cx } from "@/components/ui";
import type { PrepRounding, PrepStatus } from "@/domain/prep";
import { useMemo, useState } from "react";
import { AutoSwitch, SaveStatus } from "../../settings/controls";
import { saveCoverDays, savePrepField } from "../actions";

export interface SetupRow {
  id: string;
  name: string;
  category: string;
  onList: boolean;
  station: string;
  unitLabel: string;
  unitName: string;
  par: number | null;
  shelfLifeDays: number | null;
  rounding: PrepRounding;
  batchText: string;
  dailyText: string | null;
  daily: number;
  status: PrepStatus | null;
}

const ROUNDING = [
  { value: "batch", label: "Whole batches" },
  { value: "half", label: "Half batches" },
  { value: "exact", label: "Exact amount" },
];

function editors(r: SetupRow, grid: string) {
  return {
    station: <GridCell grid={grid} col="station" value={r.station} placeholder={r.category} ariaLabel={`${r.name} station`} onSave={(v) => savePrepField(r.id, "station", v)} />,
    unit: <GridCell grid={grid} col="unit" value={r.unitLabel} placeholder="qt" ariaLabel={`${r.name} counted in`} onSave={(v) => savePrepField(r.id, "unit", v)} />,
    par: <GridCell grid={grid} col="par" type="number" value={r.par} suffix={r.unitName === "each" ? "ea" : r.unitName} placeholder="—" ariaLabel={`${r.name} par in ${r.unitName}`} onSave={(v) => savePrepField(r.id, "parBase", v)} />,
    shelf: <GridCell grid={grid} col="shelf" type="number" value={r.shelfLifeDays} suffix="d" placeholder="—" ariaLabel={`${r.name} keeps for days`} onSave={(v) => savePrepField(r.id, "shelfLifeDays", v)} />,
    rounding: <GridSelect value={r.rounding} options={ROUNDING} ariaLabel={`${r.name} rounding`} onSave={(v) => savePrepField(r.id, "rounding", v)} />,
    onList: <AutoSwitch on={r.onList} label={`${r.name} on the prep list`} onText="On list" offText="Off" onSave={(on) => savePrepField(r.id, "onList", on ? "on" : "off")} />,
  };
}

function SetupDrawer({ r }: { r: SetupRow }) {
  const e = editors(r, "prep-d");
  const f = (label: string, hint: string, el: React.ReactNode) => (
    <div className="grid grid-cols-[1fr_9.5rem] items-center gap-3 py-2">
      <div><div className="text-sm font-medium text-ink">{label}</div><div className="text-xs text-muted">{hint}</div></div>
      {el}
    </div>
  );
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">One batch makes {r.batchText}{r.dailyText ? ` · about ${r.dailyText} used a service day` : ""}.</p>
      <div className="flex items-center justify-between gap-3">
        <div><div className="text-sm font-medium text-ink">On the prep list</div><div className="text-xs text-muted">Off for portions or things made to order.</div></div>
        {e.onList}
      </div>
      <div className="divide-y divide-border">
        {f("Station", "Groups the list, like Sauces or Fry.", e.station)}
        {f("Counted in", "qt, lb, or a container: cambro = 6 qt.", e.unit)}
        {f("Par", "The least to keep on hand.", e.par)}
        {f("Keeps for", "Days it lasts once made.", e.shelf)}
        {f("Round to", "How amounts are rounded up.", e.rounding)}
      </div>
    </div>
  );
}

export function PrepSetupTable({ rows, stations }: { rows: SetupRow[]; stations: string[] }) {
  const columns = useMemo<Column<SetupRow>[]>(() => [
    { id: "name", header: "Prep item", width: 200, hideable: false, sort: (r) => r.name, csv: (r) => r.name, cell: (r) => <div className="min-w-0"><div className={cx("truncate font-medium", !r.onList && "text-muted")}>{r.name}</div><div className="text-xs text-muted">Batch {r.batchText}</div></div> },
    { id: "onList", header: "On list", help: "prep.setup.onList", width: 130, edit: true, sort: (r) => (r.onList ? 1 : 0), csv: (r) => (r.onList ? "yes" : "no"), cell: (r) => <div className="px-2">{editors(r, "prep").onList}</div> },
    { id: "station", header: "Station", help: "prep.setup.station", width: 140, edit: true, sort: (r) => r.station, csv: (r) => r.station, cell: (r) => editors(r, "prep").station },
    { id: "unit", header: "Counted in", help: "prep.setup.unit", width: 150, edit: true, sort: (r) => r.unitLabel, csv: (r) => r.unitLabel, cell: (r) => editors(r, "prep").unit },
    { id: "par", header: "Par", help: "prep.setup.par", width: 110, align: "right", edit: true, firstDir: "desc", sort: (r) => r.par, csv: (r) => r.par, cell: (r) => editors(r, "prep").par },
    { id: "shelf", header: "Keeps", help: "prep.setup.shelfLife", width: 90, align: "right", edit: true, sort: (r) => r.shelfLifeDays, csv: (r) => r.shelfLifeDays, cell: (r) => editors(r, "prep").shelf },
    { id: "rounding", header: "Round to", help: "prep.setup.rounding", width: 150, edit: true, sort: (r) => r.rounding, csv: (r) => r.rounding, cell: (r) => editors(r, "prep").rounding },
    { id: "daily", header: "Used a day", width: 110, align: "right", firstDir: "desc", sort: (r) => r.daily, csv: (r) => r.dailyText ?? "", cell: (r) => (r.dailyText ? <span className="num text-ink-2">{r.dailyText}</span> : <span className="text-muted">—</span>) },
  ], []);

  const filters = useMemo<Filter<SetupRow>[]>(() => [
    { id: "list", label: "On list", kind: "facet", single: true, display: "segmented", allLabel: "All", values: (r) => (r.onList ? "on" : "off"), options: [{ value: "on", label: "On list" }, { value: "off", label: "Off" }] },
    { id: "nopar", label: "No forecast, no par", kind: "toggle", test: (r) => r.onList && r.status === "nodata", tone: "warn" },
    { id: "station", label: "Station", kind: "facet", values: (r) => r.station || r.category, options: stations.map((s) => ({ value: s, label: s })) },
  ], [stations]);

  const groups = useMemo<GroupBy<SetupRow>[]>(() => [{ id: "station", label: "Station", key: (r) => r.station || r.category }], []);

  return (
    <DataTable
      id="prep-setup"
      rows={rows}
      rowKey={(r) => r.id}
      columns={columns}
      noun={["prep item", "prep items"]}
      searchText={(r) => `${r.name} ${r.station} ${r.category}`}
      searchPlaceholder="Search prep items"
      filters={filters}
      groups={groups}
      defaultView={{ group: "station" }}
      rowClassName={(r) => (r.onList ? undefined : "opacity-70")}
      csvName="prep-setup"
      urlSearch={false}
      help="prep.setup"
      tours={{ root: "prep.setup-table" }}
      drawer={(r) => <SetupDrawer r={r} />}
      drawerTitle={(r) => r.name}
      card={(r) => ({
        title: r.name,
        subtitle: `${r.station || r.category} · batch ${r.batchText}`,
        value: r.par != null ? `Par ${r.par} ${r.unitName}` : r.onList ? undefined : <Badge>Off list</Badge>,
        sub: [r.shelfLifeDays ? `Keeps ${r.shelfLifeDays}d` : null, ROUNDING.find((x) => x.value === r.rounding)?.label].filter(Boolean).join(" · "),
      })}
      summary={(vis, all) => [
        { value: all.filter((r) => r.onList).length, label: "on the list" },
        { value: all.filter((r) => r.par != null).length, label: "with a par" },
        { value: all.filter((r) => r.onList && r.status === "nodata").length, label: "no forecast or par", tone: "warn", filter: { id: "nopar" } },
      ]}
    />
  );
}

const COVER = [1, 2, 3, 4];

/** How many service days a day's prep should last. */
export function CoverDays({ value }: { value: number }) {
  const [v, setV] = useState(value);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const pick = async (n: number) => {
    const prev = v;
    setV(n);
    setStatus("saving");
    const r = await saveCoverDays(n);
    if (r.error) { setV(prev); setError(r.error); setStatus("error"); } else { setStatus("saved"); setTimeout(() => setStatus("idle"), 1500); }
  };
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div>
        <div className="flex items-center gap-1 text-sm font-medium text-ink">Prep enough for <HelpTip id="prep.cover" /></div>
        <div className="text-xs text-muted">Service days each day&apos;s prep should cover. Closed days don&apos;t count.</div>
      </div>
      <div className="inline-flex rounded-xl border border-border bg-surface p-1" role="group" aria-label="Service days to cover">
        {COVER.map((n) => (
          <button key={n} type="button" aria-pressed={v === n} onClick={() => void pick(n)} className={cx("h-10 min-w-12 rounded-lg px-3 text-sm font-medium transition-colors duration-120 sm:h-9", v === n ? "bg-primary text-primary-ink" : "text-ink-2 hover:bg-surface-2")}>
            {n} day{n === 1 ? "" : "s"}
          </button>
        ))}
      </div>
      {status !== "idle" && <SaveStatus status={status} error={error} />}
    </div>
  );
}
