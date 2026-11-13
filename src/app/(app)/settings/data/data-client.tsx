"use client";

import { useConfirm } from "@/components/dialog";
import { Button, Input } from "@/components/ui";
import { useState, useTransition } from "react";
import { clearAllData } from "../actions";

export function ClearData({ counts }: { counts: { label: string; n: number }[] }) {
  const confirm = useConfirm();
  const [typed, setTyped] = useState("");
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();
  const ready = typed.trim().toUpperCase() === "CLEAR";
  const what = counts.filter((c) => c.n > 0).map((c) => `${c.n.toLocaleString()} ${c.label}`).join(", ");
  return (
    <div className="space-y-3 px-4 py-4 sm:px-5">
      <p className="text-sm text-ink-2">This removes every ingredient, price, recipe, sale, count, order, invoice, shift and timecard{what ? ` (${what})` : ""}. Logins are kept. It can't be undone.</p>
      <div className="flex flex-wrap items-start gap-2">
        <div>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type CLEAR" aria-label="Type CLEAR to confirm" autoComplete="off" className="w-40" />
          <p className="mt-1 text-xs text-muted">Type CLEAR to unlock the button.</p>
        </div>
        <Button
          variant="danger"
          className="border border-bad/40"
          disabled={!ready || pending}
          onClick={async () => {
            const ok = await confirm({ title: "Clear all data?", body: `Everything except logins goes${what ? ` — ${what}` : ""}. There's no undo.`, confirmLabel: "Clear everything", danger: true });
            if (!ok) return;
            start(async () => {
              const fd = new FormData();
              fd.set("confirm", typed);
              setMsg((await clearAllData(undefined, fd)) ?? null);
              setTyped("");
            });
          }}
        >
          {pending ? "Clearing…" : "Clear all data"}
        </Button>
      </div>
      {msg && <p className={msg.error ? "text-sm text-bad" : "text-sm text-good"} aria-live="polite">{msg.error ?? msg.ok}</p>}
    </div>
  );
}
