"use client";

import { Button } from "@/components/ui";
import { RefreshCw } from "lucide-react";
import { useTransition } from "react";
import { refreshWhatToFix } from "./actions";

export function RefreshFix({ claude }: { claude: boolean }) {
  const [pending, start] = useTransition();
  return (
    <Button variant="ghost" size="sm" className="h-10 sm:h-8" disabled={pending} onClick={() => start(async () => { await refreshWhatToFix(); })} title={claude ? "Ask Claude to rewrite this from the latest reviews" : "Recalculate from the latest reviews"}>
      <RefreshCw className={pending ? "size-4 animate-spin" : "size-4"} strokeWidth={1.75} />
      {pending ? "Thinking…" : "Refresh"}
    </Button>
  );
}
