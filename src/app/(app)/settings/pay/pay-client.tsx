"use client";

import { AutoInput, AutoSwitch } from "../controls";
import { saveLaborTarget, saveScheduleAutoDraft } from "../setting-actions";

export function LaborTargetInput({ value }: { value: number | null }) {
  return <AutoInput value={value == null ? "" : String(Math.round(value * 1000) / 10)} numeric suffix="%" placeholder="None" ariaLabel="Default labor target percent" className="w-28" onSave={saveLaborTarget} />;
}

export function AutoDraftSwitch({ on }: { on: boolean }) {
  return <AutoSwitch on={on} label="Draft next week's schedule automatically" onSave={saveScheduleAutoDraft} />;
}
