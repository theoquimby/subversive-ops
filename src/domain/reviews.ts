/**
 * Customer reviews: parsing pasted text, keyword themes, sentiment and a
 * plain fallback reply — used when Claude isn't configured, and to keep
 * theme names consistent when it is.
 */

import { addDays, ISODate } from "./dates";

// ---- Themes --------------------------------------------------------------------

export const REVIEW_THEMES = {
  "service-speed": "Service speed",
  food: "Food quality",
  beer: "Beer",
  price: "Price & value",
  staff: "Staff friendliness",
  family: "Kids & family",
  dogs: "Dogs",
  cleanliness: "Cleanliness",
  wait: "Wait & seating",
  atmosphere: "Atmosphere",
} as const;

export type ReviewTheme = keyof typeof REVIEW_THEMES;
export const THEME_KEYS = Object.keys(REVIEW_THEMES) as ReviewTheme[];
export const themeLabel = (k: string) => (REVIEW_THEMES as Record<string, string>)[k] ?? k;
export const isTheme = (k: string): k is ReviewTheme => k in REVIEW_THEMES;

const KEYWORDS: Record<ReviewTheme, RegExp> = {
  "service-speed": /\b(slow(ly)?|took (forever|ages|so long|a long time)|forever|(waited|waiting) (an hour|\d+|over|almost|nearly|forever)|fast|quick(ly)?|prompt(ly)?|speedy|came out (fast|quick|cold|late)|never came|forgot (our|my|the)|understaffed|short[- ]staffed|not enough (staff|people|servers)|overwhelmed|swamped|(\d+|forty|thirty|twenty)[- ]?(min|minutes))\b/i,
  food: /\b(food (was|is|has)|great food|good food|burgers?|fries|wings|pretzel|grilled cheese|sandwich|tacos?|pizza|salad|nachos|delicious|tasty|bland|cold food|undercooked|overcooked|soggy|greasy|fried|chicken|smash|cheese|appetizers?|dish(es)?|meal|portions?|flavou?r)\b/i,
  beer: /\b(beers?|ipas?|stouts?|lagers?|pilsners?|sours?|ales?|brew(s|ery|ed)?|flights?|taps?|pints?|crowlers?|growlers?|hazy|drafts?|cider)\b/i,
  price: /\b(price[ds]?|pricey|expensive|overpriced|cheap|value|worth|cost(ly)?|\$\d+|affordable|reasonabl[ey])\b/i,
  staff: /\b(staff (was|were|is|are)|friendly staff|bartenders? (was|were)|friendly|rude|attentive|welcoming|hospitable|helpful|knowledgeable|unfriendly|dismissive|apologetic|nobody checked|the team was|crew makes|service was (great|excellent|amazing|friendly))\b/i,
  family: /\b(kids?|children|child|family|families|toddlers?|baby|high ?chairs?|kid[- ]friendly|family[- ]friendly)\b/i,
  dogs: /\b(dogs?|pups?|puppy|pet[- ]friendly|dog[- ]friendly|four[- ]legged)\b/i,
  cleanliness: /\b(clean|dirty|filthy|sticky|bathrooms?|restrooms?|tables? (were|was) (dirty|sticky)|spotless|gross|smell(ed|s)?)\b/i,
  wait: /\b(wait(ed|ing)? (for|to be) (a )?(table|seat(ed)?)|no (tables?|seats?|seating)|packed|crowded|busy|line (out|was)|nowhere to sit|seating|reservations?|full house|standing room)\b/i,
  atmosphere: /\b(atmosphere|vibe|cozy|patio|outdoor|view|music|decor|space|ambiance|ambience|beer garden|fire ?pit|creek|mountains?)\b/i,
};

/** Themes mentioned in a review, by keyword. Stable order (THEME_KEYS). */
export function keywordThemes(text: string): ReviewTheme[] {
  return THEME_KEYS.filter((k) => KEYWORDS[k].test(text));
}

// ---- Sentiment -------------------------------------------------------------------

export type Sentiment = "positive" | "mixed" | "negative";

const NEGATIVE = /\b(slow|rude|cold|bland|dirty|sticky|overpriced|disappoint(ed|ing)?|never (came|again)|forgot|terrible|awful|worst|meh|mediocre|ignored|wrong order|undercooked|overcooked|greasy|steep|off night|soggy|too long|forever|chaos|unfortunately|however|but the)\b/i;
const POSITIVE = /\b(great|amazing|awesome|love[ds]?|delicious|excellent|best|friendly|fantastic|perfect|wonderful|recommend|favorite|favourite|gem|can't wait)\b/i;

/** Rating-led sentiment, nudged by wording (a 4★ that complains is "mixed"). */
export function keywordSentiment(rating: number, text: string): Sentiment {
  const neg = NEGATIVE.test(text);
  const pos = POSITIVE.test(text);
  if (rating <= 2) return "negative";
  if (rating === 3) return pos && !neg ? "positive" : neg && !pos ? "negative" : "mixed";
  if (rating === 4 && neg) return "mixed";
  return "positive";
}

/** A best guess at stars when a pasted review has none. */
export function estimateRating(text: string): number {
  const neg = (text.match(new RegExp(NEGATIVE.source, "gi")) ?? []).length;
  const pos = (text.match(new RegExp(POSITIVE.source, "gi")) ?? []).length;
  if (neg === 0 && pos > 0) return 5;
  if (pos > neg) return 4;
  if (pos === neg) return 3;
  return neg - pos >= 2 ? 1 : 2;
}

// ---- Fallback reply ----------------------------------------------------------------

export interface ReplyInput {
  author: string | null;
  rating: number;
  themes: readonly string[];
  sentiment: Sentiment;
}

/** A short, plain reply in Subversive's voice for when Claude isn't available. */
export function fallbackReply(r: ReplyInput, signoff = "— the Subversive crew"): string {
  const first = r.author?.trim().split(/\s+/)[0]?.replace(/[^\p{L}'-]/gu, "");
  const hi = first ? `Hi ${first},` : "Hi there,";
  const t = new Set(r.themes);
  if (r.sentiment === "positive") {
    const bits: string[] = [];
    if (t.has("beer")) bits.push("glad the beer hit the spot");
    if (t.has("food")) bits.push("happy you enjoyed the food");
    if (t.has("staff")) bits.push("we'll pass the kind words to the team");
    if (t.has("dogs")) bits.push("give your pup a scratch from us");
    if (t.has("family")) bits.push("we love having families in");
    const middle = bits.length ? `Thanks so much — ${bits.slice(0, 2).join(", and ")}.` : "Thanks so much for coming by and taking the time to write this.";
    return `${hi} ${middle} See you next time you're in Catskill. ${signoff}`;
  }
  const fixes: string[] = [];
  if (t.has("service-speed") || t.has("wait")) fixes.push("We're adding hands on our busiest shifts so food and pints come out faster");
  if (t.has("food")) fixes.push("we've shared your notes with the kitchen");
  if (t.has("cleanliness")) fixes.push("we've tightened up our table and restroom checks");
  if (t.has("price")) fixes.push("we hear you on value and we're looking at it");
  if (t.has("staff")) fixes.push("we've talked with the team about how you were treated");
  const fix = fixes.length ? `${fixes.slice(0, 2).join(", and ")}.` : "We've shared this with the team.";
  const sorry = r.sentiment === "mixed" ? "Thanks for the honest feedback — glad parts of the visit were good, and sorry the rest didn't measure up." : "Sorry we let you down — that's not the visit we want anyone to have.";
  return `${hi} ${sorry} ${fix[0].toUpperCase()}${fix.slice(1)} We'd love another shot — ask for a manager next time and say hi. ${signoff}`;
}

// ---- Pasted reviews -------------------------------------------------------------------

export type ReviewSource = "GOOGLE" | "YELP" | "TRIPADVISOR" | "MANUAL";

export interface ParsedReview {
  author: string | null;
  rating: number | null;
  date: ISODate | null;
  text: string;
  source: ReviewSource;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const monthIndex = (s: string) => MONTHS.indexOf(s.slice(0, 3).toLowerCase()) + 1;

const WORD_NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

/** Find a date in a line: absolute ("Oct 3, 2026", "10/3/2026", "2026-10-03", "September 2026") or relative ("2 weeks ago"). */
export function parseReviewDate(line: string, today: ISODate): ISODate | null {
  const s = line.toLowerCase();
  let m = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (m) return iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1], +m[2]);
  m = s.match(new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`));
  if (m) return iso(+m[3], monthIndex(m[1]), +m[2]);
  m = s.match(new RegExp(`\\b(\\d{1,2})\\s+${MONTH_RE}\\s+(\\d{4})\\b`));
  if (m) return iso(+m[3], monthIndex(m[2]), +m[1]);
  m = s.match(new RegExp(`\\b${MONTH_RE}\\s+(\\d{4})\\b`));
  if (m) return iso(+m[2], monthIndex(m[1]), 1);
  m = s.match(new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`));
  if (m && /\b(on|visited|written|reviewed|posted)\b|^\s*\S+\s+\d/.test(s)) {
    const y = +today.slice(0, 4);
    const d = iso(y, monthIndex(m[1]), +m[2]);
    return d > today ? iso(y - 1, monthIndex(m[1]), +m[2]) : d;
  }
  if (/\btoday\b|\b(an?|\d+) hours? ago\b|\bjust now\b/.test(s)) return today;
  if (/\byesterday\b/.test(s)) return addDays(today, -1);
  m = s.match(/\b(a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+(day|week|month|year)s?\s+ago\b/);
  if (m) {
    const n = WORD_NUM[m[1]] ?? Number(m[1]);
    const days = { day: 1, week: 7, month: 30, year: 365 }[m[2] as "day" | "week" | "month" | "year"];
    return addDays(today, -n * days);
  }
  return null;
}

/** Find a star rating in a line ("★★★★☆", "4 stars", "4/5", "Rated 4.0 out of 5", "4 star rating"). */
export function parseRating(line: string): number | null {
  const stars = line.match(/[★⭐]+/u);
  if (stars) {
    const n = [...stars[0]].length;
    if (n >= 1 && n <= 5) return n;
  }
  const m =
    line.match(/\b([1-5](?:\.\d)?)\s*(?:\/\s*5|out of 5|of 5)\b/i) ??
    line.match(/\b([1-5](?:\.\d)?)\s*[- ]?stars?\b/i) ??
    line.match(/\brat(?:ed|ing)\s*:?\s*([1-5](?:\.\d)?)\b/i) ??
    line.match(/^\s*([1-5])\s*$/);
  if (m) return Math.round(Number(m[1]));
  const words = line.match(/\b(one|two|three|four|five)\s+stars?\b/i);
  return words ? WORD_NUM[words[1].toLowerCase()] : null;
}

const NOISE = /^(google|yelp|trip ?advisor|google reviews|local guide\b.*|\d+\s+(reviews?|photos?|friends?|contributions?|helpful votes?)|like|share|helpful|report|more|read more|see more|translate|new|edited|useful|funny|cool|\d+|·|•|\s*(\d+\s+(reviews?|photos?)\s*[·•]?\s*)+|(dine in|takeout|delivery)|meal type:.*|price per person:.*|(food|service|atmosphere):\s*\d.*|recommended dishes?:?.*|visited on.*|date of visit:.*|trip type:.*|reviewed .*|written .*|this review is the subjective opinion.*)$/i;
const OWNER_RESPONSE = /^(response from the owner|owner'?s? response|business owner|management response|.*responded to this review)/i;
const SOURCE_HINT: [RegExp, ReviewSource][] = [
  [/\byelp\b|\bstar rating\b|\buseful\b.*\bfunny\b/i, "YELP"],
  [/\btrip ?advisor\b|\bdate of visit\b|\bwritten (on )?[a-z]+ \d/i, "TRIPADVISOR"],
  [/\bgoogle\b|\blocal guide\b|\bresponse from the owner\b/i, "GOOGLE"],
];

const looksLikeAuthor = (l: string) =>
  l.length > 0 && l.length <= 40 && !/[!?]$/.test(l) && !/\p{L}{3,}\.$/u.test(l) && !/\d{3,}/.test(l) && l.split(/\s+/).length <= 5 && !/^(the|we|i|my|our|this|great|good|amazing|love)\b/i.test(l);

/** True when a block carries the header of a new review (a rating or date near the top). */
function hasHeader(lines: string[], today: ISODate) {
  return lines.slice(0, 4).some((l) => parseRating(l) != null || (l.length < 60 && parseReviewDate(l, today) != null));
}

/**
 * Parse reviews pasted from Google, Yelp or TripAdvisor, one review per block.
 * Blocks are separated by blank lines or "---"; a block with no rating/date
 * header is treated as another paragraph of the review above it.
 */
export function parsePastedReviews(text: string, today: ISODate, defaultSource: ReviewSource = "MANUAL"): ParsedReview[] {
  const normalized = text.replace(/\r/g, "").replace(/ /g, " ");
  const explicit = /^\s*-{3,}\s*$/m.test(normalized);
  const rawBlocks = normalized
    .split(explicit ? /^\s*-{3,}\s*$/m : /\n\s*\n/)
    .map((b) => b.split("\n").map((l) => l.trim()).filter(Boolean))
    .filter((b) => b.length > 0);

  const anyHeader = rawBlocks.some((b) => hasHeader(b, today));
  const blocks: string[][] = [];
  for (const b of rawBlocks) {
    if (!explicit && anyHeader && blocks.length > 0 && !hasHeader(b, today)) blocks[blocks.length - 1].push("", ...b);
    else blocks.push([...b]);
  }

  return blocks
    .map((lines): ParsedReview | null => {
      const joined = lines.join("\n");
      const source = SOURCE_HINT.find(([re]) => re.test(joined))?.[1] ?? defaultSource;
      let author: string | null = null;
      let rating: number | null = null;
      let date: ISODate | null = null;
      const body: string[] = [];
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (OWNER_RESPONSE.test(l)) break;
        const r = l.length < 60 ? parseRating(l) : null;
        const d = l.length < 60 ? parseReviewDate(l, today) : null;
        if (r != null || d != null) {
          rating ??= r;
          date ??= d;
          // "★★★★★ 2 weeks ago" or "4 stars · Oct 3" — header line; keep any trailing prose
          const rest = l.replace(/[★☆⭐]+/gu, "").replace(/\b\d(\.\d)?\s*(\/\s*5|out of 5|stars?( rating)?)\b/gi, "").replace(/\b(a|an|\d+)\s+(day|week|month|year)s?\s+ago\b/gi, "").replace(/[·•|,-]/g, " ").trim();
          if (rest.split(/\s+/).length >= 6) body.push(l);
          continue;
        }
        if (body.length === 0 && author == null && i < 3 && looksLikeAuthor(l) && !NOISE.test(l)) {
          author = l.replace(/\s*[·•].*$/, "");
          continue;
        }
        if (NOISE.test(l) || (body.length === 0 && /^[A-Z][a-z]+,\s*[A-Z]{2}$/.test(l))) continue; // Yelp "Albany, NY"
        body.push(l);
      }
      const textOut = body.join("\n").replace(/\n{2,}/g, "\n\n").replace(/^\s*["“]|["”]\s*$/g, "").trim();
      if (!textOut && rating == null) return null;
      return { author, rating, date, text: textOut, source };
    })
    .filter((r): r is ParsedReview => r != null && r.text.length > 0);
}

/** Stable id for a pasted review so pasting the same text twice doesn't duplicate it. */
export function reviewFingerprint(r: { author: string | null; date: ISODate | null; text: string }): string {
  const s = `${(r.author ?? "").toLowerCase()}|${r.date ?? ""}|${r.text.toLowerCase().replace(/\s+/g, " ").slice(0, 120)}`;
  let h1 = 5381;
  let h2 = 52711;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = (h1 * 33) ^ c;
    h2 = (h2 * 33) ^ c;
  }
  return `p${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
}

// ---- Summaries ----------------------------------------------------------------------

export interface ReviewLite {
  rating: number;
  postedAt: ISODate;
  themes: readonly string[];
  sentiment: string | null;
}

/** Average rating per week (Monday start) — the trend line. */
export function weeklyRatings(reviews: readonly ReviewLite[], weekStartOf: (d: ISODate) => ISODate) {
  const by = new Map<ISODate, { sum: number; n: number }>();
  for (const r of reviews) {
    const w = weekStartOf(r.postedAt);
    const cur = by.get(w) ?? { sum: 0, n: 0 };
    cur.sum += r.rating;
    cur.n += 1;
    by.set(w, cur);
  }
  return [...by].sort(([a], [b]) => a.localeCompare(b)).map(([week, v]) => ({ week, avg: v.sum / v.n, count: v.n }));
}

/** Rolling average rating (last `window` reviews) at each review, oldest first — smoother than weekly with few reviews. */
export function rollingRating(reviews: readonly ReviewLite[], window = 5) {
  const sorted = [...reviews].sort((a, b) => a.postedAt.localeCompare(b.postedAt));
  return sorted.map((r, i) => {
    const slice = sorted.slice(Math.max(0, i - window + 1), i + 1);
    return { date: r.postedAt, avg: slice.reduce((s, x) => s + x.rating, 0) / slice.length };
  });
}

/** Mentions per theme, split by sentiment, most-mentioned first. */
export function themeCounts(reviews: readonly ReviewLite[]) {
  const by = new Map<string, { theme: string; total: number; positive: number; negative: number; mixed: number }>();
  for (const r of reviews) {
    for (const t of r.themes) {
      const cur = by.get(t) ?? { theme: t, total: 0, positive: 0, negative: 0, mixed: 0 };
      cur.total++;
      if (r.sentiment === "positive") cur.positive++;
      else if (r.sentiment === "negative") cur.negative++;
      else cur.mixed++;
      by.set(t, cur);
    }
  }
  return [...by.values()].sort((a, b) => b.total - a.total || b.negative - a.negative);
}

// ---- Connecting a review to the day's operations ---------------------------------

export interface OpsDay {
  date: ISODate;
  sales: number | null;
  forecast: number | null;
  scheduledHours: number | null;
  neededHours: number | null;
  workedHours: number | null;
  overTarget: { name: string; foodCostPct: number; target: number; sold: number }[];
}

const pctText = (x: number) => `${x > 0 ? "+" : "−"}${Math.abs(Math.round(x * 100))}%`;

/** Plain-English hint at what went wrong operationally on the day of a review. */
export function operationalHint(themes: readonly string[], ops: OpsDay | undefined): string | null {
  if (!ops) return null;
  const t = new Set(themes);
  const out: string[] = [];
  const surge = ops.sales != null && ops.forecast != null && ops.forecast > 0 ? ops.sales / ops.forecast - 1 : null;
  const staffed = ops.workedHours ?? ops.scheduledHours;
  const short = staffed != null && ops.neededHours != null && ops.neededHours > 0 ? staffed / ops.neededHours - 1 : null;
  const serviceIssue = t.has("service-speed") || t.has("wait") || t.has("staff");
  if (serviceIssue && short != null && short < -0.1) {
    out.push(`Short-staffed: ${Math.round(staffed!)} h on the floor vs ${Math.round(ops.neededHours!)} h needed for the sales that day.`);
  }
  if (surge != null && surge > 0.15 && (serviceIssue || out.length > 0)) {
    out.push(`Sales ran ${pctText(surge)} over forecast, so the day was staffed and prepped for a quieter shift.`);
  }
  if (t.has("food") && ops.overTarget.length > 0) {
    const top = [...ops.overTarget].sort((a, b) => b.sold - a.sold)[0];
    out.push(`${ops.overTarget.length} item${ops.overTarget.length === 1 ? " was" : "s were"} over food-cost target — check the recipe card and portioning on ${top.name}.`);
  }
  if (out.length === 0 && serviceIssue && surge != null && surge > 0.15) {
    out.push(`Sales ran ${pctText(surge)} over forecast.`);
  }
  return out.length ? out.join(" ") : null;
}

// ---- Rating-drop alert -----------------------------------------------------------------

export interface RatingDrop {
  /** Average over the last 30 days, and over the 90 days before that. */
  recent: number | null;
  baseline: number | null;
  recentCount: number;
  baselineCount: number;
  /** baseline − recent, in stars (positive = worse lately). */
  drop: number | null;
  alert: boolean;
  /** Themes in the last 30 days' critical reviews, most frequent first. */
  themes: string[];
}

/**
 * Has the rating slipped? Alerts when the last 30 days average at least
 * `threshold` stars below the 90 days before, with enough reviews on both sides
 * that one grumpy guest can't trigger it.
 */
export function ratingDrop(reviews: readonly ReviewLite[], today: ISODate, opts: { threshold?: number; minRecent?: number; minBaseline?: number } = {}): RatingDrop {
  const threshold = opts.threshold ?? 0.3;
  const recentFrom = addDays(today, -30);
  const baseFrom = addDays(today, -120);
  const recent = reviews.filter((r) => r.postedAt > recentFrom && r.postedAt <= today);
  const base = reviews.filter((r) => r.postedAt > baseFrom && r.postedAt <= recentFrom);
  const avg = (rs: readonly ReviewLite[]) => (rs.length ? rs.reduce((s, r) => s + r.rating, 0) / rs.length : null);
  const a = avg(recent);
  const b = avg(base);
  const drop = a != null && b != null ? b - a : null;
  const alert = drop != null && drop >= threshold - 1e-9 && recent.length >= (opts.minRecent ?? 3) && base.length >= (opts.minBaseline ?? 5);
  const counts = new Map<string, number>();
  for (const r of recent) if (r.rating <= 3 || r.sentiment === "negative" || r.sentiment === "mixed") for (const t of r.themes) counts.set(t, (counts.get(t) ?? 0) + 1);
  const themes = [...counts].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).map(([t]) => t);
  return { recent: a, baseline: b, recentCount: recent.length, baselineCount: base.length, drop, alert, themes };
}

// ---- "What to fix" (deterministic fallback) -------------------------------------------

export interface FixAction {
  theme: string;
  title: string;
  why: string;
  action: string;
}

const PLAYBOOK: Record<ReviewTheme, { title: string; action: string }> = {
  "service-speed": { title: "Speed up service at the peaks", action: "Compare the schedule with the hourly forecast for the busiest shifts and add a runner or line cook where sales outrun staff hours. Check ticket times on Fridays and Saturdays." },
  food: { title: "Tighten consistency in the kitchen", action: "Re-check recipe cards and portioning on the dishes guests mention, taste-test at the start of each shift, and hold plates under the pass no longer than a few minutes." },
  beer: { title: "Look after the taps", action: "Check line cleaning dates, pour temperatures and what's run out. Brief staff on the current list so they can steer guests to something they'll like." },
  price: { title: "Make the value obvious", action: "Look at the items called out as pricey against their food cost and portion. Consider a lower-priced option or a clearer description before cutting prices." },
  staff: { title: "Reset the welcome", action: "Talk through greeting, check-backs and how to handle a problem at the next pre-shift. Pair newer staff with someone guests praise by name." },
  family: { title: "Make families feel planned for", action: "Check high chairs, the kids' options and crayons, and seat families where there's room for strollers." },
  dogs: { title: "Keep the dog policy clear", action: "Post the dog rules where guests see them, keep water bowls out on the patio, and make sure staff explain it the same way." },
  cleanliness: { title: "Fix cleaning between turns", action: "Add bathroom and table checks to an hourly checklist during service, with initials, and walk the room before the dinner rush." },
  wait: { title: "Manage the wait", action: "Quote honest wait times, offer a drink at the bar while guests wait, and look at whether reservations or a waitlist text would help on peak nights." },
  atmosphere: { title: "Look at the room", action: "Check music volume, lighting and temperature during the busiest hours, and fix anything guests keep mentioning about the space." },
};

/**
 * Up to three things to fix this month, from theme counts and likely causes.
 * Recent critical mentions weigh most; positive-only themes never make the list.
 */
export function whatToFixFallback(args: {
  themes: readonly { theme: string; total: number; negative: number; mixed: number }[];
  recentThemes?: readonly string[];
  rootCauses?: readonly string[];
}): FixAction[] {
  const recent = new Set(args.recentThemes ?? []);
  const scored = args.themes
    .filter((t) => isTheme(t.theme) && t.negative + t.mixed > 0)
    .map((t) => ({ t, score: t.negative + t.mixed * 0.5 + (recent.has(t.theme) ? 1 : 0) }))
    .sort((a, b) => b.score - a.score || b.t.total - a.t.total);
  return scored.slice(0, 3).map(({ t }) => {
    const p = PLAYBOOK[t.theme as ReviewTheme];
    const n = t.negative + t.mixed;
    const cause = args.rootCauses?.find((c) => matchesTheme(c, t.theme));
    return {
      theme: t.theme,
      title: p.title,
      why: `${n} critical or mixed mention${n === 1 ? "" : "s"} of ${themeLabel(t.theme).toLowerCase()} in the last 90 days${recent.has(t.theme) ? ", including this month" : ""}.${cause ? ` ${cause}` : ""}`,
      action: p.action,
    };
  });
}

function matchesTheme(cause: string, theme: string) {
  const c = cause.toLowerCase();
  if (theme === "service-speed" || theme === "wait" || theme === "staff") return /short-staffed|staff|over forecast/.test(c);
  if (theme === "food") return /food-cost|recipe|portion/.test(c);
  return false;
}
