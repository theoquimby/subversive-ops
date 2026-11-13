"use client";

/**
 * Labor rules editor. Every value autosaves on blur/Enter. Pre-filled with New
 * York defaults; the app applies whatever is set here and doesn't certify it
 * matches current law.
 *
 * Usage (server component): <LaborRulesForm rules={await getLaborRules()} />
 */

import { GridCell } from "@/components/grid";
import type { LaborRules } from "@/domain/labor";
import { saveLaborRule } from "./actions";

const ROWS: { key: keyof LaborRules; label: string; hint: string; prefix?: string; suffix?: string; pct?: boolean }[] = [
  { key: "minimumWage", label: "Minimum wage", hint: "Per hour. Also the spread-of-hours rate.", prefix: "$" },
  { key: "weeklyOvertimeHours", label: "Overtime after", hint: "Hours in a Monday–Sunday week.", suffix: "h" },
  { key: "overtimeMultiplier", label: "Overtime rate", hint: "Multiple of the regular rate.", suffix: "×" },
  { key: "spreadOfHours", label: "Spread of hours", hint: "A day spanning longer than this earns one extra hour at minimum wage.", suffix: "h" },
  { key: "callInMinHours", label: "Call-in minimum", hint: "Shorter shifts get flagged when scheduling.", suffix: "h" },
  { key: "minRestHours", label: "Rest between shifts", hint: "Less than this is flagged as a clopen.", suffix: "h" },
  { key: "maxShiftHours", label: "Longest shift", hint: "Longer shifts are flagged.", suffix: "h" },
  { key: "minorMaxDailyHours", label: "Minors: hours per day", hint: "Under-18s, non-school days.", suffix: "h" },
  { key: "minorLatestHour", label: "Minors: latest finish", hint: "Hour of day, 24h clock (22 = 10pm).", suffix: ":00" },
  { key: "employerBurdenPct", label: "Employer burden", hint: "Payroll taxes, workers' comp, etc. on top of wages in labor cost.", suffix: "%", pct: true },
];

export function LaborRulesForm({ rules }: { rules: LaborRules }) {
  return (
    <div className="divide-y divide-border">
      {ROWS.map((r) => {
        const v = rules[r.key];
        return (
          <div key={r.key} className="grid grid-cols-[1fr_7.5rem] items-center gap-3 px-4 py-2">
            <div className="min-w-0">
              <div className="text-sm font-medium text-ink">{r.label}</div>
              <div className="text-xs text-muted">{r.hint}</div>
            </div>
            <GridCell
              grid="labor-rules"
              col="value"
              type="number"
              prefix={r.prefix}
              suffix={r.suffix}
              value={r.pct ? Math.round(v * 10000) / 100 : v}
              onSave={saveLaborRule.bind(null, r.key)}
              ariaLabel={r.label}
            />
          </div>
        );
      })}
    </div>
  );
}
