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
  OpsDay,
  parsePastedReviews,
  REVIEW_THEMES,
  ReviewSource,
  reviewFingerprint,
  Sentiment,
  THEME_KEYS,
} from "@/domain/reviews";
import { z } from "zod";
import { db, num } from "../db";
import { env } from "../env";
import { claudeConfigured, claudeJSON } from "../integrations/claude";
import { fetchGoogleReviews, googlePlacesConfigured } from "../integrations/google-places";
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
  const rows = await db.setting.findMany({ where: { key: { in: [SETTING_PLACE_ID, SETTING_TONE] } } });
  const get = (k: string) => rows.find((r) => r.key === k)?.value ?? "";
  return { placeId: get(SETTING_PLACE_ID), toneNotes: get(SETTING_TONE), googleConfigured: googlePlacesConfigured(), claude: claudeConfigured() };
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
  if (claudeConfigured()) {
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
  return { added: created.length, skipped, parsed: parsed.length };
}

export async function importGoogleReviews() {
  const { placeId } = await reviewSettings();
  if (!googlePlacesConfigured()) return { error: "Google import turns on once GOOGLE_PLACES_API_KEY is added." };
  if (!placeId) return { error: "Add your Google Place ID below first." };
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
