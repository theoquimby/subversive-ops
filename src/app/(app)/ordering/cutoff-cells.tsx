"use client";

import { GridCell, GridSelect } from "@/components/grid";
import { saveCutoff } from "./actions";

const label12 = (t: string) => {
  const h = Number(t.slice(0, 2));
  const m = t.slice(3, 5);
  return `${h % 12 === 0 ? 12 : h % 12}${m === "00" ? "" : `:${m}`}${h < 12 ? "am" : "pm"}`;
};

export function CutoffTimeCell({ supplierId, time }: { supplierId: string; time: string }) {
  return <GridCell grid="cutoffs" col="time" value={label12(time)} onSave={(v) => saveCutoff(supplierId, "time", v)} ariaLabel="Order cutoff time" />;
}

export function CutoffDaysCell({ supplierId, days }: { supplierId: string; days: number }) {
  return <GridCell grid="cutoffs" col="days" type="number" align="left" value={days} onSave={(v) => saveCutoff(supplierId, "daysBefore", v)} ariaLabel="Days before delivery" />;
}

export function AutoDraftCell({ supplierId, on }: { supplierId: string; on: boolean }) {
  return (
    <GridSelect
      value={on ? "on" : "off"}
      options={[{ value: "on", label: "Auto-draft" }, { value: "off", label: "Off" }]}
      onSave={(v) => saveCutoff(supplierId, "autoDraft", v)}
      ariaLabel="Auto-draft before cutoff"
    />
  );
}
