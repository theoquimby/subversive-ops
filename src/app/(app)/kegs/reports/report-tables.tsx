"use client";

import { DataTable, downloadText, type Column, type Filter } from "@/components/data-table";
import { Badge, cx } from "@/components/ui";
import { toCsv } from "@/domain/dataTable";
import { barrels, type BeerVolume, type SnapshotRow, type VolumeLine } from "@/domain/kegAccounts";
import { useMemo } from "react";
import { bbl, daysWord, gal } from "../accounts/bits";
import { BeerDot, sizeShort } from "../bits";

/**
 * The keg reports' three tables: volume by beer and by account for the chosen
 * dates, and the kegs sitting at accounts today. Each searches, sorts and has a
 * totals row; CSV gives the same file as before (kegs and barrels, then a total
 * line), for the rows in view.
 */

const NO_BEER = "Beer not recorded";
const NO_ACCOUNT = "No account recorded";
/** Two decimals in a file, so small kegs don't round away. */
const bbl2 = (gallons: number) => Math.round(barrels(gallons) * 100) / 100;
const sum = (lines: VolumeLine[]): VolumeLine => lines.reduce((s, l) => ({ kegs: s.kegs + l.kegs, gallons: s.gallons + l.gallons }), { kegs: 0, gallons: 0 });
const bblCell = (l: VolumeLine) => <span className={cx(!l.kegs && "text-muted")}>{bbl(l.gallons)}</span>;
const download = (name: string, header: string[], rows: (string | number)[][]) =>
  downloadText(name, toCsv(rows, header.map((h, i) => ({ header: h, value: (r: (string | number)[]) => r[i] }))));

export type BeerVolumeRow = BeerVolume & { name: string | null; color: string | null };

export function VolumeByBeerTable({ rows, stamp }: { rows: BeerVolumeRow[]; stamp: string }) {
  const columns = useMemo<Column<BeerVolumeRow>[]>(() => [
    { id: "beer", header: "Beer", width: 200, hideable: false, sort: (b) => b.name, cell: (b) => <span className="flex items-center gap-2">{b.color && <BeerDot color={b.color} />}<span className={cx(!b.name && "text-muted")}>{b.name ?? NO_BEER}</span></span> },
    { id: "tapped", header: "Tapped", align: "right", width: 90, firstDir: "desc", sort: (b) => b.tapped.gallons, cell: (b) => bblCell(b.tapped), total: (l) => bbl(sum(l.map((b) => b.tapped)).gallons) },
    { id: "out", header: "Sent out", align: "right", width: 90, firstDir: "desc", sort: (b) => b.out.gallons, cell: (b) => bblCell(b.out), total: (l) => bbl(sum(l.map((b) => b.out)).gallons) },
    { id: "none", header: "No scan", align: "right", width: 90, firstDir: "desc", sort: (b) => b.none.gallons, cell: (b) => bblCell(b.none), total: (l) => bbl(sum(l.map((b) => b.none)).gallons) },
    { id: "total", header: "Total", align: "right", width: 90, firstDir: "desc", sort: (b) => b.total.gallons, cell: (b) => bbl(b.total.gallons), total: (l) => bbl(sum(l.map((b) => b.total)).gallons) },
    { id: "kegs", header: "Kegs", align: "right", width: 80, firstDir: "desc", sort: (b) => b.total.kegs, cell: (b) => <span className="text-ink-2">{b.total.kegs}</span>, total: (l) => sum(l.map((b) => b.total)).kegs },
  ], []);
  const filters = useMemo<Filter<BeerVolumeRow>[]>(() => [
    { id: "tapped", label: "Tapped here", kind: "toggle", test: (b) => b.tapped.kegs > 0 },
    { id: "out", label: "Sent out", kind: "toggle", test: (b) => b.out.kegs > 0 },
    { id: "none", label: "Some with no scan", kind: "toggle", tone: "warn", test: (b) => b.none.kegs > 0 },
  ], []);
  return (
    <DataTable
      id="kegs-report-beer"
      rows={rows}
      rowKey={(b) => b.beerId ?? "none"}
      columns={columns}
      noun={["beer", "beers"]}
      searchText={(b) => b.name ?? NO_BEER}
      searchPlaceholder="Search beers"
      filters={filters}
      urlSearch={false}
      maxHeight="32rem"
      totals="Every beer"
      exportCsv={(list) => {
        const t = { tapped: sum(list.map((b) => b.tapped)), out: sum(list.map((b) => b.out)), none: sum(list.map((b) => b.none)), total: sum(list.map((b) => b.total)) };
        download(`keg-volume-by-beer-${stamp}.csv`, ["Beer", "Tapped kegs", "Tapped barrels", "Sent out kegs", "Sent out barrels", "No scan kegs", "No scan barrels", "Total kegs", "Total barrels", "Total gallons"], [
          ...list.map((b) => [b.name ?? NO_BEER, b.tapped.kegs, bbl2(b.tapped.gallons), b.out.kegs, bbl2(b.out.gallons), b.none.kegs, bbl2(b.none.gallons), b.total.kegs, bbl2(b.total.gallons), b.total.gallons]),
          ["Total", t.tapped.kegs, bbl2(t.tapped.gallons), t.out.kegs, bbl2(t.out.gallons), t.none.kegs, bbl2(t.none.gallons), t.total.kegs, bbl2(t.total.gallons), t.total.gallons],
        ]);
      }}
      card={(b) => ({
        title: <span className="inline-flex items-center gap-2">{b.color && <BeerDot color={b.color} />}{b.name ?? NO_BEER}</span>,
        subtitle: `Tapped ${bbl(b.tapped.gallons)} · out ${bbl(b.out.gallons)} · no scan ${bbl(b.none.gallons)}`,
        value: `${bbl(b.total.gallons)} bbl`,
        sub: `${b.total.kegs} keg${b.total.kegs === 1 ? "" : "s"}`,
      })}
    />
  );
}

export type AccountVolumeRow = { accountId: string | null; name: string | null } & VolumeLine;

export function VolumeByAccountTable({ rows, stamp }: { rows: AccountVolumeRow[]; stamp: string }) {
  const columns = useMemo<Column<AccountVolumeRow>[]>(() => [
    { id: "account", header: "Account", width: 220, hideable: false, sort: (a) => a.name, cell: (a) => (a.accountId && a.name ? <span className="font-medium">{a.name}</span> : <span className="text-muted">{NO_ACCOUNT}</span>) },
    { id: "kegs", header: "Kegs", align: "right", width: 80, firstDir: "desc", sort: (a) => a.kegs, cell: (a) => a.kegs, total: (l) => sum(l).kegs },
    { id: "bbl", header: "Barrels", align: "right", width: 90, firstDir: "desc", sort: (a) => a.gallons, cell: (a) => bbl(a.gallons), total: (l) => bbl(sum(l).gallons) },
    { id: "gal", header: "Gallons", align: "right", width: 90, firstDir: "desc", sort: (a) => a.gallons, cell: (a) => <span className="text-ink-2">{gal(a.gallons)}</span>, total: (l) => gal(sum(l).gallons) },
  ], []);
  return (
    <DataTable
      id="kegs-report-account"
      rows={rows}
      rowKey={(a) => a.accountId ?? "none"}
      columns={columns}
      noun={["account", "accounts"]}
      searchText={(a) => a.name ?? NO_ACCOUNT}
      searchPlaceholder="Search accounts"
      urlSearch={false}
      maxHeight="32rem"
      totals="Total"
      rowHref={(a) => (a.accountId && a.name ? `/kegs/accounts/${a.accountId}` : null)}
      exportCsv={(list) => {
        const t = sum(list);
        download(`keg-volume-by-account-${stamp}.csv`, ["Account", "Kegs", "Barrels", "Gallons"], [...list.map((a) => [a.name ?? NO_ACCOUNT, a.kegs, bbl2(a.gallons), a.gallons]), ["Total", t.kegs, bbl2(t.gallons), t.gallons]]);
      }}
      card={(a) => ({ title: a.name ?? NO_ACCOUNT, subtitle: `${gal(a.gallons)} gallons`, value: `${bbl(a.gallons)} bbl`, sub: `${a.kegs} keg${a.kegs === 1 ? "" : "s"}` })}
    />
  );
}

export function AtAccountsTable({ rows, sizes, days, bySize, today }: { rows: SnapshotRow[]; sizes: string[]; days: number; bySize: boolean; today: string }) {
  const columns = useMemo<Column<SnapshotRow>[]>(() => [
    { id: "account", header: "Account", width: 220, hideable: false, sort: (a) => a.name, cell: (a) => (a.accountId ? <span className="font-medium">{a.name}</span> : <span className="text-muted">{a.name}</span>) },
    { id: "kegs", header: "Kegs", align: "right", width: 80, firstDir: "desc", sort: (a) => a.total, cell: (a) => a.total, total: (l) => l.reduce((s, a) => s + a.total, 0) },
    { id: "over", header: `Over ${daysWord(days)}`, align: "right", width: 120, firstDir: "desc", sort: (a) => a.over, cell: (a) => (a.over ? <Badge tone="warn">{a.over}</Badge> : <span className="text-muted">0</span>), total: (l) => l.reduce((s, a) => s + a.over, 0) },
    { id: "longest", header: "Longest wait", align: "right", width: 120, firstDir: "desc", sort: (a) => a.longest, cell: (a) => <span className="whitespace-nowrap text-ink-2">{daysWord(a.longest)}</span> },
    ...(bySize ? sizes.map((z): Column<SnapshotRow> => ({ id: `size-${z}`, header: sizeShort(z), align: "right", width: 80, firstDir: "desc", sort: (a) => a.bySize[z] ?? 0, cell: (a) => <span className={cx(!a.bySize[z] && "text-muted")}>{a.bySize[z] ?? 0}</span>, total: (l) => l.reduce((s, a) => s + (a.bySize[z] ?? 0), 0) })) : []),
  ], [days, bySize, sizes]);
  const filters = useMemo<Filter<SnapshotRow>[]>(() => [{ id: "over", label: `Out over ${daysWord(days)}`, kind: "toggle", tone: "warn", test: (a) => a.over > 0 }], [days]);
  return (
    <DataTable
      id="kegs-report-at"
      rows={rows}
      rowKey={(a) => a.accountId ?? "none"}
      columns={columns}
      noun={["account", "accounts"]}
      searchText={(a) => a.name}
      searchPlaceholder="Search accounts"
      filters={filters}
      urlSearch={false}
      maxHeight="32rem"
      totals="All accounts"
      rowHref={(a) => (a.accountId ? `/kegs/accounts/${a.accountId}` : null)}
      exportCsv={(list) => {
        const total = (f: (a: SnapshotRow) => number) => list.reduce((s, a) => s + f(a), 0);
        download(`kegs-at-accounts-${today}.csv`, ["Account", "Kegs", `Out more than ${daysWord(days)}`, "Longest wait, days", ...(bySize ? sizes.map(sizeShort) : [])], [
          ...list.map((a) => [a.name, a.total, a.over, a.longest, ...(bySize ? sizes.map((z) => a.bySize[z] ?? 0) : [])]),
          ["Total", total((a) => a.total), total((a) => a.over), "", ...(bySize ? sizes.map((z) => total((a) => a.bySize[z] ?? 0)) : [])],
        ]);
      }}
      card={(a) => ({ title: a.name, subtitle: `Longest ${daysWord(a.longest)}`, value: `${a.total} keg${a.total === 1 ? "" : "s"}`, sub: a.over ? <span className="text-warn">{a.over} over {daysWord(days)}</span> : undefined })}
    />
  );
}
