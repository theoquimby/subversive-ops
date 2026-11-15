"use client";

import { Button } from "@/components/ui";
import { useToast } from "@/components/toast";
import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { testWebsitePing } from "./actions";

/** Sends the website a refresh now and says how it went. */
export function TestPingButton({ label = "Send a test refresh" }: { label?: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const [toast, show] = useToast();
  return (
    <>
      <Button
        size="sm"
        disabled={pending}
        data-tour="website.test-ping"
        onClick={() =>
          start(async () => {
            const r = await testWebsitePing();
            show(r.message, r.ok ? "good" : "bad");
            router.refresh();
          })
        }
      >
        <RefreshCw className={pending ? "size-4 animate-spin" : "size-4"} /> {pending ? "Sending…" : label}
      </Button>
      {toast}
    </>
  );
}
