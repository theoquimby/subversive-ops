"use client";

import { Button } from "@/components/ui";
import { useState, useTransition } from "react";
import { backfill, syncNow } from "./actions";

export function SyncButtons({ configured }: { configured: boolean }) {
  const [msg, setMsg] = useState<{ error?: string; message?: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-2">
      {msg && <span className={msg.error ? "text-sm text-bad" : "text-sm text-good"}>{msg.error ?? msg.message}</span>}
      <Button disabled={pending || !configured} onClick={() => start(async () => setMsg(await backfill(180)))}>Import last 6 months</Button>
      <Button variant="primary" disabled={pending || !configured} onClick={() => start(async () => setMsg(await syncNow()))}>{pending ? "Syncing…" : "Sync now"}</Button>
    </div>
  );
}
