import { GridCell } from "@/components/grid";
import { cx, Dot, PageHeader, Section, Stat, Table, Td, Th } from "@/components/ui";
import { rag, Rag } from "@/domain/budgets";
import { addDays } from "@/domain/dates";
import { money, pct, shortDate } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { budgetGrid, BudgetRow } from "@/server/services/budgets";
import { setTarget } from "./actions";
import { BudgetActions } from "./budget-actions";

export const metadata = { title: "Budgets" };

const tone = (r: Rag) => (r === "none" ? "neutral" : r);
const toneText = (r: Rag) => (r === "bad" ? "text-bad" : r === "warn" ? "text-warn" : r === "good" ? "text-good" : "text-muted");
const pct100 = (n: number | null) => (n == null ? null : Math.round(n * 1000) / 10);

export default async function BudgetsPage() {
  await requireUser("MANAGER");
  const { rows, thisWeek } = await budgetGrid(6, 8);
  const current = rows.find((r) => r.weekStart === thisWeek)!;
  const past = rows.filter((r) => r.when === "past" && r.sales != null && r.sales_actual != null);
  const hit = past.filter((r) => r.status.sales === "good").length;

  return (
    <>
      <PageHeader
        title="Budgets"
        description="Weekly targets for sales, food cost and labor. Type to change a target — it saves as you go. Weeks start on Monday."
        actions={<BudgetActions />}
      />

      <div className="mb-10 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="This week, sales"
          value={money(current.sales_actual, { whole: true })}
          hint={current.sales ? `of ${money(current.sales, { whole: true })} target · on pace for ${money(current.sales_forecast, { whole: true })}` : "No target set"}
          tone={current.status.sales === "none" ? undefined : tone(current.status.sales)}
        />
        <Stat label="Food cost, this week" value={pct(current.foodCostPct_actual)} hint={current.foodCostPct ? `Target ${pct(current.foodCostPct, 0)} · theoretical` : "No target set"} tone={current.status.foodCostPct === "none" ? undefined : tone(current.status.foodCostPct)} />
        <Stat
          label="Labor, this week"
          value={pct(current.laborPct_actual ?? current.laborPct_scheduled)}
          hint={current.laborPct ? `Target ${pct(current.laborPct, 0)} · ${current.laborPct_actual != null ? "from timecards" : current.laborPct_scheduled != null ? "scheduled" : "no timecards yet"}` : "No target set"}
          tone={current.status.laborPct === "none" ? undefined : tone(current.status.laborPct)}
        />
        <Stat label="Sales target hit" value={past.length ? `${hit} of ${past.length}` : "—"} hint="Last 6 finished weeks" tone={past.length ? (hit >= past.length / 2 ? "good" : "warn") : undefined} />
      </div>

      <Section title="Weekly targets" description="Under each target: actual so far, or the forecast for weeks ahead.">
        <Table>
          <thead>
            <tr>
              <Th className="pr-1! pl-3! sm:px-4!">Week</Th>
              <Th align="right" className="px-2! sm:px-4!">Sales</Th>
              <Th align="right" className="px-2! sm:px-4!">Food cost</Th>
              <Th align="right" className="px-2! sm:px-4!">Labor</Th>
              <Th align="center" className="hidden sm:table-cell">Status</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <WeekRow key={r.weekStart} r={r} />
            ))}
          </tbody>
        </Table>
        <p className="mt-3 text-xs text-muted">Food cost is theoretical (recipes × items sold). Labor uses timecards for past days and scheduled shifts ahead, with employer taxes added. Sales targets for the current week are compared pro-rata.</p>
      </Section>
    </>
  );
}

function WeekRow({ r }: { r: BudgetRow }) {
  const isCurrent = r.when === "current";
  const end = addDays(r.weekStart, 6);
  const salesSub = r.when === "future" ? r.sales_forecast : r.sales_actual;
  const laborSub = r.laborPct_actual ?? (r.when !== "past" ? r.laborPct_scheduled : null);
  return (
    <tr className={cx("transition-colors hover:bg-surface-2/60", isCurrent && "bg-surface-2/50")}>
      <Td className="pr-1! pl-3! whitespace-nowrap sm:px-4!">
        <div className="flex items-center gap-2">
          <span className="sm:hidden"><Dot tone={tone(r.status.overall)} /></span>
          <div>
            <div className={cx("text-sm", isCurrent ? "font-semibold" : "font-medium")}>{shortDate(r.weekStart)}</div>
            <div className="hidden text-xs text-muted sm:block">{isCurrent ? "This week" : `to ${shortDate(end)}`}</div>
          </div>
        </div>
      </Td>
      <Td align="right" className="px-2! sm:px-4!">
        <Cell grid="budget" col="sales" week={r.weekStart} field="sales" value={r.sales} prefix="$" label="Sales target" />
        <Sub value={salesSub == null ? null : money(salesSub, { whole: true })} label={r.when === "future" ? "forecast" : r.when === "current" ? "so far" : "actual"} rag={r.when === "future" ? "none" : r.status.sales} />
      </Td>
      <Td align="right" className="px-2! sm:px-4!">
        <Cell grid="budget" col="food" week={r.weekStart} field="foodCostPct" value={pct100(r.foodCostPct)} suffix="%" label="Food cost target" />
        <Sub value={r.foodCostPct_actual == null ? null : pct(r.foodCostPct_actual)} label="theo." rag={r.status.foodCostPct} />
      </Td>
      <Td align="right" className="px-2! sm:px-4!">
        <Cell grid="budget" col="labor" week={r.weekStart} field="laborPct" value={pct100(r.laborPct)} suffix="%" label="Labor target" />
        <Sub value={laborSub == null ? null : pct(laborSub)} label={r.laborPct_actual != null ? "actual" : "sched."} rag={r.laborPct_actual != null ? r.status.laborPct : rag("laborPct", r.laborPct, laborSub)} />
      </Td>
      <Td align="center" className="hidden sm:table-cell">
        <StatusPill r={r} />
      </Td>
    </tr>
  );
}

function Cell({ grid, col, week, field, value, prefix, suffix, label }: { grid: string; col: string; week: string; field: "sales" | "foodCostPct" | "laborPct"; value: number | null; prefix?: string; suffix?: string; label: string }) {
  return (
    <GridCell
      grid={grid}
      col={col}
      type="number"
      value={value}
      prefix={prefix}
      suffix={suffix}
      placeholder="—"
      onSave={setTarget.bind(null, week, field)}
      ariaLabel={`${label}, week of ${week}`}
      className={cx("ml-auto", field === "sales" ? "w-[5.5rem] sm:w-24" : "w-14 sm:w-20")}
    />
  );
}

function Sub({ value, label, rag }: { value: string | null; label: string; rag: Rag }) {
  if (value == null) return <div className="h-4 pr-2 text-[11px] text-muted/60">—</div>;
  return (
    <div className="num pr-2 text-[11px] leading-4 whitespace-nowrap">
      <span className={cx("font-medium", toneText(rag))}>{value}</span>
      <span className="hidden text-muted sm:inline"> {label}</span>
    </div>
  );
}

function StatusPill({ r }: { r: BudgetRow }) {
  if (r.when === "future") return <span className="text-xs text-muted">{r.sales == null ? "Not set" : "Planned"}</span>;
  const s = r.status.overall;
  const label = { good: "On track", warn: "Watch", bad: "Off track", none: "No targets" }[s];
  return (
    <span className={cx("inline-flex items-center gap-1.5 text-xs font-medium", toneText(s))}>
      <Dot tone={tone(s)} />
      {label}
    </span>
  );
}
