"use client";

import { DataTable, type Column, type Filter, type GroupBy } from "@/components/data-table";
import { Badge, Button, EmptyState, LinkButton, type Tone } from "@/components/ui";
import { money, shortDate } from "@/lib/format";
import Link from "next/link";
import { useMemo } from "react";
import { approveMatched } from "./actions";
import { QboBadge } from "./quickbooks-client";
import type { ComponentProps } from "react";

export interface InvoiceRow {
  id: string;
  supplierId: string;
  supplier: string;
  number: string | null;
  date: string;
  orderId: string | null;
  delivery: string | null;
  status: string;
  statusLabel: string;
  tone: Tone;
  total: number;
  flagged: number;
  qbo: ComponentProps<typeof QboBadge>["state"];
}

const month = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });

export function InvoicesTable({ rows, statuses }: { rows: InvoiceRow[]; statuses: { value: string; label: string }[] }) {
  const columns = useMemo<Column<InvoiceRow>[]>(() => [
    { id: "supplier", header: "Supplier", width: 200, sort: (i) => i.supplier, csv: (i) => i.supplier, cell: (i) => <Link href={`/invoices/${i.id}`} className="font-medium text-ink hover:underline">{i.supplier}</Link> },
    { id: "number", header: "Number", sort: (i) => i.number, csv: (i) => i.number, cell: (i) => <span className="num text-ink-2">{i.number ?? <span className="text-muted">—</span>}</span> },
    { id: "date", header: "Date", firstDir: "desc", sort: (i) => i.date, csv: (i) => i.date, cell: (i) => <span className="num">{shortDate(i.date)}</span> },
    { id: "order", header: "Order", sort: (i) => i.delivery, csv: (i) => i.delivery, cell: (i) => (i.orderId ? <Link href={`/ordering/po/${i.orderId}`} className="text-ink-2 hover:text-ink hover:underline">Delivery {shortDate(i.delivery!)}</Link> : <span className="text-muted">Not linked</span>) },
    {
      id: "status",
      header: "Status",
      sort: (i) => i.statusLabel,
      csv: (i) => i.statusLabel,
      cell: (i) => (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <Badge tone={i.tone}>{i.statusLabel}</Badge>
          <QboBadge state={i.qbo} />
          {i.status !== "APPROVED" && i.status !== "MATCHED" && i.flagged > 0 && <span className="text-xs text-muted">{i.flagged} {i.flagged === 1 ? "line" : "lines"}</span>}
        </span>
      ),
    },
    { id: "total", header: "Total", align: "right", firstDir: "desc", sort: (i) => i.total, csv: (i) => i.total, cell: (i) => money(i.total), total: (rs) => money(rs.reduce((s, r) => s + r.total, 0)) },
  ], []);

  const filters = useMemo<Filter<InvoiceRow>[]>(() => [
    { id: "status", label: "Status", kind: "facet", values: (i) => [i.status, ...(i.status !== "APPROVED" ? ["OPEN"] : [])], options: statuses, param: "status" },
    { id: "supplier", label: "Supplier", kind: "facet", values: (i) => i.supplierId, options: [...new Map(rows.map((r) => [r.supplierId, r.supplier]))].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label })), param: "supplier" },
    { id: "month", label: "Month", kind: "facet", values: (i) => i.date.slice(0, 7), options: [...new Set(rows.map((r) => r.date.slice(0, 7)))].sort().reverse().map((m) => ({ value: m, label: month(`${m}-01`) })), param: "month" },
    { id: "unlinked", label: "No order linked", kind: "toggle", test: (i) => !i.orderId },
  ], [rows, statuses]);

  const groups = useMemo<GroupBy<InvoiceRow>[]>(() => [
    { id: "supplier", label: "Supplier", key: (i) => i.supplier },
    { id: "month", label: "Month", key: (i) => i.date.slice(0, 7), title: (k) => month(`${k}-01`), order: (a, b) => b.localeCompare(a) },
    { id: "status", label: "Status", key: (i) => i.statusLabel },
  ], []);

  return (
    <DataTable
      id="invoices"
      help="invoices.list"
      rows={rows}
      rowKey={(i) => i.id}
      columns={columns}
      noun={["invoice", "invoices"]}
      searchText={(i) => `${i.supplier} ${i.number ?? ""} ${i.statusLabel} ${i.date}`}
      filters={filters}
      groups={groups}
      defaultView={{ sort: [{ id: "date", dir: "desc" }] }}
      csvName="invoices"
      rowHref={(i) => `/invoices/${i.id}`}
      empty={<EmptyState title="No invoices yet" action={<LinkButton href="/invoices/new" variant="primary">Add the first invoice</LinkButton>}>Take a photo of a delivery invoice, or type it in. Each line is checked against the order and its check-in.</EmptyState>}
      summary={(vis) => [
        { value: vis.length, label: vis.length === 1 ? "invoice" : "invoices" },
        { value: money(vis.reduce((s, r) => s + r.total, 0), { whole: true }), label: "total" },
        { value: vis.filter((i) => i.status !== "APPROVED").length, label: "to approve", tone: "warn", filter: { id: "status", value: "OPEN" } },
        { value: vis.filter((i) => i.status === "MATCHED").length, label: "clean matches", tone: "good", filter: { id: "status", value: "MATCHED" } },
      ]}
      card={(i) => ({ title: i.supplier, subtitle: <>{i.number ? `#${i.number} · ` : ""}{shortDate(i.date)} · <span className={i.tone === "bad" ? "text-bad" : i.tone === "warn" ? "text-warn" : undefined}>{i.statusLabel}</span></>, value: money(i.total) })}
      bulkActions={(api) => {
        const clean = api.rows.filter((r) => r.status === "MATCHED");
        return clean.length ? <Button size="sm" variant="primary" disabled={api.pending} onClick={() => api.run(() => approveMatched(clean.map((r) => r.id)))}>Approve {clean.length} matched</Button> : <span className="px-1 text-xs text-muted">Only clean matches can be approved in bulk</span>;
      }}
    />
  );
}
