"use client";

import { DataTable, type Column, type Filter, type GroupBy } from "@/components/data-table";
import { Badge } from "@/components/ui";
import type { AccountRow } from "@/domain/kegAccounts";
import { useMemo } from "react";
import { ACCOUNT_KINDS, dated, daysWord, kindLabel } from "./bits";

const DEFAULT_VIEW = { filters: { use: ["current"] }, sort: [{ id: "kegs", dir: "desc" as const }, { id: "name", dir: "asc" as const }] };
/** An account no longer used stays in view while it still has kegs. */
const inUse = (a: AccountRow) => a.active || a.kegsOut > 0;

/** Every account: search, type and "kegs there" filters, sort by any number; a row opens the account. */
export function AccountsTable({ rows, overdueDays }: { rows: AccountRow[]; overdueDays: number }) {
  const columns = useMemo<Column<AccountRow>[]>(() => [
    { id: "name", header: "Account", width: 220, hideable: false, sort: (a) => a.name, csv: (a) => a.name, cell: (a) => <span className="font-medium">{a.name}</span> },
    { id: "kind", header: "Type", width: 130, sort: (a) => kindLabel(a.kind), csv: (a) => kindLabel(a.kind), cell: (a) => <span className="whitespace-nowrap text-ink-2">{kindLabel(a.kind)}{!a.active && <Badge className="ml-2">No longer used</Badge>}</span> },
    { id: "kegs", header: "Kegs there", align: "right", width: 100, firstDir: "desc", sort: (a) => a.kegsOut, csv: (a) => a.kegsOut, cell: (a) => <span className={a.kegsOut ? "font-medium" : "text-muted"}>{a.kegsOut}</span>, total: (l) => l.reduce((s, a) => s + a.kegsOut, 0) },
    {
      id: "wait", header: "Longest wait", align: "right", width: 120, firstDir: "desc", sort: (a) => a.longestDays, csv: (a) => a.longestDays ?? "",
      cell: (a) => (a.longestDays == null ? <span className="text-muted">—</span> : a.overdue ? <Badge tone="warn">{daysWord(a.longestDays)}</Badge> : <span className="text-ink-2">{daysWord(a.longestDays)}</span>),
    },
    { id: "d12", header: "Deliveries, 12 months", align: "right", width: 150, firstDir: "desc", sort: (a) => a.deliveries12, csv: (a) => a.deliveries12, cell: (a) => <span className={a.deliveries12 ? undefined : "text-muted"}>{a.deliveries12}</span>, total: (l) => l.reduce((s, a) => s + a.deliveries12, 0) },
    { id: "last", header: "Last delivery", width: 130, firstDir: "desc", sort: (a) => a.lastDelivery, csv: (a) => a.lastDelivery ?? "", cell: (a) => (a.lastDelivery ? <span className="whitespace-nowrap text-ink-2">{dated(a.lastDelivery)}</span> : <span className="text-muted">None scanned</span>) },
    { id: "all", header: "All deliveries", align: "right", width: 110, firstDir: "desc", sort: (a) => a.deliveries, csv: (a) => a.deliveries, cell: (a) => <span className={a.deliveries ? undefined : "text-muted"}>{a.deliveries}</span> },
  ], []);

  const filters = useMemo<Filter<AccountRow>[]>(() => [
    { id: "use", label: "Accounts", kind: "facet", display: "segmented", single: true, allLabel: "All", values: (a) => (inUse(a) ? "current" : "old"), options: [{ value: "current", label: "In use" }, { value: "old", label: "No longer used" }] },
    { id: "kind", label: "Type", kind: "facet", param: "type", values: (a) => a.kind, options: ACCOUNT_KINDS },
    { id: "there", label: "Kegs there now", kind: "toggle", test: (a) => a.kegsOut > 0 },
    { id: "late", label: `Out over ${daysWord(overdueDays)}`, kind: "toggle", tone: "warn", param: "late", test: (a) => a.overdue },
  ], [overdueDays]);

  const groups = useMemo<GroupBy<AccountRow>[]>(() => [{ id: "kind", label: "Type", key: (a) => kindLabel(a.kind) }], []);

  return (
    <DataTable
      id="kegs-accounts"
      rows={rows}
      rowKey={(a) => a.id}
      columns={columns}
      noun={["account", "accounts"]}
      searchText={(a) => `${a.name} ${kindLabel(a.kind)}`}
      searchPlaceholder="Search accounts"
      filters={filters}
      groups={groups}
      defaultView={DEFAULT_VIEW}
      csvName="keg-accounts"
      urlSearch={false}
      help="kegs.accounts"
      rowHref={(a) => `/kegs/accounts/${a.id}`}
      rowClassName={(a) => (a.active ? undefined : "opacity-60")}
      totals="Total"
      summary={(vis) => [
        { value: vis.length, label: vis.length === 1 ? "account" : "accounts" },
        { value: vis.filter((a) => a.kegsOut > 0).length, label: "with kegs there", filter: { id: "there" } },
        ...(vis.some((a) => a.overdue) ? [{ value: vis.filter((a) => a.overdue).length, label: `with a keg out over ${daysWord(overdueDays)}`, tone: "warn" as const, filter: { id: "late" } }] : []),
      ]}
      card={(a) => ({
        title: a.name,
        subtitle: `${kindLabel(a.kind)}${a.active ? "" : " · no longer used"}${a.lastDelivery ? ` · last ${dated(a.lastDelivery)}` : ""}`,
        value: `${a.kegsOut} keg${a.kegsOut === 1 ? "" : "s"}`,
        sub: a.longestDays == null ? undefined : <span className={a.overdue ? "text-warn" : undefined}>longest {daysWord(a.longestDays)}</span>,
      })}
    />
  );
}
