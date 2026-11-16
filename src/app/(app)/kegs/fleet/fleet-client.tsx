"use client";

import { DataTable, downloadText, type Column, type Filter, type GroupBy } from "@/components/data-table";
import { useConfirm } from "@/components/dialog";
import { Select } from "@/components/select";
import { Button } from "@/components/ui";
import { KEG_STATUSES, STATUS_META, type KegStatus } from "@/domain/kegs";
import { shortDate } from "@/lib/format";
import { Download } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { setKegField } from "../actions";
import { StatusBadge } from "../bits";

const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
const NO_BEER = "Beer not recorded";

export interface OutLongRow { id: string; code: string; display: string; size: string; beer: string | null; account: string; days: number }

/** Kegs out at an account too long, grouped by account, the longest wait first. */
export function OutTooLongTable({ rows }: { rows: OutLongRow[] }) {
  const columns = useMemo<Column<OutLongRow>[]>(() => [
    { id: "keg", header: "Keg", width: 100, hideable: false, sort: (k) => k.code, csv: (k) => k.display, cell: (k) => <span className="num font-medium whitespace-nowrap">{k.display}</span> },
    { id: "beer", header: "Beer", width: 180, sort: (k) => k.beer, csv: (k) => k.beer ?? "", cell: (k) => (k.beer ? <span className="text-ink-2">{k.beer}</span> : <span className="text-muted">{NO_BEER}</span>) },
    { id: "size", header: "Size", width: 90, sort: (k) => k.size, csv: (k) => k.size, cell: (k) => <span className="text-muted">{k.size}</span> },
    { id: "account", header: "Account", width: 200, sort: (k) => k.account, csv: (k) => k.account, cell: (k) => k.account },
    { id: "days", header: "Out for", align: "right", width: 90, firstDir: "desc", sort: (k) => k.days, csv: (k) => k.days, cell: (k) => <span className="num text-warn">{days(k.days)}</span>, total: (l) => <span className="num">longest {days(Math.max(0, ...l.map((k) => k.days)))}</span> },
  ], []);
  const filters = useMemo<Filter<OutLongRow>[]>(() => [
    { id: "account", label: "Account", kind: "facet", values: (k) => k.account },
    { id: "beer", label: "Beer", kind: "facet", values: (k) => k.beer ?? NO_BEER },
    { id: "size", label: "Size", kind: "facet", values: (k) => k.size },
  ], []);
  const groups = useMemo<GroupBy<OutLongRow>[]>(() => [{ id: "account", label: "Account", key: (k) => k.account }, { id: "beer", label: "Beer", key: (k) => k.beer ?? NO_BEER }], []);
  return (
    <DataTable
      id="kegs-fleet-out"
      rows={rows}
      rowKey={(k) => k.id}
      columns={columns}
      noun={["keg", "kegs"]}
      searchText={(k) => `${k.code} ${k.display} ${k.beer ?? ""} ${k.account}`}
      searchPlaceholder="Search keg, beer or account"
      filters={filters}
      groups={groups}
      defaultView={{ group: "account", sort: [{ id: "days", dir: "desc" }] }}
      csvName="kegs-out-too-long"
      urlSearch={false}
      maxHeight="32rem"
      rowHref={(k) => `/kegs/k/${k.code}`}
      card={(k) => ({ title: <span><span className="num">{k.display}</span> · {k.beer ?? NO_BEER}</span>, subtitle: `${k.account} · ${k.size}`, value: <span className="text-warn">{days(k.days)}</span> })}
    />
  );
}

export interface IdleRow { id: string; code: string; display: string; size: string; status: KegStatus; beer: string | null; lastSeen: string | null; days: number }

const IDLE_GROUPS: GroupBy<IdleRow>[] = [{ id: "status", label: "Last known", key: (k) => k.status, title: (s) => STATUS_META[s as KegStatus]?.label ?? s }];

/** Kegs nobody has scanned lately, the quietest first, each with Retire. */
export function IdleTable({ rows }: { rows: IdleRow[] }) {
  const confirm = useConfirm();
  const columns = useMemo<Column<IdleRow>[]>(() => [
    { id: "keg", header: "Keg", width: 120, hideable: false, sort: (k) => k.code, csv: (k) => k.display, cell: (k) => <span className="num font-medium whitespace-nowrap">{k.display} <span className="font-normal text-muted">{k.size}</span></span> },
    { id: "status", header: "Last known", width: 120, sort: (k) => KEG_STATUSES.indexOf(k.status), csv: (k) => STATUS_META[k.status].label, cell: (k) => <StatusBadge status={k.status} /> },
    { id: "beer", header: "Beer", width: 170, sort: (k) => k.beer, csv: (k) => k.beer ?? "", cell: (k) => <span className="text-ink-2">{k.beer ?? "—"}</span> },
    { id: "seen", header: "Last scan", width: 130, sort: (k) => k.lastSeen, csv: (k) => k.lastSeen ?? "", cell: (k) => <span className="whitespace-nowrap text-muted">{k.lastSeen ? `${shortDate(k.lastSeen)}, ${k.lastSeen.slice(0, 4)}` : "Never scanned"}</span> },
    { id: "days", header: "Quiet for", align: "right", width: 100, firstDir: "desc", sort: (k) => k.days, csv: (k) => k.days, cell: (k) => <span className="num text-muted">{days(k.days)}</span> },
    { id: "retire", header: <span className="sr-only">Retire</span>, label: "Retire", align: "right", width: 110, hideable: false, csv: () => undefined, cell: (k) => <RetireKeg id={k.id} code={k.display} /> },
  ], []);
  const filters = useMemo<Filter<IdleRow>[]>(() => [
    { id: "status", label: "Last known", kind: "facet", values: (k) => k.status, options: KEG_STATUSES.map((s) => ({ value: s, label: STATUS_META[s].short })) },
    { id: "beer", label: "Beer", kind: "facet", values: (k) => k.beer ?? "No beer" },
    { id: "size", label: "Size", kind: "facet", values: (k) => k.size },
    { id: "never", label: "Never scanned", kind: "toggle", test: (k) => !k.lastSeen },
  ], []);
  return (
    <DataTable
      id="kegs-fleet-idle"
      rows={rows}
      rowKey={(k) => k.id}
      columns={columns}
      noun={["keg", "kegs"]}
      searchText={(k) => `${k.code} ${k.display} ${k.beer ?? ""}`}
      searchPlaceholder="Search keg or beer"
      filters={filters}
      groups={IDLE_GROUPS}
      defaultView={{ sort: [{ id: "days", dir: "desc" }] }}
      csvName="kegs-not-seen-lately"
      urlSearch={false}
      maxHeight="32rem"
      rowHref={(k) => `/kegs/k/${k.code}`}
      card={(k) => ({ title: <span><span className="num">{k.display}</span> · {k.beer ?? "No beer"}</span>, subtitle: `${STATUS_META[k.status].short} · ${k.size} · ${k.lastSeen ? `last scan ${shortDate(k.lastSeen)}` : "never scanned"}`, value: days(k.days) })}
      bulkActions={(api) => (
        <Button size="sm" disabled={api.pending} onClick={async () => {
          const n = api.rows.length;
          // Ask first, then save (never wait on a dialog inside a transition).
          const ok = await confirm({ title: `Retire ${n} keg${n === 1 ? "" : "s"}?`, body: "They come off the boards and counts. Each keeps its history, and scanning it later brings it back from All kegs.", confirmLabel: "Retire" });
          if (!ok) return;
          api.run(async () => {
            for (const k of api.rows) {
              const r = await setKegField(k.id, "active", "false");
              if (r.error) return { error: `${k.display}: ${r.error}` };
            }
            return { message: `Retired ${n} keg${n === 1 ? "" : "s"}.` };
          });
        }}>Retire {api.rows.length}</Button>
      )}
    />
  );
}

/** Narrow the fill charts to one beer; the choice lives in the address so it survives a refresh. */
export function BeerPicker({ beers, value, range }: { beers: { id: string; name: string }[]; value: string | null; range: string }) {
  const router = useRouter();
  return (
    <Select
      aria-label="Beer"
      className="w-56"
      value={value ?? ""}
      onChange={(e) => router.push(`/kegs/fleet?range=${range}${e.target.value ? `&beer=${e.target.value}` : ""}`, { scroll: false })}
      options={[{ value: "", label: "Every beer" }, ...beers.map((b) => ({ value: b.id, label: b.name }))]}
    />
  );
}

const cell = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

/** The status by size grid as a CSV file. */
export function ExportGrid({ header, rows }: { header: string[]; rows: (string | number)[][] }) {
  return (
    <Button size="sm" className="h-10 sm:h-8" onClick={() => downloadText(`keg-fleet-${new Date().toISOString().slice(0, 10)}.csv`, [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n"))}>
      <Download className="size-4" /> Export
    </Button>
  );
}

/** Take a keg nobody can find off the boards. Its history stays; scanning it later brings it back from All kegs. */
export function RetireKeg({ id, code }: { id: string; code: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  return (
    <span className="inline-flex items-center gap-2">
      {error && <span className="text-xs text-bad">{error}</span>}
      <Button
        size="sm"
        variant="ghost"
        className="h-10 sm:h-8"
        disabled={pending}
        aria-label={`Retire keg ${code}`}
        onClick={() =>
          start(async () => {
            const r = await setKegField(id, "active", "false");
            if (r.error) setError(r.error);
            else router.refresh();
          })
        }
      >
        {pending ? "Retiring…" : "Retire"}
      </Button>
    </span>
  );
}
