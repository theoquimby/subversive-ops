import "server-only";
import { paidHours, staffingCurve } from "@/domain/labor";
import { addDays, businessDate, ISODate, parseISODate, weekday, zonedMidnightUTC } from "@/domain/dates";
import { forecastSeries } from "@/domain/forecast";
import {
  estimateRating,
  fallbackReply,
  isTheme,
  keywordSentiment,
  keywordThemes,
  operationalHint,
  OpsDay,
  FixAction,
  parsePastedReviews,
  RatingDrop,
  ratingDrop,
  REVIEW_THEMES,
  ReviewSource,
  reviewFingerprint,
  Sentiment,
  THEME_KEYS,
  themeCounts,
  themeLabel,
  whatToFixFallback,
} from "@/domain/reviews";
import { z } from "zod";
import { db, num } from "../db";
import { env } from "../env";
import { claudeReady, claudeJSON } from "../integrations/claude";
import { fetchGoogleReviews, GOOGLE_NOT_SET_UP, googlePlacesReady } from "../integrations/google-places";
import { buildContext, loadCostingSnapshot, safeCost } from "./costing";
import { dailySalesHistory } from "./forecasting";
import { targetFoodCost } from "./insights";
import { getOpeningHours } from "./labor-rules";
import { businessToday, salesByRecipe } from "./sales";

export const SETTING_PLACE_ID = "reviews.googlePlaceId";
export const SETTING_TONE = "reviews.toneNotes";
const HINT_PREFIX = "reviews.hint.";

const tz = () => env.BUSINESS_TIMEZONE;
export const reviewDate = (d: Date) => businessDate(d, tz());

export async function reviewSettings() {
  const rows = await db.setting.findMany({ where: { key: { in: [SETTING_PLACE_ID, SETTING_TONE, "reviews.googlePlaceName"] } } });
  const get = (k: string) => rows.find((r) => r.key === k)?.value ?? "";
  return { placeId: get(SETTING_PLACE_ID), placeName: get("reviews.googlePlaceName"), toneNotes: get(SETTING_TONE), googleConfigured: await googlePlacesReady(), claude: await claudeReady() };
}

export async function saveReviewSetting(key: typeof SETTING_PLACE_ID | typeof SETTING_TONE, value: string) {
  if (!value) await db.setting.deleteMany({ where: { key } });
  else await db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

/** Root-cause hints written by Claude, by review id. */
export async function claudeHints(): Promise<Map<string, string>> {
  const rows = await db.setting.findMany({ where: { key: { startsWith: HINT_PREFIX } } });
  return new Map(rows.map((r) => [r.key.slice(HINT_PREFIX.length), r.value]));
}

// ---- Operations on the day of a review --------------------------------------------

/** Sales vs forecast, staffing vs need, and items over food-cost target, for each date. */
export async function opsForDates(dates: ISODate[]): Promise<Map<ISODate, OpsDay>> {
  const out = new Map<ISODate, OpsDay>();
  const uniq = [...new Set(dates)].sort();
  if (uniq.length === 0) return out;
  const first = uniq[0];
  const last = addDays(uniq[uniq.length - 1], 1);

  const [history, positions, shifts, timecards, hourly, opening, snap, globalTarget, sold] = await Promise.all([
    dailySalesHistory(addDays(first, -120), last),
    db.position.findMany(),
    db.shift.findMany({ where: { start: { gte: zonedMidnightUTC(first, tz()), lt: zonedMidnightUTC(last, tz()) } } }),
    db.timecard.findMany({ where: { clockIn: { gte: zonedMidnightUTC(first, tz()), lt: zonedMidnightUTC(last, tz()) }, clockOut: { not: null } } }),
    db.hourlySale.findMany({ where: { date: { gte: parseISODate(first), lt: parseISODate(last) } } }),
    getOpeningHours(),
    loadCostingSnapshot(),
    targetFoodCost(),
    Promise.all(uniq.map(async (d) => [d, (await salesByRecipe(d, addDays(d, 1))).byRecipe] as const)),
  ]);
  const soldBy = new Map(sold);
  const staffable = positions.filter((p) => p.salesPerHour != null || p.minStaff > 0);

  for (const date of uniq) {
    const sales = history.sales.get(date) ?? null;
    const [f] = forecastSeries({ history: history.sales, openDays: history.openDays, asOf: date, dates: [date] });
    const forecast = f && f.samples > 0 ? f.qty : null;

    const dayShifts = shifts.filter((s) => reviewDate(s.start) === date);
    const dayCards = timecards.filter((t) => reviewDate(t.clockIn) === date);
    const scheduledHours = dayShifts.length ? dayShifts.reduce((s, x) => s + paidHours(x), 0) : null;
    const workedHours = dayCards.length ? dayCards.reduce((s, x) => s + paidHours({ start: x.clockIn, end: x.clockOut!, breakMinutes: x.breakMinutes }), 0) : null;

    let neededHours: number | null = null;
    const hours = opening[weekday(date)];
    if (staffable.length && hours && sales) {
      const openHours = Array.from({ length: 24 }, (_, h) => h >= hours[0] && h < hours[1]);
      const rows = hourly.filter((h) => h.date.toISOString().slice(0, 10) === date);
      const openCount = openHours.filter(Boolean).length || 1;
      const curve = rows.length ? Array.from({ length: 24 }, (_, h) => rows.find((r) => r.hour === h)?.netSales.toNumber() ?? 0) : openHours.map((o) => (o ? sales / openCount : 0));
      neededHours = staffable.reduce(
        (s, p) => s + staffingCurve(curve, { id: p.id, name: p.name, salesPerHour: num(p.salesPerHour), minStaff: p.minStaff, maxStaff: p.maxStaff }, openHours).reduce((a, b) => a + b, 0),
        0,
      );
    }

    const ctx = buildContext(snap, date);
    const overTarget: OpsDay["overTarget"] = [];
    for (const [recipeId, series] of soldBy.get(date) ?? new Map()) {
      const recipe = snap.recipes.find((r) => r.id === recipeId);
      const res = safeCost(ctx, recipeId);
      if (!recipe || "error" in res || res.foodCostPct == null) continue;
      const target = recipe.targetFoodCostPct?.toNumber() ?? globalTarget;
      if (res.foodCostPct > target) overTarget.push({ name: recipe.name, foodCostPct: res.foodCostPct, target, sold: series.get(date) ?? 0 });
    }
    overTarget.sort((a, b) => b.sold - a.sold);
    out.set(date, { date, sales, forecast, scheduledHours, neededHours, workedHours, overTarget });
  }
  return out;
}

// ---- Analysis --------------------------------------------------------------------

const analysisSchema = z.object({
  themes: z.array(z.enum(THEME_KEYS as [string, ...string[]])),
  sentiment: z.enum(["positive", "mixed", "negative"]),
  rootCause: z.string(),
  reply: z.string(),
});

const VOICE = `You write review replies for Subversive, a small brewery and taproom with a kitchen in Catskill, NY.
Voice: friendly, local, plain-spoken, a little warm. Short (2–4 sentences). First name only if given. No corporate phrases ("we strive", "valued guest", "we apologize for any inconvenience"), no emojis, no exclamation-mark pile-ups, no discounts or promises you can't keep. Thank happy guests specifically for what they mentioned. For unhappy guests: own it, name the concrete fix, invite them back. Sign off "— the Subversive crew".`;

function opsFacts(o: OpsDay | undefined): string {
  if (!o) return "No operations data for that day.";
  const f: string[] = [];
  if (o.sales != null) f.push(`Net sales $${Math.round(o.sales)}${o.forecast ? ` vs forecast $${Math.round(o.forecast)}` : ""}.`);
  if (o.scheduledHours != null) f.push(`Staff hours scheduled: ${o.scheduledHours.toFixed(1)}.`);
  if (o.workedHours != null) f.push(`Staff hours worked: ${o.workedHours.toFixed(1)}.`);
  if (o.neededHours != null) f.push(`Staff hours needed for that sales level: ${o.neededHours.toFixed(1)}.`);
  if (o.overTarget.length) f.push(`Items over food-cost target that day: ${o.overTarget.slice(0, 5).map((i) => `${i.name} (${Math.round(i.foodCostPct * 100)}% vs ${Math.round(i.target * 100)}%)`).join(", ")}.`);
  return f.join(" ") || "No operations data for that day.";
}

interface AnalyzableReview {
  id: string;
  author: string | null;
  rating: number;
  text: string;
  postedAt: Date;
}

async function analyzeOne(r: AnalyzableReview, ops: OpsDay | undefined, toneNotes: string) {
  if (await claudeReady()) {
    const res = await claudeJSON({
      schema: analysisSchema,
      effort: "low",
      maxTokens: 2000,
      system: `${VOICE}${toneNotes ? `\nOwner's notes on tone: ${toneNotes}` : ""}`,
      content: [
        `Analyse this ${r.rating}-star review and draft a reply.

Themes — pick any that the review talks about, from: ${THEME_KEYS.map((k) => `${k} (${REVIEW_THEMES[k]})`).join(", ")}.
rootCause — one plain sentence on the likely operational cause, using the day's operations data below when it explains the complaint (e.g. short-staffed, sales above forecast, a recipe over cost). Empty string for positive reviews or when nothing points to a cause.

Review by ${r.author ?? "a guest"} on ${reviewDate(r.postedAt)}:
"""${r.text}"""

Operations that day: ${opsFacts(ops)}`,
      ],
    });
    if (res.ok) {
      return { themes: res.data.themes.filter(isTheme), sentiment: res.data.sentiment as Sentiment, replyDraft: res.data.reply.trim(), rootCause: res.data.rootCause.trim() || null };
    }
  }
  const themes = keywordThemes(r.text);
  const sentiment = keywordSentiment(r.rating, r.text);
  return { themes, sentiment, replyDraft: fallbackReply({ author: r.author, rating: r.rating, themes, sentiment }), rootCause: null };
}

/** Themes, sentiment and a reply draft for each review (Claude when configured, keywords otherwise). */
export async function analyzeReviews(ids: string[]) {
  if (ids.length === 0) return 0;
  const reviews = await db.review.findMany({ where: { id: { in: ids } } });
  const { toneNotes } = await reviewSettings();
  const ops = await opsForDates(reviews.filter((r) => r.rating <= 3).map((r) => reviewDate(r.postedAt)));
  const queue = [...reviews];
  const worker = async () => {
    for (let r = queue.shift(); r; r = queue.shift()) {
      const a = await analyzeOne(r, ops.get(reviewDate(r.postedAt)), toneNotes);
      await db.review.update({ where: { id: r.id }, data: { themes: a.themes, sentiment: a.sentiment, replyDraft: r.replied ? r.replyDraft ?? a.replyDraft : a.replyDraft } });
      const key = `${HINT_PREFIX}${r.id}`;
      if (a.rootCause) await db.setting.upsert({ where: { key }, create: { key, value: a.rootCause }, update: { value: a.rootCause } });
      else await db.setting.deleteMany({ where: { key } });
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, reviews.length) }, worker));
  return reviews.length;
}

// ---- Import --------------------------------------------------------------------------

/** Tell managers about new 1–2★ reviews (after the response when in a request). */
async function alertBadReviews(ids: string[]) {
  if (ids.length === 0) return;
  // Imported lazily: notify → brief → reviews would otherwise be a cycle.
  const { inBackground, notifyBadReviews } = await import("./notify");
  inBackground(() => notifyBadReviews(ids));
}

export async function importPastedReviews(text: string, defaultSource: ReviewSource) {
  const today = businessToday();
  const parsed = parsePastedReviews(text, today, defaultSource);
  if (parsed.length === 0) return { added: 0, skipped: 0, parsed: 0 };
  const created: string[] = [];
  let skipped = 0;
  for (const p of parsed) {
    const externalId = reviewFingerprint(p);
    const exists = await db.review.findUnique({ where: { source_externalId: { source: p.source, externalId } } });
    if (exists) {
      skipped++;
      continue;
    }
    const date = p.date ?? today;
    const r = await db.review.create({
      data: {
        source: p.source,
        externalId,
        author: p.author,
        rating: p.rating ?? estimateRating(p.text),
        text: p.text,
        // Noon local, so the business date never shifts.
        postedAt: new Date(zonedMidnightUTC(date, tz()).getTime() + 12 * 3600_000),
      },
    });
    created.push(r.id);
  }
  await analyzeReviews(created);
  await alertBadReviews(created);
  return { added: created.length, skipped, parsed: parsed.length };
}

export async function importGoogleReviews() {
  const { placeId } = await reviewSettings();
  if (!(await googlePlacesReady())) return { error: GOOGLE_NOT_SET_UP };
  if (!placeId) return { error: "Pick your business first: Settings → Connections → Google reviews → Find my business." };
  try {
    const rows = await fetchGoogleReviews(placeId);
    const created: string[] = [];
    for (const g of rows) {
      const exists = await db.review.findUnique({ where: { source_externalId: { source: "GOOGLE", externalId: g.externalId } } });
      if (exists) continue;
      const r = await db.review.create({ data: { source: "GOOGLE", externalId: g.externalId, author: g.author, rating: g.rating, text: g.text, postedAt: g.postedAt } });
      created.push(r.id);
    }
    await analyzeReviews(created);
    await alertBadReviews(created);
    await db.setting.upsert({ where: { key: "reviews.lastGoogleSync" }, create: { key: "reviews.lastGoogleSync", value: new Date().toISOString() }, update: { value: new Date().toISOString() } });
    return { added: created.length, fetched: rows.length };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't reach Google." };
  }
}

// ---- Reading -------------------------------------------------------------------------

export async function loadReviews() {
  const rows = await db.review.findMany({ orderBy: { postedAt: "desc" } });
  return rows.map((r) => ({ ...r, date: reviewDate(r.postedAt) }));
}

export type LoadedReview = Awaited<ReturnType<typeof loadReviews>>[number];

export const needsReply = (r: { replied: boolean; rating: number; sentiment: string | null }) => !r.replied && (r.rating <= 3 || r.sentiment === "negative" || r.sentiment === "mixed");

/** Count for the weekly brief: negative/mixed reviews still waiting for a reply. */
export async function unrepliedNegative(sinceDays = 60) {
  const since = zonedMidnightUTC(addDays(businessToday(), -sinceDays), tz());
  const rows = await db.review.findMany({ where: { replied: false, postedAt: { gte: since } }, select: { rating: true, sentiment: true, replied: true } });
  return rows.filter(needsReply).length;
}

// ---- Daily Google import (cron) --------------------------------------------------------

/**
 * Daily job: import new Google reviews when the key and Place ID are set.
 * Quietly skips (no error) when Google isn't configured. Never throws.
 */
export async function importGoogleReviewsDaily(): Promise<{ skipped: string } | { added: number; fetched: number } | { error: string }> {
  const { placeId } = await reviewSettings();
  if (!(await googlePlacesReady())) return { skipped: "No Google key saved" };
  if (!placeId) return { skipped: "No Google business picked" };
  try {
    return await importGoogleReviews();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Google import failed" };
  }
}

export async function lastGoogleSync(): Promise<Date | null> {
  const s = await db.setting.findUnique({ where: { key: "reviews.lastGoogleSync" } });
  return s ? new Date(s.value) : null;
}

// ---- Rating-drop alert (for the weekly brief) -------------------------------------------

export interface ReviewAlert {
  kind: "rating-drop";
  title: string;
  detail: string;
  drop: RatingDrop;
}

/** Alerts worth surfacing in the brief: the 30-day rating ≥ 0.3★ below the 90 days before. */
export async function reviewAlerts(): Promise<ReviewAlert[]> {
  const today = businessToday();
  const since = zonedMidnightUTC(addDays(today, -121), tz());
  const rows = await db.review.findMany({ where: { postedAt: { gte: since } }, select: { rating: true, postedAt: true, themes: true, sentiment: true } });
  const drop = ratingDrop(rows.map((r) => ({ rating: r.rating, postedAt: reviewDate(r.postedAt), themes: r.themes, sentiment: r.sentiment })), today);
  if (!drop.alert) return [];
  const themes = drop.themes.slice(0, 2).map((t) => themeLabel(t).toLowerCase());
  return [
    {
      kind: "rating-drop",
      title: "Rating is slipping",
      detail: `${drop.recent!.toFixed(1)}★ over the last 30 days (${drop.recentCount} reviews), down from ${drop.baseline!.toFixed(1)}★ the 90 days before${themes.length ? `. Most mentioned: ${themes.join(" and ")}` : ""}.`,
      drop,
    },
  ];
}

// ---- Monthly "what to fix" -----------------------------------------------------------------

const FIX_KEY = "reviews.whatToFix";

export interface WhatToFix {
  month: string; // YYYY-MM it was written for
  generatedAt: string;
  by: "claude" | "rules";
  reviewCount: number;
  actions: FixAction[];
}

const fixSchema = z.object({
  actions: z
    .array(
      z.object({
        theme: z.string().describe("One of the theme keys given."),
        title: z.string().describe("Short imperative, under 8 words."),
        why: z.string().describe("One or two sentences of evidence from the reviews and operations facts."),
        action: z.string().describe("Concrete steps for this month: who, what, when."),
      }),
    )
    .max(3),
});

/** Cached monthly summary; regenerated on demand or when the month changes. */
export async function loadWhatToFix(): Promise<WhatToFix | null> {
  const s = await db.setting.findUnique({ where: { key: FIX_KEY } });
  if (!s) return null;
  try {
    return JSON.parse(s.value) as WhatToFix;
  } catch {
    return null;
  }
}

/**
 * Up to three things to fix this month from the last 90 days of reviews:
 * theme counts, this month's critical themes, likely operational causes and
 * the days' operations. Claude writes it when configured; otherwise a
 * deterministic playbook. Cached in a Setting.
 */
export async function generateWhatToFix(useClaude = true): Promise<WhatToFix> {
  const today = businessToday();
  const since = zonedMidnightUTC(addDays(today, -90), tz());
  const [rows, hints] = await Promise.all([db.review.findMany({ where: { postedAt: { gte: since } }, orderBy: { postedAt: "desc" } }), claudeHints()]);
  const lite = rows.map((r) => ({ rating: r.rating, postedAt: reviewDate(r.postedAt), themes: r.themes, sentiment: r.sentiment }));
  const themes = themeCounts(lite);
  const monthAgo = addDays(today, -30);
  const recentCritical = rows.filter((r) => reviewDate(r.postedAt) > monthAgo && (r.rating <= 3 || r.sentiment === "negative" || r.sentiment === "mixed"));
  const recentThemes = [...new Set(recentCritical.flatMap((r) => r.themes))];
  const critical = rows.filter((r) => r.rating <= 3 || r.sentiment === "negative" || r.sentiment === "mixed");
  const ops = await opsForDates(critical.slice(0, 20).map((r) => reviewDate(r.postedAt)));
  const causes = critical.map((r) => hints.get(r.id) ?? operationalHint(r.themes, ops.get(reviewDate(r.postedAt)))).filter((x): x is string => Boolean(x));

  let result: WhatToFix = { month: today.slice(0, 7), generatedAt: new Date().toISOString(), by: "rules", reviewCount: rows.length, actions: whatToFixFallback({ themes, recentThemes, rootCauses: causes }) };

  if (useClaude && (await claudeReady()) && critical.length > 0) {
    const res = await claudeJSON({
      schema: fixSchema,
      effort: "medium",
      maxTokens: 4000,
      system: "You advise the owner of Subversive, a small brewery taproom with a kitchen in Catskill, NY (busy summer and fall foliage seasons, quiet winters). Be specific and practical. Plain English, no fluff, no buzzwords. Only recommend fixes the evidence supports.",
      content: [
        `From the last 90 days of guest reviews, give up to three things to fix this month, most important first. Each must tie to a theme key: ${THEME_KEYS.join(", ")}.

Theme counts (total / critical / mixed): ${themes.map((t) => `${t.theme} ${t.total}/${t.negative}/${t.mixed}`).join("; ") || "none"}.
Critical themes in the last 30 days: ${recentThemes.join(", ") || "none"}.
Likely operational causes found on review days: ${[...new Set(causes)].slice(0, 8).join(" | ") || "none found"}.

Critical and mixed reviews (newest first):
${critical
  .slice(0, 25)
  .map((r) => `- ${reviewDate(r.postedAt)}, ${r.rating}★, themes ${r.themes.join("/") || "-"}: "${r.text.slice(0, 400).replace(/\s+/g, " ")}" Ops: ${opsFacts(ops.get(reviewDate(r.postedAt)))}`)
  .join("\n")}`,
      ],
    });
    if (res.ok && res.data.actions.length) {
      result = { ...result, by: "claude", actions: res.data.actions.map((a) => ({ theme: isTheme(a.theme) ? a.theme : "", title: a.title.trim(), why: a.why.trim(), action: a.action.trim() })) };
    }
  }
  const value = JSON.stringify(result);
  await db.setting.upsert({ where: { key: FIX_KEY }, create: { key: FIX_KEY, value }, update: { value } });
  return result;
}

/**
 * This month's summary for the page: the cache when it's current; otherwise
 * the quick rules-based version now, with `stale` telling the caller to have
 * Claude rewrite it in the background.
 */
export async function whatToFixThisMonth(): Promise<{ fix: WhatToFix; stale: boolean }> {
  const cached = await loadWhatToFix();
  if (cached && cached.month === businessToday().slice(0, 7)) return { fix: cached, stale: false };
  const fix = await generateWhatToFix(false);
  return { fix, stale: await claudeReady() };
}
