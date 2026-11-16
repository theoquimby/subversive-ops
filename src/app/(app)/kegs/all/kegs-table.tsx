"use client";

import { DataTable, type Column, type Filter, type GroupBy } from "@/components/data-table";
import { EmptyState, LinkButton } from "@/components/ui";
import { KEG_STATUSES, OWNER_LABEL, STATUS_META, type KegOwner, type KegStatus } from "@/domain/kegs";
import { Printer } from "lucide-react";
import { useMemo } from "react";
import { BeerDot, StatusBadge } from "../bits";

export interface KegRow {
  id: string;
  code: string;
  display: string;
  label: string | null;
  legacyCode: string | null;
  active: boolean;
  status: KegStatus;
  beerId: string | null;
  beer: string | null;
  color: string | null;
  sizeId: string;
  size: string;
  /** Gallons, so sizes sort small to big. */
  gallons: number;
  owner: KegOwner;
  /** "Walk-in · Back left", "Tap 3", "Out at Catskill Tap House"; null with no spot yet. */
  where: string | null;
  /** Where filter values: an area and its spot, or "At accounts" and the account. */
  whereFacets: string[];
  account: string | null;
  /** How long it has been in this status ("3 days"), worked out on the server. */
  since: string;
  /** Minutes in this status, for sorting. */
  minutes: number;
}

const STATUS_RANK = Object.fromEntries(KEG_STATUSES.map((s, i) => [s, i])) as Record<KegStatus, number>;
const DEFAULT_VIEW = { filters: { retired: ["0"] }, sort: [{ id: "status", dir: "asc" as const }, { id: "code", dir: "asc" as const }] };
/** The label printer page takes up to 500 codes at once. */
const PRINT_MAX = 500;

/** Every keg, in service or retired: search, filters, sort, group, CSV; each row opens the keg. */
export function KegsTable({ rows }: { rows: KegRow[] }) {
  const columns = useMemo<Column<KegRow>[]>(() => [
    {
      id: "code", header: "Code", width: 130, hideable: false, sort: (k) => k.code, csv: (k) => k.display,
      cell: (k) => <span className="whitespace-nowrap"><span className="num font-medium">{k.display}</span>{k.label && <span className="ml-2 text-muted">{k.label}</span>}</span>,
    },
    { id: "beer", header: "Beer", width: 170, sort: (k) => k.beer, csv: (k) => k.beer ?? "", cell: (k) => (k.beer ? <span className="inline-flex items-center gap-2"><BeerDot color={k.color ?? "amber"} />{k.beer}</span> : <span className="text-muted">—</span>) },
    { id: "status", header: "Status", width: 110, sort: (k) => STATUS_RANK[k.status], csv: (k) => STATUS_META[k.status].label, cell: (k) => <StatusBadge status={k.status} /> },
    { id: "where", header: "Where", width: 220, sort: (k) => k.where, csv: (k) => k.where ?? "", cell: (k) => (k.where ? <span className="text-ink-2">{k.where}</span> : <span className="text-muted">No spot yet</span>) },
    { id: "size", header: "Size", width: 90, sort: (k) => k.gallons, csv: (k) => k.size, cell: (k) => <span className="whitespace-nowrap text-muted">{k.size}</span> },
    { id: "owner", header: "Owner", width: 100, sort: (k) => OWNER_LABEL[k.owner], csv: (k) => OWNER_LABEL[k.owner], cell: (k) => <span className="text-muted">{OWNER_LABEL[k.owner]}</span> },
    { id: "legacy", header: "Old sticker", width: 150, defaultHidden: true, sort: (k) => k.legacyCode, csv: (k) => k.legacyCode ?? "", cell: (k) => <span className="num text-xs text-muted">{k.legacyCode ?? "—"}</span> },
    { id: "for", header: "For", label: "Time in status", align: "right", width: 90, firstDir: "desc", sort: (k) => k.minutes, csv: (k) => k.since, cell: (k) => <span className="num whitespace-nowrap text-muted">{k.since}</span> },
  ], []);

  const filters = useMemo<Filter<KegRow>[]>(() => [
    { id: "retired", label: "Kegs", kind: "facet", display: "segmented", single: true, allLabel: "All kegs", param: "retired", values: (k) => (k.active ? "0" : "1"), options: [{ value: "0", label: "In service" }, { value: "1", label: "Retired" }] },
    { id: "status", label: "Status", kind: "facet", param: "status", values: (k) => k.status, options: KEG_STATUSES.map((s) => ({ value: s, label: STATUS_META[s].short })) },
    { id: "beer", label: "Beer", kind: "facet", param: "beer", values: (k) => k.beerId ?? "none", options: beerOptions(rows) },
    { id: "size", label: "Size", kind: "facet", param: "size", values: (k) => k.sizeId, options: sizeOptions(rows) },
    { id: "owner", label: "Owner", kind: "facet", values: (k) => k.owner, options: (Object.keys(OWNER_LABEL) as KegOwner[]).map((o) => ({ value: o, label: OWNER_LABEL[o] })) },
    { id: "where", label: "Where", kind: "facet", param: "where", values: (k) => k.whereFacets },
  ], [rows]);

  const groups = useMemo<GroupBy<KegRow>[]>(() => [
    { id: "status", label: "Status", key: (k) => k.status, title: (s) => STATUS_META[s as KegStatus]?.label ?? s, order: (a, b) => STATUS_RANK[a as KegStatus] - STATUS_RANK[b as KegStatus] },
    { id: "beer", label: "Beer", key: (k) => k.beer, title: (b) => b || "No beer" },
    { id: "size", label: "Size", key: (k) => k.size },
    { id: "where", label: "Where", key: (k) => k.whereFacets[0], title: (w) => w || "No spot yet" },
  ], []);

  return (
    <DataTable
      id="kegs-all"
      rows={rows}
      rowKey={(k) => k.id}
      columns={columns}
      noun={["keg", "kegs"]}
      searchText={(k) => `${k.code} ${k.display} ${k.legacyCode ?? ""} ${k.beer ?? ""} ${k.account ?? ""} ${k.label ?? ""} ${k.where ?? ""}`}
      searchPlaceholder="Code, old sticker, beer, account"
      filters={filters}
      groups={groups}
      defaultView={DEFAULT_VIEW}
      csvName="kegs"
      help="kegs.all"
      rowHref={(k) => `/kegs/k/${k.code}`}
      rowClassName={(k) => (k.active ? undefined : "opacity-60")}
      summary={(vis) =>
        KEG_STATUSES.map((s) => ({ s, n: vis.filter((k) => k.status === s).length }))
          .filter((x) => x.n > 0)
          .map((x) => ({ value: x.n, label: STATUS_META[x.s].short.toLowerCase(), filter: { id: "status", value: x.s } }))
      }
      card={(k) => ({
        title: <span className="num">{k.display}{k.label && <span className="ml-2 font-normal text-muted">{k.label}</span>}</span>,
        subtitle: [k.beer ?? "No beer", k.where ?? "No spot yet"].join(" · "),
        value: STATUS_META[k.status].short,
        sub: `${k.size} · ${k.since}`,
      })}
      empty={<EmptyState title="No kegs yet">Add your kegs below, or import them from your old keg app.</EmptyState>}
      bulkActions={(api) => {
        const codes = api.rows.slice(0, PRINT_MAX).map((k) => k.code);
        return (
          <LinkButton size="sm" href={`/print/kegs?codes=${codes.join(",")}`} title={api.rows.length > PRINT_MAX ? `The first ${PRINT_MAX}; print the rest after` : undefined}>
            <Printer className="size-3.5" /> Print {codes.length} label{codes.length === 1 ? "" : "s"}
          </LinkButton>
        );
      }}
    />
  );
}

function beerOptions(rows: KegRow[]) {
  const seen = new Map<string, string>();
  for (const k of rows) if (k.beerId && k.beer) seen.set(k.beerId, k.beer);
  const list = [...seen].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  return rows.some((k) => !k.beerId) ? [...list, { value: "none", label: "No beer" }] : list;
}

function sizeOptions(rows: KegRow[]) {
  const seen = new Map<string, { label: string; gallons: number }>();
  for (const k of rows) seen.set(k.sizeId, { label: k.size, gallons: k.gallons });
  return [...seen].sort((a, b) => a[1].gallons - b[1].gallons).map(([value, s]) => ({ value, label: s.label }));
}
