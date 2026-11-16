"use client";

import { useToast } from "@/components/toast";
import { Badge, Button, Card, cx, Select, Textarea } from "@/components/ui";
import { Gift, Send } from "lucide-react";
import { useState, useTransition } from "react";
import { givePeerShoutout, redeemReward } from "../workforce-actions";

type Res = { error?: string; ok?: string };
const offline = { error: "No signal — that didn't go through. Try again in a moment." } as Res;

export function GiveShoutout({ team, values }: { team: { id: string; name: string }[]; values: string[] }) {
  const [pending, start] = useTransition();
  const [toast, show] = useToast();
  const [to, setTo] = useState("");
  const [value, setValue] = useState("");
  const [body, setBody] = useState("");
  return (
    <Card className="p-4">
      {toast}
      <h2 className="mb-3 text-[0.95rem] font-semibold">Thank a teammate</h2>
      <div className="flex flex-col gap-2.5">
        <Select aria-label="Who" value={to} onChange={(e) => setTo(e.target.value)} placeholder="Who?" options={team.map((t) => ({ value: t.id, label: t.name }))} searchable className="max-sm:h-12" />
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Value">
          {values.map((v) => (
            <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => setValue(value === v ? "" : v)} className={cx("min-h-10 rounded-full border px-3 text-sm transition-colors duration-120", value === v ? "border-ink bg-ink text-surface" : "border-border text-ink-2 active:bg-surface-2")}>
              {v}
            </button>
          ))}
        </div>
        <Textarea aria-label="What they did" placeholder="What did they do? (“Ran food for my section when I got slammed”)" value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={400} />
        <Button
          variant="primary"
          className="self-end max-sm:h-12"
          disabled={pending || !to || body.trim().length < 3}
          onClick={() =>
            start(async () => {
              const r = await givePeerShoutout({ employeeId: to, value: value || undefined, body }).catch(() => offline);
              if (r.error) show(r.error, "bad");
              else {
                show(r.ok ?? "Sent");
                setTo("");
                setValue("");
                setBody("");
              }
            })
          }
        >
          <Send className="size-4" aria-hidden /> Send
        </Button>
      </div>
    </Card>
  );
}

export function RewardsList({ balance, rewards, asked }: { balance: number; rewards: { id: string; name: string; description: string | null; cost: number }[]; asked: { id: string; name: string; points: number; status: string; at: string }[] }) {
  const [pending, start] = useTransition();
  const [toast, show] = useToast();
  return (
    <section aria-labelledby="rewards-h">
      {toast}
      <h2 id="rewards-h" className="mb-2.5 flex items-center gap-1.5 px-1 text-[0.95rem] font-semibold"><Gift className="size-4 text-muted" aria-hidden /> Rewards</h2>
      {rewards.length === 0 ? (
        <Card className="px-4 py-5 text-sm text-muted">No rewards set up yet.</Card>
      ) : (
        <Card className="divide-y divide-border">
          {rewards.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="text-[0.95rem] font-medium">{r.name}</div>
                {r.description && <div className="text-xs text-muted">{r.description}</div>}
              </div>
              <Button
                size="sm"
                variant={balance >= r.cost ? "primary" : "secondary"}
                className="shrink-0 max-sm:h-11"
                disabled={pending || balance < r.cost}
                onClick={() =>
                  start(async () => {
                    const res = await redeemReward(r.id).catch(() => offline);
                    show(res.error ?? res.ok ?? "Done", res.error ? "bad" : "good");
                  })
                }
              >
                <span className="num">{r.cost}</span> pts
              </Button>
            </div>
          ))}
        </Card>
      )}
      {asked.length > 0 && (
        <Card className="mt-3 divide-y divide-border">
          {asked.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <span>{a.name} <span className="num text-muted">· {a.points} pts</span></span>
              <Badge tone={a.status === "APPROVED" ? "good" : a.status === "DENIED" ? "bad" : "warn"}>{a.status === "APPROVED" ? "Approved" : a.status === "DENIED" ? "Not approved" : "Waiting"}</Badge>
            </div>
          ))}
        </Card>
      )}
    </section>
  );
}
