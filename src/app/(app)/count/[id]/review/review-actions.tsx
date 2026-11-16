"use client";

import { Button, LinkButton } from "@/components/ui";
import { useConfirm } from "@/components/dialog";
import { HelpZone } from "@/components/help";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { approveCount, sendBackCount } from "../../actions";

export function ReviewActions({ countId }: { countId: string }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const go = (fn: () => Promise<{ error?: string }>, to: string) =>
    start(async () => {
      const r = await fn();
      if (r.error) setError(r.error);
      else router.push(to);
    });
  return (
    <div className="fixed inset-x-0 bottom-[var(--tabbar)] z-30 border-t border-border bg-surface/95 backdrop-blur lg:left-60">
      <HelpZone id="count.review.approve" className="mx-auto flex max-w-xl flex-wrap items-center justify-end gap-2 px-4 py-3">
        {error && <span className="mr-auto text-sm text-bad">{error}</span>}
        <LinkButton href={`/count/${countId}`} variant="ghost" size="lg">Fix numbers</LinkButton>
        <Button variant="ghost" size="lg" disabled={pending} onClick={async () => { if (await confirm({ title: "Send it back?", body: "Whoever counted can open it again from Counts, fix it and send it again.", confirmLabel: "Send back" })) go(() => sendBackCount(countId), "/count"); }}>Send back</Button>
        <Button variant="primary" size="lg" disabled={pending} onClick={() => go(() => approveCount(countId), "/count?done=1")}>{pending ? "Saving…" : "Approve"}</Button>
      </HelpZone>
    </div>
  );
}
