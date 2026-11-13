"use client";

import { DataTable, type Column, type GroupBy } from "@/components/data-table";
import { money, shortDate } from "@/lib/format";
import Link from "next/link";
import { useMemo } from "react";

export interface BillRow { id: string; supplier: string; billNo: string; date: string; dueDate: string; accounts: string[]; total: number }
export interface DayRow { date: string; categories: string; net: number; tax: number | null; tips: number | null; total: number }

const month = (d: string) => new Date(`${d.slice(0, 7)}-01T12:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });

/** Approved bills in the chosen range: search, sort, group by supplier, account or month with totals. */
export function BillsTable({ rows }: { rows: BillRow[] }) {
  const columns = useMemo<Column<BillRow>[]>(() => [
    { id: "supplier", header: "Supplier", width: 200, sort: (b) => b.supplier, csv: (b) => b.supplier, cell: (b) => <Link href={`/invoices/${b.id}`} className="font-medium text-ink hover:underline">{b.supplier}</Link> },
    { id: "billNo", header: "Bill no", sort: (b) => b.billNo, csv: (b) => b.billNo, cell: (b) => <span className="num text-ink-2">{b.billNo}</span> },
    { id: "date", header: "Date", firstDir: "desc", sort: (b) => b.date, csv: (b) => b.date, cell: (b) => <span className="num">{shortDate(b.date)}</span> },
    { id: "due", header: "Due", firstDir: "desc", sort: (b) => b.dueDate, csv: (b) => b.dueDate, cell: (b) => <span className="num text-ink-2">{shortDate(b.dueDate)}</span> },
    { id: "accounts", header: "Accounts", sort: (b) => b.accounts.join(", "), csv: (b) => b.accounts.join("; "), cell: (b) => <span className="text-ink-2">{b.accounts.join(", ")}</span> },
    { id: "total", header: "Amount", align: "right", firstDir: "desc", sort: (b) => b.total, csv: (b) => b.total, cell: (b) => money(b.total), total: (rs) => money(rs.reduce((s, r) => s + r.total, 0)) },
  ], []);
  const groups = useMemo<GroupBy<BillRow>[]>(() => [
    { id: "supplier", label: "Supplier", key: (b) => b.supplier },
    { id: "month", label: "Month", key: (b) => b.date.slice(0, 7), title: month, order: (a, b) => b.localeCompare(a) },
  ], []);
  return (
    <DataTable
      id="export-bills"
      rows={rows}
      rowKey={(b) => b.id}
      columns={columns}
      noun={["bill", "bills"]}
      searchText={(b) => `${b.supplier} ${b.billNo} ${b.accounts.join(" ")}`}
      filters={[
        { id: "supplier", label: "Supplier", kind: "facet", values: (b) => b.supplier },
        { id: "account", label: "Account", kind: "facet", values: (b) => b.accounts },
      ]}
      groups={groups}
      defaultView={{ sort: [{ id: "date", dir: "desc" }] }}
      urlSearch={false}
      csvName="bills"
      rowHref={(b) => `/invoices/${b.id}`}
      summary={(vis) => [{ value: vis.length, label: vis.length === 1 ? "bill" : "bills" }, { value: money(vis.reduce((s, r) => s + r.total, 0)), label: "total" }]}
      card={(b) => ({ title: b.supplier, subtitle: `#${b.billNo} · ${shortDate(b.date)}`, value: money(b.total) })}
    />
  );
}

export function SalesDaysTable({ rows }: { rows: DayRow[] }) {
  const columns = useMemo<Column<DayRow>[]>(() => [
    { id: "date", header: "Day", firstDir: "desc", sort: (d) => d.date, csv: (d) => d.date, cell: (d) => <span className="num">{shortDate(d.date)}</span> },
    { id: "categories", header: "By category", sort: (d) => d.categories, csv: (d) => d.categories, cell: (d) => <span className="text-ink-2">{d.categories}</span> },
    { id: "net", header: "Net sales", align: "right", firstDir: "desc", sort: (d) => d.net, csv: (d) => d.net, cell: (d) => money(d.net), total: (rs) => money(rs.reduce((s, r) => s + r.net, 0), { whole: true }) },
    { id: "tax", header: "Tax", align: "right", firstDir: "desc", sort: (d) => d.tax, csv: (d) => d.tax, cell: (d) => (d.tax == null ? <span className="text-muted">—</span> : money(d.tax)) },
    { id: "tips", header: "Tips", align: "right", firstDir: "desc", sort: (d) => d.tips, csv: (d) => d.tips, cell: (d) => (d.tips == null ? <span className="text-muted">—</span> : money(d.tips)), total: (rs) => money(rs.reduce((s, r) => s + (r.tips ?? 0), 0), { whole: true }) },
    { id: "total", header: "Total", align: "right", firstDir: "desc", sort: (d) => d.total, csv: (d) => d.total, cell: (d) => money(d.total), total: (rs) => money(rs.reduce((s, r) => s + r.total, 0), { whole: true }) },
  ], []);
  const groups = useMemo<GroupBy<DayRow>[]>(() => [
    { id: "month", label: "Month", key: (d) => d.date.slice(0, 7), title: month, order: (a, b) => b.localeCompare(a) },
    { id: "weekday", label: "Weekday", key: (d) => new Date(`${d.date}T12:00:00`).toLocaleDateString("en-US", { weekday: "long" }) },
  ], []);
  return (
    <DataTable
      id="export-sales"
      rows={rows}
      rowKey={(d) => d.date}
      columns={columns}
      noun={["day", "days"]}
      searchText={(d) => `${d.date} ${shortDate(d.date)} ${d.categories}`}
      groups={groups}
      defaultView={{ sort: [{ id: "date", dir: "desc" }] }}
      urlSearch={false}
      csvName="sales-days"
      card={(d) => ({ title: shortDate(d.date), subtitle: d.categories, value: money(d.net), sub: d.tips ? `tips ${money(d.tips)}` : undefined })}
    />
  );
}
