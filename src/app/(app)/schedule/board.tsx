"use client";

import { useConfirm } from "@/components/dialog";
import { Badge, Button, Card, cx, LinkButton } from "@/components/ui";
import { weekday } from "@/domain/dates";
import { availabilityLabel, shiftLabel, shiftPaidHours } from "@/domain/schedule";
import { dayDate, money, pct, shortDate } from "@/lib/format";
import type { ShiftView, WeekData, WeekIssue } from "@/server/services/scheduling";
import { AlertTriangle, ChevronLeft, ChevronRight, CopyPlus, Eraser, Inbox, Plus, Send, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { clearDraftShifts, copyPreviousWeek, createShift, moveShift, publishSchedule } from "./actions";
import { DemandChart } from "./demand-chart";
import { GeneratePanel } from "./generate-panel";
import { ShiftEditor } from "./shift-editor";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const fmtH = (h: number) => `${Number(h.toFixed(1))}h`;
const OPEN = "open";

export function ScheduleBoard({ data, today, prevWeek, nextWeek, thisWeek }: { data: WeekData; today: string; prevWeek: string; nextWeek: string; thisWeek: string }) {
  const { dates, positions, employees, issues, summary, timeOff, pendingTimeOff, opening } = data;
  const confirm = useConfirm();
  const [busy, start] = useTransition();
  const [toast, setToast] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; anchor: HTMLElement | null } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [dayIdx, setDayIdx] = useState(() => Math.max(0, dates.indexOf(today)));
  const [moved, setMoved] = useState<Record<string, { employeeId: string | null; date: string }>>({});
  useEffect(() => setMoved({}), [data.shifts]);

  const showToast = useCallback((m: string) => {
    setToast(m);
    window.setTimeout(() => setToast((t) => (t === m ? null : t)), 3200);
  }, []);

  const shifts = useMemo(() => data.shifts.map((s) => (moved[s.id] ? { ...s, ...moved[s.id] } : s)), [data.shifts, moved]);
  const posMap = useMemo(() => new Map(positions.map((p) => [p.id, p])), [positions]);
  const posIdx = useMemo(() => new Map(positions.map((p, i) => [p.id, i])), [positions]);
  const issuesBy = useMemo(() => {
    const m = new Map<string, WeekIssue[]>();
    for (const i of issues) m.set(i.shiftId, [...(m.get(i.shiftId) ?? []), i]);
    return m;
  }, [issues]);
  const byCell = useMemo(() => {
    const m = new Map<string, ShiftView[]>();
    for (const s of shifts) {
      const k = `${s.employeeId ?? OPEN}|${s.date}`;
      m.set(k, [...(m.get(k) ?? []), s]);
    }
    for (const list of m.values()) list.sort((a, b) => a.startMin - b.startMin);
    return m;
  }, [shifts]);
  const hoursBy = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of shifts) if (s.employeeId) m.set(s.employeeId, (m.get(s.employeeId) ?? 0) + shiftPaidHours(s));
    return m;
  }, [shifts]);
  const rows = useMemo(
    () => [...employees].filter((e) => e.positionIds.length || hoursBy.has(e.id)).sort((a, b) => (posIdx.get(a.positionIds[0]) ?? 99) - (posIdx.get(b.positionIds[0]) ?? 99) || a.name.localeCompare(b.name)),
    [employees, hoursBy, posIdx],
  );
  const empName = useMemo(() => new Map(employees.map((e) => [e.id, e.name])), [employees]);

  const drafts = shifts.filter((s) => !s.published).length;
  const blocks = issues.filter((i) => i.level === "block");
  const pastWeek = dates[6] < today;

  // ---- actions ----
  const quickAdd = (employeeId: string | null, date: string) => {
    const emp = employees.find((e) => e.id === employeeId);
    const positionId = emp?.positionIds[0] ?? positions[0]?.id;
    if (!positionId) return showToast("Add a position on the Team page first.");
    const o = opening[weekday(date)];
    const startMin = o ? Math.max(0, o[0] - 1) * 60 : 16 * 60;
    const endMin = o ? Math.min(startMin + 6 * 60, (o[1] + 1) * 60) : 22 * 60;
    start(async () => {
      const r = await createShift({ employeeId, positionId, date, startMin, endMin: Math.max(endMin, startMin + 4 * 60), breakMinutes: 0, notes: null });
      if (r.error) showToast(r.error);
      else if (r.id) setEditing({ id: r.id, anchor: null });
    });
  };

  const drop = (id: string, employeeId: string | null, date: string) => {
    const s = shifts.find((x) => x.id === id);
    if (!s || (s.employeeId === employeeId && s.date === date)) return;
    setMoved((m) => ({ ...m, [id]: { employeeId, date } }));
    start(async () => {
      const r = await moveShift(id, { employeeId, date, startMin: s.startMin, endMin: s.endMin });
      if (r.error) {
        showToast(r.error);
        setMoved((m) => {
          const { [id]: _, ...rest } = m;
          void _;
          return rest;
        });
      }
    });
  };

  const publish = async () => {
    let override = false;
    if (blocks.length) {
      const ok = await confirm({
        title: `Publish with ${blocks.length} problem${blocks.length === 1 ? "" : "s"}?`,
        body: <>Some shifts break a rule you&apos;ve marked as must-fix (like double-booking or scheduling someone on approved time off). Publish anyway only if you&apos;ve checked them.</>,
        confirmLabel: "Publish anyway",
        danger: true,
      });
      if (!ok) return;
      override = true;
    }
    start(async () => {
      const r = await publishSchedule(data.monday, override);
      if (r.error) showToast(r.error);
      else if (r.blockers) showToast(`${r.blockers} must-fix problems — check the list below.`);
      else showToast(`Published ${r.published} shift${r.published === 1 ? "" : "s"}. The team can see them in their app.`);
    });
  };

  // When a quick-added shift appears, anchor the editor to its chip.
  useEffect(() => {
    if (editing && !editing.anchor) {
      const el = document.querySelector<HTMLElement>(`[data-shift-id="${editing.id}"]`);
      if (el && el.offsetParent) setEditing({ id: editing.id, anchor: el });
    }
  }, [editing, shifts]);

  // ---- drag & drop (desktop, mouse/pen) ----
  const dragRef = useRef<{ id: string; x: number; y: number; started: boolean; w: number } | null>(null);
  const justDragged = useRef(false);
  const [ghost, setGhost] = useState<{ id: string; x: number; y: number; w: number; target: string | null } | null>(null);
  useEffect(() => {
    const cellAt = (x: number, y: number) => (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>("[data-cell]")?.dataset.cell ?? null;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (!d.started && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return;
      d.started = true;
      setGhost({ id: d.id, x: e.clientX, y: e.clientY, w: d.w, target: cellAt(e.clientX, e.clientY) });
    };
    const onUp = (e: PointerEvent) => {
      const d = dragRef.current;
      dragRef.current = null;
      if (!d?.started) return;
      justDragged.current = true;
      setTimeout(() => (justDragged.current = false), 0);
      setGhost(null);
      const target = cellAt(e.clientX, e.clientY);
      if (target) {
        const [emp, date] = target.split("|");
        drop(d.id, emp === OPEN ? null : emp, date);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shifts]);

  const chip = (s: ShiftView, opts: { showName?: boolean } = {}) => {
    const p = posMap.get(s.positionId);
    const iss = issuesBy.get(s.id) ?? [];
    const bad = iss.some((i) => i.level === "block");
    return (
      <button
        key={s.id}
        type="button"
        data-shift-id={s.id}
        onPointerDown={(e) => {
          if (e.button !== 0 || e.pointerType === "touch") return;
          dragRef.current = { id: s.id, x: e.clientX, y: e.clientY, started: false, w: (e.currentTarget as HTMLElement).offsetWidth };
        }}
        onClick={(e) => {
          if (justDragged.current) return;
          setEditing({ id: s.id, anchor: e.currentTarget });
        }}
        className={cx(
          "group/chip relative w-full cursor-pointer rounded-md border-l-[3px] py-1 pr-1.5 pl-2 text-left text-xs transition-shadow hover:shadow-sm focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none",
          !s.published && "outline-1 -outline-offset-1 outline-border-strong outline-dashed",
          ghost?.id === s.id && "opacity-40",
          editing?.id === s.id && "ring-2 ring-ink",
        )}
        style={{ borderLeftColor: p?.color, background: `color-mix(in srgb, ${p?.color ?? "#64748b"} 13%, var(--surface))` }}
      >
        <div className="flex items-center justify-between gap-1">
          <span className="num truncate font-medium text-ink">{shiftLabel(s.startMin, s.endMin)}</span>
          {iss.length > 0 && <AlertTriangle className={cx("size-3 shrink-0", bad ? "text-bad" : "text-warn")} strokeWidth={2.25} aria-label={iss.map((i) => i.message).join("; ")} />}
        </div>
        <div className="truncate text-[11px] text-ink-2">{opts.showName && s.employeeId ? empName.get(s.employeeId) : p?.name}</div>
      </button>
    );
  };

  const cell = (rowKey: string, date: string, empId: string | null) => {
    const list = byCell.get(`${rowKey}|${date}`) ?? [];
    const off = empId ? timeOff[empId]?.includes(date) : false;
    const pending = empId ? pendingTimeOff[empId]?.includes(date) : false;
    const emp = empId ? employees.find((e) => e.id === empId) : undefined;
    const unavailable = emp?.availability && (emp.availability[weekday(date)] ?? []).length === 0;
    const key = `${rowKey}|${date}`;
    return (
      <div
        key={key}
        data-cell={key}
        className={cx(
          "group/cell relative flex min-h-[58px] flex-col gap-1 border-b border-l border-border p-1",
          ghost?.target === key && "bg-surface-2 ring-2 ring-ink/40 ring-inset",
          date === today && "bg-surface-2/40",
        )}
        style={off || unavailable ? { backgroundImage: "repeating-linear-gradient(135deg, transparent 0 6px, var(--surface-2) 6px 7px)" } : undefined}
      >
        {off && <div className="rounded px-1 text-[11px] font-medium text-muted">Time off</div>}
        {!off && pending && <div className="px-1 text-[11px] text-muted">Asked off</div>}
        {!off && !pending && unavailable && list.length === 0 && <div className="px-1 text-[11px] text-muted/80">Unavailable</div>}
        {list.map((s) => chip(s))}
        {!pastWeek && (
          <button
            type="button"
            onClick={() => quickAdd(empId, date)}
            aria-label={`Add shift ${emp?.name ?? "open"} ${dayDate(date)}`}
            className={cx(
              "flex flex-1 items-center justify-center rounded-md text-muted opacity-0 transition-opacity group-hover/cell:opacity-100 hover:bg-surface-2 hover:text-ink focus-visible:opacity-100",
              list.length ? "min-h-5" : "min-h-12",
            )}
          >
            <Plus className="size-3.5" />
          </button>
        )}
      </div>
    );
  };

  const maxHours = Math.max(1, ...summary.days.map((d) => Math.max(d.hours, d.requiredHours)));
  const dayHeader = (date: string, i: number) => {
    const d = summary.days[i];
    const closed = !opening[weekday(date)];
    const shortfall = d.requiredHours > 0 && d.hours < d.requiredHours * 0.9;
    return (
      <div key={date} className={cx("border-b border-l border-border px-2 py-2", date === today && "bg-surface-2/40")}>
        <div className="flex items-baseline justify-between gap-1">
          <span className={cx("text-sm font-semibold", date === today && "underline decoration-2 underline-offset-4")}>{DOW[weekday(date)]} <span className="num font-normal text-muted">{shortDate(date).split(" ")[1]}</span></span>
          {closed ? <span className="text-[11px] text-muted">Closed</span> : <span className={cx("num text-[11px]", laborTone(d.laborPct))}>{pct(d.laborPct, 0)}</span>}
        </div>
        <div className="num mt-0.5 flex items-baseline justify-between text-[11px] text-muted">
          <span>{d.sales ? money(d.sales, { whole: true }) : "—"}</span>
          <span>{money(d.cost, { whole: true })}</span>
        </div>
        <HoursBar hours={d.hours} required={d.requiredHours} max={maxHours} short={shortfall} />
      </div>
    );
  };

  const editingShift = editing ? shifts.find((s) => s.id === editing.id) : undefined;
  const day = dates[dayIdx];
  const dayShifts = shifts.filter((s) => s.date === day).sort((a, b) => Number(!!a.employeeId) - Number(!!b.employeeId) || a.startMin - b.startMin || (posIdx.get(a.positionId) ?? 0) - (posIdx.get(b.positionId) ?? 0));
  const touch = useRef<{ x: number; y: number } | null>(null);

  return (
    <>
      {/* Toolbar */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <LinkButton href={`/schedule?week=${prevWeek}`} variant="ghost" size="sm" aria-label="Previous week" className="max-sm:size-10"><ChevronLeft className="size-4" /></LinkButton>
          <div className="num min-w-[9.5rem] text-center text-[0.95rem] font-semibold">{shortDate(dates[0])} – {shortDate(dates[6])}</div>
          <LinkButton href={`/schedule?week=${nextWeek}`} variant="ghost" size="sm" aria-label="Next week" className="max-sm:size-10"><ChevronRight className="size-4" /></LinkButton>
          {data.monday !== thisWeek && <LinkButton href="/schedule" variant="ghost" size="sm">This week</LinkButton>}
          <span className="ml-1 hidden text-sm text-muted sm:inline">
            {shifts.length === 0 ? "No shifts yet" : drafts ? <><span className="text-ink">{drafts} draft</span> · {shifts.length - drafts} published</> : "All published"}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LinkButton href="/schedule/requests" variant="ghost" size="sm" className="max-sm:h-10">
            <Inbox className="size-4" strokeWidth={1.75} /> Requests {data.pendingRequests > 0 && <Badge tone="warn">{data.pendingRequests}</Badge>}
          </LinkButton>
          {!pastWeek && (
            <>
              <Button size="sm" variant="ghost" className="hidden md:inline-flex" disabled={busy} onClick={() => start(async () => { const r = await copyPreviousWeek(data.monday); showToast(r.error ?? `Copied ${r.created} shifts from last week as drafts.`); })}>
                <CopyPlus className="size-4" strokeWidth={1.75} /> Copy last week
              </Button>
              {drafts > 0 && (
                <Button size="sm" variant="ghost" className="hidden md:inline-flex" disabled={busy} onClick={async () => {
                  if (!(await confirm({ title: `Delete ${drafts} draft shift${drafts === 1 ? "" : "s"}?`, body: "Published shifts stay.", confirmLabel: "Delete drafts", danger: true }))) return;
                  start(async () => { const r = await clearDraftShifts(data.monday); showToast(r.error ?? `Removed ${r.removed} drafts.`); });
                }}>
                  <Eraser className="size-4" strokeWidth={1.75} /> Clear drafts
                </Button>
              )}
              <Button size="sm" className="max-sm:h-10" onClick={() => setGenerating(true)} disabled={positions.length === 0}>
                <Sparkles className="size-4" strokeWidth={1.75} /> Generate
              </Button>
              <Button size="sm" variant="primary" className="max-sm:h-10" disabled={busy || drafts === 0} onClick={publish}>
                <Send className="size-3.5" /> {drafts ? `Publish ${drafts}` : "Published"}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* KPI strip */}
      <div className="mb-6 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Kpi label="Forecast sales" value={money(summary.sales, { whole: true })} hint="this week" />
        <Kpi label="Scheduled labor" value={money(summary.cost, { whole: true })} hint={summary.overtimeHours > 0 ? `incl. ${fmtH(summary.overtimeHours)} overtime` : summary.callInHours > 0 ? `incl. ${fmtH(summary.callInHours)} call-in pay` : "wages + employer taxes"} />
        <Kpi
          label="Labor %"
          value={pct(summary.laborPct)}
          tone={data.laborTarget != null && summary.laborPct != null ? (summary.laborPct > data.laborTarget + 0.0005 ? "text-bad" : "text-good") : laborTone(summary.laborPct)}
          hint={data.laborTarget != null ? `budget ${pct(data.laborTarget)}` : "of forecast sales"}
        />
        <Kpi label="Hours" value={<>{fmtH(summary.hours)}<span className="text-base font-normal text-muted"> / {fmtH(summary.requiredHours)}</span></>} hint={summary.openShifts ? `${summary.openShifts} open shift${summary.openShifts === 1 ? "" : "s"}` : "scheduled / needed"} />
      </div>

      {positions.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted">Add positions and people on the Team page, then come back to build the schedule.</Card>
      ) : (
        <>
          {/* Desktop week grid */}
          <Card className="hidden overflow-x-auto md:block">
            <div className="grid min-w-[860px] select-none" style={{ gridTemplateColumns: "164px repeat(7, minmax(0, 1fr))" }}>
              <div className="flex items-end border-b border-border px-3 py-2 text-[11px] text-muted">
                <div>
                  <div>Sales · labor</div>
                  <div className="mt-1">Hours / needed</div>
                </div>
              </div>
              {dates.map(dayHeader)}

              <RowHead title="Open shifts" sub={`${shifts.filter((s) => !s.employeeId).length} to fill`} tone={shifts.some((s) => !s.employeeId) ? "warn" : undefined} />
              {dates.map((d) => cell(OPEN, d, null))}

              {rows.map((e) => {
                const h = hoursBy.get(e.id) ?? 0;
                const over = e.maxHoursWeek != null && h > e.maxHoursWeek;
                return (
                  <div key={e.id} className="contents">
                    <div className="flex min-w-0 items-center gap-2 border-b border-border px-3 py-2">
                      <div className="flex shrink-0 flex-col gap-0.5">
                        {e.positionIds.slice(0, 3).map((pid) => <span key={pid} className="size-1.5 rounded-full" style={{ background: posMap.get(pid)?.color }} />)}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{e.name}{e.isMinor && <span className="ml-1 text-[11px] font-normal text-muted">minor</span>}</div>
                        <div className={cx("num text-[11px]", over ? "text-warn" : h > data.rules.weeklyOvertimeHours ? "text-bad" : "text-muted")}>
                          {fmtH(h)}{e.maxHoursWeek ? ` / ${e.maxHoursWeek}h max` : ""}
                        </div>
                      </div>
                    </div>
                    {dates.map((d) => cell(e.id, d, e.id))}
                  </div>
                );
              })}
            </div>
          </Card>
          <div className="mt-2 hidden items-center gap-4 text-xs text-muted md:flex">
            {positions.map((p) => <span key={p.id} className="flex items-center gap-1.5"><span className="size-2 rounded-sm" style={{ background: p.color }} />{p.name}</span>)}
            <span className="ml-auto flex items-center gap-1.5"><span className="inline-block h-3 w-5 rounded-sm outline-1 -outline-offset-1 outline-border-strong outline-dashed" /> Draft</span>
            <span>Drag a shift to move it</span>
          </div>

          {/* Phone: one day at a time */}
          <div className="md:hidden">
            <div className="grid grid-cols-7 gap-1" role="tablist" aria-label="Day">
              {dates.map((d, i) => {
                const n = issues.filter((x) => shifts.find((s) => s.id === x.shiftId)?.date === d).length;
                return (
                  <button
                    key={d}
                    role="tab"
                    aria-selected={i === dayIdx}
                    onClick={() => setDayIdx(i)}
                    className={cx("relative flex h-14 flex-col items-center justify-center rounded-lg text-xs transition-colors", i === dayIdx ? "bg-primary text-primary-ink" : "text-ink-2 hover:bg-surface-2", !opening[weekday(d)] && i !== dayIdx && "text-muted")}
                  >
                    <span>{DOW[weekday(d)].slice(0, 2)}</span>
                    <span className="num text-sm font-semibold">{Number(d.slice(8))}</span>
                    {n > 0 && <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-warn" />}
                  </button>
                );
              })}
            </div>
            <div
              className="mt-3"
              onTouchStart={(e) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
              onTouchEnd={(e) => {
                const t = touch.current;
                touch.current = null;
                if (!t) return;
                const dx = e.changedTouches[0].clientX - t.x;
                const dy = e.changedTouches[0].clientY - t.y;
                if (Math.abs(dx) > 60 && Math.abs(dy) < 50) setDayIdx((i) => Math.max(0, Math.min(6, i + (dx < 0 ? 1 : -1))));
              }}
            >
              {(() => {
                const d = summary.days[dayIdx];
                return (
                  <Card className="mb-3 px-4 py-3">
                    <div className="flex items-baseline justify-between">
                      <div className="text-sm font-semibold">{dayDate(day)}</div>
                      {!opening[weekday(day)] ? <span className="text-xs text-muted">Closed</span> : <span className={cx("num text-sm", laborTone(d.laborPct))}>{pct(d.laborPct)} labor</span>}
                    </div>
                    <div className="num mt-1 flex justify-between text-xs text-muted">
                      <span>{money(d.sales, { whole: true })} forecast</span>
                      <span>{money(d.cost, { whole: true })} labor</span>
                    </div>
                    <HoursBar hours={d.hours} required={d.requiredHours} max={Math.max(d.hours, d.requiredHours, 1)} short={d.requiredHours > 0 && d.hours < d.requiredHours * 0.9} />
                  </Card>
                );
              })()}
              <div className="flex flex-col gap-2">
                {dayShifts.length === 0 && <Card className="px-4 py-8 text-center text-sm text-muted">No shifts on {DOW[weekday(day)]}.</Card>}
                {dayShifts.map((s) => {
                  const p = posMap.get(s.positionId);
                  const iss = issuesBy.get(s.id) ?? [];
                  return (
                    <button
                      key={s.id}
                      data-shift-id={s.id}
                      onClick={(e) => setEditing({ id: s.id, anchor: e.currentTarget })}
                      className={cx("flex min-h-14 items-center gap-3 rounded-xl border bg-surface px-3 py-2.5 text-left", s.published ? "border-border" : "border-dashed border-border-strong")}
                    >
                      <span className="h-9 w-1 shrink-0 rounded-full" style={{ background: p?.color }} />
                      <span className="min-w-0 flex-1">
                        <span className={cx("block truncate text-sm font-medium", !s.employeeId && "text-warn")}>{s.employeeId ? empName.get(s.employeeId) : "Open shift"}</span>
                        <span className="block truncate text-xs text-muted">{p?.name}{!s.published && " · draft"}{iss[0] && <span className={iss.some((i) => i.level === "block") ? "text-bad" : "text-warn"}> · {iss[0].message}</span>}</span>
                      </span>
                      <span className="num shrink-0 text-right text-sm">
                        {shiftLabel(s.startMin, s.endMin)}
                        <span className="block text-xs text-muted">{fmtH(shiftPaidHours(s))}</span>
                      </span>
                    </button>
                  );
                })}
                {!pastWeek && (
                  <Button className="h-11" variant="secondary" disabled={busy} onClick={() => quickAdd(null, day)}>
                    <Plus className="size-4" /> Add shift
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Staff vs demand */}
          <section className="mt-8">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-[0.95rem] font-semibold">Staff vs demand</h2>
                <p className="mt-0.5 text-sm text-muted">People on shift each hour against what the forecast needs at the standard staffing level.</p>
              </div>
              <div className="hidden gap-1 md:flex" role="tablist" aria-label="Day for staff vs demand">
                {dates.map((d, i) => (
                  <button key={d} role="tab" aria-selected={i === dayIdx} onClick={() => setDayIdx(i)} className={cx("h-8 rounded-md px-2.5 text-xs", i === dayIdx ? "bg-primary text-primary-ink" : "text-ink-2 hover:bg-surface-2")}>
                    {DOW[weekday(d)]} {Number(d.slice(8))}
                  </button>
                ))}
              </div>
            </div>
            <Card>
              <div className="px-4 pt-3 text-sm font-medium md:hidden">{dayDate(day)}</div>
              <DemandChart rows={data.demand[day] ?? []} />
            </Card>
          </section>

          {/* Compliance */}
          <section className="mt-8">
            <div className="mb-3 flex items-end justify-between gap-4">
              <div>
                <h2 className="text-[0.95rem] font-semibold">Compliance</h2>
                <p className="mt-0.5 text-sm text-muted">Checked against your labor rules (New York defaults): meal breaks, minimum wage, rest, overtime, minors, call-in pay, time off and availability. Turn rules on or off in Settings.</p>
              </div>
              {issues.length > 0 && (
                <div className="flex shrink-0 gap-1.5">
                  {blocks.length > 0 && <Badge tone="bad">{blocks.length} must fix</Badge>}
                  {issues.length - blocks.length > 0 && <Badge tone="warn">{issues.length - blocks.length} to check</Badge>}
                </div>
              )}
            </div>
            {issues.length === 0 ? (
              <Card className="px-4 py-5 text-sm text-muted">{shifts.length ? "No problems found this week." : "Nothing to check yet."}</Card>
            ) : (
              <Card className="divide-y divide-border">
                {[...issues].sort((a, b) => Number(b.level === "block") - Number(a.level === "block")).map((i, n) => {
                  const s = shifts.find((x) => x.id === i.shiftId);
                  return (
                    <button
                      key={n}
                      className="flex w-full items-start gap-3 px-4 py-3 text-left text-sm hover:bg-surface-2/60"
                      onClick={() => {
                        if (!s) return;
                        setDayIdx(dates.indexOf(s.date));
                        const el = Array.from(document.querySelectorAll<HTMLElement>(`[data-shift-id="${s.id}"]`)).find((x) => x.offsetParent);
                        el?.scrollIntoView({ block: "center", behavior: "smooth" });
                        setEditing({ id: s.id, anchor: el ?? null });
                      }}
                    >
                      <Badge tone={i.level === "block" ? "bad" : "warn"} className="mt-px w-[4.6rem] justify-center">{i.level === "block" ? "Must fix" : "Check"}</Badge>
                      <span className="min-w-0 flex-1">
                        <span className="block text-ink">{i.message}</span>
                        {s && <span className="num block text-xs text-muted">{s.employeeId ? empName.get(s.employeeId) : "Open shift"} · {dayDate(s.date)} · {shiftLabel(s.startMin, s.endMin)}</span>}
                      </span>
                    </button>
                  );
                })}
              </Card>
            )}
          </section>

          <section className="mt-8">
            <h2 className="mb-3 text-[0.95rem] font-semibold">Availability this week</h2>
            <Card className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[0.75rem] text-muted">
                    <th className="border-b border-border px-4 py-2 text-left font-medium">Person</th>
                    {dates.map((d) => <th key={d} className="hidden border-b border-border px-2 py-2 text-left font-medium sm:table-cell">{DOW[weekday(d)]}</th>)}
                    <th className="border-b border-border px-4 py-2 text-left font-medium sm:hidden">{DOW[weekday(day)]}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => (
                    <tr key={e.id} className="[&:last-child>td]:border-b-0">
                      <td className="border-b border-border px-4 py-2 font-medium whitespace-nowrap">{e.name}</td>
                      {dates.map((d) => (
                        <td key={d} className={cx("num hidden border-b border-border px-2 py-2 text-xs whitespace-nowrap sm:table-cell", timeOff[e.id]?.includes(d) ? "text-bad" : "text-muted")}>
                          {timeOff[e.id]?.includes(d) ? "Time off" : availabilityLabel(e.availability, weekday(d))}
                        </td>
                      ))}
                      <td className="num border-b border-border px-4 py-2 text-xs text-muted sm:hidden">{timeOff[e.id]?.includes(day) ? "Time off" : availabilityLabel(e.availability, weekday(day))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </section>
        </>
      )}

      {ghost && (
        <div className="pointer-events-none fixed z-50 rounded-md bg-surface px-2 py-1 text-xs font-medium shadow-xl ring-1 ring-border" style={{ left: ghost.x + 8, top: ghost.y + 8, width: Math.max(110, ghost.w) }}>
          {(() => {
            const s = shifts.find((x) => x.id === ghost.id);
            return s ? <><span className="num">{shiftLabel(s.startMin, s.endMin)}</span> <span className="text-muted">· {posMap.get(s.positionId)?.name}</span></> : null;
          })()}
        </div>
      )}

      {editing && editingShift && (
        <ShiftEditor
          key={editing.id}
          shift={editingShift}
          anchor={editing.anchor}
          employees={employees}
          positions={positions}
          issues={issues}
          hoursByEmployee={hoursBy}
          timeOff={timeOff}
          onClose={() => setEditing(null)}
          onToast={showToast}
        />
      )}
      {generating && <GeneratePanel monday={data.monday} positions={positions} laborTarget={data.laborTarget} autoDraft={data.autoDraft} onClose={() => setGenerating(false)} onDone={showToast} />}
      {toast && (
        <div role="status" className="fixed inset-x-0 bottom-4 z-[80] flex justify-center px-4 pb-[env(safe-area-inset-bottom)]">
          <div className="rounded-xl bg-primary px-4 py-2.5 text-sm text-primary-ink shadow-xl">{toast}</div>
        </div>
      )}
    </>
  );
}

const laborTone = (p: number | null) => (p == null ? "text-muted" : p > 0.35 ? "text-bad" : p > 0.3 ? "text-warn" : "text-ink-2");

function Kpi({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: string; tone?: string }) {
  return (
    <Card className="px-4 py-3">
      <div className="text-[0.75rem] font-medium text-muted">{label}</div>
      <div className={cx("num mt-1 text-xl font-semibold tracking-tight", tone)}>{value}</div>
      {hint && <div className="mt-0.5 truncate text-[0.72rem] text-muted">{hint}</div>}
    </Card>
  );
}

function RowHead({ title, sub, tone }: { title: string; sub: string; tone?: "warn" }) {
  return (
    <div className="flex items-center border-b border-border bg-surface-2/40 px-3 py-2">
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className={cx("text-[11px]", tone === "warn" ? "text-warn" : "text-muted")}>{sub}</div>
      </div>
    </div>
  );
}

/** Staffed person-hours vs required, as a small bar with a tick at "needed". */
function HoursBar({ hours, required, max, short }: { hours: number; required: number; max: number; short: boolean }) {
  return (
    <div className="mt-1.5" aria-label={`${fmtH(hours)} scheduled, ${fmtH(required)} needed`}>
      <div className="relative h-1.5 rounded-full bg-surface-2">
        <div className={cx("h-full rounded-full", short ? "bg-warn" : "bg-ink-2")} style={{ width: `${Math.min(100, (hours / max) * 100)}%` }} />
        {required > 0 && <div className="absolute -top-0.5 h-2.5 w-0.5 rounded-full bg-ink" style={{ left: `calc(${Math.min(100, (required / max) * 100)}% - 1px)` }} />}
      </div>
      <div className="num mt-0.5 text-[10.5px] text-muted">{fmtH(hours)} / {fmtH(required)}</div>
    </div>
  );
}
