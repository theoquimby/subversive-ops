"use client";

/**
 * Labor rules editor. Every value autosaves on blur/Enter. Pre-filled with New
 * York defaults; the app applies whatever is set here and doesn't certify it
 * matches current law.
 *
 * Usage (server component): <LaborRulesForm rules={await getLaborRules()} />
 */

import { GridCell, GridSelect } from "@/components/grid";
import { DatePicker } from "@/components/ui";
import { LaborRules, ruleLevel, ruleOn, RULE_IDS, RULES } from "@/domain/labor";
import { useState, useTransition } from "react";
import { saveLaborRule, savePayPeriod, saveRuleSetting } from "./actions";

type NumericKey = Parameters<typeof saveLaborRule>[0];

const GROUPS: { title: string; rows: { key: NumericKey; label: string; hint: string; prefix?: string; suffix?: string; pct?: boolean }[] }[] = [
  {
    title: "Pay",
    rows: [
      { key: "minimumWage", label: "Minimum wage", hint: "Per hour. Also the spread-of-hours and call-in rate. Upstate NY: $16.00 in 2026.", prefix: "$" },
      { key: "tippedMinimumWage", label: "Tipped minimum wage", hint: "Cash wage for tip-eligible positions (food service tip credit).", prefix: "$" },
      { key: "weeklyOvertimeHours", label: "Overtime after", hint: "Hours in a Monday–Sunday week.", suffix: "h" },
      { key: "overtimeMultiplier", label: "Overtime rate", hint: "Multiple of the regular rate.", suffix: "×" },
      { key: "spreadOfHours", label: "Spread of hours", hint: "A day spanning longer than this earns one extra hour at minimum wage.", suffix: "h" },
      { key: "callInMinHours", label: "Call-in minimum", hint: "Short shifts are costed up to this when planning; leaving early is paid up to it.", suffix: "h" },
      { key: "employerBurdenPct", label: "Employer burden", hint: "Payroll taxes, workers' comp, etc. on top of wages in labor cost.", suffix: "%", pct: true },
    ],
  },
  {
    title: "Shifts",
    rows: [
      { key: "mealBreakAfterHours", label: "Meal break after", hint: "Shifts longer than this need a meal break. Generated shifts get one.", suffix: "h" },
      { key: "mealBreakMinutes", label: "Meal break length", hint: "Unpaid minutes.", suffix: "m" },
      { key: "minRestHours", label: "Rest between shifts", hint: "Less than this is flagged as a clopen.", suffix: "h" },
      { key: "maxShiftHours", label: "Longest shift", hint: "Longer shifts and timecards are flagged.", suffix: "h" },
      { key: "minorMaxDailyHours", label: "Minors: hours per day", hint: "Under-18s, non-school days.", suffix: "h" },
      { key: "minorLatestHour", label: "Minors: latest finish", hint: "Hour of day, 24h clock (22 = 10pm).", suffix: ":00" },
    ],
  },
  {
    title: "Paid sick leave",
    rows: [
      { key: "sickHoursWorkedPerHour", label: "Accrual", hint: "Hours worked to earn 1 hour of paid sick leave. NY: 30.", suffix: "h" },
      { key: "sickAnnualCapHours", label: "Yearly cap", hint: "NY: 40h for 5–99 employees, 56h for 100 or more.", suffix: "h" },
    ],
  },
];

const PERIODS = [{ value: "WEEKLY", label: "Weekly" }, { value: "BIWEEKLY", label: "Every two weeks" }];
const LEVELS = [{ value: "block", label: "Must fix" }, { value: "warn", label: "Warn" }, { value: "off", label: "Off" }];

const row = "grid grid-cols-[1fr_7.5rem] items-center gap-3 px-4 py-2";

export function LaborRulesForm({ rules }: { rules: LaborRules }) {
  return (
    <div className="divide-y divide-border">
      {GROUPS.map((g) => (
        <div key={g.title}>
          <div className="bg-surface-2/40 px-4 py-2 text-xs font-medium text-ink-2">{g.title}</div>
          <div className="divide-y divide-border">
            {g.rows.map((r) => {
              const v = rules[r.key];
              return (
                <div key={r.key} className={row}>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-ink">{r.label}</div>
                    <div className="text-xs text-muted">{r.hint}</div>
                  </div>
                  <GridCell grid="labor-rules" col="value" type="number" prefix={r.prefix} suffix={r.suffix} value={r.pct ? Math.round(v * 10000) / 100 : v} onSave={saveLaborRule.bind(null, r.key)} ariaLabel={r.label} />
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div>
        <div className="bg-surface-2/40 px-4 py-2 text-xs font-medium text-ink-2">Payroll</div>
        <div className={row}>
          <div className="min-w-0">
            <div className="text-sm font-medium text-ink">Pay period</div>
            <div className="text-xs text-muted">How timecards are grouped for approval and the payroll export. Overtime is still per week.</div>
          </div>
          <GridSelect value={rules.payPeriod} options={PERIODS} onSave={savePayPeriod.bind(null, "payPeriod")} ariaLabel="Pay period" />
        </div>
        {rules.payPeriod === "BIWEEKLY" && <AnchorRow anchor={rules.payPeriodAnchor} />}
      </div>

      <div>
        <div className="bg-surface-2/40 px-4 py-2 text-xs font-medium text-ink-2">Compliance checks</div>
        <p className="px-4 pt-2 text-xs text-muted">Must fix stops a schedule from publishing until you override it. Warn only flags it.</p>
        <div className="divide-y divide-border">
          {RULE_IDS.map((id) => (
            <div key={id} className={row}>
              <div className="min-w-0">
                <div className="text-sm font-medium text-ink">{RULES[id].label}</div>
                <div className="text-xs text-muted">{RULES[id].basis}</div>
              </div>
              <GridSelect value={ruleOn(rules, id) ? ruleLevel(rules, id) : "off"} options={LEVELS} onSave={saveRuleSetting.bind(null, id)} ariaLabel={`${RULES[id].label} level`} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AnchorRow({ anchor }: { anchor: string }) {
  const [v, setV] = useState(anchor);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className={`${row} grid-cols-[1fr_11rem]`}>
      <div className="min-w-0">
        <div className="text-sm font-medium text-ink">First day of a pay period</div>
        <div className="text-xs text-muted">{error ? <span className="text-bad">{error}</span> : "Any Monday a two-week period started on."}</div>
      </div>
      <DatePicker
        value={v}
        aria-label="First day of a pay period"
        className={pending ? "opacity-60" : undefined}
        onChange={(e) => {
          const next = e.target.value;
          setV(next);
          start(async () => {
            const r = await savePayPeriod("payPeriodAnchor", next);
            setError(r && r.error ? r.error : null);
          });
        }}
      />
    </div>
  );
}
