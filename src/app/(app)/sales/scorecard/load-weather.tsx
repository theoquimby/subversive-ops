"use client";

import { Button } from "@/components/ui";
import { useState, useTransition } from "react";
import { loadWeatherHistory } from "./actions";

/** One press loads the weather for every past day with sales (it also runs by itself each night). */
export function LoadWeather({ missing }: { missing: number }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await loadWeatherHistory();
            setNote("error" in r ? { text: r.error, bad: true } : { text: r.message, bad: false });
          })
        }
      >
        {pending ? "Loading weather…" : `Load ${missing.toLocaleString("en-US")} days of past weather`}
      </Button>
      <span role="status" className={`text-sm ${note?.bad ? "text-bad" : "text-ink-2"}`}>
        {note ? note.text : "It also loads by itself each night."}
      </span>
    </div>
  );
}
