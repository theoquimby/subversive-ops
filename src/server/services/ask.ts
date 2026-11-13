import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { AskToolName, clampPeriod, routeQuestion } from "@/domain/ask";
import { addDays, ISODate } from "@/domain/dates";
import { shiftPaidHours, weekStartOf } from "@/domain/schedule";
import { CLAUDE_MODEL, claudeClient, claudeReady } from "../integrations/claude";
import { db } from "../db";
import { buildContext, loadCostingSnapshot } from "./costing";
import { menuCosts, recentPriceMoves } from "./insights";
import { periodKpis } from "./kpis";
import { buildOrderPlan } from "./planning";
import { businessToday } from "./sales";
import { loadWeek } from "./scheduling";
import { certStatusRows } from "./training";
import { lastCountPeriod, varianceReport } from "./variance";
import { insightFeed } from "./analytics";
import { MODEL_IDS, type ModelId } from "@/domain/analytics";

/**
 * "Ask": a fixed set of read-only data tools. Claude chooses which to call
 * (with a key); otherwise the page routes questions and suggestion buttons to
 * the same tools. Every number shown comes from one of these results.
 */

export interface AskLink { label: string; href: string }
export interface AskTable { columns: string[]; rows: (string | number)[][]; align?: ("left" | "right")[] }
export interface ToolResult {
  tool: AskToolName;
  title: string;
  /** Short plain-English facts with the numbers in them. */
  facts: string[];
  table?: AskTable;
  links: AskLink[];
}

const $ = (n: number | null | undefined, whole = false) => (n == null ? "—" : `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 })}`);
const pc = (n: number | null | undefined, d = 1) => (n == null ? "—" : `${(n * 100).toFixed(d)}%`);
const sd = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// ---- Tools --------------------------------------------------------------------

async function periodKpisTool(args: { from?: unknown; to?: unknown }): Promise<ToolResult> {
  const today = businessToday();
  const p = clampPeriod(args.from, args.to, today);
  const onlyToday = p.from === today && p.to === addDays(today, 1);
  const k = await periodKpis(p.from, p.to, { includeToday: onlyToday });
  const t = k.total;
  const facts = [
    `Net sales ${$(t.sales, true)} over ${k.counted.length} day${k.counted.length === 1 ? "" : "s"} (${sd(p.from)}–${sd(addDays(p.to, -1))})${k.todayExcluded ? ", today not counted yet" : ""}.`,
    `Food cost ${pc(k.foodPct)} of food sales; beverage cost ${pc(k.beveragePct)} of beverage sales (theoretical, from recipes).`,
    `Labor ${$(t.labor, true)} = ${pc(k.laborPct)} of sales over ${t.laborHours.toFixed(0)} hours.`,
    `Prime cost ${pc(k.primePct)}; profit before overhead ${$(t.profit, true)}.`,
  ];
  if (k.counted.length === 0) facts.unshift("No finished days in this period yet.");
  if (k.uncosted.length) facts.push(`${k.uncosted.length} item${k.uncosted.length === 1 ? "" : "s"} sold without a costed recipe, so food cost is a floor.`);
  return {
    tool: "period_kpis",
    title: `Numbers for ${sd(p.from)}–${sd(addDays(p.to, -1))}`,
    facts,
    table: {
      columns: ["", "Sales", "Cost", "%"],
      align: ["left", "right", "right", "right"],
      rows: [
        ["Food", $(k.split.food.sales, true), $(k.split.food.cogs, true), pc(k.split.food.pct)],
        ["Beverage", $(k.split.beverage.sales, true), $(k.split.beverage.cogs, true), pc(k.split.beverage.pct)],
        ["Labor", "", $(t.labor, true), pc(k.laborPct)],
        ["Prime", $(t.sales, true), $(t.primeCost, true), pc(k.primePct)],
      ],
    },
    links: [{ label: "Open in P&L", href: `/pnl?period=custom&from=${p.from}&to=${addDays(p.to, -1)}` }],
  };
}

async function menuMarginsTool(): Promise<ToolResult> {
  const { rows } = await menuCosts();
  const items = rows
    .filter((r) => r.kind === "MENU" && r.menuPrice && r.cost != null)
    .map((r) => {
      const now = r.menuPrice! - r.cost!;
      const before = r.costBefore == null ? null : r.menuPrice! - r.costBefore;
      return { ...r, marginNow: now, change: before == null ? null : now - before };
    });
  const lost = items.filter((i) => i.change != null && i.change < -0.005).sort((a, b) => a.change! - b.change!);
  const over = items.filter((i) => i.foodCostPct != null && i.foodCostPct > i.target).sort((a, b) => b.foodCostPct! - b.target - (a.foodCostPct! - a.target));
  const facts = [
    lost.length ? `${lost.length} menu item${lost.length === 1 ? "" : "s"} lost margin over the last 30 days because ingredient prices moved; the biggest is ${lost[0].name} (${$(lost[0].change)} per plate).` : "No menu item lost margin from price changes in the last 30 days.",
    over.length ? `${over.length} item${over.length === 1 ? " is" : "s are"} above target food cost, worst ${over[0].name} at ${pc(over[0].foodCostPct)} vs ${pc(over[0].target, 0)}.` : "Every costed item is at or under its food cost target.",
  ];
  const show = (lost.length ? lost : over).slice(0, 10);
  return {
    tool: "menu_margins",
    title: lost.length ? "Items that lost margin (last 30 days)" : "Items above target food cost",
    facts,
    table: show.length
      ? { columns: ["Item", "Price", "Cost", "Food %", "Margin change"], align: ["left", "right", "right", "right", "right"], rows: show.map((i) => [i.name, $(i.menuPrice), $(i.cost), pc(i.foodCostPct), i.change == null ? "—" : $(i.change)]) }
      : undefined,
    links: [{ label: "Menu costs", href: "/menu" }, ...show.slice(0, 3).map((i) => ({ label: i.name, href: `/menu/${i.id}` }))],
  };
}

async function priceMovesTool(args: { days?: unknown }): Promise<ToolResult> {
  const days = Math.min(365, Math.max(1, Math.round(Number(args.days) || 30)));
  const moves = await recentPriceMoves(days);
  const up = moves.filter((m) => m.changePct > 0);
  return {
    tool: "price_moves",
    title: `Price changes, last ${days} days`,
    facts: moves.length
      ? [`${moves.length} product price${moves.length === 1 ? "" : "s"} changed (${up.length} up, ${moves.length - up.length} down). Biggest: ${moves[0].description} from ${moves[0].supplier}, ${$(moves[0].oldPrice)} → ${$(moves[0].newPrice)} (${moves[0].changePct > 0 ? "+" : ""}${pc(moves[0].changePct)}).`]
      : ["No supplier prices changed in this window."],
    table: moves.length ? { columns: ["Product", "Supplier", "Was", "Now", "Change"], align: ["left", "left", "right", "right", "right"], rows: moves.slice(0, 10).map((m) => [m.ingredient ?? m.description, m.supplier, $(m.oldPrice), $(m.newPrice), `${m.changePct > 0 ? "+" : ""}${pc(m.changePct)}`]) } : undefined,
    links: [{ label: "Prices", href: "/prices" }],
  };
}

async function marginGapTool(): Promise<ToolResult> {
  const period = await lastCountPeriod();
  if (!period) return { tool: "margin_gap", title: "Margin gap", facts: ["There aren't two completed counts on different days yet, so there's no gap to show."], links: [{ label: "Counts", href: "/count" }] };
  const r = await varianceReport(period.start.id, period.end.id);
  const rows = r.rows.filter((x) => x.unexplainedCost != null && Math.abs(x.unexplainedCost) >= 1).sort((a, b) => b.unexplainedCost! - a.unexplainedCost!).slice(0, 8);
  return {
    tool: "margin_gap",
    title: `Margin gap ${sd(r.from)}–${sd(r.to)}`,
    facts: [
      `Actual usage cost ${$(r.actualCost, true)} vs ${$(r.theoreticalCost, true)} theoretical from sales. Logged waste explains ${$(r.wasteCost, true)}; ${$(r.unexplainedCost, true)} is unexplained.`,
      rows.length ? `Biggest unexplained: ${rows[0].name} (${$(rows[0].unexplainedCost, true)}).` : "No single ingredient stands out.",
    ],
    table: rows.length ? { columns: ["Ingredient", "Unexplained", "Waste"], align: ["left", "right", "right"], rows: rows.map((x) => [x.name, $(x.unexplainedCost, true), $(x.wasteCost, true)]) } : undefined,
    links: [{ label: "Margin gap", href: `/variance?start=${period.start.id}&end=${period.end.id}` }],
  };
}

async function scheduleWeekTool(args: { week_start?: unknown; over_hours?: unknown }): Promise<ToolResult> {
  const today = businessToday();
  const raw = typeof args.week_start === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.week_start) ? args.week_start : today;
  const monday = weekStartOf(raw);
  const over = Number(args.over_hours) > 0 ? Math.min(80, Number(args.over_hours)) : null;
  const w = await loadWeek(monday);
  const hours = new Map<string, number>();
  for (const s of w.shifts) if (s.employeeId) hours.set(s.employeeId, (hours.get(s.employeeId) ?? 0) + shiftPaidHours(s));
  const people = w.employees.map((e) => ({ name: e.name, hours: hours.get(e.id) ?? 0, max: e.maxHoursWeek })).filter((p) => p.hours > 0).sort((a, b) => b.hours - a.hours);
  const list = over != null ? people.filter((p) => p.hours > over) : people;
  const drafts = w.shifts.filter((s) => !s.published).length;
  const facts = [
    `${w.shifts.length} shifts, ${w.summary.hours.toFixed(1)} hours, labor ${pc(w.summary.laborPct)} of ${$(w.summary.sales, true)} forecast sales${w.laborTarget != null ? ` (budget ${pc(w.laborTarget)})` : ""}.`,
    over != null ? (list.length ? `${list.length} ${list.length === 1 ? "person is" : "people are"} over ${over} hours: ${list.map((p) => `${p.name} ${p.hours.toFixed(1)}h`).join(", ")}.` : `Nobody is over ${over} hours.`) : `${people.length} people scheduled; most hours: ${people[0] ? `${people[0].name} ${people[0].hours.toFixed(1)}h` : "—"}.`,
  ];
  if (w.summary.overtimeHours > 0) facts.push(`${w.summary.overtimeHours.toFixed(1)} overtime hours.`);
  if (w.summary.openShifts > 0) facts.push(`${w.summary.openShifts} open shift${w.summary.openShifts === 1 ? "" : "s"} still to fill.`);
  if (drafts) facts.push(`${drafts} shift${drafts === 1 ? " is" : "s are"} draft (not published).`);
  return {
    tool: "schedule_week",
    title: `Schedule, week of ${sd(monday)}`,
    facts,
    table: list.length ? { columns: ["Person", "Hours", "Max"], align: ["left", "right", "right"], rows: list.slice(0, 15).map((p) => [p.name, p.hours.toFixed(1), p.max ?? "—"]) } : undefined,
    links: [{ label: "Open schedule", href: `/schedule?week=${monday}` }],
  };
}

async function orderPlansTool(): Promise<ToolResult> {
  const suppliers = await db.supplier.findMany({ where: { active: true, products: { some: { ingredientId: { not: null } } } }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const plans = (await Promise.all(suppliers.map((s) => buildOrderPlan(s.id).then((p) => ({ s, p })).catch(() => null)))).filter((x) => x != null);
  const rows = plans
    .map(({ s, p }) => ({ id: s.id, name: s.name, delivery: p.deliveryDate, lines: p.lines.filter((l) => l.suggestedUnits > 0).length, total: p.total, short: p.lines.filter((l) => l.status === "runs-out").length }))
    .sort((a, b) => a.delivery.localeCompare(b.delivery));
  const next = rows.find((r) => r.lines > 0);
  return {
    tool: "order_plans",
    title: "Suggested orders",
    facts: next
      ? [
          `Next up: ${next.name} for ${sd(next.delivery)}, ${next.lines} item${next.lines === 1 ? "" : "s"}, about ${$(next.total, true)}.`,
          `${rows.filter((r) => r.lines > 0).length} of ${rows.length} suppliers have something to order.`,
          ...rows.filter((r) => r.short > 0).map((r) => `${r.short} item${r.short === 1 ? "" : "s"} from ${r.name} run out before that delivery.`),
        ]
      : ["Nothing needs ordering right now based on the forecast and last count."],
    table: rows.length ? { columns: ["Supplier", "Delivery", "Items", "Est. total"], align: ["left", "left", "right", "right"], rows: rows.map((r) => [r.name, sd(r.delivery), r.lines, $(r.total, true)]) } : undefined,
    links: [{ label: "Ordering", href: "/ordering" }, ...rows.filter((r) => r.lines > 0).slice(0, 3).map((r) => ({ label: r.name, href: `/ordering/${r.id}` }))],
  };
}

async function wasteSummaryTool(args: { days?: unknown }): Promise<ToolResult> {
  const days = Math.min(365, Math.max(1, Math.round(Number(args.days) || 30)));
  const today = businessToday();
  const since = new Date(`${addDays(today, -days)}T00:00:00Z`);
  const [rows, snap] = await Promise.all([
    db.wasteLog.findMany({ where: { loggedAt: { gte: since } }, include: { ingredient: { select: { id: true, name: true } }, sourceRecipe: { select: { name: true } } } }),
    loadCostingSnapshot(),
  ]);
  const ctx = buildContext(snap, today);
  const by = new Map<string, { name: string; cost: number }>();
  let total = 0;
  for (const w of rows) {
    const c = (ctx.ingredients.get(w.ingredientId)?.costPerBase ?? 0) * w.qtyBase.toNumber();
    total += c;
    const key = w.sourceRecipe ? `r:${w.sourceRecipe.name}` : `i:${w.ingredient.id}`;
    const e = by.get(key) ?? { name: w.sourceRecipe ? `${w.sourceRecipe.name} (prepped/plated)` : w.ingredient.name, cost: 0 };
    e.cost += c;
    by.set(key, e);
  }
  const top = [...by.values()].sort((a, b) => b.cost - a.cost).slice(0, 8);
  const entries = new Set(rows.map((r) => r.batchId ?? r.id)).size;
  return {
    tool: "waste_summary",
    title: `Waste, last ${days} days`,
    facts: [`${entries} waste entr${entries === 1 ? "y" : "ies"} worth ${$(total, true)} at purchase cost.`, top[0] ? `Most: ${top[0].name} (${$(top[0].cost, true)}).` : "Nothing logged."],
    table: top.length ? { columns: ["Item", "Cost"], align: ["left", "right"], rows: top.map((t) => [t.name, $(t.cost, true)]) } : undefined,
    links: [{ label: "Waste log", href: "/waste" }],
  };
}

const CERT_STATUS_WORD: Record<string, string> = { valid: "In date", expiring: "Expiring", expired: "Expired", missing: "Missing", "not-required": "Optional" };
const CERT_FILTERS = ["expired", "expiring", "missing", "valid", "attention"] as const;

async function certStatusTool(args: { cert?: unknown; status?: unknown }): Promise<ToolResult> {
  const status = CERT_FILTERS.find((f) => f === args.status);
  const cert = typeof args.cert === "string" ? args.cert.slice(0, 60) : undefined;
  const r = await certStatusRows({ cert, status });
  const s = r.summary;
  const what = cert && r.matchedType ? r.types.join(", ") : "certificates";
  const label = status === "attention" ? "needing attention" : status ? CERT_STATUS_WORD[status].toLowerCase() : "";
  const rows = [...r.rows].sort((a, b) => (a.expiresOn ?? "0").localeCompare(b.expiresOn ?? "0") || a.person.localeCompare(b.person)).slice(0, 25);
  const facts = [
    cert && !r.matchedType ? `No certificate type matches “${cert}”. Tracked: ${r.types.join(", ") || "none yet"}.` : "",
    status ? `${r.rows.length} ${what} ${label}${r.rows.length ? `: ${rows.slice(0, 6).map((x) => (cert && r.matchedType ? x.person : `${x.person} (${x.cert})`)).join(", ")}${r.rows.length > 6 ? "…" : ""}` : ""}.` : "",
    s.required ? `Team-wide, ${s.ok} of ${s.required} required certificates are in date (${pc(s.pct, 0)}): ${s.expired} expired, ${s.expiring} expiring within 30 days, ${s.missing} missing.` : "No certificates are required yet.",
  ].filter(Boolean);
  return {
    tool: "cert_status",
    title: status ? `${cert && r.matchedType ? what : "Certificates"} ${label}` : `Certificates${cert && r.matchedType ? `: ${what}` : ""}`,
    facts,
    table: rows.length ? { columns: ["Person", "Certificate", "Status", "Expires"], align: ["left", "left", "left", "right"], rows: rows.map((x) => [x.person, x.cert, x.required ? CERT_STATUS_WORD[x.status] : "Optional", x.expiresOn ? sd(x.expiresOn) : "—"]) } : undefined,
    links: [{ label: "Training & certificates", href: "/team/training" }, ...rows.slice(0, 2).map((x) => ({ label: x.person, href: `/team/training?person=${x.employeeId}` }))],
  };
}

async function insightsTool(args: { topic?: unknown }): Promise<ToolResult> {
  const topic = MODEL_IDS.find((m) => m === args.topic) as ModelId | undefined;
  const { items, run } = await insightFeed({ limit: 5, novelty: false });
  if (!run) return { tool: "insights", title: "Insights", facts: ["Insights haven't been worked out yet — they update overnight, or press Refresh on the Insights page."], links: [{ label: "Insights", href: "/insights" }] };
  const age = Math.round((Date.now() - new Date(run.computedAt).getTime()) / 3_600_000);
  if (topic) {
    const r = run.results[topic];
    if (!r) return { tool: "insights", title: "Insights", facts: ["That model hasn't run yet."], links: [{ label: "Insights", href: "/insights" }] };
    return {
      tool: "insights",
      title: r.title,
      facts: [r.headline + ".", r.action, `Confidence: ${r.confidence.note}.`, ...r.how.slice(0, 2)],
      table: r.inputs.length ? { columns: ["Input", "Value"], align: ["left", "right"], rows: r.inputs.slice(0, 10).map((i) => [i.label, i.value]) } : undefined,
      links: [{ label: r.title, href: `/insights#${topic}` }],
    };
  }
  const conf = (c: number) => (c >= 0.65 ? "solid" : c >= 0.4 ? "fair" : "rough");
  return {
    tool: "insights",
    title: "Top opportunities",
    facts: [
      items.length ? `The biggest: ${items[0].title}. ${items[0].action}` : "Nothing worth chasing right now — everything checked is in line.",
      `Worked out ${age <= 1 ? "within the last hour" : `${age} hours ago`} from your own sales, costs and timecards; each figure is a cautious estimate with a range.`,
    ],
    table: items.length ? { columns: ["Finding", "$/month", "Confidence"], align: ["left", "right", "left"], rows: items.map((i) => [i.title, i.oneOff ? `${$(i.oneOff, true)} once` : $(i.monthly, true), conf(i.confidence)]) } : undefined,
    links: [{ label: "Insights", href: "/insights" }, ...items.slice(0, 2).map((i) => ({ label: i.title.slice(0, 40), href: i.href }))],
  };
}

const RUNNERS: Record<AskToolName, (args: Record<string, unknown>) => Promise<ToolResult>> = {
  period_kpis: periodKpisTool,
  menu_margins: menuMarginsTool,
  price_moves: priceMovesTool,
  margin_gap: marginGapTool,
  schedule_week: scheduleWeekTool,
  order_plans: orderPlansTool,
  waste_summary: wasteSummaryTool,
  cert_status: certStatusTool,
  insights: insightsTool,
};

export async function runAskTool(tool: AskToolName, args: Record<string, unknown>): Promise<ToolResult> {
  return RUNNERS[tool](args);
}

// ---- Claude -------------------------------------------------------------------

const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "insights",
    description: "The Insights models' conclusions: the top money opportunities ($/month with confidence), or one model's answer — menu engineering (stars/dogs, what to reprice), price response (what +$1 does), forecast ranges, order quantities, staffing by hour, profit drivers & break-even, unusual days. Use for 'what should I do', 'biggest opportunity', 'break even', 'what if I raise the price', 'am I overstaffed'.",
    input_schema: { type: "object", properties: { topic: { type: "string", enum: ["menu", "price", "forecast", "orders", "staffing", "drivers", "anomalies"], description: "One model; omit for the top opportunities." } } },
  },
  {
    name: "period_kpis",
    description: "Net sales, food cost %, beverage cost %, labor %, prime cost % and profit before overhead for a date range of business days. Use for any question about sales, food cost, labor cost or how a period went.",
    input_schema: { type: "object", properties: { from: { type: "string", description: "First day, YYYY-MM-DD" }, to: { type: "string", description: "Day AFTER the last day (exclusive), YYYY-MM-DD" } }, required: ["from", "to"] },
  },
  { name: "menu_margins", description: "Menu items whose margin dropped in the last 30 days because ingredient prices changed, and items above their food cost target.", input_schema: { type: "object", properties: {} } },
  { name: "price_moves", description: "Supplier product price changes in the last N days, biggest first.", input_schema: { type: "object", properties: { days: { type: "integer", description: "Look-back window in days (default 30)" } } } },
  { name: "margin_gap", description: "Variance between the last two stock counts: actual vs theoretical usage, waste, and the biggest unexplained ingredients.", input_schema: { type: "object", properties: {} } },
  {
    name: "schedule_week",
    description: "Scheduled shifts for a week: hours per person, labor % of forecast, overtime, open and draft shifts. Use for questions about hours, who is working, overtime.",
    input_schema: { type: "object", properties: { week_start: { type: "string", description: "Any date in the week, YYYY-MM-DD (weeks start Monday)" }, over_hours: { type: "number", description: "Only list people scheduled over this many hours" } }, required: ["week_start"] },
  },
  { name: "order_plans", description: "Suggested orders per supplier for their next delivery: item count and estimated total.", input_schema: { type: "object", properties: {} } },
  { name: "waste_summary", description: "Logged waste in the last N days at purchase cost, biggest items first.", input_schema: { type: "object", properties: { days: { type: "integer", description: "Look-back window in days (default 30)" } } } },
  {
    name: "cert_status",
    description: "Staff certifications and required training (ATAP, ServSafe Food Handler, allergen, CPR, sexual harassment prevention, working papers for minors): who holds what, what's expired, expiring within 30 days or missing, and team-wide compliance. Use for 'who has an expired ATAP?', 'who's missing harassment training?'.",
    input_schema: { type: "object", properties: { cert: { type: "string", description: "Part of the certificate name, e.g. ATAP, Food Handler, harassment. Omit for all." }, status: { type: "string", enum: ["expired", "expiring", "missing", "valid", "attention"], description: "Only people in this state; attention = expired, expiring or missing. Omit for everyone." } } },
  },
];

const answerSystem = (today: ISODate) => `You answer questions from the manager of Subversive, a brewery and restaurant in Catskill, NY, about their own business data.
Today is ${today} (business date). Weeks start Monday. "Last week" is the previous Monday–Sunday.
Rules:
- Get every number from the tools. Never estimate, invent or remember figures. If no tool covers the question, say so briefly and suggest what the app can answer.
- Call the tools you need (in parallel when independent), then answer in 1–4 short sentences of plain English with the key numbers. No headings, no tables, no markdown links — the app shows the tool results and links under your answer.
- Food cost here is theoretical (recipes × items sold), as % of food sales.`;

export interface AskResponse {
  answer: string | null;
  results: ToolResult[];
  mode: "claude" | "rules";
  error?: string;
}

const MAX_TURNS = 6;

export async function ask(question: string): Promise<AskResponse> {
  const today = businessToday();
  if (!(await claudeReady())) {
    const r = routeQuestion(question, today);
    if (!r) return { answer: null, results: [], mode: "rules", error: "I can't tell which numbers that needs. Try one of the suggested questions, or turn on AI features in Settings → Connections to ask anything." };
    return { answer: null, results: [await runAskTool(r.tool, r.args)], mode: "rules" };
  }
  const results: ToolResult[] = [];
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: question }];
  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const client = await claudeClient();
      const res = await client.beta.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 8000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: answerSystem(today),
        output_config: { effort: "medium" },
        tools: TOOLS,
        messages,
      });
      if (res.stop_reason === "refusal") return { answer: null, results, mode: "claude", error: "Claude wouldn't answer that one. Try asking it another way." };
      const uses = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (res.stop_reason !== "tool_use" || uses.length === 0) {
        const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
        return { answer: text || null, results: dedupe(results), mode: "claude" };
      }
      messages.push({ role: "assistant", content: res.content });
      const out = await Promise.all(
        uses.map(async (u): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
          const name = u.name as AskToolName;
          const args = z.record(z.string(), z.unknown()).safeParse(u.input);
          if (!(name in RUNNERS) || !args.success) return { type: "tool_result", tool_use_id: u.id, content: "Unknown tool or bad input.", is_error: true };
          try {
            const r = await runAskTool(name, args.data);
            results.push(r);
            return { type: "tool_result", tool_use_id: u.id, content: JSON.stringify({ title: r.title, facts: r.facts, table: r.table }) };
          } catch (e) {
            console.error("ask tool failed", name, e);
            return { type: "tool_result", tool_use_id: u.id, content: "That data couldn't be loaded.", is_error: true };
          }
        }),
      );
      messages.push({ role: "user", content: out });
    }
    return { answer: null, results: dedupe(results), mode: "claude", error: "That took too many steps. Try a narrower question." };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return { answer: null, results, mode: "claude", error: "Claude didn't accept the saved key. Replace it in Settings → Connections → AI features." };
    if (e instanceof Anthropic.RateLimitError) return { answer: null, results, mode: "claude", error: "Claude is busy right now. Try again in a minute." };
    if (e instanceof Anthropic.APIError) return { answer: null, results, mode: "claude", error: "Couldn't reach Claude just now. Try again shortly." };
    console.error("ask failed", e);
    return { answer: null, results, mode: "claude", error: "Something went wrong. Try again." };
  }
}

const dedupe = (rs: ToolResult[]) => [...new Map(rs.map((r) => [`${r.tool}|${r.title}`, r])).values()];
