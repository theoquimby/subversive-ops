"use client";

import { DISCOUNT_CLASSES, discountClassLabel, type DiscountClass } from "@/domain/squareMoney";
import { money, shortDate } from "@/lib/format";
import { AutoChoice, SettingRow } from "../settings/controls";
import { saveDiscountClass } from "./actions";

export interface DiscountNameRow {
  name: string;
  amount: number;
  lines: number;
  last: string;
  /** Set in Settings, or null for the default. */
  set: DiscountClass | null;
  /** What the name counts as with no setting. */
  fallback: DiscountClass;
}

/** One row per discount name rung in Square, with what it counts as on the P&L. */
export function DiscountClassRows({ rows }: { rows: DiscountNameRow[] }) {
  return (
    <>
      {rows.map((r) => (
        <SettingRow
          key={r.name}
          label={r.name}
          what={`${money(r.amount, { whole: true })} over ${r.lines} line${r.lines === 1 ? "" : "s"} · last ${shortDate(r.last)}`}
          defaultNote={`Default: ${discountClassLabel(r.fallback)}`}
        >
          <AutoChoice
            className="w-full sm:w-44"
            ariaLabel={`What ${r.name} counts as`}
            value={r.set ?? "default"}
            options={[{ value: "default", label: `${discountClassLabel(r.fallback)} (default)` }, ...DISCOUNT_CLASSES.map((c) => ({ value: c.value, label: c.label, hint: c.hint }))]}
            onSave={(v) => saveDiscountClass(r.name, v)}
          />
        </SettingRow>
      ))}
    </>
  );
}
