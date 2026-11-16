"use client";

import { DataTable, downloadText, type Column, type Filter, type GroupBy } from "@/components/data-table";
import { Button, cx, DatePicker } from "@/components/ui";
import { historyDatePresets, NO_BEER } from "@/domain/kegHistory";
import { businessDateOf, dayDate } from "@/lib/format";
import type { HistoryOptions, HistoryRow } from "@/server/services/kegHistory";
import { Loader2, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { BeerDot } from "../bits";
import { exportHistoryCsv, loadOlderHistory } from "./actions";

export interface HistoryInitial {
  rows: HistoryRow[];
  next: string | null;
  total: number;
  counts: Record<string, Record<string, number>>;
  options: HistoryOptions;
}

/**
 * Keg history, newest first, a page at a time from the server. The search box,
 * filters and dates all live in the address and narrow the list on the server,
 * so "Load older" and the CSV cover everything that matches, not just what's loaded.
 */
export function HistoryTable({ initial, today, from, to, narrowedOutside }: { initial: HistoryInitial; today: string; from: string | null; to: string | null; narrowedOutside: boolean }) {
  // Older pages stack under the first; a new first page (new filters) starts over.
  const [base, setBase] = useState(initial);
  const [older, setOlder] = useState<HistoryRow[]>([]);
  const [next, setNext] = useState(initial.next);
  if (base !== initial) {
    setBase(initial);
    setOlder([]);
    setNext(initial.next);
  }
  const rows = useMemo(() => (older.length ? [...initial.rows, ...older] : initial.rows), [initial.rows, older]);
  const [loading, startLoading] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const loadOlder = () => {
    if (!next) return;
    setMsg(null);
    startLoading(async () => {
      const r = await loadOlderHistory(window.location.search, next);
      if ("error" in r) return setMsg(r.error);
      setOlder((o) => [...o, ...r.rows]);
      setNext(r.next);
    });
  };
  const [exporting, startExport] = useTransition();
  const exportCsv = () =>
    startExport(async () => {
      setMsg(null);
      const r = await exportHistoryCsv(window.location.search);
      if ("error" in r) return setMsg(r.error);
      downloadText(`keg-history-${today}.csv`, r.csv);
      setMsg(r.capped ? `Downloaded the newest ${r.count.toLocaleString("en-US")}. Pick dates to get the rest.` : `Downloaded ${r.count.toLocaleString("en-US")} entr${r.count === 1 ? "y" : "ies"}.`);
    });

  const columns = useMemo<Column<HistoryRow>[]>(() => [
    { id: "when", header: "When", width: 130, hideable: false, csv: (e) => e.when, cell: (e) => <span className="num whitespace-nowrap text-ink-2">{e.when}</span> },
    { id: "keg", header: "Keg", width: 90, csv: (e) => e.kegDisplay, cell: (e) => <Link href={`/kegs/k/${e.kegCode}`} className="num whitespace-nowrap hover:underline">{e.kegDisplay}</Link> },
    {
      id: "what", header: "What", width: 260, csv: (e) => [e.actionLabel, e.beer].filter(Boolean).join(" "),
      cell: (e) => {
        const extra = [e.account, e.note].filter(Boolean).join(" · ");
        return (
          <div className="min-w-0">
            <div className="flex items-center gap-2">{e.color && <BeerDot color={e.color} />}<span className="font-medium">{e.actionLabel}</span>{e.beer && <span className="text-ink-2">{e.beer}</span>}</div>
            {extra && <div className="text-xs text-muted">{extra}</div>}
          </div>
        );
      },
    },
    { id: "where", header: "Where", width: 220, csv: (e) => e.place ?? "", cell: (e) => <span className="text-xs text-ink-2">{e.place ?? ""}</span> },
    { id: "who", header: "Who", width: 120, csv: (e) => e.who, cell: (e) => <span className="text-ink-2">{e.who}</span> },
    { id: "account", header: "Account", width: 160, defaultHidden: true, csv: (e) => e.account ?? "", cell: (e) => <span className="text-ink-2">{e.account ?? ""}</span> },
  ], []);

  const filters = useMemo<Filter<HistoryRow>[]>(() => [
    { id: "action", label: "What", kind: "facet", param: "action", values: (e) => e.action, options: initial.options.actions },
    { id: "beer", label: "Beer", kind: "facet", param: "beer", values: (e) => e.beerId ?? NO_BEER, options: initial.options.beers },
    { id: "who", label: "Who", kind: "facet", param: "who", values: (e) => e.whoKey, options: initial.options.who },
    { id: "account", label: "Account", kind: "facet", param: "account", values: (e) => e.accountId, options: initial.options.accounts },
  ], [initial.options]);

  const groups = useMemo<GroupBy<HistoryRow>[]>(() => [
    { id: "day", label: "Day", key: (e) => businessDateOf(e.at), title: (d) => dayDate(d), order: (a, b) => b.localeCompare(a) },
    { id: "keg", label: "Keg", key: (e) => e.kegDisplay },
    { id: "who", label: "Who", key: (e) => e.who },
  ], []);

  const shown = rows.length;
  const footer = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border px-4 py-3 text-sm text-muted sm:border-t">
      <span className="num">{next ? `The newest ${shown.toLocaleString("en-US")} of ${initial.total.toLocaleString("en-US")}.` : shown ? `All ${initial.total.toLocaleString("en-US")} shown.` : null}</span>
      {next && (
        <Button size="sm" className="h-10 sm:h-8" disabled={loading} onClick={loadOlder}>
          {loading && <Loader2 className="size-3.5 motion-safe:animate-spin" />}Load older
        </Button>
      )}
      <Button size="sm" variant="ghost" className="h-10 sm:hidden" disabled={exporting} onClick={exportCsv}>Download CSV</Button>
      {exporting && <span>Making the spreadsheet…</span>}
      {msg && <span role="status" className="text-ink-2">{msg}</span>}
    </div>
  );

  return (
    <>
      <DateRange today={today} from={from} to={to} />
      <DataTable
        id="kegs-history"
        rows={rows}
        rowKey={(e) => e.id}
        columns={columns}
        noun={["entry", "entries"]}
        searchText={(e) => `${e.kegCode} ${e.kegDisplay} ${e.beer ?? ""} ${e.account ?? ""} ${e.who}`}
        searchPlaceholder="Keg code, old sticker, beer, account, person"
        filters={filters}
        groups={groups}
        csvName="keg-history"
        help="kegs.history"
        rowHref={(e) => `/kegs/k/${e.kegCode}`}
        rowClassName={(e) => (e.undone ? "text-muted line-through" : undefined)}
        remote={{ total: initial.total, counts: initial.counts, exportCsv }}
        footer={footer}
        card={(e) => ({
          title: <span className={cx(e.undone && "text-muted line-through")}><span className="num">{e.kegDisplay}</span> · {e.actionLabel}{e.beer ? ` ${e.beer}` : ""}</span>,
          subtitle: [e.place, e.account, e.note].filter(Boolean).join(" · ") || undefined,
          value: <span className="text-xs font-normal text-ink-2">{e.when}</span>,
          sub: e.who,
        })}
        empty={narrowedOutside ? <span>Nothing in these dates for this keg or filter. Pick other dates, or choose Any time above.</span> : <span>Nothing yet. Scans show up here as staff use them.</span>}
      />
    </>
  );
}

/** The date filter: quick ranges and two pickers, kept in the address as from/to. */
function DateRange({ today, from, to }: { today: string; from: string | null; to: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  const presets = useMemo(() => historyDatePresets(today), [today]);
  const go = (f: string | null, t: string | null) => {
    const u = new URLSearchParams(window.location.search);
    if (f) u.set("from", f);
    else u.delete("from");
    if (t) u.set("to", t);
    else u.delete("to");
    const qs = u.toString();
    start(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };
  const chip = (on: boolean, label: string, onClick: () => void) => (
    <button key={label} type="button" aria-pressed={on} onClick={onClick} className={cx("inline-flex h-10 items-center rounded-full border px-3 text-sm whitespace-nowrap transition-colors duration-120 sm:h-8", on ? "border-ink bg-ink text-bg" : "border-border bg-surface text-ink-2 hover:bg-surface-2")}>{label}</button>
  );
  const custom = !!(from || to) && !presets.some((p) => p.from === from && p.to === to);
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Dates">
      <span className="mr-1 text-sm text-muted">When</span>
      {chip(!from && !to, "Any time", () => go(null, null))}
      {presets.map((p) => chip(p.from === from && p.to === to, p.label, () => go(p.from, p.to)))}
      <div className="flex items-center gap-1.5">
        <DatePicker value={from ?? ""} max={to ?? today} onChange={(e) => go(e.target.value || null, to)} aria-label="From" className={cx("w-36", custom && "border-ink")} />
        <span className="text-sm text-muted">to</span>
        <DatePicker value={to ?? ""} min={from ?? undefined} max={today} onChange={(e) => go(from, e.target.value || null)} aria-label="To" className={cx("w-36", custom && "border-ink")} />
        {(from || to) && <button type="button" onClick={() => go(null, null)} aria-label="Clear dates" className="grid size-10 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink sm:size-8"><X className="size-4" /></button>}
      </div>
      {pending && <Loader2 aria-hidden className="ml-1 size-4 text-muted motion-safe:animate-spin" />}
    </div>
  );
}
