"use client";

import { DataTable, DetailRow, type Column, type Filter, type GroupBy } from "@/components/data-table";
import { useConfirm } from "@/components/dialog";
import { GridCell } from "@/components/grid";
import { Badge, Button, cx, LinkButton, type Tone } from "@/components/ui";
import { WEEKDAYS } from "@/domain/dates";
import { clock, compareByDeadline, DEADLINE_BUCKETS, deadlineBucket, deadlineKey, deadlineSummary, mondayFirst, needsOrder, type DeadlineBucket, type SupplierStateKind } from "@/domain/orderingBoard";
import { dayDate, money, shortDate } from "@/lib/format";
import type { BoardPo, BoardSupplier, SuggestedOrder } from "@/server/services/orderingBoard";
import { RefreshCw, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { SupplierSuggestionLine } from "../settings/learned-cards";
import { AutoSwitch } from "../settings/controls";
import { saveSupplierCutoff, saveSupplierField } from "../settings/setting-actions";
import { DayChips } from "../settings/suppliers/suppliers-table";
import { draftOrders, emailDrafts, setAutoDraft } from "./actions";
import { Countdown } from "./countdown";
import { DeadlineEditor } from "./deadline-editor";

type Row = BoardSupplier;
const DEFAULT_VIEW = { sort: [{ id: "orderBy", dir: "asc" as const }] };
type Suggestions = Record<string, SuggestedOrder>;

const KINDS = [{ value: "DISTRIBUTOR", label: "Distributor" }, { value: "LOCAL", label: "Local" }];
const STATE: Record<SupplierStateKind, { label: string; tone: Tone }> = {
  none: { label: "No order", tone: "neutral" },
  draft: { label: "Draft", tone: "warn" },
  sent: { label: "Sent", tone: "neutral" },
  received: { label: "Received", tone: "good" },
};
const PO_STATUS: Record<BoardPo["status"], { label: string; tone: Tone }> = { DRAFT: { label: "Draft", tone: "warn" }, SENT: { label: "Sent", tone: "neutral" }, RECEIVED: { label: "Received", tone: "good" } };
const STATE_RANK: Record<SupplierStateKind, number> = { none: 0, draft: 1, sent: 2, received: 3 };
const days = (d: number[]) => (d.length ? mondayFirst(d).map((x) => WEEKDAYS[x]).join(", ") : "No delivery days");
const lines = (n: number) => `${n} line${n === 1 ? "" : "s"}`;
const shortDay = (iso: string) => `${WEEKDAYS[new Date(`${iso}T12:00:00Z`).getUTCDay()]} ${shortDate(iso)}`;

/** "Wed 5pm" for the next deadline; "today 2pm" / "tomorrow 2pm" when that's clearer. */
function deadlineText(r: Row, today: string) {
  if (!r.next) return null;
  const b = deadlineBucket(r.next.cutoffDate, today);
  const day = b === "today" ? "Today" : b === "tomorrow" ? "Tomorrow" : WEEKDAYS[new Date(`${r.next.cutoffDate}T12:00:00Z`).getUTCDay()];
  return `${day} ${clock(r.next.cutoffTime)}`;
}

function StatusCell({ r }: { r: Row }) {
  const s = STATE[r.state.kind];
  const o = r.state.order;
  return (
    <div className="min-w-0">
      <Badge tone={r.state.kind === "none" && r.next && r.hoursToCutoff != null && r.hoursToCutoff <= 48 ? "bad" : s.tone}>{s.label}</Badge>
      {o && (
        <Link href={`/ordering/po/${o.id}`} className="num mt-0.5 block text-xs whitespace-nowrap text-ink-2 hover:underline" title={`For ${dayDate(o.deliveryDate)}`}>
          {o.total != null ? money(o.total, { whole: true }) : "—"} · {lines(o.lines)}{!r.state.forNext && <span className="text-muted"> · {shortDay(o.deliveryDate)}</span>}
        </Link>
      )}
    </div>
  );
}

function SuggestedCell({ s, loading, items }: { s: SuggestedOrder | undefined; loading: boolean; items: number }) {
  if (items === 0) return <span className="text-xs text-muted">No items linked</span>;
  if (!s) return <span className="text-xs text-muted">{loading ? "Working out…" : "—"}</span>;
  if (s.lines === 0) return <span className="text-xs text-muted">{s.needsCount ? `Count ${s.needsCount} to suggest` : "Nothing needed"}</span>;
  return (
    <div className="num">
      <span className="text-ink">≈{money(s.total, { whole: true })}</span>
      <span className="text-xs text-muted"> · {lines(s.lines)}</span>
      {s.runsOut > 0 && <div className="text-xs text-bad">{s.runsOut} run{s.runsOut === 1 ? "s" : ""} out first</div>}
      {s.minOrder != null && s.total < s.minOrder && <div className="text-xs text-warn">Under {money(s.minOrder, { whole: true })} min</div>}
    </div>
  );
}

function DraftButton({ r, label = "Draft this order", variant = "secondary" }: { r: Row; label?: string; variant?: "primary" | "secondary" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button variant={variant} className="h-10 sm:h-9" disabled={pending} onClick={() => start(async () => {
        setError(null);
        const res = await draftOrders([r.id]);
        if (res.error) setError(res.error);
        else if (res.orderIds?.[0]) router.push(`/ordering/po/${res.orderIds[0]}`);
      })}>{pending ? "Drafting…" : label}</Button>
      {error && <p role="alert" className="basis-full text-xs text-bad">{error}</p>}
    </>
  );
}

function SupplierPanel({ r, today, s, loading, reload }: { r: Row; today: string; s: SuggestedOrder | undefined; loading: boolean; reload: () => void }) {
  const o = r.state.order;
  const f = (label: string, el: React.ReactNode) => (
    <div className="grid items-center gap-1 py-1.5 sm:grid-cols-[7.5rem_1fr] sm:gap-3">
      <div className="text-sm text-muted">{label}</div>
      <div className="min-w-0">{el}</div>
    </div>
  );
  return (
    <div className="space-y-6">
      <section>
        <div className="text-[0.8rem] font-medium text-ink-2">Next deadline</div>
        {r.next ? (
          <div className="mt-1">
            <div className="flex flex-wrap items-center gap-2 text-base">
              <span className="font-medium">Order by {deadlineText(r, today)?.replace(/^(Today|Tomorrow)/, (w) => w.toLowerCase())}</span>
              <Countdown at={r.cutoffAt} />
              {r.guessed && <Badge tone="warn">guessed</Badge>}
            </div>
            <div className="text-sm text-muted">For the {dayDate(r.next.deliveryDate)} delivery</div>
            <div className="mt-0.5 text-xs text-muted">All deadlines: {deadlineSummary(r.deliveryDays, r.rule)}</div>
          </div>
        ) : (
          <p className="mt-1 text-sm text-muted">{r.deliveryDays.length ? "No deadline coming up." : "Set delivery days to get deadlines and auto-drafts."}</p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <LinkButton href={`/ordering/${r.id}`} variant="primary" className="h-10 sm:h-9">Build order</LinkButton>
          {o && <LinkButton href={`/ordering/po/${o.id}`} className="h-10 sm:h-9">{o.status === "DRAFT" ? "Open draft" : "Open order"}</LinkButton>}
          {r.state.kind === "none" && r.next && r.items > 0 && <DraftButton r={r} />}
          <DeadlineEditor supplierId={r.id} name={r.name} deliveryDays={r.deliveryDays} rule={r.rule} learned={r.hint} className="mr-0 h-10 sm:h-9" />
        </div>
        {r.learned && <SupplierSuggestionLine s={r.learned} />}
      </section>

      <section>
        <div className="flex items-center justify-between gap-2">
          <div className="text-[0.8rem] font-medium text-ink-2">Suggested order{s && <span className="font-normal text-muted"> · for {dayDate(s.deliveryDate)}</span>}</div>
          <Button size="sm" variant="ghost" className="h-10 w-10 p-0 sm:h-8 sm:w-8" onClick={reload} disabled={loading} aria-label="Work it out again" title="Work it out again"><RefreshCw className={cx("size-3.5", loading && "animate-spin")} /></Button>
        </div>
        {r.items === 0 ? (
          <p className="mt-1 text-sm text-muted">No items are linked to {r.name} yet, so there&apos;s nothing to suggest. Link their products on <Link href="/prices" className="text-ink-2 underline">Prices</Link>.</p>
        ) : !s ? (
          <p className="mt-1 text-sm text-muted">{loading ? "Working out the suggested order…" : "Couldn't work it out. Open Build order instead."}</p>
        ) : s.lines === 0 ? (
          <p className="mt-1 text-sm text-muted">{s.needsCount ? `Nothing to suggest until ${s.needsCount} item${s.needsCount === 1 ? " is" : "s are"} counted.` : "Stock covers this delivery. Nothing needed."}</p>
        ) : (
          <>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-3 text-sm">
              <span className="num text-lg font-semibold">≈{money(s.total)}</span>
              <span className="text-muted">{lines(s.lines)}</span>
              {s.minOrder != null && s.total < s.minOrder && <span className="text-warn">under the {money(s.minOrder, { whole: true })} minimum</span>}
              {s.runsOut > 0 && <span className="text-bad">{s.runsOut} run{s.runsOut === 1 ? "s" : ""} out before delivery</span>}
            </div>
            <ul className="mt-2 divide-y divide-border rounded-lg border border-border text-sm">
              {s.top.slice(0, 12).map((l) => (
                <li key={l.name} className="flex items-baseline justify-between gap-3 px-3 py-1.5">
                  <span className="min-w-0 truncate">{l.name}{l.runsOut && <span className="text-bad"> · runs out</span>}</span>
                  <span className="num shrink-0 text-ink-2">{l.units} {l.unit}{l.cost != null && <span className="text-muted"> · {money(l.cost)}</span>}</span>
                </li>
              ))}
            </ul>
            {s.top.length > 12 && <p className="mt-1 text-xs text-muted">and {s.lines - 12} more — Build order shows every line.</p>}
            {(s.needsCount > 0 || s.needsSetup > 0) && <p className="mt-1 text-xs text-warn">{[s.needsCount && `${s.needsCount} need a count`, s.needsSetup && `${s.needsSetup} need a pack size`].filter(Boolean).join(" · ")} before they can be suggested.</p>}
          </>
        )}
      </section>

      <section>
        <div className="text-[0.8rem] font-medium text-ink-2">Recent orders</div>
        {r.recent.length === 0 ? (
          <p className="mt-1 text-sm text-muted">No orders in the last few months.</p>
        ) : (
          <ul className="mt-1">
            {r.recent.map((p) => (
              <li key={p.id}>
                <Link href={`/ordering/po/${p.id}`} className="flex min-h-10 items-center justify-between gap-3 border-b border-border py-1.5 text-sm last:border-b-0 hover:bg-surface-2/60">
                  <span className="flex items-center gap-2"><Badge tone={PO_STATUS[p.status].tone}>{PO_STATUS[p.status].label}</Badge><span className="num">{dayDate(p.deliveryDate)}</span></span>
                  <span className="num text-ink-2">{p.total != null ? money(p.total) : "—"} <span className="text-muted">· {p.lines}</span></span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="mb-1 text-[0.8rem] font-medium text-ink-2">Supplier</div>
        {f("Delivers on", <DayChips key={r.deliveryDays.join()} id={r.id} value={r.deliveryDays} name={r.name} />)}
        {f("Order email", <GridCell grid="ord-d" col="email" value={r.email} placeholder="none" ariaLabel="Order email" onSave={(v) => saveSupplierField(r.id, "email", v)} className="rounded-md border border-border" />)}
        {f("Minimum", <GridCell grid="ord-d" col="min" type="number" prefix="$" value={r.minOrder} placeholder="none" ariaLabel="Minimum order" onSave={(v) => saveSupplierField(r.id, "minOrder", v)} className="rounded-md border border-border" />)}
        {f("Auto-draft", <AutoSwitch on={r.rule.autoDraft} label="Draft orders before the deadline" onSave={(on) => saveSupplierCutoff(r.id, "autoDraft", on ? "on" : "off")} />)}
        <DetailRow label="Linked items">{r.items}</DetailRow>
        <DetailRow label="More">
          <Link href="/settings/suppliers" className="text-ink-2 hover:underline">Lead time, type and notes in Settings</Link>
        </DetailRow>
      </section>
    </div>
  );
}

export function SuppliersBoard({ rows, today, emailReady }: { rows: Row[]; today: string; emailReady: boolean }) {
  const confirm = useConfirm();
  const [sugg, setSugg] = useState<Suggestions>({});
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch("/ordering/suggested", { cache: "no-store" });
      const j = (await res.json()) as { suggestions?: Suggestions; error?: string };
      if (j.suggestions) setSugg(j.suggestions);
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const columns = useMemo<Column<Row>[]>(() => [
    {
      id: "name",
      header: "Supplier",
      width: 180,
      sort: (r) => r.name,
      csv: (r) => r.name,
      cell: (r) => (
        <div className="min-w-0">
          <Link href={`/ordering/${r.id}`} className="font-medium text-ink hover:underline" data-tour="ordering.supplier-card">{r.name}</Link>
          <div className="flex items-center gap-1 text-xs text-muted">
            {r.kind === "DISTRIBUTOR" ? "Distributor" : "Local"}
            {r.learned && <span title="A suggestion from your invoices is waiting — open the row" className="inline-flex items-center gap-0.5 text-ink-2"><Sparkles className="size-3" aria-hidden /> tip</span>}
          </div>
        </div>
      ),
    },
    { id: "days", header: "Delivers", edit: true, width: 262, sort: (r) => r.deliveryDays.length, csv: (r) => days(r.deliveryDays), cell: (r) => <DayChips key={r.deliveryDays.join()} id={r.id} value={r.deliveryDays} name={r.name} /> },
    { id: "next", header: "Next delivery", width: 110, sort: (r) => r.next?.deliveryDate ?? null, csv: (r) => r.next?.deliveryDate ?? "", cell: (r) => (r.next ? <span className="num whitespace-nowrap">{shortDay(r.next.deliveryDate)}</span> : <span className="text-muted">—</span>) },
    {
      id: "orderBy",
      header: "Order by",
      help: "ordering.cutoffs",
      width: 200,
      sort: (r) => deadlineKey(r.next),
      csv: (r) => (r.next ? `${r.next.cutoffDate} ${r.next.cutoffTime}` : ""),
      cell: (r) => (
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            {r.next ? (
              <>
                <div className="num whitespace-nowrap">{deadlineText(r, today)}</div>
                <div className="flex flex-wrap items-center gap-1">
                  {r.state.kind === "none" ? <Countdown at={r.cutoffAt} /> : <span className="text-xs text-muted">ordered{r.guessed && " ·"}</span>}
                  {r.guessed && <span className="text-xs text-warn" title="No deadline set for this delivery day yet: guessed from the lead time">guessed</span>}
                </div>
              </>
            ) : (
              <span className="text-xs text-muted">{r.deliveryDays.length ? "None coming up" : "Set delivery days"}</span>
            )}
          </div>
          <DeadlineEditor compact supplierId={r.id} name={r.name} deliveryDays={r.deliveryDays} rule={r.rule} learned={r.hint} />
        </div>
      ),
    },
    { id: "status", header: "Status", width: 130, sort: (r) => STATE_RANK[r.state.kind], csv: (r) => STATE[r.state.kind].label, cell: (r) => <StatusCell r={r} /> },
    { id: "suggested", header: "Suggested", help: "ordering.board.suggested", align: "right", width: 130, firstDir: "desc", sort: (r) => sugg[r.id]?.total ?? null, csv: (r) => sugg[r.id]?.total ?? "", cell: (r) => <SuggestedCell s={sugg[r.id]} loading={loading} items={r.items} /> },
    { id: "items", header: "Items", align: "right", width: 70, firstDir: "desc", sort: (r) => r.items, csv: (r) => r.items, cell: (r) => <span className={r.items ? "text-ink-2" : "text-muted"}>{r.items}</span> },
    {
      id: "last",
      header: "Last order",
      width: 120,
      firstDir: "desc",
      sort: (r) => r.lastOrder?.createdOn ?? null,
      csv: (r) => r.lastOrder?.createdOn ?? "",
      cell: (r) => (r.lastOrder ? <Link href={`/ordering/po/${r.lastOrder.id}`} className="num text-sm whitespace-nowrap text-ink-2 hover:underline">{shortDate(r.lastOrder.createdOn)} <span className="text-xs text-muted">{PO_STATUS[r.lastOrder.status].label.toLowerCase()}</span></Link> : <span className="text-muted">—</span>),
    },
    { id: "min", header: "Minimum", align: "right", edit: true, width: 100, firstDir: "desc", sort: (r) => r.minOrder, csv: (r) => r.minOrder, cell: (r) => <GridCell grid="ord" col="min" type="number" prefix="$" value={r.minOrder} placeholder="—" ariaLabel={`${r.name} minimum order`} onSave={(v) => saveSupplierField(r.id, "minOrder", v)} /> },
    { id: "email", header: "Order email", edit: true, width: 200, sort: (r) => r.email, csv: (r) => r.email, cell: (r) => <GridCell grid="ord" col="email" value={r.email} placeholder="—" ariaLabel={`${r.name} order email`} onSave={(v) => saveSupplierField(r.id, "email", v)} /> },
    { id: "auto", header: "Auto-draft", help: "ordering.cutoffs", width: 130, sort: (r) => r.rule.autoDraft, csv: (r) => (r.rule.autoDraft ? "on" : "off"), cell: (r) => <AutoSwitch on={r.rule.autoDraft} label={`Auto-draft orders for ${r.name}`} onSave={(on) => saveSupplierCutoff(r.id, "autoDraft", on ? "on" : "off")} /> },
    { id: "deadlines", header: "All deadlines", width: 220, defaultHidden: true, sort: (r) => deadlineSummary(r.deliveryDays, r.rule), csv: (r) => deadlineSummary(r.deliveryDays, r.rule), cell: (r) => <span className="text-sm">{deadlineSummary(r.deliveryDays, r.rule) || <span className="text-muted">—</span>}</span> },
    { id: "lead", header: "Lead", align: "right", width: 70, defaultHidden: true, sort: (r) => r.leadTimeDays, csv: (r) => r.leadTimeDays, cell: (r) => <span className="text-ink-2">{r.leadTimeDays}d</span> },
  ], [today, sugg, loading]);

  const bucket = useCallback((r: Row): DeadlineBucket => deadlineBucket(r.next?.cutoffDate, today), [today]);
  const filters = useMemo<Filter<Row>[]>(() => [
    { id: "today", label: "Deadline today", kind: "toggle", test: (r) => bucket(r) === "today", tone: "bad" },
    { id: "week", label: "Deadline this week", kind: "toggle", test: (r) => ["today", "tomorrow", "week"].includes(bucket(r)) },
    { id: "needs", label: "Needs an order", kind: "toggle", test: (r) => needsOrder(r.state, r.next), tone: "warn" },
    { id: "draft", label: "Has a draft", kind: "toggle", test: (r) => r.state.kind === "draft" },
    { id: "nodays", label: "No delivery days", kind: "toggle", test: (r) => r.deliveryDays.length === 0, tone: "warn" },
    { id: "kind", label: "Type", kind: "facet", values: (r) => r.kind, options: KINDS },
    { id: "status", label: "Status", kind: "facet", values: (r) => r.state.kind, options: (Object.keys(STATE) as SupplierStateKind[]).map((k) => ({ value: k, label: STATE[k].label })) },
  ], [bucket]);

  const groups = useMemo<GroupBy<Row>[]>(() => [
    { id: "delivery", label: "Next delivery", key: (r) => r.next?.deliveryDate ?? "", title: (k) => (k ? dayDate(k) : "No delivery coming up") },
    { id: "deadline", label: "Next deadline", key: (r) => bucket(r), title: (k) => DEADLINE_BUCKETS.find((b) => b.value === k)?.label ?? k, order: (a, b) => DEADLINE_BUCKETS.findIndex((x) => x.value === a) - DEADLINE_BUCKETS.findIndex((x) => x.value === b) },
    { id: "status", label: "Status", key: (r) => r.state.kind, title: (k) => STATE[k as SupplierStateKind]?.label ?? k, order: (a, b) => STATE_RANK[a as SupplierStateKind] - STATE_RANK[b as SupplierStateKind] },
    { id: "kind", label: "Type", key: (r) => r.kind, title: (k) => KINDS.find((x) => x.value === k)?.label ?? k },
  ], [bucket]);

  // Soonest deadline first until someone picks another sort.
  const sortedRows = useMemo(() => [...rows].sort(compareByDeadline), [rows]);

  return (
    <>
      {failed && (
        <p className="mb-2 text-xs text-muted">Suggested orders couldn&apos;t be worked out just now. <button type="button" className="text-ink-2 underline" onClick={() => void load()}>Try again</button></p>
      )}
      <DataTable
        id="ordering-suppliers"
        rows={sortedRows}
        rowKey={(r) => r.id}
        columns={columns}
        noun={["supplier", "suppliers"]}
        searchText={(r) => `${r.name} ${r.email ?? ""} ${days(r.deliveryDays)} ${r.kind === "DISTRIBUTOR" ? "distributor" : "local"} ${STATE[r.state.kind].label}`}
        searchPlaceholder="Search suppliers"
        filters={filters}
        groups={groups}
        defaultView={DEFAULT_VIEW}
        csvName="suppliers"
        urlSearch={false}
        help="ordering.board"
        tours={{ root: "ordering.table", toolbar: "ordering.toolbar" }}
        maxHeight="calc(100dvh - 12rem)"
        summary={(vis) => [
          { value: vis.length, label: vis.length === 1 ? "supplier" : "suppliers" },
          { value: vis.filter((r) => bucket(r) === "today").length, label: "deadline today", tone: "bad", filter: { id: "today" } },
          { value: vis.filter((r) => needsOrder(r.state, r.next)).length, label: "need an order", tone: "warn", filter: { id: "needs" } },
          { value: vis.filter((r) => r.state.kind === "draft").length, label: "drafts", filter: { id: "draft" } },
          { value: vis.filter((r) => r.deliveryDays.length === 0).length, label: "no delivery days", filter: { id: "nodays" } },
        ]}
        card={(r) => ({
          title: r.name,
          subtitle: (
            <>
              {STATE[r.state.kind].label}
              {r.state.order?.total != null && ` ${money(r.state.order.total, { whole: true })}`}
              {r.state.order ? ` · for ${shortDay(r.state.order.deliveryDate)}` : r.next ? ` · for ${shortDay(r.next.deliveryDate)}` : r.deliveryDays.length ? "" : " · no delivery days"}
            </>
          ),
          value: r.next && r.state.kind === "none" ? <Countdown at={r.cutoffAt} /> : r.next ? <span className="text-xs font-normal text-muted">{STATE[r.state.kind].label.toLowerCase()}</span> : null,
          sub: r.next ? `by ${deadlineText(r, today)?.replace(/^(Today|Tomorrow)/, (w) => w.toLowerCase())}` : undefined,
        })}
        drawerTitle={(r) => r.name}
        drawer={(r) => <SupplierPanel r={r} today={today} s={sugg[r.id]} loading={loading} reload={() => void load()} />}
        bulkActions={(api) => {
          const drafts = api.rows.map((r) => r.state.order).filter((o): o is BoardPo => o?.status === "DRAFT");
          return (
            <>
              <Button size="sm" variant="primary" disabled={api.pending} onClick={() => api.run(() => draftOrders(api.keys).then((r) => { if (!r.error) void load(); return r; }))} title="Save each supplier's suggested order as a draft">Draft orders</Button>
              {drafts.length > 0 && emailReady && (
                <Button size="sm" disabled={api.pending} onClick={async () => {
                  // Ask first, then start the send: never wait on a dialog inside the run.
                  const ok = await confirm({ title: `Email ${drafts.length} draft${drafts.length === 1 ? "" : "s"}?`, body: <>Each goes to the supplier&apos;s order email with the spreadsheet attached, and is marked sent.</>, confirmLabel: "Email them" });
                  if (ok) api.run(() => emailDrafts(drafts.map((d) => d.id)));
                }}>Email drafts</Button>
              )}
              {drafts.length > 0 && (
                <Button size="sm" variant="ghost" disabled={api.pending} onClick={() => { for (const d of drafts) window.open(`/ordering/po/${d.id}`, "_blank", "noopener"); }} title="Opens each draft in a new tab">Open drafts</Button>
              )}
              <Button size="sm" variant="ghost" disabled={api.pending} onClick={() => api.run(() => setAutoDraft(api.keys, true))}>Auto-draft on</Button>
              <Button size="sm" variant="ghost" disabled={api.pending} onClick={() => api.run(() => setAutoDraft(api.keys, false))}>Auto-draft off</Button>
            </>
          );
        }}
        empty={<span>No active suppliers yet. Add them in <Link href="/settings/suppliers" className="underline">Settings → Suppliers</Link>.</span>}
      />
    </>
  );
}
