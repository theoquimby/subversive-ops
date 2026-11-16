"use client";

import { Button, Textarea } from "@/components/ui";
import { useState, useTransition } from "react";
import { addCountNote } from "./actions";
import { Sheet } from "./item-sheet";

/** Staff can't add, rename or change items; they leave the manager a note instead. */
export function TellManager({ countId, about, onClose, onSent }: { countId: string; about?: string; onClose: () => void; onSent: () => void }) {
  const [text, setText] = useState(about ? `${about}: ` : "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Sheet title="Tell the manager" label="Tell the manager" onClose={onClose}>
      <form className="space-y-3 pb-2" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await addCountNote(countId, text); if (r.error) setError(r.error); else onSent(); }); }}>
        <p className="text-sm text-muted">Something on the shelf that isn&apos;t on the list, a unit that doesn&apos;t fit, or a label that&apos;s wrong? The manager sees this with your count.</p>
        <Textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. There's a case of oat milk in the walk-in that isn't on the list." className="min-h-24 text-base sm:text-sm" aria-label="Note for the manager" maxLength={500} />
        {error && <p className="text-sm text-bad">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={pending || !text.trim()}>{pending ? "Sending…" : "Send note"}</Button>
        </div>
      </form>
    </Sheet>
  );
}
