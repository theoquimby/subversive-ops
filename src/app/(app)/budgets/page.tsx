import { Verdict } from "@/components/chapter";
import { ColumnsChart, type Col } from "@/components/columns-chart";
import { GridCell } from "@/components/grid";
import { Badge, cx, Dot, PageHeader, Section, Table, Td, Th } from "@/components/ui";
import { rag, Rag } from "@/domain/budgets";
import { budgetVerdict, weekWord } from "@/domain/budgetStory";
import { addDays } from "@/domain/dates";
import { KPI_LABELS } from "@/domain/pnl";
import { rangeWords } from "@/domain/pnlVerdict";
import { money, pct, shortDate } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { budgetGrid, BudgetRow } from "@/server/services/budgets";
import { ArrowRight } from "lucide-react";
import { setTarget } from "./actions";
import { BudgetActions } from "./budget-actions";

export const metadata = { title: "Budgets" };

const tone = (r: Rag) => (r === "none" ? "neutral" : r);
const toneText = (r: Rag) => (r === "bad" ? "text-bad" : r === "warn" ? "text-warn" : r === "good" ? "text-good" : "text-muted");
const pct100 = (n: number | null) => (n == null ? null : Math.round(n * 1000) / 10);
const whole = (n: number | null) => money(n, { whole: true });

export default async function BudgetsPage() {
  await requireUser("MANAGER");
  const { rows, thisWeek } = await budgetGrid(6, 8);
  const current = rows.find((r) => r.weekStart === thisWeek)!;
  const verdict = budgetVerdict(rows);
  const started = current.daysIn > 0;

  // The picture: each finished week's sales against its target, and this week so far.
  const shown = rows.filter((r) => r.when !== "future");
  const cols: Col[] = shown.map((r) => {
    const w = weekWord(r);
    const missing = r.notIn > 0 || (r.when === "current" && !started);
    return {
      key: r.weekStart,
      label: shortDate(r.weekStart),
      sub: r.when === "current" ? "So far" : w.word,
      mark: r.when === "current",
      missing,
      parts: missing ? [0] : [r.sales_actual ?? 0],
      tick: r.sales ?? undefined,
      tip: {
        title: `Week of ${rangeWords(r.weekStart, addDays(r.weekStart, 6))}`,
        rows: [
          { color: "var(--money-sales)", label: r.when === "current" ? "Sales so far" : "Sales", value: missing ? (r.notIn ? `${r.notIn} day${r.notIn === 1 ? "" : "s"} not in yet` : "None yet") : whole(r.sales_actual) },
          { label: "Target", value: r.sales != null ? whole(r.sales) : "Not set" },
          ...(r.when === "past" ? [{ label: "Result", value: w.word, strong: true }] : []),
        ],
      },
    };
  });

  return (
    <>
      <PageHeader
        help="budgets.page"
        title="Budgets"
        description="Weekly targets for sales, food cost and labor. Type to change a target; it saves as you go. Weeks start on Monday."
        actions={<BudgetActions />}
      />

      <Verdict
        badge={{ tone: verdict.tone }}
        title={verdict.title}
        line={verdict.line}
        stats={[
          started
            ? { label: "This week, sales so far", value: whole(current.sales_actual), tone: current.notIn ? "unknown" : current.status.sales === "none" ? "neutral" : tone(current.status.sales), hint: current.notIn ? `${current.notIn} day${current.notIn === 1 ? "" : "s"} not in yet` : current.sales ? `of a ${whole(current.sales)} target · on pace for ${whole(current.sales_forecast)}` : "No target set" }
            : { label: "This week's forecast", value: whole(current.sales_forecast), hint: current.sales ? `against a ${whole(current.sales)} target` : "No target set" },
          {
            label: `${KPI_LABELS.food}, this week`,
            value: started && current.foodCostPct_actual != null ? pct(current.foodCostPct_actual) : "—",
            tone: !started || current.foodCostPct_actual == null ? "unknown" : current.status.foodCostPct === "none" ? "neutral" : tone(current.status.foodCostPct),
            hint: !started ? "Shows after the first day" : `${KPI_LABELS.foodHint}${current.foodCostPct ? ` · target ${pct(current.foodCostPct, 0)}` : ""}`,
          },
          {
            label: `${KPI_LABELS.labor}, this week`,
            value: pct(current.laborPct_actual ?? current.laborPct_scheduled),
            tone: current.laborPct_actual == null && current.laborPct_scheduled == null ? "unknown" : current.laborPct_actual != null && current.status.laborPct !== "none" ? tone(current.status.laborPct) : "neutral",
            hint: `${current.laborPct_actual != null ? "Timecards to yesterday" : current.laborPct_scheduled != null ? "Scheduled, of the forecast" : "No timecards or shifts yet"}${current.laborPct ? ` · target ${pct(current.laborPct, 0)}` : ""}`,
          },
        ]}
      >
        {verdict.action && (
          <div className="mb-5 flex gap-2.5 rounded-lg bg-surface-2 px-3.5 py-3 text-sm text-ink">
            <ArrowRight aria-hidden className="mt-0.5 size-4 shrink-0 text-muted" />
            <p className="max-w-2xl font-medium">{verdict.action}</p>
          </div>
        )}
        <h3 className="mb-3 text-sm font-medium text-ink">Weekly sales against target</h3>
        <ColumnsChart
          cols={cols}
          series={[{ color: "var(--money-sales)", label: "Sales" }]}
          tickLabel="The week's sales target"
          height={180}
          ariaLabel="Each week's sales, with a mark at its sales target"
          caption="Week starting"
        />
      </Verdict>

      <Section help="budgets.targets" title="Weekly targets" description="Under each target: actual so far, or the forecast for weeks ahead.">
        <Table sticky>
          <thead>
            <tr>
              <Th className="pr-1! pl-3! sm:px-4!">Week</Th>
              <Th align="right" className="px-1.5! sm:px-4!">Sales</Th>
              <Th align="right" className="px-1.5! sm:px-4!">Food</Th>
              <Th align="right" className="pr-3! pl-1.5! sm:px-4!">Labor</Th>
              <Th align="center" className="hidden sm:table-cell">Result</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <WeekRow key={r.weekStart} r={r} />
            ))}
          </tbody>
        </Table>
        <p className="mt-3 text-xs text-muted">Same definitions as the P&amp;L: net sales are Square sales with ignored items left out. Food cost is theoretical (items sold × each day&apos;s recipe cost) as a % of food sales. Labor is timecards × pay rate plus employer taxes, as a % of net sales; weeks ahead use scheduled shifts. The current week counts finished days only, and its sales target is compared pro-rata. A finished week is Hit when sales, food cost and labor all met their targets.</p>
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
          <div>
            <div className={cx("text-sm", isCurrent ? "font-semibold" : "font-medium")}>{shortDate(r.weekStart)}</div>
            <div className="hidden text-xs text-muted sm:block">{isCurrent ? "This week" : `to ${shortDate(end)}`}</div>
            <div className="sm:hidden"><StatusPill r={r} /></div>
          </div>
        </div>
      </Td>
      <Td align="right" className="px-1.5! sm:px-4!">
        <Cell grid="budget" col="sales" week={r.weekStart} field="sales" value={r.sales == null ? null : r.sales.toLocaleString("en-US", { maximumFractionDigits: 2 })} prefix="$" label="Sales target" />
        <Sub value={salesSub == null ? null : money(salesSub, { whole: true })} label={r.when === "future" ? "forecast" : r.when === "current" ? "so far" : "actual"} rag={r.when === "future" ? "none" : r.status.sales} />
      </Td>
      <Td align="right" className="px-1.5! sm:px-4!">
        <Cell grid="budget" col="food" week={r.weekStart} field="foodCostPct" value={pct100(r.foodCostPct)} suffix="%" label="Food cost target" />
        <Sub value={r.foodCostPct_actual == null ? null : pct(r.foodCostPct_actual)} label="of food sales" rag={r.status.foodCostPct} />
      </Td>
      <Td align="right" className="pr-3! pl-1.5! sm:px-4!">
        <Cell grid="budget" col="labor" week={r.weekStart} field="laborPct" value={pct100(r.laborPct)} suffix="%" label="Labor target" />
        <Sub value={laborSub == null ? null : pct(laborSub)} label={r.laborPct_actual != null ? "actual" : "sched."} rag={r.laborPct_actual != null ? r.status.laborPct : rag("laborPct", r.laborPct, laborSub)} />
      </Td>
      <Td align="center" className="hidden sm:table-cell">
        <StatusPill r={r} />
      </Td>
    </tr>
  );
}

function Cell({ grid, col, week, field, value, prefix, suffix, label }: { grid: string; col: string; week: string; field: "sales" | "foodCostPct" | "laborPct"; value: number | string | null; prefix?: string; suffix?: string; label: string }) {
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
      className={cx("ml-auto", field === "sales" ? "w-[5.25rem] sm:w-28" : "w-[3.75rem] sm:w-20")}
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
  const w = weekWord(r);
  if (w.tone === "unknown") return <Badge tone="unknown">{w.word}</Badge>;
  if (w.tone === "neutral") return <span className="text-xs text-muted">{w.word}</span>;
  return (
    <span className={cx("inline-flex items-center gap-1.5 text-xs font-medium", toneText(w.tone))}>
      <Dot tone={w.tone} />
      {w.word}
    </span>
  );
}
