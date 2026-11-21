"use client";

import { Button, Input } from "@/components/ui";
import { useState, useTransition } from "react";
import { setTimecardField } from "./actions";

/**
 * Fix a missed clock-out from the "Before you approve" list: type the time
 * ("11p", "1:15a") or take the scheduled end in one tap.
 */
export function MissingOutFix({ cardId, who, scheduled }: { cardId: string; who: string; scheduled: { value: string; label: string } | null }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = (value: string) =>
    start(async () => {
      setError(null);
      const r = await setTimecardField(cardId, "clockOut", value);
      if (r && r.error) setError(r.error);
    });
  return (
    <div className="mt-2">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return setError("Type the clock-out time, like 11p");
          save(text);
        }}
      >
        <Input value={text} onChange={(e) => { setText(e.target.value); setError(null); }} placeholder="Out, e.g. 11p" aria-label={`Clock-out time: ${who}`} autoComplete="off" enterKeyHint="done" className="num w-32" />
        <Button size="sm" type="submit" className="max-sm:h-10" pending={pending}>Save</Button>
        {scheduled && (
          <Button size="sm" type="button" variant="ghost" className="max-sm:h-10" disabled={pending} onClick={() => save(scheduled.value)}>
            Use scheduled end ({scheduled.label})
          </Button>
        )}
      </form>
      {error && <p role="alert" className="mt-1 text-xs font-medium text-bad">{error}</p>}
    </div>
  );
}
