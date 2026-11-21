"use client";

import { useConfirm } from "@/components/dialog";
import { Button } from "@/components/ui";
import { CalendarRange, Copy, TrendingUp } from "lucide-react";
import { useState, useTransition } from "react";
import { copyLastWeek, fillNextWeeks, fillFromForecast } from "./actions";

export function BudgetActions() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ bad?: boolean; text: string } | null>(null);
  const confirm = useConfirm();
  const report = (r: { error?: string; changed?: number }, what: string) =>
    setMsg(r.error ? { bad: true, text: r.error } : { text: r.changed ? `${what} · ${r.changed} week${r.changed === 1 ? "" : "s"} updated` : "Nothing to change — those weeks are already set" });
  return (
    <>
      {msg && <span className={msg.bad ? "text-sm text-bad" : "text-sm text-good"}>{msg.text}</span>}
      <Button disabled={pending} onClick={() => start(async () => report(await copyLastWeek(), "Copied last week"))}>
        <Copy className="size-4" strokeWidth={1.75} />
        Copy last week
      </Button>
      <Button
        disabled={pending}
        onClick={async () => {
          const ok = await confirm({ title: "Use the forecast as the sales target?", body: "This week and the next 8 get the sales forecast as their target, rounded to $50. Only blank sales targets are filled; ones you've set stay.", confirmLabel: "Use the forecast" });
          if (ok) start(async () => report(await fillFromForecast(), "Sales targets from the forecast"));
        }}
      >
        <TrendingUp className="size-4" strokeWidth={1.75} />
        Use the forecast
      </Button>
      <Button
        variant="primary"
        disabled={pending}
        onClick={async () => {
          const ok = await confirm({ title: "Set the next 8 weeks?", body: "Blank weeks get this week's targets. Weeks you've already set keep their numbers.", confirmLabel: "Fill 8 weeks" });
          if (ok) start(async () => report(await fillNextWeeks(), "Filled next 8 weeks"));
        }}
      >
        <CalendarRange className="size-4" strokeWidth={1.75} />
        Set next 8 weeks
      </Button>
    </>
  );
}
