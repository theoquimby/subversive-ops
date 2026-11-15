"use client";

import { DataTable, type Column, type Filter } from "@/components/data-table";
import { Badge } from "@/components/ui";
import { discountClassLabel, type DiscountClass } from "@/domain/squareMoney";
import { money, pct, qty } from "@/lib/format";
import Link from "next/link";
import { useMemo } from "react";

export type CompsView = "reason" | "item" | "staff";

export interface CompsRow {
  id: string;
  view: CompsView;
  label: string;
  /** What the discount counts as (reasons only). */
  cls: DiscountClass | null;
  amount: number;
  qty: number;
  lines: number;
  /** Share of all comps & discounts in the period. */
  share: number;
}

const VIEWS: { value: CompsView; label: string }[] = [
  { value: "reason", label: "By reason" },
  { value: "item", label: "By item" },
  { value: "staff", label: "By staff" },
];
const DEFAULT_VIEW = { filters: { view: ["reason"] }, sort: [{ id: "amount", dir: "desc" as const }] };

/** Comps & discounts for the period, by the name rung in Square, by item, or by who took the payment. */
export function CompsTable({ rows }: { rows: CompsRow[] }) {
  const columns = useMemo<Column<CompsRow>[]>(() => [
    {
      id: "name",
      header: "Name",
      hideable: false,
      width: 180,
      sort: (r) => r.label.toLowerCase(),
      csv: (r) => r.label,
      cell: (r) => (
        <span className="min-w-0">
          <span className="font-medium text-ink">{r.label}</span>
          {r.view === "staff" && r.id === "staff:" && <span className="block text-xs text-muted">Payments with no team member</span>}
        </span>
      ),
    },
    {
      id: "cls",
      header: "Counts as",
      width: 110,
      sort: (r) => r.cls ?? "",
      csv: (r) => (r.cls ? discountClassLabel(r.cls) : ""),
      cell: (r) => (r.cls ? <Link href="/settings/money#discounts" className="hover:underline"><Badge tone={r.cls === "promo" ? "neutral" : "warn"}>{discountClassLabel(r.cls)}</Badge></Link> : <span className="text-muted">—</span>),
    },
    { id: "amount", header: "Amount", align: "right", width: 100, firstDir: "desc", sort: (r) => r.amount, csv: (r) => r.amount.toFixed(2), cell: (r) => <span className="num font-medium text-ink">{money(r.amount)}</span>, total: (list) => <span className="num">{money(list.reduce((s, r) => s + r.amount, 0))}</span> },
    { id: "share", header: "Share", align: "right", width: 70, firstDir: "desc", sort: (r) => r.share, csv: (r) => r.share.toFixed(4), cell: (r) => <span className="num text-ink-2">{pct(r.share, 0)}</span> },
    { id: "qty", header: "Items", align: "right", width: 70, firstDir: "desc", sort: (r) => r.qty, csv: (r) => r.qty, cell: (r) => <span className="num text-ink-2">{qty(r.qty, 0)}</span> },
    { id: "lines", header: "Times", align: "right", width: 70, firstDir: "desc", defaultHidden: true, sort: (r) => r.lines, csv: (r) => r.lines, cell: (r) => <span className="num text-ink-2">{qty(r.lines, 0)}</span> },
  ], []);

  const filters = useMemo<Filter<CompsRow>[]>(() => [
    { id: "view", label: "Show", kind: "facet", display: "segmented", single: true, values: (r) => r.view, options: VIEWS },
    { id: "cls", label: "Counts as", kind: "facet", values: (r) => (r.cls ? discountClassLabel(r.cls) : null) },
  ], []);

  return (
    <DataTable
      id="pnl-comps"
      rows={rows}
      rowKey={(r) => r.id}
      columns={columns}
      filters={filters}
      defaultView={DEFAULT_VIEW}
      noun={["row", "rows"]}
      searchText={(r) => `${r.label} ${r.cls ? discountClassLabel(r.cls) : ""}`}
      searchPlaceholder="Search comps & discounts"
      csvName="comps-and-discounts"
      urlSearch={false}
      help="pnl.comps"
      maxHeight="28rem"
      summary={(vis) => [
        { value: money(vis.reduce((s, r) => s + r.amount, 0), { whole: true }), label: "in view" },
      ]}
      card={(r) => ({
        title: r.label,
        subtitle: r.cls ? discountClassLabel(r.cls) : r.view === "item" ? `${qty(r.qty, 0)} items` : `${qty(r.lines, 0)} times`,
        value: money(r.amount),
        sub: pct(r.share, 0),
      })}
      empty={<span>No comps or discounts in these days.</span>}
    />
  );
}
