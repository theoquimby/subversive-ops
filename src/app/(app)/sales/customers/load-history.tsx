"use client";

import { Button } from "@/components/ui";
import { shortDate } from "@/lib/format";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { loadGuestHistory, recountGuests } from "./actions";

/**
 * Loads past card visits from Square a stretch at a time, newest first, and
 * keeps going until it reaches the first day with sales. Leaving the page
 * stops it; the nightly sync carries on from wherever it got to.
 */
export function LoadHistory({ label, firstSale }: { label: string; firstSale: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const stop = useRef(false);

  async function run() {
    setBusy(true);
    stop.current = false;
    setNote({ text: "Asking Square for past card payments…" });
    try {
      for (let i = 0; i < 200 && !stop.current; i++) {
        const r = await loadGuestHistory();
        if (r.error) {
          setNote({ text: `${r.error} What's loaded so far is kept; press again to carry on.`, bad: true });
          break;
        }
        if (r.done) {
          setNote({ text: "All of it is loaded." });
          break;
        }
        setNote({ text: `Loaded back to ${r.through ? `${shortDate(r.through)}, ${r.through.slice(0, 4)}` : "…"}${firstSale ? ` (going back to ${firstSale.slice(0, 4)})` : ""}. Keep this page open; the figures appear when it finishes or you press Stop.` });
      }
    } finally {
      // Count what's in (all of it, or as far as it got) and show it.
      await recountGuests().catch(() => undefined);
      setBusy(false);
      router.refresh();
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="primary" disabled={busy} onClick={run}>
        {busy ? "Loading…" : label}
      </Button>
      {busy && (
        <Button variant="ghost" onClick={() => (stop.current = true)}>
          Stop
        </Button>
      )}
      <span role="status" className={`text-sm ${note?.bad ? "text-bad" : "text-ink-2"}`}>
        {note ? note.text : "Takes a few minutes for several years. It also carries on by itself each night."}
      </span>
    </div>
  );
}
