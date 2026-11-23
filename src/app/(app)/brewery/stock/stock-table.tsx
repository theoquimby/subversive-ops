"use client";

import { DataTable, type Column, type Filter, type GroupBy } from "@/components/data-table";
import { useConfirm } from "@/components/dialog";
import { useToast } from "@/components/toast";
import { Badge, Button, cx, Field, Input, Select, type Tone } from "@/components/ui";
import { MOVE_LABEL, STATUS_LABEL, type StockStatus } from "@/domain/brewStock";
import { BREWING_CATEGORIES } from "@/domain/brewRecipes";
import { businessDateTime, qty, shortDate } from "@/lib/format";
import type { BrewStockRow, StockMoveView } from "@/server/services/brewStock";
import { Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { deleteMoveAction, moveToKitchenAction, saveAdjustAction, saveReceivedAction, stockHistoryAction } from "./actions";

const TONE: Record<StockStatus, Tone> = { uncounted: "unknown", short: "bad", soon: "warn", fine: "good" };
const RANK: Record<StockStatus, number> = { short: 0, uncounted: 1, soon: 2, fine: 3 };
const STATUSES: StockStatus[] = ["short", "uncounted", "soon", "fine"];
const amount = (n: number | null, unit: string, digits = 1) => (n == null ? "—" : `${qty(n, digits)} ${unit}`);
const cover = (w: number | null) => (w == null ? "—" : w >= 52 ? "a year+" : `${w < 10 ? w.toFixed(1) : Math.round(w)} wk`);
/** Never counted: what's on the shelf isn't known, so no amount (only what came in since, if anything did). */
const onHandText = (r: BrewStockRow) => (r.counted ? amount(r.onHand, r.unit) : "—");

function StatusBadge({ r }: { r: BrewStockRow }) {
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <Badge tone={TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
      {r.counted && r.firstShortOn && <span className="text-[0.7rem] text-muted">runs short {shortDate(r.firstShortOn)}</span>}
    </span>
  );
}

export function StockTable({ rows, today }: { rows: BrewStockRow[]; today: string }) {
  const columns = useMemo<Column<BrewStockRow>[]>(() => [
    {
      id: "name",
      header: "Ingredient",
      width: 200,
      hideable: false,
      sort: (r) => r.name,
      csv: (r) => r.name,
      cell: (r) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-ink">{r.name}</div>
          <div className="truncate text-xs text-muted">{[r.category, r.supplier].filter(Boolean).join(" · ")}</div>
        </div>
      ),
    },
    {
      id: "onHand",
      header: "On hand",
      align: "right",
      width: 110,
      firstDir: "desc",
      help: "brewery.stock.onHand",
      sort: (r) => (r.counted ? r.onHandBase : null),
      csv: (r) => (r.counted ? r.onHand : ""),
      cell: (r) => (
        <span className={cx("num whitespace-nowrap", r.counted && r.onHandBase < 0 ? "text-bad" : !r.counted ? "text-muted" : "text-ink")}>
          {onHandText(r)}
          {!r.counted && <span className="block text-[0.7rem] text-muted">{r.onHandBase > 0 ? `never counted · ${amount(r.onHand, r.unit)} in since` : "never counted"}</span>}
        </span>
      ),
    },
    { id: "counted", header: "Last counted", width: 110, firstDir: "desc", sort: (r) => r.lastCounted, csv: (r) => r.lastCounted ?? "", cell: (r) => (r.lastCounted ? <span className="num text-ink-2">{shortDate(r.lastCounted)}</span> : <span className="text-muted">—</span>) },
    { id: "used", header: "Used, 30 days", align: "right", width: 110, firstDir: "desc", sort: (r) => r.used30, csv: (r) => r.used30, cell: (r) => <span className="num text-ink-2">{r.used30 ? amount(r.used30, r.unit) : "—"}</span> },
    {
      id: "needed",
      header: "Planned brews need",
      align: "right",
      width: 140,
      firstDir: "desc",
      help: "brewery.stock.needed",
      sort: (r) => r.needed,
      csv: (r) => r.needed,
      cell: (r) => (
        <span className="num text-ink-2" title={r.brews.join(", ")}>
          {r.needed ? amount(r.needed, r.unit) : "—"}
          {r.brews.length > 0 && <span className="block truncate text-[0.7rem] text-muted">{r.brews.length === 1 ? r.brews[0] : `${r.brews.length} brews`}</span>}
        </span>
      ),
    },
    { id: "cover", header: "Weeks of cover", align: "right", width: 110, firstDir: "asc", sort: (r) => (r.counted ? r.weeksCover : null), csv: (r) => (r.weeksCover == null || !r.counted ? "" : Number(r.weeksCover.toFixed(1))), cell: (r) => <span className="num text-ink-2">{r.counted ? cover(r.weeksCover) : "—"}</span> },
    { id: "status", header: "Status", width: 130, sort: (r) => RANK[r.status], csv: (r) => STATUS_LABEL[r.status], cell: (r) => <StatusBadge r={r} /> },
  ], []);

  const filters = useMemo<Filter<BrewStockRow>[]>(() => [
    { id: "status", label: "Status", kind: "facet", values: (r) => r.status, options: STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] })) },
    { id: "category", label: "Kind", kind: "facet", values: (r) => r.category, options: BREWING_CATEGORIES.map((c) => ({ value: c, label: c })) },
    { id: "supplier", label: "Supplier", kind: "facet", values: (r) => r.supplier ?? "No supplier" },
  ], []);

  const groups = useMemo<GroupBy<BrewStockRow>[]>(() => [
    { id: "category", label: "Kind", key: (r) => r.category, order: (a, b) => BREWING_CATEGORIES.indexOf(a) - BREWING_CATEGORIES.indexOf(b) },
    { id: "supplier", label: "Supplier", key: (r) => r.supplier },
    { id: "status", label: "Status", key: (r) => r.status, title: (k) => STATUS_LABEL[k as StockStatus] ?? k, order: (a, b) => RANK[a as StockStatus] - RANK[b as StockStatus] },
  ], []);

  return (
    <DataTable
      id="brewery-stock"
      help="brewery.stock"
      rows={rows}
      rowKey={(r) => r.id}
      columns={columns}
      noun={["ingredient", "ingredients"]}
      searchText={(r) => `${r.name} ${r.category} ${r.supplier ?? ""}`}
      searchPlaceholder="Search malt, hops, yeast"
      filters={filters}
      groups={groups}
      defaultView={{ group: "category", sort: [{ id: "name", dir: "asc" }] }}
      csvName="brewing-stock"
      urlSearch={false}
      summary={(vis) => [
        { value: vis.length, label: vis.length === 1 ? "ingredient" : "ingredients" },
        { value: vis.filter((r) => r.status === "short").length, label: "short", tone: "bad", filter: { id: "status", value: "short" } },
        { value: vis.filter((r) => r.status === "soon").length, label: "to order soon", tone: "warn", filter: { id: "status", value: "soon" } },
        { value: vis.filter((r) => r.status === "uncounted").length, label: "never counted", filter: { id: "status", value: "uncounted" } },
      ]}
      card={(r) => ({
        title: r.name,
        subtitle: <>{r.category} · <span className={r.status === "short" ? "text-bad" : r.status === "soon" ? "text-warn" : r.status === "uncounted" ? "text-muted" : undefined}>{STATUS_LABEL[r.status]}</span>{r.counted && r.firstShortOn ? ` from ${shortDate(r.firstShortOn)}` : ""}</>,
        value: <span className={r.counted && r.onHandBase < 0 ? "text-bad" : !r.counted ? "text-muted" : undefined}>{onHandText(r)}</span>,
        sub: r.needed ? `brews need ${amount(r.needed, r.unit)}` : r.counted ? `counted ${r.lastCounted ? shortDate(r.lastCounted) : ""}` : "never counted",
      })}
      drawerTitle={(r) => r.name}
      drawer={(r, close) => <StockDrawer key={r.id} row={r} today={today} close={close} />}
      empty={<span>No brewing ingredients yet. Add one below, or bring one over from the kitchen.</span>}
    />
  );
}

// ---- One ingredient ----------------------------------------------------------------------

function StockDrawer({ row, close }: { row: BrewStockRow; today: string; close: () => void }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [toast, show] = useToast();
  const [history, setHistory] = useState<StockMoveView[] | null>(null);
  const [tick, setTick] = useState(0);
  const [pending, start] = useTransition();
  useEffect(() => {
    let live = true;
    stockHistoryAction(row.id).then((h) => live && setHistory(h)).catch(() => live && setHistory([]));
    return () => { live = false; };
  }, [row.id, tick]);
  const done = (msg: string) => { show(msg, "good"); setTick((t) => t + 1); router.refresh(); };

  return (
    <div className="space-y-6">
      {toast}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div><div className="text-xs text-muted">On hand</div><div className={cx("num text-lg font-semibold", row.counted && row.onHandBase < 0 && "text-bad", !row.counted && "text-muted")}>{onHandText(row)}</div>{!row.counted && <div className="text-xs text-muted">Not counted yet</div>}</div>
        <div><div className="text-xs text-muted">Status</div><StatusBadge r={row} /></div>
        <div><div className="text-xs text-muted">Planned brews need (8 weeks)</div><div className="num">{row.needed ? amount(row.needed, row.unit) : "—"}</div></div>
        <div><div className="text-xs text-muted">Last counted</div><div className="num">{row.lastCounted ? shortDate(row.lastCounted) : "Never"}</div></div>
      </div>
      {row.brews.length > 0 && <p className="text-sm text-ink-2">Needed for {row.brews.join(", ")}.</p>}

      <AmountForm row={row} kind="received" onDone={done} />
      <AmountForm row={row} kind="adjust" onDone={done} />

      <section>
        <h3 className="mb-2 text-sm font-semibold text-ink">History</h3>
        {history == null ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : history.length === 0 ? (
          <p className="text-sm text-muted">Nothing yet. <Link href="/brewery/stock/count" className="underline underline-offset-2">Count it</Link> to start.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {history.map((m) => (
              <li key={m.id} className="flex items-start gap-3 px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="text-ink">
                    {MOVE_LABEL[m.kind]}
                    {m.batch && <> · <Link href={`/brewery/batches/${m.batch.id}`} className="underline underline-offset-2">{m.batch.code}</Link></>}
                    {m.invoiceId && <> · <Link href={`/invoices/${m.invoiceId}`} className="underline underline-offset-2">from an invoice</Link></>}
                  </div>
                  <div className="text-xs text-muted">{businessDateTime(m.at)}{m.userName ? ` · ${m.userName}` : ""}{m.note ? ` · ${m.note}` : ""}</div>
                </div>
                <span className={cx("num whitespace-nowrap", m.kind === "used" || (m.qty ?? 0) < 0 ? "text-ink-2" : "text-ink")}>
                  {m.kind === "count" ? "" : (m.qty ?? 0) > 0 ? "+" : ""}{amount(m.qty, row.unit)}
                </span>
                {m.kind !== "used" && (
                  <Button size="sm" variant="ghost" className="size-10 p-0 text-muted hover:text-bad sm:size-8" aria-label="Remove this entry" disabled={pending} onClick={async () => {
                    if (!(await confirm({ title: `Remove this ${MOVE_LABEL[m.kind].toLowerCase()} entry?`, body: "On hand is worked out again without it.", confirmLabel: "Remove", danger: true }))) return;
                    start(async () => { const r = await deleteMoveAction(m.id); if (r.error) show(r.error, "bad"); else done("Removed."); });
                  }}><Trash2 className="size-3.5" /></Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="border-t border-border pt-4">
        <Button variant="ghost" size="sm" disabled={pending} onClick={async () => {
          if (!(await confirm({ title: `Move ${row.name} to the kitchen side?`, body: "It leaves brewing stock and ordering and shows in kitchen counts and ordering instead. Its brewing history is kept.", confirmLabel: "Move to kitchen" }))) return;
          start(async () => { const r = await moveToKitchenAction(row.id); if (r.error) show(r.error, "bad"); else { close(); router.refresh(); } });
        }}>Move to the kitchen side</Button>
      </div>
    </div>
  );
}

/** Received (a delivery) or a fix, in any unit that fits. */
function AmountForm({ row, kind, onDone }: { row: BrewStockRow; kind: "received" | "adjust"; onDone: (msg: string) => void }) {
  const [amountText, setAmount] = useState("");
  const [unit, setUnit] = useState(row.unit);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const n = Number(amountText.replace(",", "."));
  const valid = amountText.trim() !== "" && Number.isFinite(n) && n !== 0 && (kind === "adjust" || n > 0);
  const submit = () => start(async () => {
    setError(null);
    const r = kind === "received"
      ? await saveReceivedAction([{ ingredientId: row.id, qty: n, unit }], note.trim() || null)
      : await saveAdjustAction({ ingredientId: row.id, qty: n, unit, note });
    if (r.error) setError(r.error);
    else { setAmount(""); setNote(""); onDone(kind === "received" ? "Added to stock." : "Fixed."); }
  });
  return (
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (valid) submit(); }}>
      <h3 className="text-sm font-semibold text-ink">{kind === "received" ? "Received" : "Fix the amount"}</h3>
      <p className="text-xs text-muted">{kind === "received" ? "What came in on a delivery. Approved invoices for brewing ingredients add this on their own." : "Spilled, found a sack, or a brew used more than the recipe: plus or minus, with why."}</p>
      <div className="flex gap-2">
        <Input inputMode="decimal" value={amountText} onChange={(e) => setAmount(e.target.value)} placeholder={kind === "adjust" ? "−5 or 5" : "Amount"} aria-label={kind === "received" ? `Amount of ${row.name} received` : `Amount to change ${row.name} by`} className="w-28" />
        <Select value={unit} onChange={(e) => setUnit(e.target.value)} options={row.units.map((u) => ({ value: u, label: u }))} aria-label="Unit" className="w-24" />
      </div>
      <Field label={kind === "received" ? "Note (optional)" : "Why"}>
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === "received" ? "Invoice 1234" : "Spilled half a sack"} maxLength={200} />
      </Field>
      {error && <p role="alert" className="text-xs text-bad">{error}</p>}
      <Button type="submit" size="sm" variant={kind === "received" ? "primary" : "secondary"} disabled={pending || !valid || (kind === "adjust" && !note.trim())}>{kind === "received" ? "Add to stock" : "Save fix"}</Button>
    </form>
  );
}
