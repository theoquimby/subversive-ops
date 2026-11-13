"use client";

import { X } from "lucide-react";
import { useTransition } from "react";
import { dismissSetupCard } from "./actions";

/** The "×" on the Overview's "Finish setting up" card. Setup stays reachable from the command palette. */
export function DismissSetupButton() {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      aria-label="Hide setup card"
      title="Hide. Search “Finish setting up” (⌘K) to come back to it."
      disabled={pending}
      onClick={() => start(async () => { await dismissSetupCard(); })}
      className="grid size-10 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-50 sm:size-8"
    >
      <X className="size-4" />
    </button>
  );
}
