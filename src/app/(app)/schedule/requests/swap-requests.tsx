"use client";

import { HelpTip, HelpZone } from "@/components/help";
import { Badge, Button, Card, cx, Select } from "@/components/ui";
import { STAGE_LABEL, SWAP_KIND_LABEL, type SwapKind, type SwapRules, type SwapStage } from "@/domain/swaps";
import { dayDate } from "@/lib/format";
import { Check, ChevronDown, X } from "lucide-react";
import { useState, useTransition } from "react";
import { decideSwap, saveSwapSettings } from "./actions";

export interface Candidate {
  id: string;
  name: string;
  eligible: boolean;
  reasons: string[];
  warnings: string[];
  hoursBefore: number;
  hoursAfter: number;
}

export interface SwapRow {
  id: string;
  kind: SwapKind;
  stage: SwapStage;
  requester: string;
  taker: string | null;
  takerId: string | null;
  date: string;
  time: string;
  position: string;
  color: string;
  note: string | null;
  /** Trade: the shift the requester gets back. */
  giving: string | null;
  /** The taker's check (and, in a trade, the requester's for the shift they get). */
  checks: { who: string; eligible: boolean; reasons: string[]; warnings: string[] }[];
  candidates: Candidate[];
  log: { at: string; by: string; what: string }[];
  auto: boolean;
  decidedBy: string | null;
}

const fmtH = (h: number) => `${Number(h.toFixed(1))}h`;
const KIND_TONE: Record<SwapKind, "neutral" | "warn"> = { GIVE: "neutral", SWAP: "neutral", DROP: "warn", PICKUP: "neutral" };

export function SwapRequests({ decide, open, recent, rules }: { decide: SwapRow[]; open: SwapRow[]; recent: SwapRow[]; rules: SwapRules }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [pick, setPick] = useState<Record<string, string>>({});
  const run = (fn: () => Promise<{ error?: string; ok?: string }>) =>
    start(async () => {
      const r = await fn();
      setMsg(r.error ? { text: r.error, bad: true } : { text: r.ok ?? "Done" });
    });

  return (
    <div className="flex flex-col gap-10">
      {msg && <div role="status" className={cx("-mb-4 rounded-xl px-4 py-3 text-sm", msg.bad ? "bg-bad-bg text-bad" : "bg-good-bg text-good")}>{msg.text}</div>}

      <HelpZone id="schedule.requests.swaps"><section>
        <h2 className="mb-3 text-[0.95rem] font-semibold">Swaps to approve <span className="num font-normal text-muted">{decide.length || ""}</span></h2>
        {decide.length === 0 ? <Card className="px-4 py-5 text-sm text-muted">Nothing waiting. Swaps land here once a teammate says they&apos;ll take the shift, or someone asks to drop one.</Card> : (
          <Card className="divide-y divide-border">
            {decide.map((w) => {
              const chosen = w.kind === "DROP" ? null : pick[w.id] ?? w.takerId ?? "";
              const cand = w.candidates.find((c) => c.id === chosen);
              return (
                <div key={w.id} className="flex flex-col gap-3 px-4 py-3.5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <Badge tone={KIND_TONE[w.kind]}>{SWAP_KIND_LABEL[w.kind]}</Badge>
                        {w.kind === "PICKUP" ? <span><span className="font-medium">{w.requester}</span> wants an open shift</span> : w.kind === "DROP" ? <span><span className="font-medium">{w.requester}</span> can&apos;t work it</span> : <span><span className="font-medium">{w.requester}</span> → <span className={cx("font-medium", !w.taker && "text-muted")}>{w.taker ?? "no one yet"}</span></span>}
                      </div>
                      <div className="num mt-0.5 flex items-center gap-1.5 text-sm text-ink-2">
                        <span className="size-2 rounded-full" style={{ background: w.color }} />{dayDate(w.date)} · {w.time} · {w.position}
                      </div>
                      {w.giving && <div className="text-xs text-muted">In return {w.requester.split(" ")[0]} gets {w.giving}</div>}
                      {w.note && <div className="text-xs text-muted">“{w.note}”</div>}
                      {w.checks.map((c) => (
                        <div key={c.who} className={cx("mt-1 text-xs", !c.eligible ? "text-bad" : c.warnings.length ? "text-warn" : "text-good")}>
                          {c.who}: {!c.eligible ? c.reasons.join(" · ") : c.warnings.length ? c.warnings.join(" · ") : "passes every check"}
                        </div>
                      ))}
                      {w.kind === "DROP" && <div className="mt-1 text-xs text-muted">Approving takes it off their schedule and makes it an open shift. {w.candidates.filter((c) => c.eligible).length} people could pick it up.</div>}
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <Button size="sm" variant="ghost" className="text-bad hover:bg-bad-bg max-sm:h-10" disabled={pending} onClick={() => run(() => decideSwap(w.id, false))}><X className="size-4" /> Deny</Button>
                      <Button size="sm" variant="primary" className="max-sm:h-10" disabled={pending || (w.kind !== "DROP" && !chosen)} onClick={() => run(() => decideSwap(w.id, true, chosen || null))}><Check className="size-4" /> Approve</Button>
                    </div>
                  </div>
                  {w.kind !== "DROP" && w.kind !== "SWAP" && w.candidates.length > 0 && (
                    <div className="max-w-sm">
                      <Select
                        aria-label="Who takes the shift"
                        value={chosen ?? ""}
                        onChange={(e) => setPick((p) => ({ ...p, [w.id]: e.target.value }))}
                        options={w.candidates.map((c) => ({ value: c.id, label: `${c.name} · ${fmtH(c.hoursBefore)} that week`, hint: !c.eligible ? c.reasons.join(", ") : c.warnings.join(", ") || undefined }))}
                        className="max-sm:h-11"
                      />
                      {cand && cand.id !== w.takerId && <div className={cx("mt-1 text-xs", !cand.eligible ? "text-bad" : cand.warnings.length ? "text-warn" : "text-muted")}>{!cand.eligible ? cand.reasons.join(" · ") : cand.warnings.join(" · ") || `Goes to ${fmtH(cand.hoursAfter)} that week`}</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </Card>
        )}
      </section></HelpZone>

      {open.length > 0 && (
        <section>
          <h2 className="mb-1 text-[0.95rem] font-semibold">Offered, nobody yet <span className="num font-normal text-muted">{open.length}</span></h2>
          <p className="mb-3 text-sm text-muted">Teammates who can take these see them on their phone. You can hand one to someone now.</p>
          <Card className="divide-y divide-border">
            {open.map((w) => {
              const chosen = pick[w.id] ?? "";
              const able = w.candidates.filter((c) => c.eligible);
              return (
                <div key={w.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1 text-sm">
                    <div><span className="font-medium">{w.requester}</span> <span className="text-muted">· {SWAP_KIND_LABEL[w.kind].toLowerCase()} · {w.stage === "asked" ? `asked ${w.taker}` : `${able.length} can take it`}</span></div>
                    <div className="num text-ink-2">{dayDate(w.date)} · {w.time} · {w.position}</div>
                  </div>
                  {w.kind === "GIVE" && able.length > 0 && (
                    <div className="flex gap-1.5">
                      <div className="w-52"><Select aria-label="Give it to" placeholder="Give it to…" value={chosen} onChange={(e) => setPick((p) => ({ ...p, [w.id]: e.target.value }))} options={able.map((c) => ({ value: c.id, label: c.name }))} className="max-sm:h-11" /></div>
                      <Button size="sm" variant="primary" className="max-sm:h-11" disabled={pending || !chosen} onClick={() => run(() => decideSwap(w.id, true, chosen))}>Approve</Button>
                    </div>
                  )}
                </div>
              );
            })}
          </Card>
        </section>
      )}

      <SwapRulesCard rules={rules} />

      {recent.length > 0 && (
        <HelpZone id="schedule.requests.recent"><section>
          <h2 className="mb-3 text-[0.95rem] font-semibold">Swap history</h2>
          <Card className="divide-y divide-border">
            {recent.map((w) => (
              <details key={w.id} className="group px-4 py-2.5">
                <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">
                    <span className="font-medium">{w.requester}</span>
                    <span className="text-muted"> {w.kind === "PICKUP" ? "picked up" : w.kind === "DROP" ? "dropped" : `→ ${w.taker ?? "—"}`} · {dayDate(w.date).split(",")[0]} {w.time}{w.auto ? " · auto" : ""}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <Badge tone={w.stage === "approved" ? "good" : w.stage === "denied" ? "bad" : "neutral"}>{STAGE_LABEL[w.stage]}</Badge>
                    <ChevronDown className="size-4 text-muted transition-transform group-open:rotate-180" aria-hidden />
                  </span>
                </summary>
                <ol className="mt-1.5 mb-1 space-y-1 border-l border-border pl-3 text-xs text-muted">
                  {w.log.map((l, i) => <li key={i}><span className="num">{new Date(l.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })}</span> · {l.by ? `${l.by}: ` : ""}{l.what}</li>)}
                </ol>
              </details>
            ))}
          </Card>
        </section></HelpZone>
      )}
    </div>
  );
}

const AUTO = [
  { value: "off", label: "Off: I approve every swap" },
  { value: "eligible", label: "When the taker passes every check" },
  { value: "clean", label: "Only with no warnings at all" },
];
const NOTICE = [0, 12, 24, 48, 72].map((h) => ({ value: String(h), label: h ? `${h} hours before` : "Any time" }));
const YES_NO = [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }];

function SwapRulesCard({ rules }: { rules: SwapRules }) {
  const [r, setR] = useState(rules);
  const [pending, start] = useTransition();
  const save = (patch: Partial<SwapRules>) => {
    setR((x) => ({ ...x, ...patch }));
    start(async () => {
      await saveSwapSettings(patch);
    });
  };
  return (
    <HelpZone id="schedule.requests.rules"><section>
      <h2 className="mb-3 flex items-center gap-1.5 text-[0.95rem] font-semibold">Swap rules <HelpTip id="schedule.requests.rules" /></h2>
      <Card className="divide-y divide-border text-sm" aria-busy={pending}>
        <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div><div className="font-medium">Approve swaps automatically</div><div className="text-xs text-muted">Checks hours, overtime, minors, certificates and time off: the same rules as the schedule.</div></div>
          <div className="sm:w-72"><Select aria-label="Approve swaps automatically" value={r.autoApprove} onChange={(e) => save({ autoApprove: e.target.value as SwapRules["autoApprove"] })} options={AUTO} className="max-sm:h-11" /></div>
        </div>
        <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div><div className="font-medium">…but not inside</div><div className="text-xs text-muted">Last-minute swaps always come to you.</div></div>
          <div className="sm:w-72"><Select aria-label="Not inside" value={String(r.minNoticeHours)} onChange={(e) => save({ minNoticeHours: Number(e.target.value) })} options={NOTICE} className="max-sm:h-11" /></div>
        </div>
        <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div><div className="font-medium">Open shifts go to the first person who can take them</div><div className="text-xs text-muted">No: pickups wait for you.</div></div>
          <div className="sm:w-72"><Select aria-label="Open shifts instant" value={r.openShiftsInstant ? "yes" : "no"} onChange={(e) => save({ openShiftsInstant: e.target.value === "yes" })} options={YES_NO} className="max-sm:h-11" /></div>
        </div>
        <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div><div className="font-medium">Staff can ask to drop a shift</div><div className="text-xs text-muted">You always decide a drop.</div></div>
          <div className="sm:w-72"><Select aria-label="Allow drops" value={r.allowDrop ? "yes" : "no"} onChange={(e) => save({ allowDrop: e.target.value === "yes" })} options={YES_NO} className="max-sm:h-11" /></div>
        </div>
      </Card>
    </section></HelpZone>
  );
}
