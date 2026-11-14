"use client";

import { DataTable, type Column, type Filter, type GroupBy } from "@/components/data-table";
import { useConfirm } from "@/components/dialog";
import { Badge, Button, type Tone } from "@/components/ui";
import { addDays, WEEKDAYS } from "@/domain/dates";
import { dayDate, money, shortDate } from "@/lib/format";
import type { BoardPo } from "@/server/services/orderingBoard";
import { Copy } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { duplicateOrder, emailDrafts, markOrdersSent, receiveOrders } from "./actions";

const STATUS: Record<BoardPo["status"], { label: string; tone: Tone }> = { DRAFT: { label: "Draft", tone: "warn" }, SENT: { label: "Sent", tone: "neutral" }, RECEIVED: { label: "Received", tone: "good" } };
const RANK: Record<BoardPo["status"], number> = { DRAFT: 0, SENT: 1, RECEIVED: 2 };
const DEFAULT_VIEW = { sort: [{ id: "delivery", dir: "desc" as const }] };
const shortDay = (iso: string) => `${WEEKDAYS[new Date(`${iso}T12:00:00Z`).getUTCDay()]} ${shortDate(iso)}`;

/** Per-row quick actions: Mark sent (drafts), Check in (sent), Copy as a new draft. */
function RowActions({ o }: { o: BoardPo }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<{ error?: string; id?: string }>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (r.error) setError(r.error);
      else if (r.id) router.push(`/ordering/po/${r.id}`);
      else router.refresh();
    });
  return (
    <div className="flex items-center justify-end gap-1">
      {error && <span role="alert" className="mr-1 max-w-40 truncate text-xs text-bad" title={error}>{error}</span>}
      {o.status === "DRAFT" && <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => markOrdersSent([o.id]))} title="Sent by phone, portal or your own email">Mark sent</Button>}
      {o.status === "SENT" && (
        <Button size="sm" variant="ghost" disabled={pending} onClick={async () => {
          // Ask first, then start the save (never wait on a dialog inside a transition).
          const ok = await confirm({ title: `Check in ${o.supplierName} as ordered?`, body: "Every line is counted as arrived in full. For shorts or substitutions, open the order and check it in line by line.", confirmLabel: "Check in" });
          if (ok) run(() => receiveOrders([o.id]));
        }}>Check in</Button>
      )}
      <Button size="sm" variant="ghost" className="size-10 p-0 sm:size-8" disabled={pending} onClick={() => run(() => duplicateOrder(o.id))} aria-label={`Copy ${o.supplierName} order as a new draft`} title="Copy as a new draft for the next delivery"><Copy className="size-3.5" /></Button>
    </div>
  );
}

export function OrdersTable({ rows, today, emailReady }: { rows: BoardPo[]; today: string; emailReady: boolean }) {
  const confirm = useConfirm();
  const columns = useMemo<Column<BoardPo>[]>(() => [
    {
      id: "supplier",
      header: "Supplier",
      width: 180,
      sort: (o) => o.supplierName,
      csv: (o) => o.supplierName,
      cell: (o) => (
        <div className="min-w-0">
          <Link href={`/ordering/po/${o.id}`} className="font-medium text-ink hover:underline">{o.supplierName}</Link>
          <div className="text-xs text-muted">{o.auto ? "Auto-drafted" : "Created"} {shortDate(o.createdOn)}</div>
        </div>
      ),
    },
    { id: "delivery", header: "Delivery", width: 120, firstDir: "desc", sort: (o) => o.deliveryDate, csv: (o) => o.deliveryDate, cell: (o) => <span className={o.status === "SENT" && o.deliveryDate < today ? "num whitespace-nowrap text-warn" : "num whitespace-nowrap"}>{shortDay(o.deliveryDate)}</span> },
    { id: "status", header: "Status", width: 110, sort: (o) => RANK[o.status], csv: (o) => STATUS[o.status].label, cell: (o) => <Badge tone={o.status === "SENT" && o.deliveryDate < today ? "warn" : STATUS[o.status].tone}>{o.status === "SENT" && o.deliveryDate <= today ? "To check in" : STATUS[o.status].label}</Badge> },
    { id: "lines", header: "Lines", align: "right", width: 70, firstDir: "desc", sort: (o) => o.lines, csv: (o) => o.lines, cell: (o) => <span className="num">{o.lines}</span> },
    {
      id: "total",
      header: "Total",
      align: "right",
      width: 110,
      firstDir: "desc",
      sort: (o) => o.total,
      csv: (o) => o.total,
      cell: (o) => (
        <span className="num whitespace-nowrap">
          {money(o.total)}
          {o.total != null && (o.invoiced ? <span className="block text-xs text-muted">invoiced</span> : o.estimated ? <span className="block text-xs text-muted" title="Some lines priced from current supplier prices">est.</span> : null)}
        </span>
      ),
      total: (list) => <span className="num">{money(list.reduce((s, o) => s + (o.total ?? 0), 0))}</span>,
    },
    { id: "sent", header: "Sent", width: 90, firstDir: "desc", sort: (o) => o.sentOn, csv: (o) => o.sentOn ?? "", cell: (o) => (o.sentOn ? <span className="num text-ink-2">{shortDate(o.sentOn)}</span> : <span className="text-muted">—</span>) },
    { id: "received", header: "Received", width: 90, firstDir: "desc", sort: (o) => o.receivedOn, csv: (o) => o.receivedOn ?? "", cell: (o) => (o.receivedOn ? <span className="num text-ink-2">{shortDate(o.receivedOn)}</span> : <span className="text-muted">—</span>) },
    { id: "created", header: "Created", width: 90, defaultHidden: true, firstDir: "desc", sort: (o) => o.createdOn, csv: (o) => o.createdOn, cell: (o) => <span className="num text-ink-2">{shortDate(o.createdOn)}</span> },
    { id: "actions", header: <span className="sr-only">Actions</span>, label: "Actions", align: "right", width: 180, hideable: false, csv: () => undefined, cell: (o) => <RowActions o={o} /> },
  ], [today]);

  const filters = useMemo<Filter<BoardPo>[]>(() => [
    { id: "status", label: "Status", kind: "facet", display: "segmented", allLabel: "All", single: true, values: (o) => o.status, options: [{ value: "DRAFT", label: "Drafts" }, { value: "SENT", label: "Sent" }, { value: "RECEIVED", label: "Received" }] },
    { id: "checkin", label: "To check in", kind: "toggle", test: (o) => o.status === "SENT" && o.deliveryDate <= today, tone: "warn" },
    { id: "week", label: "Delivering this week", kind: "toggle", test: (o) => o.deliveryDate >= today && o.deliveryDate < addDays(today, 7) },
    { id: "supplier", label: "Supplier", kind: "facet", values: (o) => o.supplierName },
  ], [today]);

  const groups = useMemo<GroupBy<BoardPo>[]>(() => [
    { id: "supplier", label: "Supplier", key: (o) => o.supplierName },
    { id: "delivery", label: "Delivery date", key: (o) => o.deliveryDate, title: (k) => dayDate(k), order: (a, b) => b.localeCompare(a) },
    { id: "status", label: "Status", key: (o) => o.status, title: (k) => STATUS[k as BoardPo["status"]]?.label ?? k, order: (a, b) => RANK[a as BoardPo["status"]] - RANK[b as BoardPo["status"]] },
  ], []);

  return (
    <DataTable
      id="ordering-orders"
      rows={rows}
      rowKey={(o) => o.id}
      columns={columns}
      noun={["order", "orders"]}
      searchText={(o) => `${o.supplierName} ${STATUS[o.status].label} ${o.deliveryDate} ${dayDate(o.deliveryDate)}`}
      searchPlaceholder="Search orders"
      filters={filters}
      groups={groups}
      defaultView={DEFAULT_VIEW}
      csvName="orders"
      urlSearch={false}
      help="ordering.recent"
      tours={{ root: "ordering.recent" }}
      maxHeight="calc(100dvh - 12rem)"
      rowHref={(o) => `/ordering/po/${o.id}`}
      summary={(vis) => [
        { value: vis.length, label: vis.length === 1 ? "order" : "orders" },
        { value: money(vis.reduce((s, o) => s + (o.total ?? 0), 0), { whole: true }), label: "total" },
        { value: vis.filter((o) => o.status === "SENT" && o.deliveryDate <= today).length, label: "to check in", tone: "warn", filter: { id: "checkin" } },
      ]}
      card={(o) => ({
        title: o.supplierName,
        subtitle: <>{o.status === "SENT" && o.deliveryDate <= today ? "To check in" : STATUS[o.status].label} · for {shortDay(o.deliveryDate)}</>,
        value: money(o.total),
        sub: `${o.lines} line${o.lines === 1 ? "" : "s"}`,
      })}
      empty={<span>No orders yet. Saved orders show up here so deliveries can be checked in.</span>}
      bulkActions={(api) => {
        const drafts = api.rows.filter((o) => o.status === "DRAFT");
        const sent = api.rows.filter((o) => o.status === "SENT");
        return (
          <>
            {drafts.length > 0 && emailReady && (
              <Button size="sm" variant="primary" disabled={api.pending} onClick={async () => {
                const ok = await confirm({ title: `Email ${drafts.length} draft${drafts.length === 1 ? "" : "s"}?`, body: "Each goes to the supplier's order email with the spreadsheet attached, and is marked sent.", confirmLabel: "Email them" });
                if (ok) api.run(() => emailDrafts(drafts.map((o) => o.id)));
              }}>Email drafts</Button>
            )}
            {drafts.length > 0 && <Button size="sm" disabled={api.pending} onClick={() => api.run(() => markOrdersSent(drafts.map((o) => o.id)))}>Mark {drafts.length} sent</Button>}
            {drafts.length > 0 && <Button size="sm" variant="ghost" disabled={api.pending} onClick={() => { for (const d of drafts) window.open(`/ordering/po/${d.id}`, "_blank", "noopener"); }}>Open drafts</Button>}
            {sent.length > 0 && (
              <Button size="sm" disabled={api.pending} onClick={async () => {
                const ok = await confirm({ title: `Check in ${sent.length} order${sent.length === 1 ? "" : "s"} as ordered?`, body: "Every line is counted as arrived in full. For shorts or substitutions, open each order instead.", confirmLabel: "Check in" });
                if (ok) api.run(() => receiveOrders(sent.map((o) => o.id)));
              }}>Check in {sent.length}</Button>
            )}
          </>
        );
      }}
    />
  );
}
