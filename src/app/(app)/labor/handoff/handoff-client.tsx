"use client";

import { useToast } from "@/components/toast";
import { Button } from "@/components/ui";
import { CheckCheck, Undo2 } from "lucide-react";
import { useTransition } from "react";
import { setHandedOff } from "./actions";

export function HandedOffButton({ start, done, enabled, provider }: { start: string; done: boolean; enabled: boolean; provider: string }) {
  const [pending, go] = useTransition();
  const [toast, show] = useToast();
  return (
    <>
      {toast}
      <Button
        variant={done ? "ghost" : "primary"}
        className="max-sm:h-12"
        disabled={pending || (!enabled && !done)}
        onClick={() =>
          go(async () => {
            const r = await setHandedOff(start, !done);
            show(r.error ?? r.ok ?? "Done", r.error ? "bad" : "good");
          })
        }
      >
        {done ? <><Undo2 className="size-4" aria-hidden /> Not done in {provider} yet</> : <><CheckCheck className="size-4" aria-hidden /> Done in {provider}</>}
      </Button>
    </>
  );
}
