import { refreshIfStale } from "@/server/services/square-sync";
import { HelpZone } from "@/components/help";
import { Badge, Card, cx, LinkButton } from "@/components/ui";
import { addDays, weekday } from "@/domain/dates";
import { dayDate, money, pct, shortDate, signedPct } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { weeklyBrief, WeeklyBrief } from "@/server/services/brief";
import { BadgeCheck, CalendarDays, ChevronRight, ClipboardList, Gavel, History, type LucideIcon, MessageSquareText, Scale, ShoppingCart, Star, Tag, Trash2, TrendingUp, Unlink, UtensilsCrossed } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { CreateOrderButton } from "./create-order-button";

export const metadata = { title: "Weekly brief" };

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const greeting = () => {
  const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: process.env.BUSINESS_TIMEZONE || "America/New_York", hour: "numeric", hourCycle: "h23" }).format(new Date()));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

interface Item {
  id: string;
  icon: LucideIcon;
  title: string;
  status: string;
  needsYou: boolean;
  body?: ReactNode;
  action: ReactNode;
}

export default async function BriefPage() {
  const session = await requireUser("MANAGER");
  await refreshIfStale();
  const b = await weeklyBrief();
  const items = buildItems(b);
  const todo = items.filter((i) => i.needsYou);
  const clear = items.filter((i) => !i.needsYou);

  const summary: string[] = [];
  if (b.forecast.total > 0) summary.push(`We're forecasting ${money(b.forecast.total, { whole: true })} in sales${b.forecast.busiest.length ? `, busiest on ${list(b.forecast.busiest.map((d) => fullDay(d.date)))}` : ""}.`);
  summary.push(todo.length === 0 ? "Everything else is in hand." : `${todo.length} thing${todo.length === 1 ? " needs" : "s need"} you before the week starts.`);

  return (
    <div className="mx-auto max-w-3xl">
      <HelpZone id="brief.page" className="mb-10"><header>
        <div className="text-[0.8rem] font-medium tracking-wide text-muted uppercase">
          Weekly brief · {shortDate(b.week)} – {shortDate(addDays(b.week, 6))}
        </div>
        <h1 className="mt-2 text-[1.9rem] leading-tight font-semibold tracking-tight text-ink sm:text-[2.2rem]">
          {greeting()}, {session.name}.
        </h1>
        <p className="mt-3 max-w-2xl text-[1.05rem] leading-relaxed text-ink-2">{summary.join(" ")}</p>
      </header></HelpZone>

      {b.lastWeek && <LastWeekCard r={b.lastWeek} />}
      <DecisionsCard items={b.decisions} />
      <ForecastCard b={b} />

      {todo.length > 0 && (
        <HelpZone id="brief.actions" className="mt-10"><section>
          <h2 className="mb-3 text-[0.95rem] font-semibold">Needs you</h2>
          <div className="space-y-3">
            {todo.map((i) => (
              <BriefCard key={i.id} item={i} />
            ))}
          </div>
        </section></HelpZone>
      )}

      {clear.length > 0 && (
        <HelpZone id="brief.inHand" className="mt-10"><section>
          <h2 className="mb-3 text-[0.95rem] font-semibold">In hand</h2>
          <Card className="divide-y divide-border">
            {clear.map((i) => (
              <div key={i.id} className="flex items-center gap-3 px-4 py-3">
                <i.icon className="size-4 shrink-0 text-muted" strokeWidth={1.75} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{i.title}</div>
                  <div className="text-xs text-muted">{i.status}</div>
                </div>
                <div className="shrink-0">{i.action}</div>
              </div>
            ))}
          </Card>
        </section></HelpZone>
      )}

      <p className="mt-10 text-center text-xs text-muted">Built {dayDate(b.today)} from Square sales, your recipes, counts and the schedule.</p>
    </div>
  );
}

const fullDay = (d: string) => ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][weekday(d)];

const RAG_TEXT = { good: "text-good", warn: "text-warn", bad: "text-bad", none: "text-ink" } as const;
const RAG_DOT = { good: "bg-good", warn: "bg-warn", bad: "bg-bad", none: "bg-border-strong" } as const;

function LastWeekCard({ r }: { r: NonNullable<WeeklyBrief["lastWeek"]> }) {
  const fmt = (key: string, n: number | null) => (n == null ? "—" : key === "sales" ? money(n, { whole: true }) : pct(n));
  const vs = (key: string, d: number | null) => (d == null ? null : key === "sales" ? `${d >= 0 ? "+" : "−"}${money(Math.abs(d), { whole: true })}` : `${d >= 0 ? "+" : "−"}${(Math.abs(d) * 100).toFixed(1)} pts`);
  return (
    <HelpZone id="brief.lastWeek" className="mb-6"><Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[0.8rem] font-medium text-muted">
            <History className="size-4" strokeWidth={1.75} />
            Last week vs budget
          </div>
          <div className="mt-1 text-sm text-muted">
            {shortDate(r.from)} – {shortDate(r.to)}
            {r.todayExcluded && <> · {r.days} of 7 days, today still running</>}
            {!r.hasBudget && <> · no budget set · <Link href="/budgets" className="underline decoration-border-strong underline-offset-2 hover:text-ink">set one</Link></>}
          </div>
        </div>
        <LinkButton href={`/pnl?period=custom&from=${r.from}&to=${r.to}`} variant="secondary" size="sm" className="h-10 sm:h-8">Open P&amp;L</LinkButton>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-5">
        {r.rows.map((row) => (
          <div key={row.key} className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs text-muted">
              <span className={cx("size-1.5 shrink-0 rounded-full", RAG_DOT[row.rag])} aria-hidden />
              {row.label}
            </div>
            <div className={cx("num mt-1 text-lg font-semibold tracking-tight", RAG_TEXT[row.rag])}>{fmt(row.key, row.actual)}</div>
            <div className="num text-xs text-muted">
              {row.target == null ? "No target" : <>{row.key === "sales" ? "Budget" : "Target"} {fmt(row.key, row.target)}{vs(row.key, row.diff) && <> · {vs(row.key, row.diff)}</>}</>}
            </div>
          </div>
        ))}
      </div>
    </Card></HelpZone>
  );
}

function DecisionsCard({ items }: { items: WeeklyBrief["decisions"] }) {
  return (
    <HelpZone id="brief.decisions" className="mb-6"><Card className="overflow-hidden">
      <div className="flex items-center gap-2 px-5 pt-4 pb-2 text-[0.8rem] font-medium text-muted">
        <Gavel className="size-4" strokeWidth={1.75} />
        Needs a decision
      </div>
      {items.length === 0 ? (
        <p className="px-5 pb-4 text-sm text-ink-2">Nothing waiting on you: no requests, drafts, invoice issues or low reviews.</p>
      ) : (
        <div className="divide-y divide-border border-t border-border">
          {items.map((d) => (
            <Link key={d.key} href={d.href} className="flex min-h-11 items-center justify-between gap-3 px-5 py-2.5 text-sm hover:bg-surface-2/60">
              <span className="min-w-0">{d.title}</span>
              <ChevronRight className="size-4 shrink-0 text-muted" />
            </Link>
          ))}
        </div>
      )}
    </Card></HelpZone>
  );
}

function ForecastCard({ b }: { b: WeeklyBrief }) {
  const max = Math.max(1, ...b.forecast.days.map((d) => d.qty));
  const target = b.budget?.sales ?? null;
  const vs = target && b.forecast.total ? b.forecast.total / target - 1 : null;
  const busiest = new Set(b.forecast.busiest.map((d) => d.date));
  return (
    <HelpZone id="brief.forecast"><Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[0.8rem] font-medium text-muted">
            <TrendingUp className="size-4" strokeWidth={1.75} />
            Sales forecast
          </div>
          <div className="num mt-1.5 text-[2rem] font-semibold tracking-tight">{money(b.forecast.total, { whole: true })}</div>
          <div className="mt-0.5 text-sm text-muted">
            {target == null ? (
              <>
                No budget for this week · <Link href="/budgets" className="underline decoration-border-strong underline-offset-2 hover:text-ink">set one</Link>
              </>
            ) : (
              <>
                Budget {money(target, { whole: true })}
                {vs != null && <span className={cx("ml-1.5 font-medium", vs >= -0.03 ? "text-good" : "text-warn")}>{signedPct(vs, 0)}</span>}
                {b.schedule.laborPct != null && b.budget?.laborPct != null && (
                  <>
                    {" "}· Labor <span className={cx("font-medium", b.schedule.laborPct > b.budget.laborPct + 0.005 ? "text-warn" : "text-good")}>{pct(b.schedule.laborPct, 0)}</span> scheduled vs {pct(b.budget.laborPct, 0)} target
                  </>
                )}
              </>
            )}
          </div>
        </div>
        <LinkButton href="/sales" variant="secondary" size="sm" className="h-10 sm:h-8">
          Open forecast
        </LinkButton>
      </div>

      <div className="mt-6 grid grid-cols-7 items-end gap-1.5 sm:gap-3" aria-label="Forecast by day">
        {b.forecast.days.map((d) => (
          <div key={d.date} className="flex flex-col items-center gap-1.5">
            <div className="num text-[11px] text-muted">{d.closed || d.qty < 1 ? "Closed" : `$${(d.qty / 1000).toFixed(1)}k`}</div>
            <div className="flex h-24 w-full items-end">
              <div
                className={cx("w-full rounded-md", d.closed || d.qty < 1 ? "bg-surface-2" : busiest.has(d.date) ? "bg-ink" : "bg-border-strong")}
                style={{ height: `${d.qty < 1 ? 4 : Math.max(6, (d.qty / max) * 100)}%` }}
                title={d.closed || d.qty < 1 ? `${dayDate(d.date)}: closed` : `${dayDate(d.date)}: ${money(d.qty, { whole: true })}`}
              />
            </div>
            <div className={cx("text-xs", busiest.has(d.date) ? "font-medium text-ink" : "text-muted")}>{DAY[weekday(d.date)]}</div>
          </div>
        ))}
      </div>
      {b.forecast.events.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {b.forecast.events.map((e) => (
            <Badge key={`${e.date}-${e.title}`}>
              {DAY[weekday(e.date)]} · {e.title}
            </Badge>
          ))}
        </div>
      )}
    </Card></HelpZone>
  );
}

function BriefCard({ item }: { item: Item }) {
  const Icon = item.icon;
  return (
    <Card id={item.id} className="p-4 sm:p-5">
      <div className="flex items-start gap-3.5">
        <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-ink-2">
          <Icon className="size-4" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div className="min-w-0">
              <div className="text-[0.95rem] font-medium">{item.title}</div>
              <div className="mt-0.5 text-sm text-muted">{item.status}</div>
            </div>
            <div className="shrink-0">{item.action}</div>
          </div>
          {item.body && <div className="mt-3">{item.body}</div>}
        </div>
      </div>
    </Card>
  );
}

const go = (href: string, label: string, primary = true) => (
  <LinkButton href={href} variant={primary ? "primary" : "ghost"} size="sm" className="h-10 sm:h-8">
    {label}
  </LinkButton>
);

function Rows({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-border rounded-lg border border-border">{children}</div>;
}

function buildItems(b: WeeklyBrief): Item[] {
  const items: Item[] = [];

  // Orders: one card per supplier with something to order.
  const toOrder = b.orders.filter((o) => o.items > 0 && !o.existingDraftId);
  const drafted = b.orders.filter((o) => o.existingDraftId);
  for (const o of toOrder) {
    const below = o.minOrder != null && o.total < o.minOrder;
    items.push({
      id: `order-${o.supplierId}`,
      icon: ShoppingCart,
      title: `Order from ${o.supplier}`,
      status: `${o.items} item${o.items === 1 ? "" : "s"} · ${money(o.total)} · delivers ${dayDate(o.deliveryDate)}${below ? ` · under ${money(o.minOrder, { whole: true })} minimum` : ""}`,
      needsYou: true,
      body: o.needsCount > 0 || o.runsOut.length > 0 ? (
        <div className="space-y-1">
          {o.runsOut.length > 0 && <p className="text-sm text-bad">Runs out before delivery: {o.runsOut.length > 4 ? `${o.runsOut.slice(0, 4).join(", ")} and ${o.runsOut.length - 4} more` : list(o.runsOut)}.</p>}
          {o.needsCount > 0 && <p className="text-xs text-muted">{o.needsCount} item{o.needsCount === 1 ? " hasn't" : "s haven't"} been counted, so {o.needsCount === 1 ? "it's" : "they're"} not in this draft. <Link href={`/ordering/${o.supplierId}`} className="underline underline-offset-2 hover:text-ink">Review the full order</Link></p>}
        </div>
      ) : undefined,
      action: <CreateOrderButton input={{ supplierId: o.supplierId, deliveryDate: o.deliveryDate, coverUntil: o.coverUntil, lines: o.lines }} />,
    });
  }
  // Drafts saved automatically before a cutoff still need a look and a send.
  for (const o of drafted.filter((d) => d.autoDrafted)) {
    items.push({
      id: `draft-${o.supplierId}`,
      icon: ShoppingCart,
      title: `Send the ${o.supplier} order`,
      status: `Drafted automatically · delivers ${dayDate(o.deliveryDate)}${o.runsOut.length ? ` · ${o.runsOut.length} item${o.runsOut.length === 1 ? " runs" : "s run"} out first` : ""}`,
      needsYou: true,
      action: go(`/ordering/po/${o.existingDraftId}`, "Review & send"),
    });
  }
  if (toOrder.length === 0) {
    items.push({
      id: "orders",
      icon: ShoppingCart,
      title: "Orders",
      status: drafted.length ? `${list(drafted.map((o) => o.supplier))} drafted — send when ready` : b.orders.length ? "Stock covers this week's deliveries" : "No deliveries this week",
      needsYou: false,
      action: drafted.length ? go(`/ordering/po/${drafted[0].existingDraftId}`, "Open draft", false) : go("/ordering", "Ordering", false),
    });
  } else if (drafted.length) {
    items.push({ id: "orders-drafted", icon: ShoppingCart, title: "Drafted orders", status: `${list(drafted.map((o) => o.supplier))} already drafted`, needsYou: false, action: go("/ordering", "Ordering", false) });
  }

  // Schedule
  const s = b.schedule;
  const totalShifts = s.published + s.drafts;
  const laborNote = s.laborPct != null ? ` · labor ${pct(s.laborPct, 0)} of forecast` : "";
  if (totalShifts === 0) {
    items.push({ id: "schedule", icon: CalendarDays, title: "Build next week's schedule", status: "No shifts yet — draft one from the forecast in a tap", needsYou: true, action: go("/schedule", "Build schedule") });
  } else if (s.drafts > 0) {
    items.push({
      id: "schedule",
      icon: CalendarDays,
      title: "Publish the schedule",
      status: `${s.drafts} draft shift${s.drafts === 1 ? "" : "s"}${s.published ? `, ${s.published} published` : ""} · ${Math.round(s.hours)} h${laborNote}${s.open ? ` · ${s.open} open` : ""}`,
      needsYou: true,
      action: go("/schedule", "Review & publish"),
    });
  } else {
    items.push({ id: "schedule", icon: CalendarDays, title: "Schedule", status: `Published · ${s.published} shift${s.published === 1 ? "" : "s"} · ${Math.round(s.hours)} h${laborNote}${s.open ? ` · ${s.open} open` : ""}`, needsYou: s.open > 0, action: go("/schedule", s.open ? "Fill open shifts" : "Schedule", s.open > 0) });
  }

  // Staff requests are in the "Needs a decision" card above.

  // Reviews
  const rv = b.reviews.unreplied;
  items.push({ id: "reviews", icon: MessageSquareText, title: rv ? "Reply to reviews" : "Reviews", status: rv ? `${rv} critical review${rv === 1 ? "" : "s"} without a reply — drafts are ready` : "Every critical review has a reply", needsYou: rv > 0, action: go("/reviews", rv ? "Reply" : "Reviews", rv > 0) });

  // Rating drop
  for (const a of b.reviews.alerts) {
    items.push({ id: "rating", icon: Star, title: a.title, status: a.detail, needsYou: true, action: go("/reviews", "See what to fix") });
  }

  // Price increases
  const inc = b.increases;
  items.push({
    id: "prices",
    icon: Tag,
    title: inc.length ? "Price increases this week" : "Prices",
    status: inc.length ? `${inc.length} item${inc.length === 1 ? "" : "s"} went up in the last 7 days` : "No increases in the last 7 days",
    needsYou: inc.length > 0,
    body: inc.length ? (
      <Rows>
        {inc.slice(0, 3).map((m) => (
          <div key={m.productId} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <span className="min-w-0 truncate">{m.ingredient ?? m.description} <span className="text-muted">· {m.supplier}</span></span>
            <span className="num shrink-0 text-bad">{signedPct(m.changePct)}</span>
          </div>
        ))}
      </Rows>
    ) : undefined,
    action: go("/prices", inc.length ? "Review prices" : "Prices", inc.length > 0),
  });

  // Items over target
  const over = b.overTarget;
  items.push({
    id: "menu",
    icon: UtensilsCrossed,
    title: over.length ? "Menu items over target" : "Menu costs",
    status: over.length ? `${over.length} item${over.length === 1 ? " is" : "s are"} above food-cost target` : "Everything's on target",
    needsYou: over.length > 0,
    body: over.length ? (
      <Rows>
        {over.slice(0, 3).map((r) => (
          <Link key={r.id} href={`/menu/${r.id}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-surface-2/60">
            <span className="min-w-0 truncate">{r.name}</span>
            <span className="num shrink-0"><span className="font-medium text-bad">{pct(r.foodCostPct)}</span> <span className="text-muted">/ {pct(r.target, 0)}</span></span>
          </Link>
        ))}
      </Rows>
    ) : undefined,
    action: go("/menu", over.length ? "Fix costs" : "Menu", over.length > 0),
  });

  // Margin gap
  const g = b.gap;
  const gapBad = g != null && g.foodSales > 0 && g.unexplainedCost / g.foodSales > 0.02;
  items.push({
    id: "gap",
    icon: Scale,
    title: "Margin gap",
    status: g == null ? "Needs two completed counts" : `${money(g.unexplainedCost, { whole: true })} unexplained between ${shortDate(g.from)} and ${shortDate(g.to)}${g.foodSales > 0 ? ` · ${pct(g.unexplainedCost / g.foodSales)} of food sales` : ""}`,
    needsYou: gapBad,
    body: gapBad && g!.top.length ? <p className="text-sm text-ink-2">Biggest gaps: {list(g!.top.map((t) => `${t.name} (${money(t.cost, { whole: true })})`))}.</p> : undefined,
    action: go("/variance", gapBad ? "See the gap" : "Margin gap", gapBad),
  });

  // Counts
  const c = b.counts;
  items.push({
    id: "counts",
    icon: ClipboardList,
    title: c.overdue ? "Count is overdue" : "Counts",
    status: c.last == null ? "No completed counts yet — ordering and the margin gap need one" : c.overdue ? `Last full count was ${c.daysSince} days ago (${shortDate(c.last)})` : `Last count ${shortDate(c.last)}`,
    needsYou: c.overdue,
    action: go("/count", c.overdue ? "Start a count" : "Counts", c.overdue),
  });

  // Square items selling without a recipe: their cost is missing from food cost.
  const u = b.unmapped;
  items.push({
    id: "unmapped",
    icon: Unlink,
    title: u.count ? "Square items without a recipe" : "Square menu",
    status: u.count ? `${u.count} item${u.count === 1 ? "" : "s"} sold ${money(u.sales, { whole: true })} in the last 7 days with no recipe, so food cost reads low` : "Everything that sold is linked to a recipe",
    needsYou: u.count > 0,
    body: u.count ? (
      <Rows>
        {u.top.slice(0, 3).map((m) => (
          <div key={m.name} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <span className="min-w-0 truncate">{m.name}</span>
            <span className="num shrink-0 text-muted">{Number(m.qty.toFixed(1))} sold · {money(m.sales, { whole: true })}</span>
          </div>
        ))}
      </Rows>
    ) : undefined,
    action: go("/sales/square-menu", u.count ? "Link recipes" : "Square menu", u.count > 0),
  });

  // Training & certificates
  const t = b.training;
  if (t && (t.hasTypes || t.overdue.length || t.ready.length)) {
    const certIssues = t.expired.length + t.expiring.length + t.missing.length;
    const parts = [
      t.expired.length ? `${t.expired.length} expired` : "",
      t.expiring.length ? `${t.expiring.length} expiring in 30 days` : "",
      t.missing.length ? `${t.missing.length} missing` : "",
      t.overdue.length ? `${t.overdue.length} checklist${t.overdue.length === 1 ? "" : "s"} overdue` : "",
      t.ready.length ? `${t.ready.length} to sign off` : "",
    ].filter(Boolean);
    const rows = [
      ...t.expired.map((x) => ({ key: `x-${x.employeeId}-${x.cert}`, who: x.person, what: x.cert, note: `Expired ${x.expiresOn ? shortDate(x.expiresOn) : ""}`, tone: "text-bad" })),
      ...t.expiring.map((x) => ({ key: `e-${x.employeeId}-${x.cert}`, who: x.person, what: x.cert, note: `Expires ${x.expiresOn ? shortDate(x.expiresOn) : ""}`, tone: "text-warn" })),
      ...t.missing.map((x) => ({ key: `m-${x.employeeId}-${x.cert}`, who: x.person, what: x.cert, note: "Missing", tone: "text-bad" })),
      ...t.overdue.map((x) => ({ key: `o-${x.person}-${x.module}`, who: x.person, what: x.module, note: `${x.done}/${x.total} · due ${x.dueOn ? shortDate(x.dueOn) : ""}`, tone: "text-bad" })),
    ];
    const needs = certIssues + t.overdue.length > 0;
    items.push({
      id: "training",
      icon: BadgeCheck,
      title: "Training & certificates",
      status: parts.length ? parts.join(" · ") : `Everyone's certificates are in date${t.summary.nextExpiry ? ` · next expiry ${shortDate(t.summary.nextExpiry)}` : ""}`,
      needsYou: needs,
      body: rows.length ? (
        <Rows>
          {rows.slice(0, 5).map((r) => (
            <div key={r.key} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 truncate">{r.who} <span className="text-muted">· {r.what}</span></span>
              <span className={cx("num shrink-0 text-xs", r.tone)}>{r.note}</span>
            </div>
          ))}
          {rows.length > 5 && <div className="px-3 py-2 text-xs text-muted">and {rows.length - 5} more</div>}
        </Rows>
      ) : undefined,
      action: go("/team/training", needs ? "Open training" : "Training", needs),
    });
  }

  // Waste log
  const w = b.waste;
  items.push({
    id: "waste",
    icon: Trash2,
    title: w.quiet ? "Nothing in the waste log lately" : "Waste log",
    status: w.last == null ? "No waste logged yet — the margin gap can't tell waste from loss without it" : w.quiet ? `Last entry ${w.daysSince} days ago (${shortDate(w.last)}). Remind the team to log spills, comps and spoilage.` : `Last entry ${shortDate(w.last)}`,
    needsYou: w.quiet,
    action: go("/waste", w.quiet ? "Log waste" : "Waste", w.quiet),
  });

  return items;
}
