"use client";

import { AutoInput } from "../controls";
import { saveDrinkTarget, saveFoodTarget, saveSpike } from "../setting-actions";

const pctStr = (f: number) => String(Math.round(f * 1000) / 10);

export function FoodTargetInput({ value }: { value: number }) {
  return <AutoInput value={pctStr(value)} numeric suffix="%" ariaLabel="Food cost target percent" className="w-28" onSave={saveFoodTarget} />;
}
export function DrinkTargetInput({ value }: { value: number | null }) {
  return <AutoInput value={value == null ? "" : pctStr(value)} numeric suffix="%" placeholder="22" ariaLabel="Drink cost target percent" className="w-28" onSave={saveDrinkTarget} />;
}
export function SpikeInput({ value }: { value: number }) {
  return <AutoInput value={pctStr(value)} numeric suffix="%" ariaLabel="Price rise alert threshold percent" className="w-28" onSave={saveSpike} />;
}
