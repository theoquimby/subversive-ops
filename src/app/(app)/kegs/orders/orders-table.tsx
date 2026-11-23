"use client";

import { DataTable, type Column, type Filter, type GroupBy } from "@/components/data-table";
import { Badge } from "@/components/ui";
import type { ISODate } from "@/domain/dates";
import { progressLabel, transitLabel, TRANSITS, type KegOrderStatus, type OrderProgress } from "@/domain/kegOrders";
import { shortDate } from "@/lib/format";
import { useMemo } from "react";
import { DueBadge, OrderStatusBadge } from "./bits";

export interface OrderListRow {
  id: string;
  number: number;
  accountId: string;
  account: string;
  transit: string;
  dueOn: ISODate | null;
  status: KegOrderStatus;
  createdOn: ISODate;
  /** The business day it was fulfilled or cancelled. */
  closedOn: ISODate | null;
  /** "2 × Subversive IPA 1/2 bbl, …" */
  summary: string;
  beers: string[];
  kegs: number;
  progress: OrderProgress;
  short: number;
}

const STATUS_LABEL: Record<KegOrderStatus, string> = { OPEN: "Open", FULFILLED: "Fulfilled", CANCELLED: "Cancelled" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (m: string) => (m && m !== "none" ? `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}` : "No date");
/** The day that matters: when an open order is due, when a finished one closed. */
const dayOf = (o: OrderListRow) => (o.status === "OPEN" ? o.dueOn : o.closedOn);

/**
 * Every keg order: open ones first by due date, then finished ones, latest first.
 * Search an account, beer or number; filter by status, account, beer, month or
 * how it travels. A row opens the order.
 */
export function KegOrdersTable({ rows, today, hasOpen }: { rows: OrderListRow[]; today: ISODate; hasOpen: boolean }) {
  const columns = useMemo<Column<OrderListRow>[]>(() => [
    {
      id: "order", header: "Order", width: 220, hideable: false, sort: (o) => o.account, csv: (o) => o.account,
      cell: (o) => (
        <div className="min-w-0">
          <span className="block font-medium">{o.account}</span>
          <span className="block text-xs text-muted">Order {o.number} · {transitLabel(o.transit)}</span>
        </div>
      ),
    },
    { id: "number", header: "No.", align: "right", width: 70, defaultHidden: true, firstDir: "desc", sort: (o) => o.number, csv: (o) => o.number, cell: (o) => <span className="num">{o.number}</span> },
    { id: "kegs", header: "Kegs", width: 300, sort: (o) => o.kegs, firstDir: "desc", csv: (o) => o.summary, cell: (o) => <span className="text-ink-2">{o.summary || <span className="text-muted">No lines yet</span>}</span>, total: (l) => <span className="num">{l.reduce((s, o) => s + o.kegs, 0)} kegs</span> },
    {
      id: "date", header: "Date", width: 150, sort: (o) => dayOf(o) ?? (o.status === "OPEN" ? "9999" : null), csv: (o) => dayOf(o) ?? "",
      cell: (o) => (o.status === "OPEN" ? <DueBadge dueOn={o.dueOn} today={today} /> : <span className="whitespace-nowrap text-ink-2">{o.closedOn ? shortDate(o.closedOn) : "—"}</span>),
    },
    {
      id: "sent", header: "Sent", align: "right", width: 150, sort: (o) => o.progress.sent, csv: (o) => progressLabel(o.progress),
      cell: (o) => (
        <span className="whitespace-nowrap">
          {o.status === "CANCELLED" ? <Badge>Cancelled</Badge> : o.status === "OPEN" && o.progress.complete ? <Badge tone="good">All {o.progress.sent} sent</Badge> : <span className={o.progress.sent ? "" : "text-muted"}>{progressLabel(o.progress)}</span>}
          {o.status === "CANCELLED" && o.progress.sent > 0 && <span className="block text-xs text-muted">{progressLabel(o.progress)} went out</span>}
          {o.status === "FULFILLED" && !o.progress.complete && <span className="block text-xs font-medium text-warn">Closed with {o.progress.remaining} not sent</span>}
          {o.short > 0 && <span className="block text-xs text-warn">{o.short} to fill</span>}
        </span>
      ),
    },
    { id: "status", header: "Status", width: 110, sort: (o) => o.status, csv: (o) => STATUS_LABEL[o.status], cell: (o) => <OrderStatusBadge status={o.status} short={!o.progress.complete} /> },
    { id: "created", header: "Made", width: 100, defaultHidden: true, firstDir: "desc", sort: (o) => o.createdOn, csv: (o) => o.createdOn, cell: (o) => <span className="whitespace-nowrap text-muted">{shortDate(o.createdOn)}</span> },
  ], [today]);

  const filters = useMemo<Filter<OrderListRow>[]>(() => [
    { id: "status", label: "Status", kind: "facet", display: "segmented", single: true, allLabel: "All", param: "status", values: (o) => o.status, options: [{ value: "OPEN", label: "Open" }, { value: "FULFILLED", label: "Fulfilled" }, { value: "CANCELLED", label: "Cancelled" }] },
    { id: "due", label: "Due today or late", kind: "toggle", tone: "warn", test: (o) => o.status === "OPEN" && !!o.dueOn && o.dueOn <= today },
    { id: "short", label: "Kegs to fill", kind: "toggle", tone: "warn", test: (o) => o.short > 0 },
    { id: "closedShort", label: "Closed short", kind: "toggle", tone: "warn", test: (o) => o.status === "FULFILLED" && !o.progress.complete },
    { id: "account", label: "Account", kind: "facet", param: "account", values: (o) => o.accountId, options: accountOptions(rows) },
    { id: "beer", label: "Beer", kind: "facet", values: (o) => o.beers },
    { id: "month", label: "Month", kind: "facet", param: "month", values: (o) => dayOf(o)?.slice(0, 7) ?? "none", options: monthOptions(rows) },
    { id: "transit", label: "Delivery or pickup", kind: "facet", values: (o) => (o.transit === "PICKUP" ? "PICKUP" : "DELIVERY"), options: TRANSITS },
  ], [rows, today]);

  const groups = useMemo<GroupBy<OrderListRow>[]>(() => [
    { id: "account", label: "Account", key: (o) => o.account },
    { id: "month", label: "Month", key: (o) => dayOf(o)?.slice(0, 7) ?? "none", title: monthLabel, order: (a, b) => (a === "none" ? 1 : b === "none" ? -1 : b.localeCompare(a)) },
    { id: "status", label: "Status", key: (o) => o.status, title: (s) => STATUS_LABEL[s as KegOrderStatus] ?? s },
  ], []);

  return (
    <DataTable
      id="kegs-orders"
      rows={rows}
      rowKey={(o) => o.id}
      columns={columns}
      noun={["order", "orders"]}
      searchText={(o) => `${o.account} order ${o.number} #${o.number} ${o.beers.join(" ")} ${transitLabel(o.transit)}`}
      searchPlaceholder="Account, beer or order number"
      filters={filters}
      groups={groups}
      defaultView={hasOpen ? { filters: { status: ["OPEN"] } } : undefined}
      csvName="keg-orders"
      help="kegs.orders"
      maxHeight="calc(100dvh - 12rem)"
      rowHref={(o) => `/kegs/orders/${o.id}`}
      rowClassName={(o) => (o.status === "CANCELLED" ? "opacity-60" : undefined)}
      summary={(vis) => [
        { value: vis.length, label: vis.length === 1 ? "order" : "orders" },
        { value: vis.reduce((s, o) => s + o.kegs, 0), label: "kegs" },
        ...(vis.some((o) => o.status === "OPEN" && o.dueOn && o.dueOn <= today) ? [{ value: vis.filter((o) => o.status === "OPEN" && !!o.dueOn && o.dueOn <= today).length, label: "due today or late", tone: "warn" as const, filter: { id: "due" } }] : []),
        ...(vis.some((o) => o.short > 0) ? [{ value: vis.filter((o) => o.short > 0).length, label: "with kegs to fill", tone: "warn" as const, filter: { id: "short" } }] : []),
      ]}
      card={(o) => ({
        title: o.account,
        subtitle: `Order ${o.number} · ${o.summary || "No lines yet"}`,
        value: o.status === "OPEN" ? <DueBadge dueOn={o.dueOn} today={today} /> : o.closedOn ? shortDate(o.closedOn) : "—",
        sub: o.status === "OPEN" ? (o.progress.complete ? "All sent" : progressLabel(o.progress)) : o.status === "FULFILLED" && !o.progress.complete ? <span className="text-warn">Closed with {o.progress.remaining} not sent</span> : STATUS_LABEL[o.status],
      })}
    />
  );
}

function accountOptions(rows: OrderListRow[]) {
  const seen = new Map<string, string>();
  for (const o of rows) seen.set(o.accountId, o.account);
  return [...seen].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
}

function monthOptions(rows: OrderListRow[]) {
  const seen = new Set<string>();
  for (const o of rows) seen.add(dayOf(o)?.slice(0, 7) ?? "none");
  return [...seen].sort((a, b) => (a === "none" ? 1 : b === "none" ? -1 : b.localeCompare(a))).map((m) => ({ value: m, label: monthLabel(m) }));
}
