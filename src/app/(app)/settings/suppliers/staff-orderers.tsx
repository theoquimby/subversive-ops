"use client";

import { HelpTip } from "@/components/help";
import { Card, cx } from "@/components/ui";
import { useState, useTransition } from "react";
import { setStaffOrderers } from "../../ordering/actions";
import { SaveStatus } from "../controls";

/** Which staff can place supplier orders (one guided screen per supplier on their phone). Managers always can. */
export function StaffOrderers({ staff, value }: { staff: { id: string; name: string }[]; value: string[] }) {
  const [v, setV] = useState(value);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const toggle = (id: string) => {
    const prev = v;
    const next = v.includes(id) ? v.filter((x) => x !== id) : [...v, id];
    setV(next);
    setStatus("saving");
    start(async () => {
      const r = await setStaffOrderers(next);
      if (r.error) { setV(prev); setError(r.error); setStatus("error"); } else { setStatus("saved"); setTimeout(() => setStatus("idle"), 1500); }
    });
  };
  return (
    <Card className="mt-6 p-4">
      <div className="flex items-center gap-1 text-sm font-medium text-ink">Staff who can place orders <HelpTip id="ordering.staff" /></div>
      <p className="mt-0.5 text-xs text-muted">They get Orders on their Today screen: review the suggested order, change quantities, then send it the way each supplier takes orders. Managers can always order.</p>
      {staff.length === 0 ? (
        <p className="mt-2 text-sm text-muted">No staff logins yet.</p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Staff who can place orders">
          {staff.map((p) => (
            <button key={p.id} type="button" aria-pressed={v.includes(p.id)} onClick={() => toggle(p.id)} className={cx("h-10 rounded-full border px-3 text-sm sm:h-8 sm:text-xs", v.includes(p.id) ? "border-ink bg-primary text-primary-ink" : "border-border-strong text-ink-2 hover:bg-surface-2")}>{p.name}</button>
          ))}
        </div>
      )}
      {status !== "idle" && <div className="mt-2"><SaveStatus status={status} error={error} /></div>}
    </Card>
  );
}
