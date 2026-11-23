"use client";

import { GridCell } from "@/components/grid";
import { HelpZone } from "@/components/help";
import { Badge, Button, Card, cx, DatePicker, Input } from "@/components/ui";
import type { SickBalance } from "@/domain/sickLeave";
import { formatWindows, toMinutes } from "@/domain/timecards";
import { dayDate, shortDate } from "@/lib/format";
import { CalendarClock, CalendarOff, Thermometer } from "lucide-react";
import { useToast } from "@/components/toast";
import { useEffect, useState, useTransition } from "react";
import { cancelTimeOff, requestTimeOff, resetMyAvailability, setMyAvailability } from "./actions";


interface Props {
  today: string;
  timeOff: { id: string; start: string; end: string; note: string | null; status: "PENDING" | "APPROVED" | "DENIED"; type: LeaveType; hours: number | null }[];
  sick: SickBalance | null;
  availability: Record<string, [string, string][]> | null;
  openingHours: Record<number, [number, number]>;
}

type LeaveType = "PTO" | "SICK" | "UNPAID";
const LEAVE_TYPES = [
  { value: "UNPAID", short: "Day off", label: "Unpaid. Ask early so it's on the next schedule." },
  { value: "SICK", short: "Sick", label: "Paid from your sick leave. Fine to log for today." },
  { value: "PTO", short: "Paid off", label: "Paid time off." },
];
const LEAVE_LABEL: Record<LeaveType, string> = { UNPAID: "Day off", SICK: "Sick", PTO: "PTO" };


export function MyApp({ today, timeOff, sick, availability, openingHours }: Props) {
  const [pending, start] = useTransition();
  const [toast, show] = useToast();
  // Rows hidden the moment they're tapped (picked up, offered, withdrawn); put back if the server says no.
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [offOpen, setOffOpen] = useState(false);
  const [off, setOff] = useState<{ start: string; end: string; note: string; type: LeaveType; hours: string }>({ start: "", end: "", note: "", type: "UNPAID", hours: "" });

  const run = (fn: () => Promise<{ error?: string; ok?: string }>, opts: { hide?: string; after?: () => void } = {}) => {
    const { hide, after } = opts;
    if (hide) setGone((g) => new Set(g).add(hide));
    start(async () => {
      const r = await fn().catch(() => ({ error: "No signal, so that didn't go through. Try again in a moment." }) as { error?: string; ok?: string });
      if (r.error) {
        if (hide) setGone((g) => { const n = new Set(g); n.delete(hide); return n; });
        show(r.error, "bad");
      } else {
        show(r.ok ?? "Done");
        after?.();
      }
    });
  };
  // "/my/shifts#sick" (command bar, Today) opens the form ready to log sick time for today.
  useEffect(() => {
    if (window.location.hash !== "#sick") return;
    setOff((o) => ({ ...o, type: "SICK", start: today, end: today }));
    setOffOpen(true);
    requestAnimationFrame(() => document.getElementById("time-off")?.scrollIntoView({ block: "start" }));
  }, [today]);

  return (
    <div className="flex flex-col gap-10">
      {toast}

      <HelpZone id="my.timeOff" tour="my.time-off"><section id="time-off" className="scroll-mt-20">
        <h2 className="mb-1 text-[0.95rem] font-semibold">Time off</h2>
        <p className="mb-3 text-sm text-muted">Ask early so your manager can approve it before the schedule is built. Out sick? Log it here, even for today.</p>
        {sick && (
          <Card className="mb-3 flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">Paid sick leave</div>
              <div className="text-xs text-muted">{sick.accrued.toFixed(1)}h earned this year from {Math.round(sick.workedHours)}h worked · {sick.used.toFixed(1)}h used</div>
            </div>
            <div className="num shrink-0 text-right text-xl font-semibold">{sick.available.toFixed(1)}h<span className="block text-[11px] font-normal text-muted">available</span></div>
          </Card>
        )}
        {!offOpen ? (
          <div className="grid grid-cols-2 gap-2.5">
            <Button size="lg" className="h-14 rounded-xl text-[0.95rem]" onClick={() => { setOff((o) => ({ ...o, type: "UNPAID" })); setOffOpen(true); }}>
              <CalendarOff className="size-4" strokeWidth={1.75} aria-hidden /> Ask for time off
            </Button>
            <Button size="lg" className="h-14 rounded-xl text-[0.95rem]" onClick={() => { setOff((o) => ({ ...o, type: "SICK", start: o.start || today, end: o.end || today })); setOffOpen(true); }}>
              <Thermometer className="size-4" strokeWidth={1.75} aria-hidden /> I&apos;m out sick
            </Button>
          </div>
        ) : (
        <Card className="animate-rise-in p-4 motion-reduce:animate-none">
          <div className="mb-3 grid gap-3 sm:grid-cols-[1fr_8rem]">
            <div>
              <div id="leave-type" className="mb-1.5 text-[0.8rem] font-medium text-ink-2">Type</div>
              <div role="radiogroup" aria-labelledby="leave-type" className="grid grid-cols-3 gap-1 rounded-xl bg-surface-2 p-1">
                {LEAVE_TYPES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    role="radio"
                    aria-checked={off.type === t.value}
                    onClick={() => setOff((o) => ({ ...o, type: t.value as LeaveType }))}
                    className={cx("h-11 rounded-lg px-1 text-sm transition-[background-color,color,box-shadow] duration-120 sm:h-9", off.type === t.value ? "bg-surface font-medium text-ink shadow-sm" : "text-ink-2 active:bg-surface/60")}
                  >
                    {t.short}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-muted">{LEAVE_TYPES.find((t) => t.value === off.type)?.label}</p>
            </div>
            {off.type !== "UNPAID" && (
              <div>
                <div className="mb-1.5 text-[0.8rem] font-medium text-ink-2">Hours</div>
                <Input aria-label="Paid hours" inputMode="decimal" placeholder="Scheduled" value={off.hours} onChange={(e) => setOff((o) => ({ ...o, hours: e.target.value }))} className="num max-sm:h-12" />
              </div>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className="mb-1.5 text-[0.8rem] font-medium text-ink-2">First day off</div>
              <DatePicker aria-label="First day off" value={off.start} min={off.type === "SICK" ? `${today.slice(0, 8)}01` : today} className="max-sm:h-12" onChange={(e) => setOff((o) => ({ ...o, start: e.target.value, end: o.end && o.end >= e.target.value ? o.end : e.target.value }))} />
            </div>
            <div>
              <div className="mb-1.5 text-[0.8rem] font-medium text-ink-2">Last day off</div>
              <DatePicker aria-label="Last day off" value={off.end} min={off.start || (off.type === "SICK" ? `${today.slice(0, 8)}01` : today)} className="max-sm:h-12" onChange={(e) => setOff((o) => ({ ...o, end: e.target.value }))} />
            </div>
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Input aria-label="Reason" placeholder="Reason (optional)" value={off.note} onChange={(e) => setOff((o) => ({ ...o, note: e.target.value }))} className="max-sm:h-12" />
            <Button variant="ghost" className="shrink-0 max-sm:order-last max-sm:h-11" onClick={() => setOffOpen(false)}>Cancel</Button>
            <Button variant="primary" className="shrink-0 max-sm:h-12" disabled={pending || !off.start} onClick={() => run(() => requestTimeOff({ start: off.start, end: off.end || off.start, note: off.note, type: off.type, hours: off.hours }), { after: () => { setOff({ start: "", end: "", note: "", type: "UNPAID", hours: "" }); setOffOpen(false); } })}>
              <CalendarOff className="size-4" strokeWidth={1.75} aria-hidden /> {off.type === "SICK" ? "Log sick time" : "Request time off"}
            </Button>
          </div>
        </Card>
        )}
        {timeOff.length > 0 && (
          <Card className="mt-3 divide-y divide-border">
            {timeOff.filter((t) => !gone.has(t.id)).map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <div className="font-medium">{t.start === t.end ? dayDate(t.start) : `${shortDate(t.start)} to ${shortDate(t.end)}`} <span className="font-normal text-muted">· {LEAVE_LABEL[t.type]}{t.hours != null ? ` · ${Number(t.hours.toFixed(2))}h` : ""}</span></div>
                  {t.note && <div className="truncate text-xs text-muted">{t.note}</div>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge tone={t.status === "APPROVED" ? "good" : t.status === "DENIED" ? "bad" : "warn"}>{t.status === "APPROVED" ? "Approved" : t.status === "DENIED" ? "Denied" : "Waiting"}</Badge>
                  {t.status === "PENDING" && (
                    <Button variant="ghost" size="sm" className="max-sm:h-11" disabled={pending} onClick={() => run(() => cancelTimeOff(t.id), { hide: t.id })}>Withdraw</Button>
                  )}
                </div>
              </div>
            ))}
          </Card>
        )}
      </section></HelpZone>

      <MyAvailability availability={availability} openingHours={openingHours} />
    </div>
  );
}

const DISPLAY_DAYS = [1, 2, 3, 4, 5, 6, 0];
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Staff edit their own availability, one typed range per weekday. Autosaves. */
function MyAvailability({ availability, openingHours }: { availability: Record<string, [string, string][]> | null; openingHours: Record<number, [number, number]> }) {
  const [pending, start] = useTransition();
  const notSet = availability == null;
  const pct = (m: number) => `${(m / 1440) * 100}%`;
  return (
    <HelpZone id="my.availability"><section id="availability" className="scroll-mt-20">
      <h2 className="mb-1 flex items-center gap-2 text-[0.95rem] font-semibold"><CalendarClock className="size-4" strokeWidth={1.75} /> When you can work</h2>
      <p className="mb-3 text-sm text-muted">
        {notSet ? "Not set, so you can be scheduled any time the taproom is open." : "Type ranges like 4p-10p or 11-2, or “all day”. Leave a day blank if you can't work it. Saves as you go."}
      </p>
      {notSet ? (
        <Button className="max-sm:h-12" disabled={pending} onClick={() => start(async () => { await resetMyAvailability("all"); })}>Set my availability</Button>
      ) : (
        <Card className="divide-y divide-border">
          {DISPLAY_DAYS.map((d) => {
            const windows = availability?.[String(d)];
            const open = openingHours[d];
            return (
              <div key={d} className="grid grid-cols-[3rem_1fr] items-center gap-x-2 px-3 py-1.5 sm:grid-cols-[3rem_12rem_1fr]">
                <span className="text-sm font-medium text-ink-2">{DAY_NAMES[d]}</span>
                <GridCell grid="my-avail" col="day" value={formatWindows(windows)} placeholder="Can't work" onSave={setMyAvailability.bind(null, d)} ariaLabel={`${DAY_NAMES[d]} availability`} />
                <div className="relative col-span-2 mb-1 h-2 overflow-hidden rounded-full bg-border/60 sm:col-span-1 sm:mb-0" aria-hidden>
                  {open && <div className="absolute inset-y-0 bg-border-strong/60" style={{ left: pct(open[0] * 60), width: pct((open[1] - open[0]) * 60) }} />}
                  {(windows ?? []).map(([a, b], i) => <div key={i} className="absolute inset-y-0 rounded-full bg-ink" style={{ left: pct(toMinutes(a)), width: pct(toMinutes(b) - toMinutes(a)) }} />)}
                </div>
              </div>
            );
          })}
          <div className="flex items-center justify-between gap-2 px-4 py-2 text-xs text-muted">
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-4 rounded-full bg-ink" /> you <span className="ml-2 h-2 w-4 rounded-full bg-border-strong/60" /> open hours</span>
            <Button size="sm" variant="ghost" className="max-sm:h-11" disabled={pending} onClick={() => start(async () => { await resetMyAvailability("clear"); })}>Any time</Button>
          </div>
        </Card>
      )}
    </section></HelpZone>
  );
}
