import { CalendarRange, ChartLine, Check, CircleDashed, Clock3, Leaf, Lock, ShoppingCart, Tag, TriangleAlert, Users, UtensilsCrossed, type LucideIcon } from "lucide-react";
import { HelpZone } from "@/components/help";
import { Card, cx, LinkButton } from "@/components/ui";
import type { Insight, ModelId } from "@/domain/analytics";
import type { SetupStep } from "@/server/services/analytics";
import { InsightChart } from "./charts";
import { ShowMeHow } from "./deck";

/**
 * The Lab: one tidy tile per question. Each has one big answer, a small
 * graphic and a "Show me how" drawer with the evidence. A tile whose model
 * needs data shows exactly what unlocks it, how far along that is, and a
 * button that goes there.
 */

export interface TileSpec {
  id: ModelId;
  title: string;
  question: string;
  icon: LucideIcon;
  help: string;
  setup?: SetupStep[];
}

export const TILES: Omit<TileSpec, "setup">[] = [
  { id: "forecast", title: "Next two weeks", question: "How busy will it be?", icon: ChartLine, help: "insights.forecast" },
  { id: "staffing", title: "Staffing by hour", question: "Are the right number of people on?", icon: Users, help: "insights.staffing" },
  { id: "week", title: "Your week", question: "What does each day leave you?", icon: CalendarRange, help: "insights.week" },
  { id: "seasons", title: "Your seasons", question: "What does the year look like?", icon: Leaf, help: "insights.seasons" },
  { id: "price", title: "Prices", question: "Where would a price rise pay?", icon: Tag, help: "insights.price" },
  { id: "menu", title: "Menu", question: "Which dishes earn their place?", icon: UtensilsCrossed, help: "insights.menu" },
  { id: "orders", title: "Ordering", question: "Are you ordering the right amount?", icon: ShoppingCart, help: "insights.orders" },
  { id: "anomalies", title: "Unusual days", question: "Anything odd lately?", icon: TriangleAlert, help: "insights.anomalies" },
];

export function LabTile({ spec, r }: { spec: TileSpec; r: Insight | undefined }) {
  const Icon = spec.icon;
  const locked = !r || r.status === "thin" || r.status === "none" || r.status === "error";
  const steps = spec.setup ?? [];
  const done = steps.filter((s) => s.done).length;
  const wide = spec.id === "forecast" && !locked;
  return (
    <HelpZone id={spec.help} className={cx("h-full min-w-0", wide && "lg:col-span-2")}>
      <Card id={`lab-${spec.id}`} className={cx("lab flex h-full scroll-mt-20 flex-col rounded-2xl p-5 shadow-[var(--lab-card-shadow)] sm:p-6", locked && "bg-[color-mix(in_oklab,var(--surface-2)_35%,var(--surface))]")}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[color-mix(in_oklab,var(--area)_10%,var(--surface))]"><Icon className="size-[18px] text-area" strokeWidth={1.8} /></span>
            <div className="min-w-0">
              <h3 className="truncate text-[0.98rem] font-semibold tracking-tight text-ink">{spec.title}</h3>
              <div className="truncate text-xs text-muted">{spec.question}</div>
            </div>
          </div>
          {locked ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-2 px-2 py-1 text-[0.7rem] font-medium text-ink-2"><Lock className="size-3" strokeWidth={2} />{r?.status === "error" ? "Retrying" : "Needs setup"}</span>
          ) : (
            <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[0.7rem] text-muted" title={r.confidence.note}>{r.confidence.note.replace(/^Based on /, "")}</span>
          )}
        </div>

        {!r ? (
          <p className="mt-4 text-sm text-muted">This one arrives with the next update of the analytics service.</p>
        ) : locked ? (
          <>
            <p className="mt-4 text-[0.98rem] leading-snug font-medium text-ink-2">{r.status === "error" ? "Couldn't be worked out this time — it tries again tonight." : r.headline}</p>
            {steps.length > 0 && (
              <div className="mt-4 rounded-xl border border-border bg-surface p-3.5">
                <div className="mb-3 flex items-center gap-3 text-xs">
                  <span className="font-medium text-ink-2">To unlock it</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2"><span className="block h-full rounded-full bg-ink-2 transition-[width] duration-260" style={{ width: `${(done / steps.length) * 100}%` }} /></span>
                  <span className="num text-muted">{done} of {steps.length}</span>
                </div>
                <ul className="flex flex-col gap-2.5">
                  {steps.map((s) => (
                    <li key={s.label} className="flex items-center gap-2.5">
                      {s.done ? <Check className="size-4 shrink-0 text-good" strokeWidth={2.2} /> : <CircleDashed className="size-4 shrink-0 text-muted" strokeWidth={1.75} />}
                      <div className="min-w-0 flex-1">
                        <div className={cx("text-sm leading-snug", s.done ? "text-muted line-through decoration-border-strong" : "text-ink")}>{s.label}</div>
                        {s.progress && !s.done && <div className="num text-xs text-muted">{s.progress}</div>}
                      </div>
                      {!s.done && <LinkButton href={s.href} size="sm" className="h-10 shrink-0 sm:h-8">{s.cta} →</LinkButton>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : (
          <>
            <p className="mt-4 text-[1.1rem] leading-snug font-semibold tracking-[-0.01em] text-balance text-ink">{r.headline}</p>
            {r.action && <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{r.action}</p>}
            {r.chart && (
              <div className="mt-5 min-w-0">
                <InsightChart chart={r.chart} details={r.details} />
              </div>
            )}
          </>
        )}
        <div className="mt-auto pt-3">
          {r && !locked && <ShowMeHow how={r.how} inputs={r.inputs} evidence={r.evidence ?? null} both className="border-t border-border" />}
          {r && locked && r.how.length > 0 && <ShowMeHow how={r.how} inputs={[]} className="border-t border-border" label="Why it needs this" />}
        </div>
      </Card>
    </HelpZone>
  );
}

export function UpdatedNote({ icon: Icon = Clock3, children }: { icon?: LucideIcon; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted">
      <Icon className="size-3.5" strokeWidth={1.75} />
      {children}
    </p>
  );
}
