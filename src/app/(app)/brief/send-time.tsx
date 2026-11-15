"use client";

import { useState, useTransition } from "react";
import { BellRing } from "lucide-react";
import { Select } from "@/components/ui";
import { hourLabel, MORNING_HOURS } from "@/domain/morningBrief";
import { setMorningHour } from "./actions";

/** "Arrives 9am": when the morning brief is pushed (and emailed, for anyone who turned email on). */
export function SendTime({ hour }: { hour: number }) {
  const [value, setValue] = useState(String(hour));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-2" title="When the morning brief is sent to your phone. Change email or push in Settings → Notifications.">
      <BellRing aria-hidden className="size-4 shrink-0 text-muted" strokeWidth={1.75} />
      <span className="hidden text-sm text-muted sm:inline">Arrives</span>
      <Select
        aria-label="When the morning brief arrives"
        value={value}
        disabled={pending}
        className="w-[5.5rem]"
        options={MORNING_HOURS.map((h) => ({ value: String(h), label: hourLabel(h) }))}
        onChange={(e) => {
          const prev = value;
          setValue(e.target.value);
          setError(null);
          start(async () => {
            const r = await setMorningHour(Number(e.target.value));
            if (r.error) {
              setValue(prev);
              setError(r.error);
            }
          });
        }}
      />
      {error && <span className="text-xs text-bad">{error}</span>}
    </div>
  );
}
