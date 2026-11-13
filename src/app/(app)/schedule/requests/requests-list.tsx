"use client";

import { Badge, Button, Card, cx, Select } from "@/components/ui";
import { dayDate, shortDate } from "@/lib/format";
import { Check, X } from "lucide-react";
import { useState, useTransition } from "react";
import { decideSwap, decideTimeOff } from "./actions";

type Status = "PENDING" | "APPROVED" | "DENIED";
interface Off { id: string; name: string; start: string; end: string; days: number; note: string | null; status: Status; clashes: string[] }
interface Swap { id: string; status: Status; requester: string; requesterId: string; taker: string | null; date: string; time: string; position: string; color: string; candidates: { value: string; label: string }[] }

const range = (s: string, e: string) => (s === e ? dayDate(s) : `${shortDate(s)} – ${shortDate(e)}`);
const statusBadge = (s: Status) => <Badge tone={s === "APPROVED" ? "good" : s === "DENIED" ? "bad" : "warn"}>{s === "APPROVED" ? "Approved" : s === "DENIED" ? "Denied" : "Pending"}</Badge>;

export function RequestsList({ timeOff, swaps, recentOff, recentSwaps }: { timeOff: Off[]; swaps: Swap[]; recentOff: Off[]; recentSwaps: Swap[] }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [pick, setPick] = useState<Record<string, string>>({});
  const run = (fn: () => Promise<{ error?: string; ok?: string }>) =>
    start(async () => {
      const r = await fn();
      setMsg(r.error ? { text: r.error, bad: true } : { text: r.ok ?? "Done" });
    });

  const decide = (onApprove: () => void, onDeny: () => void, canApprove = true) => (
    <div className="flex shrink-0 gap-1.5">
      <Button size="sm" variant="ghost" className="text-bad hover:bg-bad-bg max-sm:h-10" disabled={pending} onClick={onDeny} aria-label="Deny"><X className="size-4" /> Deny</Button>
      <Button size="sm" variant="primary" className="max-sm:h-10" disabled={pending || !canApprove} onClick={onApprove} aria-label="Approve"><Check className="size-4" /> Approve</Button>
    </div>
  );

  return (
    <div className="flex flex-col gap-10">
      {msg && <div role="status" className={cx("-mb-4 rounded-xl px-4 py-3 text-sm", msg.bad ? "bg-bad-bg text-bad" : "bg-good-bg text-good")}>{msg.text}</div>}

      <section>
        <h2 className="mb-3 text-[0.95rem] font-semibold">Time off <span className="num font-normal text-muted">{timeOff.length || ""}</span></h2>
        {timeOff.length === 0 ? <Card className="px-4 py-5 text-sm text-muted">No time-off requests waiting.</Card> : (
          <Card className="divide-y divide-border">
            {timeOff.map((r) => (
              <div key={r.id} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{r.name}</div>
                  <div className="num text-sm text-ink-2">{range(r.start, r.end)} <span className="text-muted">· {r.days} day{r.days === 1 ? "" : "s"}</span></div>
                  {r.note && <div className="text-xs text-muted">“{r.note}”</div>}
                  {r.clashes.length > 0 && (
                    <div className="mt-1 text-xs text-warn">Already scheduled: {r.clashes.map((c) => { const [d, t] = c.split("|"); return `${dayDate(d).split(",")[0]} ${t}`; }).join(", ")} — reassign after approving.</div>
                  )}
                </div>
                {decide(() => run(() => decideTimeOff(r.id, true)), () => run(() => decideTimeOff(r.id, false)))}
              </div>
            ))}
          </Card>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-[0.95rem] font-semibold">Shift swaps <span className="num font-normal text-muted">{swaps.length || ""}</span></h2>
        {swaps.length === 0 ? <Card className="px-4 py-5 text-sm text-muted">No swap requests waiting.</Card> : (
          <Card className="divide-y divide-border">
            {swaps.map((w) => {
              const chosen = w.taker ? null : pick[w.id] ?? "";
              return (
                <div key={w.id} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm"><span className="font-medium">{w.requester}</span> → <span className={cx("font-medium", !w.taker && "text-muted")}>{w.taker ?? "no one yet"}</span></div>
                    <div className="num flex items-center gap-1.5 text-sm text-ink-2">
                      <span className="size-2 rounded-full" style={{ background: w.color }} />{dayDate(w.date)} · {w.time} · {w.position}
                    </div>
                    {!w.taker && (
                      <div className="mt-2 max-w-64">
                        <Select aria-label="Give the shift to" placeholder="Give it to…" value={chosen ?? ""} options={w.candidates} onChange={(e) => setPick((p) => ({ ...p, [w.id]: e.target.value }))} className="max-sm:h-11" />
                      </div>
                    )}
                  </div>
                  {decide(() => run(() => decideSwap(w.id, true, chosen || null)), () => run(() => decideSwap(w.id, false)), !!w.taker || !!chosen)}
                </div>
              );
            })}
          </Card>
        )}
      </section>

      {(recentOff.length > 0 || recentSwaps.length > 0) && (
        <section>
          <h2 className="mb-3 text-[0.95rem] font-semibold">Recently handled</h2>
          <Card className="divide-y divide-border">
            {recentOff.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0 truncate"><span className="font-medium">{r.name}</span> <span className="text-muted">· time off · {range(r.start, r.end)}</span></span>
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
        </section>
      )}
    </div>
  );
}
