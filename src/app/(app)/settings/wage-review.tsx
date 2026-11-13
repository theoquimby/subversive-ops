"use client";

import { HelpTip } from "@/components/help";
import { Switch } from "@/components/push-toggle";
import { Badge, Button, cx } from "@/components/ui";
import type { WageRuleVersion } from "@/domain/wageRules";
import { shortDate } from "@/lib/format";
import { useState, useTransition } from "react";
import { reviewRulesToday, toggleWageAuto } from "./wage-actions";

const dollars = (n: number) => `$${n.toFixed(2)}`;
const withYear = (iso: string) => `${shortDate(iso)}, ${iso.slice(0, 4)}`;

/** Settings → Labor rules: follow the NY wage table, and record when someone last checked the rules. */
export function WageReview({ auto, current, next, reviewed, due, table }: {
  auto: boolean;
  current: WageRuleVersion | null;
  next: WageRuleVersion | null;
  reviewed: { date: string; by: string } | null;
  due: { due: boolean; reason: string | null };
  table: readonly WageRuleVersion[];
}) {
  const [on, setOn] = useState(auto);
  const [pending, start] = useTransition();
  const [showTable, setShowTable] = useState(false);
  return (
    <div className="space-y-4 border-b border-border p-4" data-tour="settings.wage-review">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-medium">Follow the NY minimum wage schedule <HelpTip id="settings.wageSchedule" /></div>
          <p className="mt-0.5 text-xs text-muted">
            {on ? (
              <>
                Upstate NY rates switch by themselves on their effective date. Now{" "}
                {current ? (
                  <>
                    <span className="num text-ink">{dollars(current.minimumWage)}</span> minimum, <span className="num text-ink">{dollars(current.tippedMinimumWage)}</span> tipped (from {withYear(current.effective)})
                  </>
                ) : (
                  "no rate on file"
                )}
                .
              </>
            ) : (
              "Off — the minimum wages below are used as typed. Typing a wage turns this off."
            )}
          </p>
          {next && (
            <p className="mt-1 text-xs text-muted">
              Next: <span className="num">{dollars(next.minimumWage)}</span> / <span className="num">{dollars(next.tippedMinimumWage)}</span> tipped from {withYear(next.effective)}{" "}
              {next.status === "estimated" ? <Badge tone="warn">Estimated — verify</Badge> : <Badge>Enacted</Badge>}
            </p>
          )}
        </div>
        <Switch
          on={on}
          disabled={pending}
          label="Follow the NY minimum wage schedule"
          onChange={(v) => {
            setOn(v);
            start(async () => {
              await toggleWageAuto(v);
            });
          }}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-2/70 px-3 py-2.5">
        <div className="text-sm">
          <span className="font-medium">Rules last reviewed: </span>
          {reviewed ? <span>{withYear(reviewed.date)} by {reviewed.by}</span> : <span className="text-muted">never</span>}
          {due.due && <div className={cx("text-xs", reviewed ? "text-warn" : "text-muted")}>{due.reason} Check every rule below against current NY law, then mark it reviewed.</div>}
        </div>
        <Button size="sm" className="max-sm:h-10" disabled={pending} onClick={() => start(async () => { await reviewRulesToday(); })}>
          Mark reviewed today
        </Button>
      </div>

      <div>
        <button type="button" onClick={() => setShowTable(!showTable)} aria-expanded={showTable} className="inline-flex min-h-10 items-center text-xs text-muted underline-offset-2 hover:text-ink hover:underline sm:min-h-0">
          {showTable ? "Hide" : "Show"} the rate table
        </button>
        {showTable && (
          <table className="mt-2 w-full max-w-lg text-xs">
            <thead>
              <tr className="text-left text-muted">
                <th className="py-1 font-medium">From</th>
                <th className="py-1 text-right font-medium">Minimum</th>
                <th className="py-1 text-right font-medium">Tipped</th>
                <th className="py-1 pl-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {table.map((v) => (
                <tr key={v.effective} className={cx("border-t border-border", v.effective === current?.effective && "font-medium")}>
                  <td className="py-1.5">{withYear(v.effective)}</td>
                  <td className="num py-1.5 text-right">{dollars(v.minimumWage)}</td>
                  <td className="num py-1.5 text-right">{dollars(v.tippedMinimumWage)}</td>
                  <td className="py-1.5 pl-3">{v.status === "estimated" ? <span className="text-warn" title={v.note}>Estimated</span> : "Enacted"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-2 text-xs text-muted">
          Upstate New York (outside NYC, Long Island and Westchester). This table is a convenience, not legal advice: you are responsible for checking every rate and rule against the NY Department of Labor. Rates from 2027 are indexed to inflation and stay marked estimated until NY DOL publishes them and this table is updated.
        </p>
      </div>
    </div>
  );
}
