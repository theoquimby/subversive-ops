"use client";

import { Button, LinkButton } from "@/components/ui";
import { RefreshCw } from "lucide-react";
import { useState, useTransition } from "react";
import { syncLaborWeek } from "./square-actions";

export function SquareSyncButton({ week, connected }: { week: string; connected: boolean }) {
  const [msg, setMsg] = useState<{ error?: string; message?: string } | null>(null);
  const [pending, start] = useTransition();
  if (!connected) return <LinkButton href="/settings/square">Connect Square</LinkButton>;
  return (
    <>
      {msg && <span className={msg.error ? "text-sm text-bad" : "text-sm text-good"}>{msg.error ?? msg.message}</span>}
      <Button disabled={pending} onClick={() => start(async () => setMsg(await syncLaborWeek(week)))}>
        <RefreshCw className={pending ? "size-3.5 animate-spin" : "size-3.5"} />
        {pending ? "Syncing…" : "Sync from Square"}
      </Button>
    </>
  );
}
