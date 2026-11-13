"use client";

import { Badge, Button, Card, cx, DatePicker, Input, Select } from "@/components/ui";
import { shiftLabel } from "@/domain/schedule";
import { dayDate, shortDate } from "@/lib/format";
import { ArrowLeftRight, CalendarOff, Hand } from "lucide-react";
import { useState, useTransition } from "react";
import { cancelSwap, cancelTimeOff, offerToTake, pickUpShift, requestSwap, requestTimeOff } from "./actions";

export interface MyShift {
  id: string;
  date: string;
  startMin: number;
  endMin: number;
  hours: number;
  position: string;
  positionId: string;
  color: string;
  notes: string | null;
}

interface Props {
  today: string;
  weekHours: number;
  mine: (MyShift & { swap: { id: string; taker: string | null } | null })[];
  open: MyShift[];
  board: (MyShift & { swapId: string; from: string })[];
  timeOff: { id: string; start: string; end: string; note: string | null; status: "PENDING" | "APPROVED" | "DENIED" }[];
  team: { id: string; name: string; positionIds: string[] }[];
}

const fmtH = (h: number) => `${Number(h.toFixed(1))}h`;

export function MyApp({ today, weekHours, mine, open, board, timeOff, team }: Props) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [swapFor, setSwapFor] = useState<string | null>(null);
  const [taker, setTaker] = useState("");
  const [off, setOff] = useState({ start: "", end: "", note: "" });

  const run = (fn: () => Promise<{ error?: string; ok?: string }>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      setMsg(r.error ? { text: r.error, bad: true } : { text: r.ok ?? "Done" });
      if (!r.error) after?.();
    });

  return (
    <div className="flex flex-col gap-10">
      {msg && (
        <div role="status" className={cx("-mb-4 rounded-xl px-4 py-3 text-sm", msg.bad ? "bg-bad-bg text-bad" : "bg-good-bg text-good")}>{msg.text}</div>
      )}

      <section>
        <div className="mb-3 flex items-end justify-between">
          <h2 className="text-[0.95rem] font-semibold">Coming up</h2>
          <span className="num text-sm text-muted">{fmtH(weekHours)} this week</span>
        </div>
        {mine.length === 0 ? (
          <Card className="px-4 py-6 text-center text-sm text-muted">No upcoming shifts published yet.</Card>
        ) : (
          <Card className="divide-y divide-border">
            {mine.map((s) => (
              <div key={s.id} className="px-4 py-3">
                <ShiftRow s={s} today={today}>
                  {s.swap ? (
                    <Badge tone="warn">{s.swap.taker ? `Swap to ${s.swap.taker.split(" ")[0]} pending` : "Up for grabs"}</Badge>
                  ) : (
                    <Button variant="ghost" size="sm" className="max-sm:h-10" onClick={() => { setSwapFor(swapFor === s.id ? null : s.id); setTaker(""); }}>
                      <ArrowLeftRight className="size-3.5" /> Swap
                    </Button>
                  )}
                </ShiftRow>
                {s.swap && (
                  <div className="mt-2 flex justify-end">
                    <Button variant="ghost" size="sm" className="max-sm:h-10" disabled={pending} onClick={() => run(() => cancelSwap(s.swap!.id))}>Cancel swap</Button>
                  </div>
                )}
                {swapFor === s.id && (
                  <div className="mt-3 flex flex-col gap-2 rounded-lg bg-surface-2/60 p-3 sm:flex-row sm:items-center">
                    <div className="flex-1">
                      <Select
                        aria-label="Who takes it"
                        value={taker}
                        onChange={(e) => setTaker(e.target.value)}
                        options={[{ value: "", label: "Anyone who can cover" }, ...team.filter((t) => t.positionIds.includes(s.positionId)).map((t) => ({ value: t.id, label: t.name }))]}
                        className="max-sm:h-11"
                      />
                    </div>
                    <Button variant="primary" className="max-sm:h-11" disabled={pending} onClick={() => run(() => requestSwap(s.id, taker || null), () => setSwapFor(null))}>
                      Ask to swap
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </Card>
        )}
      </section>

      <section>
        <h2 className="mb-1 text-[0.95rem] font-semibold">Open shifts</h2>
        <p className="mb-3 text-sm text-muted">Shifts that need someone, for positions you work. First to tap gets it.</p>
        {open.length === 0 && board.length === 0 ? (
          <Card className="px-4 py-6 text-center text-sm text-muted">Nothing open right now.</Card>
        ) : (
          <Card className="divide-y divide-border">
            {open.map((s) => (
              <div key={s.id} className="px-4 py-3">
                <ShiftRow s={s} today={today}>
                  <Button variant="primary" size="sm" className="max-sm:h-10" disabled={pending} onClick={() => run(() => pickUpShift(s.id))}>
                    <Hand className="size-3.5" /> Pick up
                  </Button>
                </ShiftRow>
              </div>
            ))}
            {board.map((s) => (
              <div key={s.swapId} className="px-4 py-3">
                <ShiftRow s={s} today={today} sub={`${s.from} wants to give this away`}>
                  <Button size="sm" className="max-sm:h-10" disabled={pending} onClick={() => run(() => offerToTake(s.swapId))}>
                    Offer to take
                  </Button>
                </ShiftRow>
              </div>
            ))}
          </Card>
        )}
      </section>

      <section>
        <h2 className="mb-1 text-[0.95rem] font-semibold">Time off</h2>
        <p className="mb-3 text-sm text-muted">Ask early — your manager approves it before the schedule is built.</p>
        <Card className="p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className="mb-1.5 text-[0.8rem] font-medium text-ink-2">First day off</div>
              <DatePicker aria-label="First day off" value={off.start} min={today} className="max-sm:h-11" onChange={(e) => setOff((o) => ({ ...o, start: e.target.value, end: o.end && o.end >= e.target.value ? o.end : e.target.value }))} />
            </div>
            <div>
              <div className="mb-1.5 text-[0.8rem] font-medium text-ink-2">Last day off</div>
              <DatePicker aria-label="Last day off" value={off.end} min={off.start || today} className="max-sm:h-11" onChange={(e) => setOff((o) => ({ ...o, end: e.target.value }))} />
            </div>
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Input aria-label="Reason" placeholder="Reason (optional)" value={off.note} onChange={(e) => setOff((o) => ({ ...o, note: e.target.value }))} className="max-sm:h-11" />
            <Button variant="primary" className="shrink-0 max-sm:h-11" disabled={pending || !off.start} onClick={() => run(() => requestTimeOff({ start: off.start, end: off.end || off.start, note: off.note }), () => setOff({ start: "", end: "", note: "" }))}>
              <CalendarOff className="size-4" strokeWidth={1.75} /> Request time off
            </Button>
          </div>
        </Card>
        {timeOff.length > 0 && (
          <Card className="mt-3 divide-y divide-border">
            {timeOff.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <div className="font-medium">{t.start === t.end ? dayDate(t.start) : `${shortDate(t.start)} – ${shortDate(t.end)}`}</div>
                  {t.note && <div className="truncate text-xs text-muted">{t.note}</div>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge tone={t.status === "APPROVED" ? "good" : t.status === "DENIED" ? "bad" : "warn"}>{t.status === "APPROVED" ? "Approved" : t.status === "DENIED" ? "Denied" : "Waiting"}</Badge>
                  {t.status === "PENDING" && (
                    <Button variant="ghost" size="sm" className="max-sm:h-10" disabled={pending} onClick={() => run(() => cancelTimeOff(t.id))}>Withdraw</Button>
                  )}
                </div>
              </div>
            ))}
          </Card>
        )}
      </section>
    </div>
  );
}

function ShiftRow({ s, today, sub, children }: { s: MyShift; today: string; sub?: string; children?: React.ReactNode }) {
  const d = new Date(`${s.date}T00:00:00Z`);
  return (
    <div className="flex items-center gap-3">
      <div className={cx("flex w-12 shrink-0 flex-col items-center rounded-lg py-1.5", s.date === today ? "bg-primary text-primary-ink" : "bg-surface-2")}>
        <span className="text-[11px] uppercase">{d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })}</span>
        <span className="num text-base leading-tight font-semibold">{d.getUTCDate()}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="num text-sm font-medium">{shiftLabel(s.startMin, s.endMin)} <span className="font-normal text-muted">· {fmtH(s.hours)}</span></div>
        <div className="flex items-center gap-1.5 truncate text-xs text-muted">
          <span className="size-2 shrink-0 rounded-full" style={{ background: s.color }} />
          {s.position}{s.date === today && " · today"}{!sub && s.notes ? ` · ${s.notes}` : ""}
        </div>
        {sub && <div className="text-xs text-muted">{sub}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
