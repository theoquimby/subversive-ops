"use client";

import { Button } from "@/components/ui";
import { X } from "lucide-react";
import { useState, useTransition } from "react";
import { hideCadenceNotice } from "./actions";

/** Shown once after the switch, under the board: which suppliers are now "when stock runs low", in one dismissible line. */
export function CadenceNotice({ names }: { names: string[] }) {
  const [hidden, setHidden] = useState(false);
  const [pending, start] = useTransition();
  if (hidden || names.length === 0) return null;
  const list = names.length > 4 ? `${names.slice(0, 4).join(", ")} and ${names.length - 4} more` : names.join(", ");
  return (
    <div role="status" className="mt-4 flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-ink-2">
      <p className="min-w-0 flex-1">
        <span className="font-medium text-ink">Fewer reminders:</span> {list} {names.length === 1 ? "is" : "are"} now ordered when stock runs low. Change it with the Orders switch.
      </p>
      <Button variant="ghost" size="sm" className="size-10 shrink-0 px-0 sm:size-8" aria-label="Dismiss" disabled={pending} onClick={() => { setHidden(true); start(() => hideCadenceNotice()); }}>
        <X className="size-4" />
      </Button>
    </div>
  );
}
