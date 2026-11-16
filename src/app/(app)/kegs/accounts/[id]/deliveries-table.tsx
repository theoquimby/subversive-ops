"use client";

import { DataTable, type Column, type Filter, type GroupBy } from "@/components/data-table";
import { useMemo } from "react";
import { dated } from "../bits";

export interface DeliveryRow {
  key: string;
  out: string;
  /** Instant of the delivery scan, for order. */
  at: string;
  code: string | null;
  display: string | null;
  beer: string | null;
  size: string | null;
  state: "back" | "there" | "resent" | "unknown";
  back: string | null;
  daysKept: number | null;
}

const NO_BEER = "Beer not recorded";
const STATE: Record<DeliveryRow["state"], string> = { back: "Came back", there: "Still there", resent: "No return scan", unknown: "No return scan" };
const DEFAULT_VIEW = { sort: [{ id: "out", dir: "desc" as const }] };

/** One account's deliveries: search a keg or beer, filter by beer, size or whether it came back. */
export function DeliveriesTable({ rows, account }: { rows: DeliveryRow[]; account: string }) {
  const columns = useMemo<Column<DeliveryRow>[]>(() => [
    { id: "out", header: "Delivered", width: 120, hideable: false, firstDir: "desc", sort: (h) => h.at, csv: (h) => h.out, cell: (h) => <span className="whitespace-nowrap">{dated(h.out)}</span> },
    { id: "keg", header: "Keg", width: 100, sort: (h) => h.code, csv: (h) => h.display ?? "", cell: (h) => <span className="num font-medium whitespace-nowrap">{h.display ?? "—"}</span> },
    { id: "beer", header: "Beer", width: 180, sort: (h) => h.beer, csv: (h) => h.beer ?? "", cell: (h) => (h.beer ? <span className="text-ink-2">{h.beer}</span> : <span className="text-muted">{NO_BEER}</span>) },
    { id: "size", header: "Size", width: 90, sort: (h) => h.size, csv: (h) => h.size ?? "", cell: (h) => <span className="whitespace-nowrap text-muted">{h.size ?? "—"}</span> },
    {
      id: "back", header: "Came back", width: 140, sort: (h) => (h.state === "back" ? h.back : h.state === "there" ? "9999" : null), csv: (h) => (h.state === "back" ? h.back ?? "" : STATE[h.state]),
      cell: (h) => (h.state === "back" && h.back ? <span className="whitespace-nowrap text-ink-2">{dated(h.back)}</span> : h.state === "there" ? "Still there" : <span className="text-muted" title={h.state === "resent" && h.back ? `Next seen going out again on ${dated(h.back)}` : undefined}>No return scan</span>),
    },
    { id: "days", header: "Days kept", align: "right", width: 100, firstDir: "desc", sort: (h) => h.daysKept, csv: (h) => h.daysKept ?? "", cell: (h) => (h.daysKept == null ? <span className="text-muted">—</span> : <>{h.daysKept}{h.state === "there" && <span className="text-muted"> so far</span>}</>) },
  ], []);

  const filters = useMemo<Filter<DeliveryRow>[]>(() => [
    { id: "beer", label: "Beer", kind: "facet", values: (h) => h.beer ?? NO_BEER },
    { id: "size", label: "Size", kind: "facet", values: (h) => h.size ?? undefined },
    { id: "state", label: "Came back", kind: "facet", values: (h) => (h.state === "unknown" ? "resent" : h.state), options: [{ value: "back", label: "Came back" }, { value: "there", label: "Still there" }, { value: "resent", label: "No return scan" }] },
  ], []);

  const groups = useMemo<GroupBy<DeliveryRow>[]>(() => [
    { id: "beer", label: "Beer", key: (h) => h.beer ?? NO_BEER },
    { id: "year", label: "Year", key: (h) => h.out.slice(0, 4), order: (a, b) => b.localeCompare(a) },
  ], []);

  return (
    <DataTable
      id="kegs-account-deliveries"
      rows={rows}
      rowKey={(h) => h.key}
      columns={columns}
      noun={["delivery", "deliveries"]}
      searchText={(h) => `${h.code ?? ""} ${h.display ?? ""} ${h.beer ?? ""}`}
      searchPlaceholder="Search keg or beer"
      filters={filters}
      groups={groups}
      defaultView={DEFAULT_VIEW}
      csvName={`deliveries-${account.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`}
      urlSearch={false}
      maxHeight="36rem"
      rowHref={(h) => (h.code ? `/kegs/k/${h.code}` : null)}
      card={(h) => ({
        title: <span><span className="num">{h.display ?? "—"}</span> · {h.beer ?? NO_BEER}</span>,
        subtitle: `${dated(h.out)}${h.size ? ` · ${h.size}` : ""}`,
        value: h.daysKept == null ? undefined : `${h.daysKept} day${h.daysKept === 1 ? "" : "s"}`,
        sub: h.state === "back" ? "came back" : STATE[h.state].toLowerCase(),
      })}
    />
  );
}
