import { HelpTip, HelpZone } from "@/components/help";
import { Card, cx, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { addDays, ISODate } from "@/domain/dates";
import { windowLabel } from "@/domain/prep";
import { dayDate } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { buildPrepList } from "@/server/services/prep";
import Link from "next/link";
import { PrepBoard, type BoardLine } from "./board";
import { PrepTabs } from "./tabs";

export const metadata = { title: "Prep list" };

const lc = (s: string) => s.replace(/\b(Today|Tomorrow)\b/g, (m) => m.toLowerCase());

export default async function PrepPage({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const me = await requireUser();
  const { day } = await searchParams;
  const list = await buildPrepList(day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : undefined);
  const manager = me.role === "MANAGER";
  const tomorrow = addDays(list.today, 1);
  const isToday = list.prepDate === list.today;
  const label = (d: ISODate) => (d === list.today ? "Today" : d === tomorrow ? "Tomorrow" : dayDate(d));

  const lines: BoardLine[] = list.lines.map((l) => ({
    recipeId: l.recipeId,
    name: l.name,
    station: l.station?.trim() || "Prep",
    status: l.status,
    unit: l.unit,
    batchBase: l.batchBase,
    stepBase: l.stepBase,
    makeBase: l.makeBase,
    amountText: l.amountText,
    why: l.why,
    overShelf: l.overShelf,
    shelfLifeDays: l.shelfLifeDays,
    shelfCapBase: l.shelfCapBase,
    onHandBase: l.onHandBase,
    onHandKnown: l.onHandKnown,
    countedAt: l.countedAt,
    countedBy: l.countedBy,
    runsOutIn: l.runsOutIn,
    done: l.done,
  }));
  const noForecast = list.source.linked === 0 && list.source.guessed.length === 0;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        help="prep.page"
        title="Prep list"
        description={`${isToday ? "Today" : dayDate(list.prepDate)} · enough for ${lc(windowLabel(list.window, list.today))}${list.coverDays > 1 ? ` (${list.coverDays} service days)` : ""}`}
      />
      {manager && <PrepTabs active="today" />}

      <HelpZone id="prep.day" className="mb-5">
        <div className="inline-flex rounded-xl border border-border bg-surface p-1" role="group" aria-label="Prep for">
          {[list.today, tomorrow].map((d) => (
            <Link
              key={d}
              href={d === list.today ? "/prep" : `/prep?day=${d}`}
              aria-current={d === list.prepDate ? "page" : undefined}
              className={cx("inline-flex h-10 min-w-24 items-center justify-center rounded-lg px-4 text-sm font-medium transition-colors duration-120 sm:h-9", d === list.prepDate ? "bg-primary text-primary-ink" : "text-ink-2 hover:bg-surface-2")}
            >
              {label(d)}
            </Link>
          ))}
        </div>
      </HelpZone>

      {list.lines.length === 0 ? (
        <EmptyState title="No prep recipes yet" action={manager ? <LinkButton href="/menu">Open menu costs</LinkButton> : undefined}>
          Prep recipes (sauces, pickles, croutons…) show up here once they have a batch size and ingredients.
        </EmptyState>
      ) : (
        <PrepBoard lines={lines} day={list.prepDate} me={me.name} manager={manager} />
      )}

      <HelpZone id="prep.how" className="mt-10">
        <Card className="p-4 text-sm text-ink-2">
          <div className="mb-1 flex items-center gap-1 font-medium text-ink">How the amounts are worked out <HelpTip id="prep.how" /></div>
          <p>
            Forecast sales of every dish that uses it, for {lc(windowLabel(list.window, list.today))}, minus what&apos;s on hand, rounded up to batches.
            Par is the least to keep; shelf life caps it.
            {noForecast
              ? " No sales history matches a recipe yet, so only pars count."
              : list.source.linked > 0
                ? ` Uses ${list.source.linked} linked Square item${list.source.linked === 1 ? "" : "s"}${list.source.guessed.length ? ` and ${list.source.guessed.length} matched by name` : ""}.`
                : ` No Square items are linked to recipes yet, so ${list.source.guessed.length} were matched by name.`}
          </p>
          {manager && list.source.guessed.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-muted hover:text-ink">Matched by name</summary>
              <ul className="mt-2 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                {list.source.guessed.map((g) => (
                  <li key={g.sale} className="min-w-0 truncate"><span className="text-ink">{g.sale}</span> <span className="text-muted">→ {g.recipe}</span></li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted">Wrong one? Link the item on <Link className="underline" href="/sales">Sales &amp; forecast</Link> and the link wins.</p>
            </details>
          )}
        </Card>
      </HelpZone>
    </div>
  );
}
