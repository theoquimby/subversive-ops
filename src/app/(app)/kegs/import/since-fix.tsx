"use client";

import { Button } from "@/components/ui";
import { useState, useTransition } from "react";
import { fixImportedSince } from "./actions";

/**
 * Kegs imported before the importer kept their dates show "since" the day of
 * the import. One press sets each back to its last scan in the old app.
 */
export function SinceFix() {
  const [pending, start] = useTransition();
  const [done, setDone] = useState<number | null>(null);
  return (
    <div className="mt-2 flex max-w-2xl flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted">
      <span className="min-w-0 flex-1">Imported kegs showing “since” the day you imported them? This sets each one back to its last scan in the old app. Kegs scanned here since are left alone.</span>
      <Button size="sm" className="h-10 sm:h-8" disabled={pending} onClick={() => start(async () => setDone((await fixImportedSince()).fixed))}>{pending ? "Fixing…" : "Fix dates"}</Button>
      {done != null && <span role="status" className="w-full text-ink-2">{done === 0 ? "Nothing to fix: every imported keg already has its real date." : `Fixed ${done} keg${done === 1 ? "" : "s"}.`}</span>}
    </div>
  );
}
