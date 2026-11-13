"use client";

import { Textarea } from "@/components/ui";
import { RANGE_PRESETS } from "@/domain/lab";
import { useState, useTransition } from "react";
import { AutoChoice, SaveStatus } from "../controls";
import { saveRangeSetting, saveTone } from "../setting-actions";

export function RangeChoice({ value }: { value: string }) {
  const [note, setNote] = useState<string | null>(null);
  return (
    <div className="w-full sm:w-56">
      <AutoChoice value={value} ariaLabel="History Insights uses" options={RANGE_PRESETS.map((p) => ({ value: p.id, label: p.label }))} onSave={async (v) => { const r = await saveRangeSetting(v); setNote(r.note ?? null); return r; }} />
      {note && <p className="text-xs text-muted">{note}</p>}
    </div>
  );
}

export function ToneNotes({ value }: { value: string }) {
  const [v, setV] = useState(value);
  const [saved, setSaved] = useState(value);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const commit = () => {
    if (v.trim() === saved.trim()) return;
    setStatus("saving");
    start(async () => {
      const r = await saveTone(v);
      if (r.error) { setError(r.error); setStatus("error"); } else { setSaved(v); setStatus("saved"); setTimeout(() => setStatus("idle"), 1800); }
    });
  };
  return (
    <div>
      <Textarea value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} rows={4} maxLength={600} aria-label="Review reply voice" placeholder={"Sign off as Max.\nMention the dog-friendly patio when it fits.\nNever offer refunds in public — invite them to email us."} />
      <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted"><SaveStatus status={status} error={error} /><span className="num">{v.length}/600</span></div>
    </div>
  );
}
