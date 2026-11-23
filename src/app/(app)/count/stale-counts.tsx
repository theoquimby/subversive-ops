"use client";

import { useConfirm } from "@/components/dialog";
import { Button, Card } from "@/components/ui";
import Link from "next/link";
import { useTransition } from "react";
import { discardCount } from "./actions";

/** Counts started and left with nothing counted: say so quietly, with Continue and Discard (behind a confirm). */
export function StaleCounts({ counts }: { counts: { id: string; where: string; by: string; started: string }[] }) {
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  return (
    <Card className="divide-y divide-border">
      <p className="px-4 py-3 text-sm text-ink-2">
        {counts.length === 1 ? "A count was started and left empty." : `${counts.length} counts were started and left empty.`} Carry on with one, or throw it away.
      </p>
      {counts.map((c) => (
        <div key={c.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
          <div className="min-w-0 text-sm">
            <div className="truncate font-medium text-ink">{c.where}</div>
            <div className="text-xs text-muted">Started by {c.by} {c.started} · nothing counted</div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Link href={`/count/${c.id}`} className="inline-flex h-10 items-center rounded-lg px-3 text-sm text-ink-2 hover:bg-surface-2 hover:text-ink">Continue</Link>
            <Button
              variant="ghost"
              className="h-10 px-3 text-muted hover:text-bad"
              disabled={pending}
              onClick={async () => {
                if (await confirm({ title: `Discard the empty ${c.where} count?`, body: "Nothing was counted on it, so nothing is lost.", confirmLabel: "Discard", danger: true })) start(() => discardCount(c.id));
              }}
            >
              Discard
            </Button>
          </div>
        </div>
      ))}
    </Card>
  );
}
