"use client";

import { GridCell, GridSelect } from "@/components/grid";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, cx, Input, Select, Textarea } from "@/components/ui";
import type { RecognitionConfig } from "@/domain/recognition";
import { Check, Eye, EyeOff, Plus, Send, X } from "lucide-react";
import { useState, useTransition } from "react";
import { addReward, decideRedemption, giveShoutout, hideShoutout, saveRecognition, setRewardField } from "../workforce-actions";

type Res = { error?: string; ok?: string } | void;

function useRun() {
  const [pending, start] = useTransition();
  const [toast, show] = useToast();
  const run = (fn: () => Promise<Res>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (r?.error) show(r.error, "bad");
      else {
        if (r?.ok) show(r.ok);
        after?.();
      }
    });
  return { pending, toast, run };
}

export function ShoutoutComposer({ team, values, milestones }: { team: { id: string; name: string }[]; values: string[]; milestones: { employeeId: string; title: string }[] }) {
  const { pending, toast, run } = useRun();
  const [to, setTo] = useState("");
  const [value, setValue] = useState("");
  const [body, setBody] = useState("");
  const [announce, setAnnounce] = useState(false);
  const hint = milestones.find((m) => m.employeeId === to);
  return (
    <Card className="p-4">
      {toast}
      <h2 className="mb-3 text-[0.95rem] font-semibold">Give a shout-out</h2>
      <div className="flex flex-col gap-2.5">
        <Select aria-label="Who" value={to} onChange={(e) => setTo(e.target.value)} placeholder="Who?" options={team.map((t) => ({ value: t.id, label: t.name }))} searchable className="max-sm:h-12" />
        {hint && <p className="-mt-1 text-xs text-good">Milestone: {hint.title}</p>}
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Value">
          {values.map((v) => (
            <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => setValue(value === v ? "" : v)} className={cx("min-h-10 rounded-full border px-3 text-sm transition-colors duration-120", value === v ? "border-ink bg-ink text-surface" : "border-border text-ink-2")}>
              {v}
            </button>
          ))}
        </div>
        <Textarea aria-label="What they did" placeholder="What did they do? Be specific: it means more." rows={3} maxLength={400} value={body} onChange={(e) => setBody(e.target.value)} />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <button type="button" role="switch" aria-checked={announce} onClick={() => setAnnounce(!announce)} className="flex min-h-11 items-center gap-2 text-left text-sm">
            <span className={cx("relative inline-block h-5 w-9 shrink-0 rounded-full transition-colors", announce ? "bg-ink" : "bg-border-strong")}>
              <span className={cx("absolute top-0.5 size-4 rounded-full bg-surface shadow transition-all", announce ? "left-[1.125rem]" : "left-0.5")} />
            </span>
            Also post it as an announcement for a week
          </button>
          <Button variant="primary" className="max-sm:h-12" disabled={pending || !to || body.trim().length < 3} onClick={() => run(() => giveShoutout({ employeeId: to, value: value || undefined, body, announce }), () => { setTo(""); setValue(""); setBody(""); setAnnounce(false); })}>
            <Send className="size-4" aria-hidden /> Send
          </Button>
        </div>
      </div>
    </Card>
  );
}

export function ShoutoutFeed({ items }: { items: { id: string; to: string; from: string; value: string | null; body: string; points: number; hidden: boolean; createdAt: string }[] }) {
  const { pending, toast, run } = useRun();
  return (
    <section aria-labelledby="feed-h">
      {toast}
      <h2 id="feed-h" className="mb-3 text-[0.95rem] font-semibold">Recent</h2>
      {items.length === 0 ? (
        <Card className="px-4 py-5 text-sm text-muted">No shout-outs yet. Start with someone who made last weekend easier.</Card>
      ) : (
        <Card className="divide-y divide-border">
          {items.map((s) => (
            <article key={s.id} className={cx("flex items-start gap-3 px-4 py-3", s.hidden && "opacity-55")}>
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-snug"><span className="font-medium">{s.to}</span>: {s.body}</p>
                <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">{s.value && <Badge>{s.value}</Badge>}from {s.from} · {new Date(s.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}{s.points ? ` · +${s.points}` : ""}{s.hidden ? " · hidden" : ""}</p>
              </div>
              <Button size="sm" variant="ghost" className="shrink-0 max-sm:h-10" disabled={pending} aria-label={s.hidden ? "Show" : "Hide"} onClick={() => run(() => hideShoutout(s.id, !s.hidden))}>
                {s.hidden ? <Eye className="size-4" aria-hidden /> : <EyeOff className="size-4" aria-hidden />}
              </Button>
            </article>
          ))}
        </Card>
      )}
    </section>
  );
}

const YES_NO = [{ value: "yes", label: "On" }, { value: "no", label: "Off" }];

export function RecognitionSettings({ cfg }: { cfg: RecognitionConfig }) {
  const { pending, toast, run } = useRun();
  const [values, setValues] = useState(cfg.values.join(", "));
  return (
    <Card className="divide-y divide-border text-sm">
      {toast}
      <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
        <div className="sm:w-56"><div className="font-medium">Values</div><div className="text-xs text-muted">Comma-separated, up to 8.</div></div>
        <Input aria-label="Values" value={values} onChange={(e) => setValues(e.target.value)} className="max-sm:h-11 sm:flex-1" />
        <Button disabled={pending} className="max-sm:h-11" onClick={() => run(() => saveRecognition({ values: values.split(",").map((v) => v.trim()).filter(Boolean) }))}>Save</Button>
      </div>
      <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div><div className="font-medium">Staff can thank each other</div><div className="text-xs text-muted">You can hide any one from the feed.</div></div>
        <div className="sm:w-40"><Select aria-label="Peer shout-outs" value={cfg.peerShoutouts ? "yes" : "no"} onChange={(e) => run(() => saveRecognition({ peerShoutouts: e.target.value === "yes" }))} options={YES_NO} className="max-sm:h-11" /></div>
      </div>
      <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div><div className="font-medium">Points and rewards</div><div className="text-xs text-muted">Optional. Shout-outs add points staff can swap for rewards you list.</div></div>
        <div className="sm:w-40"><Select aria-label="Points" value={cfg.pointsEnabled ? "yes" : "no"} onChange={(e) => run(() => saveRecognition({ pointsEnabled: e.target.value === "yes" }))} options={YES_NO} className="max-sm:h-11" /></div>
      </div>
      {cfg.pointsEnabled && (
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <div><div className="font-medium">Points per manager shout-out</div><div className="text-xs text-muted">Teammates give half.</div></div>
          <div className="w-24"><GridCell grid="recog" col="points" type="number" value={cfg.managerPoints} onSave={(v) => saveRecognition({ managerPoints: Math.round(Number(v)) }).then(() => undefined)} ariaLabel="Points per shout-out" /></div>
        </div>
      )}
    </Card>
  );
}

export function RewardsEditor({ rewards }: { rewards: { id: string; name: string; description: string | null; cost: number; active: boolean }[] }) {
  const { pending, toast, run } = useRun();
  const [name, setName] = useState("");
  const [cost, setCost] = useState("");
  return (
    <Card className="overflow-hidden">
      {toast}
      <ul className="divide-y divide-border">
        {rewards.map((r) => (
          <li key={r.id} className="grid grid-cols-[1fr_5.5rem] items-center gap-x-2 px-3 py-1.5 sm:grid-cols-[1fr_1fr_6rem_7rem]">
            <GridCell grid="rewards" col="name" value={r.name} onSave={(v) => setRewardField(r.id, "name", v)} ariaLabel="Reward" className="font-medium" />
            <div className="hidden sm:block"><GridCell grid="rewards" col="desc" value={r.description ?? ""} placeholder="Details" onSave={(v) => setRewardField(r.id, "description", v)} ariaLabel="Details" /></div>
            <GridCell grid="rewards" col="cost" type="number" value={r.cost} suffix=" pts" onSave={(v) => setRewardField(r.id, "cost", v)} ariaLabel={`${r.name} points`} />
            <div className="hidden sm:block"><GridSelect value={r.active ? "yes" : "no"} options={[{ value: "yes", label: "Offered" }, { value: "no", label: "Hidden" }]} onSave={(v) => setRewardField(r.id, "active", v)} ariaLabel={`${r.name} offered`} /></div>
          </li>
        ))}
      </ul>
      <div className="flex gap-2 border-t border-border bg-surface-2/40 px-3 py-2.5">
        <Input aria-label="New reward" placeholder="e.g. Growler fill" value={name} onChange={(e) => setName(e.target.value)} className="max-sm:h-11 flex-1" />
        <Input aria-label="Points" placeholder="Points" inputMode="numeric" value={cost} onChange={(e) => setCost(e.target.value)} className="num max-sm:h-11 w-24" />
        <Button disabled={pending || !name.trim() || !cost} className="max-sm:h-11" onClick={() => run(() => addReward(name, Number(cost)), () => { setName(""); setCost(""); })}><Plus className="size-4" aria-hidden /> Add</Button>
      </div>
    </Card>
  );
}

export function RedemptionsList({ items }: { items: { id: string; who: string; reward: string; points: number; at: string }[] }) {
  const { pending, toast, run } = useRun();
  return (
    <section aria-labelledby="red-h">
      {toast}
      <h2 id="red-h" className="mb-3 text-[0.95rem] font-semibold">Rewards asked for</h2>
      <Card className="divide-y divide-border">
        {items.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
            <span className="min-w-0"><span className="font-medium">{r.who}</span> <span className="text-muted">· {r.reward} · {r.points} pts</span></span>
            <span className="flex shrink-0 gap-1">
              <Button size="sm" variant="ghost" className="text-bad max-sm:h-10" disabled={pending} aria-label="Deny" onClick={() => run(() => decideRedemption(r.id, false))}><X className="size-4" aria-hidden /></Button>
              <Button size="sm" variant="primary" className="max-sm:h-10" disabled={pending} aria-label="Approve" onClick={() => run(() => decideRedemption(r.id, true))}><Check className="size-4" aria-hidden /></Button>
            </span>
          </div>
        ))}
      </Card>
    </section>
  );
}
