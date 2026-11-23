"use client";

import { DataTable, type Column, type Filter } from "@/components/data-table";
import { qty, shortDate } from "@/lib/format";
import Link from "next/link";
import { useMemo } from "react";

export interface KegMoveRow {
  key: string;
  date: string;
  /** The keg's sticker code, for the link. */
  code: string;
  /** The code as stickers show it ("NJN-X8"). */
  display: string;
  size: string | null;
  beer: string;
  what: string;
  note: string | null;
  gallons: number;
}

/** Every keg removal the worksheet counted, to check against the cellar log: search, filter, sort, export. */
export function KegMovesTable({ rows, period }: { rows: KegMoveRow[]; period: string }) {
  const columns = useMemo<Column<KegMoveRow>[]>(() => [
    { id: "date", header: "Date", width: 90, sort: (m) => m.date, csv: (m) => m.date, cell: (m) => <span className="num whitespace-nowrap text-muted">{shortDate(m.date)}</span> },
    {
      id: "keg", header: "Keg", width: 110, hideable: false, sort: (m) => m.code, csv: (m) => m.display,
      cell: (m) => <Link href={`/kegs/k/${m.code}`} className="num font-medium underline-offset-2 hover:underline">{m.display}<span className="block text-xs font-normal text-muted">{m.size}</span></Link>,
    },
    { id: "beer", header: "Beer", width: 170, sort: (m) => m.beer, csv: (m) => m.beer, cell: (m) => m.beer },
    { id: "what", header: "What", width: 200, sort: (m) => m.what, csv: (m) => m.what, cell: (m) => <span className="text-ink-2">{m.what}{m.note ? <span className="text-muted"> · {m.note}</span> : null}</span> },
    { id: "gal", header: "Gal", align: "right", width: 80, sort: (m) => m.gallons, csv: (m) => m.gallons, cell: (m) => <span className="num">{qty(m.gallons, 1)}</span>, total: (l) => <span className="num">{qty(l.reduce((s, m) => s + m.gallons, 0), 1)}</span> },
  ], []);
  const filters = useMemo<Filter<KegMoveRow>[]>(() => [
    { id: "what", label: "What", kind: "facet", values: (m) => m.what },
    { id: "beer", label: "Beer", kind: "facet", values: (m) => m.beer },
  ], []);
  return (
    <DataTable
      id="beertax-kegs"
      rows={rows}
      rowKey={(m) => m.key}
      columns={columns}
      noun={["keg removal", "keg removals"]}
      searchText={(m) => `${m.code} ${m.display} ${m.beer} ${m.what} ${m.note ?? ""}`}
      searchPlaceholder="Keg code or beer"
      filters={filters}
      defaultView={{ sort: [{ id: "date", dir: "asc" }] }}
      csvName={`beer-tax-kegs-${period}`}
      urlSearch={false}
      maxHeight="32rem"
      card={(m) => ({ title: <span className="num">{m.display}</span>, subtitle: `${m.beer} · ${m.what}`, value: `${qty(m.gallons, 1)} gal`, sub: shortDate(m.date) })}
    />
  );
}
