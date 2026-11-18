/**
 * The scorecard, said plainly for a busy owner: how far to trust the forecast,
 * and the handful of things worth doing differently because of it. Built from
 * the same scores the tables show; nothing here is a new measurement.
 * Pure: plain data in, plain words out.
 */

import type { GroupScore, ScoreDay, ScoreSummary } from "./forecastScore";
import type { WeatherEffects } from "./weatherEffect";
import { WEATHER_KIND_LABEL, type WeatherKind } from "./weatherHistory";

export type StoryTone = "good" | "warn" | "bad" | "neutral";

export interface StoryPoint {
  key: string;
  tone: StoryTone;
  /** What's true, in a line. */
  title: string;
  /** The numbers behind it, briefly. */
  detail: string;
  /** What to do about it; null when there's nothing for the owner to do. */
  action: string | null;
  link?: { href: string; label: string };
}

export interface ForecastStory {
  /** trust: plan on it. guide: plan with a cushion. rough: a starting point only. */
  level: "trust" | "guide" | "rough";
  headline: string;
  line: string;
  /** A typical day's miss in dollars (rounded), and as a share of the day. */
  missDollars: number;
  missShare: number;
  /** "3 in 10": how many days in ten land within 15% of actual. */
  closeInTen: number;
  /** Share closer than repeating the same day last week, over the same stretch; negative is worse. */
  skill: number | null;
  /** Which stretch the verdict is about. */
  basis: "recent" | "all";
  points: StoryPoint[];
  /** What Ops does next about the weak spots (not the owner's job). */
  next: string;
}

const KIND_DAYS: Record<string, string> = { rain: "rain days", heavyRain: "heavy rain days", snow: "snow days", hot: "hot days", cold: "freezing days" };
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const pct = (n: number) => `${Math.round(Math.abs(n) * 100)}%`;
const dollars = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const list = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);
/** Round to a figure someone would say out loud: nearest $25 under $500, else nearest $50. */
const roundMoney = (n: number) => (n < 500 ? Math.round(n / 25) * 25 : Math.round(n / 50) * 50);

/** Enough days in a group to say something about it. */
export const STORY_MIN_DAYS = 20;
const WEATHER_EFFECT = 0.08;
const MAX_POINTS = 5;

export function forecastStory(i: {
  all: ScoreSummary;
  recent: ScoreSummary;
  byWeekday: GroupScore[];
  byMonth: GroupScore[];
  byWeather: GroupScore[];
  byEvent: GroupScore[];
  days: readonly ScoreDay[];
  /** Today, so a seasonal note only shows when its month is here or next. */
  today?: string;
  /** The weather the forecast already allows for; those kinds aren't something to shade for by hand. */
  weatherEffects?: WeatherEffects;
}): ForecastStory | null {
  const all = i.all.f1;
  if (!all) return null;
  const useRecent = (i.recent.f1?.days ?? 0) >= 30;
  const basis = useRecent ? i.recent.f1! : all;
  // A typical day's sales over the same stretch the verdict is about.
  const pool = useRecent && i.recent.from ? i.days.filter((d) => d.date >= i.recent.from!) : i.days;
  const avgDay = pool.length ? pool.reduce((s, d) => s + d.actual, 0) / pool.length : 0;
  const missDollars = roundMoney(basis.wape * avgDay);
  const closeInTen = Math.round(basis.within15 * 10);
  const when = useRecent ? "Over the last 90 days" : "Over your history";

  const level: ForecastStory["level"] = basis.wape <= 0.15 ? "trust" : basis.wape <= 0.3 ? "guide" : "rough";
  const headline = level === "trust" ? "You can plan on the forecast" : level === "guide" ? "Use the forecast as a guide, and leave a cushion" : "Treat the forecast as a starting point, not a plan";
  const line =
    level === "trust"
      ? `${when} a typical day landed within about ${dollars(missDollars)} of the forecast (${pct(basis.wape)}). Orders and schedules built on it are on solid ground.`
      : level === "guide"
        ? `${when} a typical day was off by about ${dollars(missDollars)} (${pct(basis.wape)}). Build orders and schedules on it, but leave room for a day that size either way.`
        : `${when} a typical day was off by about ${dollars(missDollars)} (${pct(basis.wape)}), and only ${closeInTen} days in 10 landed close. Use it to see the shape of the week, then go by what you know.`;

  const worse = useRecent && basis.wape >= all.wape * 1.2;
  const better = useRecent && basis.wape <= all.wape * 0.8;
  const trend = worse ? ` That's rougher than usual: over all your history it's ${pct(all.wape)}.` : better ? ` That's better than usual: over all your history it's ${pct(all.wape)}.` : "";

  const points: StoryPoint[] = [];

  // The plain yardstick has been closer than the forecast.
  const skill = (useRecent ? i.recent.skill : i.all.skill) ?? null;
  if (skill != null && skill <= -0.05) {
    points.push({
      key: "yardstick",
      tone: "bad",
      title: `${useRecent ? "Lately the" : "The"} same day last week has been the better guide`,
      detail: `${when} just repeating the same weekday from the week before landed closer than the forecast did.`,
      action: "Check the forecast against the same day last week, and lean toward last week where they disagree.",
    });
  }

  // Weather the forecast now allows for: say so, so nobody shades for it twice.
  const builtIn = (i.weatherEffects?.kinds ?? []).filter((k) => k.used);
  const isBuiltIn = (k: string) => builtIn.some((b) => b.kind === k);
  if (builtIn.length) {
    const e = i.weatherEffects!;
    const learnedDays = builtIn.reduce((s, k) => s + k.days, 0);
    points.push({
      key: "weatherBuiltIn",
      tone: "good",
      title: builtIn.every((k) => k.factor < 1) ? "Bad weather is now built into the forecast" : "Weather is now built into the forecast",
      detail:
        `It plans for ${list(builtIn.map((k) => `${pct(k.factor - 1)} ${k.factor < 1 ? "less" : "more"} on ${KIND_DAYS[k.kind]}`))}, learned from ${learnedDays.toLocaleString("en-US")} past days.` +
        (e.missWithout != null && e.missWith != null ? ` On those days that takes the typical miss from ${pct(e.missWithout)} to ${pct(e.missWith)}.` : ""),
      action: "Don't shade for that weather yourself; plan from the number the forecast shows.",
      link: { href: "/sales", label: "This week's forecast" },
    });
  }

  // Bad weather it doesn't allow for: the days sales run well under a forecast that didn't know about it.
  const weather = (k: WeatherKind) => i.byWeather.find((g) => g.key === k);
  const hurt = (["heavyRain", "snow", "rain", "cold"] as WeatherKind[])
    .map((k) => ({ k, g: weather(k) }))
    .filter((x) => !isBuiltIn(x.k) && x.g && (x.g.score?.days ?? 0) >= STORY_MIN_DAYS && x.g.lift != null && x.g.lift <= -WEATHER_EFFECT);
  if (hurt.length) {
    const worst = hurt.reduce((a, b) => (a.g!.lift! <= b.g!.lift! ? a : b));
    const days = hurt.reduce((s, x) => s + (x.g!.score?.days ?? 0), 0);
    points.push({
      key: "weather",
      tone: "warn",
      title: builtIn.length ? "Some weather still isn't in the forecast" : "Bad weather costs sales the forecast doesn't fully count",
      detail: `On ${days.toLocaleString("en-US")} past days: ${list(hurt.map((x) => `${WEATHER_KIND_LABEL[x.k].toLowerCase()} ${pct(x.g!.lift!)} under`))}.`,
      action: `When ${worst.k === "snow" ? "snow" : worst.k === "cold" ? "a freezing day" : "heavy rain"} is in the week's weather, staff and prep for about ${pct(worst.g!.lift!)} less than the forecast shows.`,
      link: { href: "/sales", label: "This week's weather" },
    });
  }
  const hot = weather("hot");
  if (hot && !isBuiltIn("hot") && (hot.score?.days ?? 0) >= STORY_MIN_DAYS && hot.lift != null && Math.abs(hot.lift) >= WEATHER_EFFECT) {
    points.push({
      key: "hot",
      tone: hot.lift > 0 ? "good" : "warn",
      title: hot.lift > 0 ? "Hot days beat the forecast" : "Hot days fall short of the forecast",
      detail: `On ${hot.score!.days} days at 86°F or more, sales ran ${pct(hot.lift)} ${hot.lift > 0 ? "over" : "under"}.`,
      action: hot.lift > 0 ? `On a hot day, plan for about ${pct(hot.lift)} more.` : `On a hot day, plan for about ${pct(hot.lift)} less.`,
    });
  }

  // Weekdays the method can't call.
  const weak = i.byWeekday.filter((g) => (g.score?.days ?? 0) >= STORY_MIN_DAYS && g.score!.wape >= Math.max(0.5, all.wape * 1.6));
  if (weak.length) {
    const names = weak.map((g) => `${DAY_NAMES[Number(g.key)]}s`);
    const wd = new Set(weak.map((g) => Number(g.key)));
    const those = i.days.filter((d) => wd.has(d.weekday));
    const avg = those.length ? those.reduce((s, d) => s + d.actual, 0) / those.length : 0;
    points.push({
      key: "weekdays",
      tone: "bad",
      title: `${list(names)} ${weak.length === 1 ? "is" : "are"} close to a guess`,
      detail: `Off by ${list(weak.map((g) => pct(g.score!.wape)))} on a typical day. ${weak.length === 1 ? "It's a small day" : "They're small days"} (about ${dollars(roundMoney(avg))}), so one party or one dead night swings ${weak.length === 1 ? "it" : "them"}.`,
      action: `For ${list(names)}, go by what you know is booked, not the forecast.`,
    });
  }

  // Event days.
  const ev = i.byEvent.find((g) => g.key === "event")?.score;
  const normal = i.byEvent.find((g) => g.key === "normal")?.score;
  if (ev && normal && ev.days >= 8 && ev.wape >= normal.wape * 1.3 && ev.wape - normal.wape >= 0.05) {
    points.push({
      key: "events",
      tone: "warn",
      title: "Event days are hit and miss",
      detail: `Off by ${pct(ev.wape)} on the ${ev.days} days with an event or a manual change, against ${pct(normal.wape)} on ordinary days.`,
      action: "After each event, compare the lift you gave it with what sold, and set the next one from that.",
      link: { href: "/events", label: "Events" },
    });
  }

  // A steady lean one way.
  if (Math.abs(basis.bias) >= 0.05) {
    const high = basis.bias > 0;
    points.push({
      key: "lean",
      tone: "warn",
      title: `Lately it runs ${pct(basis.bias)} ${high ? "high" : "low"}`,
      detail: `${when} the forecast added up to ${pct(basis.bias)} ${high ? "more" : "less"} than what sold.`,
      action: high ? "Shade orders and hours down a touch until it corrects." : "Leave a little extra in orders and hours until it corrects.",
    });
  }

  // A month that runs well off the forecast, when it's this month or next.
  const thisMonth = i.today ? Number(i.today.slice(5, 7)) : null;
  const near = (m: number) => thisMonth == null || m === thisMonth || m === (thisMonth % 12) + 1;
  const season = i.byMonth.filter((g) => near(Number(g.key)) && (g.score?.days ?? 0) >= 40 && g.lift != null && Math.abs(g.lift) >= 0.1).sort((a, b) => Math.abs(b.lift!) - Math.abs(a.lift!))[0];
  if (season) {
    const month = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][Number(season.key) - 1];
    points.push({
      key: "season",
      tone: "neutral",
      title: `${month} runs ${pct(season.lift!)} ${season.lift! > 0 ? "over" : "under"} the forecast`,
      detail: "Going by every year on file. The method is slow to pick up that turn of the season.",
      action: `In ${month}, plan ${season.lift! > 0 ? "above" : "below"} the forecast by about that much.`,
    });
  }

  // How far ahead it holds.
  const f14 = i.all.f14;
  if (f14 && f14.days >= STORY_MIN_DAYS) {
    if (f14.wape <= all.wape * 1.1) {
      points.push({
        key: "ahead",
        tone: level === "trust" ? "good" : "neutral",
        title: level === "trust" ? "It's as good two weeks out as the night before" : "It's no worse two weeks out than the night before",
        detail: `Off by ${pct(f14.wape)} two weeks ahead, ${pct(all.wape)} the day before.`,
        action: "Set schedules and standing orders two weeks ahead; waiting doesn't buy a better number.",
      });
    } else if (f14.wape >= all.wape * 1.25) {
      points.push({
        key: "ahead",
        tone: "warn",
        title: "Two weeks out it's noticeably shakier",
        detail: `Off by ${pct(f14.wape)} two weeks ahead, ${pct(all.wape)} the day before.`,
        action: "Pencil in schedules two weeks ahead, and firm them up a week out.",
      });
    }
  }

  const next = [
    hurt.length && !builtIn.length ? "Next, the forecast learns what rain, snow and cold do here, then holidays and school breaks." : "Next, the forecast learns holidays and school breaks.",
    "Every change has to beat today's numbers on this page before it replaces the current method.",
  ].join(" ");

  return { level, headline, line: line + trend, missDollars, missShare: basis.wape, closeInTen, skill, basis: useRecent ? "recent" : "all", points: points.slice(0, MAX_POINTS), next };
}
