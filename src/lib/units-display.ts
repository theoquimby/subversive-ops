import type { BaseUnit } from "@/domain/units";

/** The unit people think in when reading a cost: $/lb, $/qt, $/ea. */
export const DISPLAY_UNIT: Record<BaseUnit, { unit: string; factor: number }> = {
  g: { unit: "lb", factor: 453.59237 },
  ml: { unit: "qt", factor: 946.352946 },
  each: { unit: "ea", factor: 1 },
};

export const perDisplayUnit = (costPerBase: number | null, base: BaseUnit) =>
  costPerBase == null ? null : costPerBase * DISPLAY_UNIT[base].factor;
