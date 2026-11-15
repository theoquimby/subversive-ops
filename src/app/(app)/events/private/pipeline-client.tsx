"use client";

import { DataTable, type Column, type Filter, type GroupBy } from "@/components/data-table";
import { GridCell, GridSelect } from "@/components/grid";
import { Badge, Button, Card, cx, DatePicker, Input, Select } from "@/components/ui";
import { addDays, WEEKDAYS } from "@/domain/dates";
import { displayTime } from "@/domain/events";
import { EVENT_TYPE_LABEL, EVENT_TYPES, nextStage, OPEN_STAGES, PATH, STAGE_LABEL, STAGE_TONE, STAGES, type Stage } from "@/domain/privateEvents";
import { money, shortDate } from "@/lib/format";
import type { PrivateEventRow } from "@/server/services/privateEvents";
import { ArrowRight, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { addInquiry, setPrivateEventField, setStage } from "./actions";

const TYPE_OPTIONS = EVENT_TYPES.map((t) => ({ value: t, label: EVENT_TYPE_LABEL[t] }));
const STAGE_OPTIONS = STAGES.map((s) => ({ value: s, label: STAGE_LABEL[s] }));
const RANK = Object.fromEntries(STAGES.map((s, i) => [s, i])) as Record<Stage, number>;

export const dayLabel = (iso: string) => `${WEEKDAYS[new Date(`${iso}T12:00:00Z`).getUTCDay()]} ${shortDate(iso)}`;

export function StageBadge({ stage }: { stage: Stage }) {
  return <Badge tone={STAGE_TONE[stage]}>{STAGE_LABEL[stage]}</Badge>;
}

/** The one thing to do next, in a few words. */
export function nextStep(r: PrivateEventRow, today: string): { text: string; tone: "bad" | "warn" | "neutral" } {
  if (r.stage === "LOST") return { text: "Lost", tone: "neutral" };
  if (r.stage === "DONE") return r.balance > 0.005 ? { text: `${money(r.balance)} still owed`, tone: "warn" } : { text: "All settled", tone: "neutral" };
  if (r.date && r.date < today) return { text: "Mark it done", tone: "warn" };
  if (r.stage === "INQUIRY") return r.total > 0 ? { text: "Send the quote", tone: "neutral" } : { text: "Build the quote", tone: "neutral" };
  if (r.stage === "QUOTED") {
    if (r.deposit > r.paid + 0.005) {
      const late = r.depositDueOn != null && r.depositDueOn < today;
      return { text: `Deposit ${money(r.deposit - r.paid)}${r.depositDueOn ? ` ${late ? "was due" : "due"} ${shortDate(r.depositDueOn)}` : ""}`, tone: late ? "bad" : r.accepted ? "warn" : "neutral" };
    }
    return { text: "Confirm", tone: "neutral" };
  }
  if (r.stage === "DEPOSIT") return { text: "Confirm the details", tone: r.date && r.date <= addDays(today, 14) ? "warn" : "neutral" };
  if (r.balance > 0.005) {
    const late = r.balanceDueOn != null && r.balanceDueOn < today;
    return { text: `Balance ${money(r.balance)}${r.balanceDueOn ? ` ${late ? "was due" : "due"} ${shortDate(r.balanceDueOn)}` : ""}`, tone: late ? "bad" : "neutral" };
  }
  return { text: "Paid in full", tone: "neutral" };
}

// ---- New inquiry ----------------------------------------------------------------------

export function NewInquiry({ spaces, today }: { spaces: string[]; today: string }) {
  const router = useRouter();
  const [f, setF] = useState({ clientName: "", company: "", contact: "", date: "", headcount: "", type: "PARTY", space: "", notes: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = () =>
    start(async () => {
      setError(null);
      const r = await addInquiry(f);
      if (r.error) setError(r.error);
      else if (r.id) router.push(`/events/private/${r.id}`);
    });
  return (
    <Card className="p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1.3fr)_10rem_6rem]">
        <Input value={f.clientName} onChange={set("clientName")} placeholder="Client name" aria-label="Client name" autoComplete="off" onKeyDown={(e) => e.key === "Enter" && submit()} />
        <Input value={f.contact} onChange={set("contact")} placeholder="Email or phone" aria-label="Email or phone" autoComplete="off" inputMode="email" />
        <DatePicker value={f.date} onChange={set("date")} aria-label="Date" min={today} />
        <Input value={f.headcount} onChange={set("headcount")} placeholder="Guests" aria-label="Guests" inputMode="numeric" className="num" />
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.3fr)_12rem_12rem_minmax(0,1.3fr)_auto]">
        <Input value={f.company} onChange={set("company")} placeholder="Company or occasion (optional)" aria-label="Company or occasion" />
        <Select value={f.type} onChange={set("type")} options={TYPE_OPTIONS} aria-label="Type" />
        <Select value={f.space} onChange={set("space")} options={[{ value: "", label: "Space not set" }, ...spaces.map((s) => ({ value: s, label: s }))]} aria-label="Space" />
        <Input value={f.notes} onChange={set("notes")} placeholder="Notes (optional)" aria-label="Notes" />
        <Button variant="primary" disabled={pending} onClick={submit} className="h-10 sm:h-9">
          <Plus className="size-4" /> {pending ? "Adding…" : "Add inquiry"}
        </Button>
      </div>
      <div className="mt-2 min-h-5 text-sm text-bad" role="alert">{error}</div>
    </Card>
  );
}

// ---- Stage cell -----------------------------------------------------------------------

function StageCell({ r }: { r: PrivateEventRow }) {
  const router = useRouter();
  return (
    <GridSelect
      value={r.stage}
      options={STAGE_OPTIONS}
      ariaLabel={`Stage for ${r.title}`}
      onSave={async (v) => {
        const res = await setStage(r.id, v);
        if (!res.error) router.refresh();
        return res.error ? { error: res.error } : undefined;
      }}
    />
  );
}

// ---- Table ----------------------------------------------------------------------------

export function PipelineTable({ rows, today, spaces, owners }: { rows: PrivateEventRow[]; today: string; spaces: string[]; owners: { id: string; name: string }[] }) {
  const spaceOptions = useMemo(() => [{ value: "", label: "—" }, ...spaces.map((s) => ({ value: s, label: s }))], [spaces]);
  const ownerOptions = useMemo(() => [{ value: "", label: "Nobody" }, ...owners.map((o) => ({ value: o.id, label: o.name }))], [owners]);
  const columns = useMemo<Column<PrivateEventRow>[]>(() => [
    {
      id: "client",
      header: "Client",
      width: 200,
      sort: (r) => r.title.toLowerCase(),
      csv: (r) => r.title,
      cell: (r) => (
        <div className="min-w-0">
          <Link href={`/events/private/${r.id}`} className="font-medium text-ink hover:underline" data-tour="private.row-link">{r.title}</Link>
          <div className="truncate text-xs text-muted">{EVENT_TYPE_LABEL[r.type]}{r.company ? ` · ${r.clientName}` : ""}</div>
        </div>
      ),
    },
    {
      id: "date",
      header: "Date",
      width: 120,
      sort: (r) => r.date ?? "9999",
      csv: (r) => r.date ?? "",
      cell: (r) => (r.date ? (
        <div className={cx("num whitespace-nowrap", r.date < today && r.stage !== "DONE" && r.stage !== "LOST" && "text-warn")}>
          {dayLabel(r.date)}
          {r.startTime && <div className="text-xs text-muted">{displayTime(r.startTime)}{r.endTime ? `–${displayTime(r.endTime)}` : ""}</div>}
        </div>
      ) : <span className="text-muted">No date</span>),
    },
    { id: "stage", header: "Stage", width: 140, edit: true, sort: (r) => RANK[r.stage], csv: (r) => STAGE_LABEL[r.stage], cell: (r) => <StageCell r={r} /> },
    { id: "guests", header: "Guests", align: "right", width: 80, edit: true, firstDir: "desc", sort: (r) => r.headcount, csv: (r) => r.headcount, cell: (r) => <GridCell grid="pe" col="guests" type="number" value={r.headcount || ""} ariaLabel={`Guests for ${r.title}`} onSave={(v) => setPrivateEventField(r.id, "headcount", v)} /> },
    { id: "space", header: "Space", width: 140, edit: true, sort: (r) => r.space ?? "", csv: (r) => r.space ?? "", cell: (r) => <GridSelect value={r.space ?? ""} options={spaceOptions} ariaLabel={`Space for ${r.title}`} onSave={(v) => setPrivateEventField(r.id, "space", v)} /> },
    { id: "total", header: "Quote", align: "right", width: 100, firstDir: "desc", sort: (r) => r.total, csv: (r) => r.total, cell: (r) => <span className="num">{r.total > 0 ? money(r.total) : <span className="text-muted">—</span>}</span>, total: (list) => <span className="num">{money(list.reduce((s, r) => s + r.total, 0), { whole: true })}</span> },
    { id: "paid", header: "Paid", align: "right", width: 100, firstDir: "desc", sort: (r) => r.paid, csv: (r) => r.paid, cell: (r) => <span className="num">{r.paid > 0 ? money(r.paid) : <span className="text-muted">—</span>}</span> },
    { id: "margin", header: "Margin", align: "right", width: 90, defaultHidden: true, firstDir: "desc", sort: (r) => r.marginPct ?? -1, csv: (r) => r.margin, cell: (r) => <span className="num">{r.marginPct != null ? `${Math.round(r.marginPct * 100)}%` : "—"}</span> },
    { id: "owner", header: "Owner", width: 120, edit: true, sort: (r) => r.ownerName ?? "", csv: (r) => r.ownerName ?? "", cell: (r) => <GridSelect value={r.ownerId ?? ""} options={ownerOptions} ariaLabel={`Owner for ${r.title}`} onSave={(v) => setPrivateEventField(r.id, "ownerId", v)} /> },
    {
      id: "next",
      header: "Next step",
      width: 190,
      sort: (r) => nextStep(r, today).text,
      csv: (r) => nextStep(r, today).text,
      cell: (r) => {
        const n = nextStep(r, today);
        return <span className={cx("text-sm", n.tone === "bad" ? "text-bad" : n.tone === "warn" ? "text-warn" : "text-ink-2")}>{n.text}</span>;
      },
    },
  ], [today, spaceOptions, ownerOptions]);

  const filters = useMemo<Filter<PrivateEventRow>[]>(() => [
    {
      id: "status",
      label: "Status",
      kind: "facet",
      display: "segmented",
      single: true,
      allLabel: "All",
      values: (r) => ((OPEN_STAGES as readonly string[]).includes(r.stage) ? "open" : r.stage.toLowerCase()),
      options: [{ value: "open", label: "Open" }, { value: "done", label: "Done" }, { value: "lost", label: "Lost" }],
    },
    { id: "stage", label: "Stage", kind: "facet", values: (r) => r.stage, options: STAGE_OPTIONS },
    { id: "type", label: "Type", kind: "facet", values: (r) => r.type, options: TYPE_OPTIONS },
    { id: "owing", label: "Money owed", kind: "toggle", tone: "warn", test: (r) => r.stage !== "LOST" && (r.deposit > r.paid + 0.005 || (r.paid > 0 && r.balance > 0.005)) },
  ], []);

  const groups = useMemo<GroupBy<PrivateEventRow>[]>(() => [
    { id: "stage", label: "Stage", key: (r) => r.stage, title: (k) => STAGE_LABEL[k as Stage] ?? k, order: (a, b) => RANK[a as Stage] - RANK[b as Stage] },
    { id: "month", label: "Month", key: (r) => r.date?.slice(0, 7) ?? "", title: (k) => (k ? new Date(`${k}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }) : "No date"), order: (a, b) => (a || "9999").localeCompare(b || "9999") },
    { id: "owner", label: "Owner", key: (r) => r.ownerName ?? "" },
  ], []);

  return (
    <DataTable
      id="private-events"
      rows={rows}
      rowKey={(r) => r.id}
      columns={columns}
      noun={["booking", "bookings"]}
      searchText={(r) => `${r.title} ${r.clientName} ${r.company ?? ""} ${r.clientEmail ?? ""} ${r.clientPhone ?? ""} ${EVENT_TYPE_LABEL[r.type]} ${r.space ?? ""} ${STAGE_LABEL[r.stage]} ${r.date ?? ""}`}
      searchPlaceholder="Search bookings"
      filters={filters}
      groups={groups}
      defaultView={{ filters: { status: ["open"] }, sort: [{ id: "date", dir: "asc" }] }}
      csvName="private-events"
      urlSearch={false}
      help="events.private.table"
      rowHref={(r) => `/events/private/${r.id}`}
      summary={(vis) => [
        { value: vis.length, label: vis.length === 1 ? "booking" : "bookings" },
        { value: vis.reduce((s, r) => s + r.headcount, 0), label: "guests" },
        { value: money(vis.reduce((s, r) => s + r.total, 0), { whole: true }), label: "quoted" },
        { value: vis.filter((r) => r.stage !== "LOST" && (r.deposit > r.paid + 0.005 || (r.paid > 0 && r.balance > 0.005))).length, label: "owing", tone: "warn", filter: { id: "owing" } },
      ]}
      card={(r) => ({
        title: r.title,
        subtitle: <>{STAGE_LABEL[r.stage]} · {r.date ? dayLabel(r.date) : "no date"}{r.headcount ? ` · ${r.headcount} guests` : ""}</>,
        value: r.total > 0 ? money(r.total) : undefined,
        sub: nextStep(r, today).text,
      })}
      empty={<span>No bookings yet. Add the first inquiry above.</span>}
    />
  );
}

// ---- Board ----------------------------------------------------------------------------

function MoveOn({ r, today }: { r: PrivateEventRow; today: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const to = nextStage(r.stage);
  if (!to || (to === "DONE" && r.date && r.date > today)) return null;
  return (
    <div className="mt-2">
      <Button
        size="sm"
        variant="ghost"
        className="-ml-2 h-10 sm:h-8"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await setStage(r.id, to);
            if (res.error) setError(res.error);
            else router.refresh();
          })
        }
      >
        {STAGE_LABEL[to]} <ArrowRight className="size-3.5" />
      </Button>
      {error && <div role="alert" className="text-xs text-bad">{error}</div>}
    </div>
  );
}

export function PipelineBoard({ rows, today }: { rows: PrivateEventRow[]; today: string }) {
  const [showClosed, setShowClosed] = useState(false);
  const cols: Stage[] = showClosed ? [...PATH, "LOST"] : ["INQUIRY", "QUOTED", "DEPOSIT", "CONFIRMED"];
  // Done and lost only show the last 90 days, so the board stays short.
  const visible = rows.filter((r) => (r.stage === "DONE" || r.stage === "LOST" ? !r.date || r.date >= addDays(today, -90) : true));
  return (
    <div>
      <div className="mb-3 flex justify-end">
        <Button size="sm" variant="ghost" className="h-10 sm:h-8" onClick={() => setShowClosed(!showClosed)} aria-pressed={showClosed}>
          {showClosed ? "Hide done & lost" : "Show done & lost"}
        </Button>
      </div>
      <div className={cx("grid gap-3 md:grid-cols-2", showClosed ? "xl:grid-cols-6" : "xl:grid-cols-4")}>
        {cols.map((s) => {
          const list = visible.filter((r) => r.stage === s).sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"));
          return (
            <section key={s} aria-label={STAGE_LABEL[s]} className="min-w-0 rounded-xl bg-surface-2/60 p-2">
              <header className="flex items-baseline justify-between px-2 pt-1 pb-2">
                <h3 className="text-sm font-semibold text-ink">{STAGE_LABEL[s]} <span className="num ml-1 font-normal text-muted">{list.length}</span></h3>
                <span className="num text-xs text-muted">{money(list.reduce((t, r) => t + r.total, 0), { whole: true })}</span>
              </header>
              <div className="flex flex-col gap-2">
                {list.length === 0 && <div className="px-2 pb-2 text-xs text-muted">Nothing here</div>}
                {list.map((r) => {
                  const n = nextStep(r, today);
                  return (
                    <Card key={r.id} className="p-3">
                      <Link href={`/events/private/${r.id}`} className="block min-w-0" data-tour="private.row-link">
                        <div className="truncate font-medium text-ink">{r.title}</div>
                        <div className="num mt-0.5 text-xs text-muted">
                          {r.date ? dayLabel(r.date) : "No date"}{r.headcount ? ` · ${r.headcount} guests` : ""}{r.space ? ` · ${r.space}` : ""}
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <span className={cx("min-w-0 truncate text-xs", n.tone === "bad" ? "text-bad" : n.tone === "warn" ? "text-warn" : "text-ink-2")}>{n.text}</span>
                          {r.total > 0 && <span className="num shrink-0 text-sm">{money(r.total, { whole: true })}</span>}
                        </div>
                      </Link>
                      <MoveOn r={r} today={today} />
                    </Card>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
