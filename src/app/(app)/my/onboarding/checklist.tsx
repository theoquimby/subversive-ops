"use client";

import { HelpZone } from "@/components/help";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, cx, Input } from "@/components/ui";
import type { OnboardingKind, PayrollProvider, Progress } from "@/domain/onboarding";
import { shortDate } from "@/lib/format";
import { Check, ChevronRight, ExternalLink, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { saveEmergencyContact, tickMyItem } from "../workforce-actions";

interface Item {
  id: string;
  kind: OnboardingKind;
  title: string;
  detail: string | null;
  required: boolean;
  staffCanTick: boolean;
  done: boolean;
  href: string | null;
}

export function MyChecklist({ done, dueOn, progress, provider, emergency, items }: { done: boolean; dueOn: string | null; progress: Progress; provider: PayrollProvider; emergency: { name: string | null; phone: string | null; relation: string | null }; items: Item[] }) {
  const [pending, start] = useTransition();
  const [toast, show] = useToast();
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [ec, setEc] = useState({ name: emergency.name ?? "", phone: emergency.phone ?? "", relation: emergency.relation ?? "" });
  const isDone = (i: Item) => ticked[i.id] ?? i.done;
  const count = items.filter(isDone).length;
  const pct = items.length ? Math.round((count / items.length) * 100) : 100;

  const tick = (i: Item, on: boolean) => {
    setTicked((t) => ({ ...t, [i.id]: on }));
    start(async () => {
      const r = await tickMyItem(i.id, on).catch(() => ({ error: "No signal — try again in a moment." }));
      if (r.error) {
        setTicked((t) => ({ ...t, [i.id]: !on }));
        show(r.error, "bad");
      }
    });
  };

  return (
    <div className="flex flex-col gap-6">
      {toast}
      <Card className="px-4 py-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[0.95rem] font-medium">{done || progress.complete ? "All the must-dos are done" : `${count} of ${items.length} done`}</span>
          {dueOn && !done && <span className="text-xs text-muted">by {shortDate(dueOn)}</span>}
        </div>
        <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Checklist progress">
          <div className="h-full rounded-full bg-good transition-[width] duration-300" style={{ width: `${pct}%` }} />
        </div>
      </Card>

      <HelpZone id="my.onboarding.items">
        <Card className="divide-y divide-border overflow-hidden">
          {items.map((i) => {
            const d = isDone(i);
            const canTick = i.staffCanTick || i.kind === "PAYROLL";
            const body = (
              <>
                <span className={cx("grid size-7 shrink-0 place-items-center rounded-full border", d ? "border-good bg-good text-white" : "border-border-strong text-transparent")} aria-hidden><Check className="size-4" strokeWidth={2.5} /></span>
                <span className="min-w-0 flex-1">
                  <span className={cx("block text-[0.95rem] leading-snug font-medium", d ? "text-muted line-through decoration-border-strong" : "text-ink")}>{i.title}</span>
                  {i.detail && <span className="mt-0.5 block text-[0.8rem] text-muted">{i.detail}</span>}
                  {!i.required && <span className="mt-1 inline-block"><Badge>Optional</Badge></span>}
                </span>
              </>
            );
            if (i.kind === "PAYROLL") {
              return (
                <div key={i.id} className="px-4 py-3.5">
                  <div className="flex items-start gap-3">{body}</div>
                  <div className="mt-2.5 flex flex-col gap-2 pl-10 sm:flex-row">
                    {provider.url && (
                      <a href={provider.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-sm font-medium text-ink active:bg-surface-2">
                        Open {provider.name} <ExternalLink className="size-3.5" aria-hidden />
                      </a>
                    )}
                    <Button variant={d ? "ghost" : "primary"} className="min-h-11" disabled={pending} onClick={() => tick(i, !d)}>{d ? "Not done yet" : "I've done this"}</Button>
                  </div>
                  <p className="mt-2 flex items-start gap-1.5 pl-10 text-xs text-muted"><ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden /> Your SSN, bank and tax details go to {provider.name} only. This app never asks for them.</p>
                </div>
              );
            }
            if (i.kind === "EMERGENCY") {
              return (
                <div key={i.id} id="emergency" className="scroll-mt-20 px-4 py-3.5">
                  <div className="flex items-start gap-3">{body}</div>
                  <div className="mt-3 grid gap-2 pl-10 sm:grid-cols-2">
                    <Input aria-label="Contact name" placeholder="Name" autoComplete="off" value={ec.name} onChange={(e) => setEc((x) => ({ ...x, name: e.target.value }))} className="max-sm:h-12" />
                    <Input aria-label="Contact phone" placeholder="Phone" inputMode="tel" autoComplete="off" value={ec.phone} onChange={(e) => setEc((x) => ({ ...x, phone: e.target.value }))} className="max-sm:h-12" />
                    <Input aria-label="Relationship" placeholder="Relationship (optional)" value={ec.relation} onChange={(e) => setEc((x) => ({ ...x, relation: e.target.value }))} className="max-sm:h-12 sm:col-span-2" />
                    <Button
                      variant="primary"
                      className="max-sm:h-12 sm:col-span-2 sm:justify-self-end"
                      disabled={pending}
                      onClick={() =>
                        start(async () => {
                          const r = await saveEmergencyContact(ec).catch(() => ({ error: "No signal — try again in a moment." }) as { error?: string; ok?: string });
                          if (r.error) show(r.error, "bad");
                          else {
                            setTicked((t) => ({ ...t, [i.id]: true }));
                            show(r.ok ?? "Saved");
                          }
                        })
                      }
                    >
                      Save contact
                    </Button>
                  </div>
                </div>
              );
            }
            if (canTick) {
              return (
                <button key={i.id} type="button" role="checkbox" aria-checked={d} disabled={pending} onClick={() => tick(i, !d)} className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors duration-120 active:bg-surface-2">
                  {body}
                </button>
              );
            }
            return i.href && !d ? (
              <Link key={i.id} href={i.href} className="flex items-start gap-3 px-4 py-3.5 transition-colors duration-120 active:bg-surface-2">
                {body}
                <ChevronRight className="mt-1 size-4 shrink-0 text-muted" aria-hidden />
              </Link>
            ) : (
              <div key={i.id} className="flex items-start gap-3 px-4 py-3.5">
                {body}
                {!d && !i.href && <span className="mt-0.5 shrink-0 text-xs text-muted">Manager ticks</span>}
              </div>
            );
          })}
        </Card>
      </HelpZone>
    </div>
  );
}
