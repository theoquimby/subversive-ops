"use client";

import { HelpZone } from "@/components/help";
import { Badge, Button, Card, cx, Input, Select } from "@/components/ui";
import { coverageShort, DayCoverage } from "@/domain/schedule";
import { dayDate, shortDate } from "@/lib/format";
import { Check, X } from "lucide-react";
import { useState, useTransition } from "react";
import { decideSwap, decideTimeOff } from "./actions";

type Status = "PENDING" | "APPROVED" | "DENIED";
type LeaveType = "PTO" | "SICK" | "UNPAID";
interface Off {
  id: string;
  name: string;
  start: string;
  end: string;
  days: number;
  note: string | null;
  status: Status;
  type: LeaveType;
  hours: number | null;
  sickAvailable: number | null;
  clashes: { date: string; time: string; published: boolean }[];
  coverage: DayCoverage[];
}
interface Swap {
  id: string;
  status: Status;
  requester: string;
  requesterId: string;
  taker: string | null;
  takerId: string | null;
  date: string;
  time: string;
  position: string;
  color: string;
  candidates: { value: string; label: string; note: string | null }[];
}

const range = (s: string, e: string) => (s === e ? dayDate(s) : `${shortDate(s)} – ${shortDate(e)}`);
const statusBadge = (s: Status) => <Badge tone={s === "APPROVED" ? "good" : s === "DENIED" ? "bad" : "warn"}>{s === "APPROVED" ? "Approved" : s === "DENIED" ? "Denied" : "Pending"}</Badge>;
const TYPE_LABEL: Record<LeaveType, string> = { PTO: "PTO", SICK: "Sick", UNPAID: "Unpaid" };
const fmtH = (h: number) => `${Number(h.toFixed(1))}h`;

export function RequestsList({ timeOff, swaps, recentOff, recentSwaps }: { timeOff: Off[]; swaps: Swap[]; recentOff: Off[]; recentSwaps: Swap[] }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [openUp, setOpenUp] = useState<Record<string, boolean>>({});
  const [hours, setHours] = useState<Record<string, string>>({});
  const run = (fn: () => Promise<{ error?: string; ok?: string }>) =>
    start(async () => {
      const r = await fn();
      setMsg(r.error ? { text: r.error, bad: true } : { text: r.ok ?? "Done" });
    });

  const decide = (onApprove: () => void, onDeny: () => void, canApprove = true, approveLabel = "Approve") => (
    <div className="flex shrink-0 gap-1.5">
      <Button size="sm" variant="ghost" className="text-bad hover:bg-bad-bg max-sm:h-10" disabled={pending} onClick={onDeny} aria-label="Deny"><X className="size-4" /> Deny</Button>
      <Button size="sm" variant="primary" className="max-sm:h-10" disabled={pending || !canApprove} onClick={onApprove} aria-label="Approve"><Check className="size-4" /> {approveLabel}</Button>
    </div>
  );

  return (
    <div className="flex flex-col gap-10">
      {msg && <div role="status" className={cx("-mb-4 rounded-xl px-4 py-3 text-sm", msg.bad ? "bg-bad-bg text-bad" : "bg-good-bg text-good")}>{msg.text}</div>}

      <HelpZone id="schedule.requests.timeOff"><section>
        <h2 className="mb-3 text-[0.95rem] font-semibold">Time off <span className="num font-normal text-muted">{timeOff.length || ""}</span></h2>
        {timeOff.length === 0 ? <Card className="px-4 py-5 text-sm text-muted">No time-off requests waiting.</Card> : (
          <Card className="divide-y divide-border">
            {timeOff.map((r) => {
              const open = openUp[r.id] ?? r.clashes.length > 0;
              const h = hours[r.id] ?? (r.hours != null ? String(r.hours) : "");
              const short = r.coverage.filter(coverageShort);
              return (
                <div key={r.id} className="px-4 py-3.5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm font-medium">{r.name} <Badge tone={r.type === "SICK" ? "warn" : "neutral"}>{TYPE_LABEL[r.type]}</Badge></div>
                      <div className="num text-sm text-ink-2">{range(r.start, r.end)} <span className="text-muted">· {r.days} day{r.days === 1 ? "" : "s"}</span></div>
                      {r.note && <div className="text-xs text-muted">“{r.note}”</div>}
                      {r.type === "SICK" && r.sickAvailable != null && (
                        <div className={cx("mt-0.5 text-xs", r.hours != null && r.hours > r.sickAvailable ? "text-warn" : "text-muted")}>
                          {fmtH(r.sickAvailable)} paid sick leave available{r.hours != null && r.hours > r.sickAvailable ? `: ${fmtH(r.hours - r.sickAvailable)} short` : ""}
                        </div>
                      )}
                    </div>
                    {decide(
                      () => run(() => decideTimeOff(r.id, true, { openShifts: open, hours: r.type !== "UNPAID" && h.trim() ? Number(h) : null })),
                      () => run(() => decideTimeOff(r.id, false)),
                    )}
                  </div>

                  {r.coverage.length > 0 && (
                    <div className="mt-3 overflow-hidden rounded-lg border border-border">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-muted">
                            <th className="border-b border-border px-2.5 py-1.5 text-left font-medium">Day</th>
                            <th className="border-b border-border px-2.5 py-1.5 text-right font-medium">Scheduled / needed</th>
                            <th className="border-b border-border px-2.5 py-1.5 text-left font-medium">Also off</th>
                          </tr>
                        </thead>
                        <tbody>
                          {r.coverage.map((d) => (
                            <tr key={d.date} className="[&:last-child>td]:border-b-0">
                              <td className="border-b border-border px-2.5 py-1.5 whitespace-nowrap">{dayDate(d.date)}</td>
                              <td className={cx("num border-b border-border px-2.5 py-1.5 text-right whitespace-nowrap", coverageShort(d) ? "text-warn" : "text-ink-2")}>
                                {d.scheduledHours === 0 ? <span className="text-muted">Not scheduled yet · {fmtH(d.neededHours)} needed</span> : <>{fmtH(d.scheduledHours - (open ? d.theirHours : 0))} / {fmtH(d.neededHours)}</>}
                                {open && d.theirHours > 0 && <span className="text-muted"> (−{fmtH(d.theirHours)})</span>}
                              </td>
                              <td className="border-b border-border px-2.5 py-1.5 text-ink-2">
                                {[...d.off, ...d.asking.map((n) => `${n} (asked)`)].join(", ") || <span className="text-muted">Nobody</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {short.length > 0 && <div className="mt-1.5 text-xs text-warn">Short on {short.map((d) => dayDate(d.date).split(",")[0]).join(", ")} if approved. Fill the open shifts or ask someone to pick them up.</div>}

                  {(r.clashes.length > 0 || r.type !== "UNPAID") && (
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      {r.clashes.length > 0 ? (
                        <button type="button" role="switch" aria-checked={open} onClick={() => setOpenUp((o) => ({ ...o, [r.id]: !open }))} className="flex min-h-10 items-center gap-2 text-left text-sm sm:min-h-0">
                          <span className={cx("relative inline-block h-5 w-9 shrink-0 rounded-full transition-colors", open ? "bg-ink" : "bg-border-strong")}>
                            <span className={cx("absolute top-0.5 size-4 rounded-full bg-surface shadow transition-all", open ? "left-[1.125rem]" : "left-0.5")} />
                          </span>
                          <span>
                            Open up their {r.clashes.length} shift{r.clashes.length === 1 ? "" : "s"} on approval
                            <span className="block text-xs text-muted">{r.clashes.map((c) => `${dayDate(c.date).split(",")[0]} ${c.time}`).join(", ")}</span>
                          </span>
                        </button>
                      ) : <span />}
                      {r.type !== "UNPAID" && (
                        <label className="flex items-center gap-2 text-sm">
                          <span className="text-muted">Paid hours</span>
                          <Input aria-label="Paid hours" inputMode="decimal" value={h} onChange={(e) => setHours((x) => ({ ...x, [r.id]: e.target.value }))} placeholder="0" className="num w-20 text-right" />
                        </label>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </Card>
        )}
      </section></HelpZone>

      <HelpZone id="schedule.requests.swaps"><section>
        <h2 className="mb-3 text-[0.95rem] font-semibold">Shift swaps <span className="num font-normal text-muted">{swaps.length || ""}</span></h2>
        {swaps.length === 0 ? <Card className="px-4 py-5 text-sm text-muted">No swap requests waiting.</Card> : (
          <Card className="divide-y divide-border">
            {swaps.map((w) => {
              const chosen = w.taker ? null : pick[w.id] ?? "";
              const impact = w.candidates.find((c) => c.value === (w.takerId ?? chosen));
              return (
                <div key={w.id} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm"><span className="font-medium">{w.requester}</span> → <span className={cx("font-medium", !w.taker && "text-muted")}>{w.taker ?? "no one yet"}</span></div>
                    <div className="num flex items-center gap-1.5 text-sm text-ink-2">
                      <span className="size-2 rounded-full" style={{ background: w.color }} />{dayDate(w.date)} · {w.time} · {w.position}
                    </div>
                    {!w.taker && (
                      <div className="mt-2 max-w-72">
                        <Select aria-label="Give the shift to" placeholder="Give it to…" value={chosen ?? ""} options={w.candidates} onChange={(e) => setPick((p) => ({ ...p, [w.id]: e.target.value }))} className="max-sm:h-11" />
                      </div>
                    )}
                    {impact && <div className={cx("mt-1 text-xs", impact.note ? "text-warn" : "text-muted")}>{impact.label.split(" · ")[1] ?? ""}{impact.note ? ` · ${impact.note}` : " · no clashes"}</div>}
                  </div>
                  {decide(() => run(() => decideSwap(w.id, true, chosen || null)), () => run(() => decideSwap(w.id, false)), !!w.taker || !!chosen)}
                </div>
              );
            })}
          </Card>
        )}
      </section></HelpZone>

      {(recentOff.length > 0 || recentSwaps.length > 0) && (
        <HelpZone id="schedule.requests.recent"><section>
          <h2 className="mb-3 text-[0.95rem] font-semibold">Recently handled</h2>
          <Card className="divide-y divide-border">
            {recentOff.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0 truncate"><span className="font-medium">{r.name}</span> <span className="text-muted">· {TYPE_LABEL[r.type].toLowerCase()} time off · {range(r.start, r.end)}{r.hours != null ? ` · ${fmtH(r.hours)}` : ""}</span></span>
                {statusBadge(r.status)}
              </div>
            ))}
            {recentSwaps.map((w) => (
              <div key={w.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0 truncate"><span className="font-medium">{w.requester}</span> <span className="text-muted">→ {w.taker ?? "—"} · {dayDate(w.date)} {w.time}</span></span>
                {statusBadge(w.status)}
              </div>
            ))}
          </Card>
        </section></HelpZone>
      )}
    </div>
  );
}
