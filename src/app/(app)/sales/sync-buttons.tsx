"use client";

import { Button, LinkButton } from "@/components/ui";
import { useState, useTransition } from "react";
import { syncNow } from "./actions";

export function SyncButtons({ configured }: { configured: boolean }) {
  const [msg, setMsg] = useState<{ error?: string; message?: string } | null>(null);
  const [pending, start] = useTransition();
  if (!configured) return <LinkButton href="/settings/square" variant="primary">Connect Square</LinkButton>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {msg && <span className={msg.error ? "text-sm text-bad" : "text-sm text-good"}>{msg.error ?? msg.message}</span>}
      <LinkButton href="/settings/square#import">Import history</LinkButton>
      <Button variant="primary" disabled={pending} onClick={() => start(async () => setMsg(await syncNow()))}>{pending ? "Syncing…" : "Sync now"}</Button>
    </div>
  );
}
