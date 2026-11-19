import { describe, expect, it } from "vitest";
import type { GroupScore, Score, ScoreDay, ScoreSummary } from "../forecastScore";
import { forecastStory } from "../forecastStory";
import type { UpcomingHoliday } from "../holidayEffect";
import type { SignalResult, StoredSignal } from "../leadSignals";
import type { KindEffect, WeatherEffects } from "../weatherEffect";

const sc = (over: Partial<Score> = {}): Score => ({ days: 400, wape: 0.12, medianApe: 0.1, bias: 0, within15: 0.7, ...over });
const sum = (f1: Score | null, over: Partial<ScoreSummary> = {}): ScoreSummary => ({ from: "2024-01-01", to: "2026-11-16", f1, f7: f1, f14: f1, naive: sc({ wape: 0.2 }), skill: 0.2, ...over });
const g = (key: string, days: number, wape: number, lift: number | null = 0): GroupScore => ({ key, score: sc({ days, wape }), lift });
const day = (date: string, weekday: number, actual: number): ScoreDay => ({ date, weekday, actual, event: false, weather: "fair", f1: actual, f7: actual, f14: actual, naive: actual });
// 100 recent days at $2,000, a Monday every seventh at $400.
const days: ScoreDay[] = Array.from({ length: 100 }, (_, n) => day(`2026-08-${String((n % 28) + 1).padStart(2, "0")}`, n % 7, n % 7 === 1 ? 400 : 2000));
const base = { byWeekday: [] as GroupScore[], byMonth: [] as GroupScore[], byWeather: [] as GroupScore[], byEvent: [] as GroupScore[], days };

describe("forecastStory", () => {
  it("has nothing to say before any day is scored", () => {
    expect(forecastStory({ ...base, all: sum(null), recent: sum(null) })).toBeNull();
  });

  it("says plainly how far to trust it, in dollars, from the last 90 days", () => {
    const good = forecastStory({ ...base, all: sum(sc()), recent: sum(sc({ days: 80, wape: 0.1 }), { from: "2026-08-01" }) })!;
    expect(good.level).toBe("trust");
    expect(good.basis).toBe("recent");
    expect(good.headline).toMatch(/plan on the forecast/);
    // Average day (2000 × 6 + 400) ÷ 7 ≈ $1,771; 10% of that, rounded to the nearest $25.
    expect(good.missDollars).toBe(175);
    expect(good.line).toContain("$175");

    const rough = forecastStory({ ...base, all: sum(sc({ wape: 0.33 })), recent: sum(sc({ days: 77, wape: 0.41, within15: 0.27 }), { from: "2026-08-01" }) })!;
    expect(rough.level).toBe("rough");
    expect(rough.closeInTen).toBe(3);
    expect(rough.headline).toMatch(/starting point/);
    expect(rough.line).toContain("3 days in 10");
    expect(rough.line).toMatch(/rougher than usual: over all your history it's 33%/);
    expect(good.line).not.toMatch(/than usual/);
  });

  it("falls back to all history when there are too few recent days", () => {
    const s = forecastStory({ ...base, all: sum(sc({ wape: 0.2 })), recent: sum(sc({ days: 5, wape: 0.9 })) })!;
    expect(s.basis).toBe("all");
    expect(s.level).toBe("guide");
  });

  it("turns bad-weather days into one instruction, sized by the worst of them", () => {
    const s = forecastStory({ ...base, all: sum(sc()), recent: sum(sc({ days: 80 })), byWeather: [g("fair", 1300, 0.3, 0.02), g("rain", 178, 0.45, -0.1), g("heavyRain", 104, 0.47, -0.22), g("snow", 53, 0.55, -0.24), g("cold", 122, 0.39, -0.08), g("hot", 160, 0.29, 0)] })!;
    const w = s.points.find((p) => p.key === "weather")!;
    expect(w.detail).toContain("heavy rain 22% under");
    expect(w.detail).toContain("snow 24% under");
    expect(w.action).toMatch(/snow.*24% less/);
    expect(s.points.some((p) => p.key === "hot")).toBe(false);
    expect(s.next).toMatch(/rain, snow and cold/);
  });

  it("says which weather the forecast already allows for, and stops telling the owner to shade for it", () => {
    const k = (kind: KindEffect["kind"], factor: number, days: number, used: boolean): KindEffect => ({ kind, factor, days, scored: days - 10, missWithout: 0.5, missWith: 0.42, used });
    const weatherEffects: WeatherEffects = { kinds: [k("rain", 0.9, 178, true), k("heavyRain", 0.8, 104, true), k("snow", 0.81, 53, true), k("hot", 1, 160, false), k("cold", 0.93, 122, false)], fairDays: 1300, scored: 300, missWithout: 0.47, missWith: 0.41, through: "2026-11-12" };
    const s = forecastStory({ ...base, all: sum(sc()), recent: sum(sc({ days: 80 })), weatherEffects, byWeather: [g("rain", 178, 0.45, -0.1), g("heavyRain", 104, 0.47, -0.22), g("snow", 53, 0.55, -0.24), g("cold", 122, 0.39, -0.08)] })!;
    const built = s.points.find((p) => p.key === "weatherBuiltIn")!;
    expect(built.title).toBe("Bad weather is now built into the forecast");
    expect(built.detail).toContain("10% less on rain days, 20% less on heavy rain days and 19% less on snow days");
    expect(built.detail).toContain("from 47% to 41%");
    expect(built.action).toMatch(/Don't shade/);
    // Freezing days aren't switched on, so that one is still the owner's to allow for.
    const open = s.points.find((p) => p.key === "weather")!;
    expect(open.title).toBe("Some weather still isn't in the forecast");
    expect(open.detail).toBe("On 122 past days: freezing 8% under.");
    expect(s.next).toMatch(/^Next, the forecast learns holidays/);
  });

  it("mentions an online number only when it would have made the forecast closer", () => {
    const sig = (over: Partial<SignalResult>): SignalResult => ({ key: "gbp.directions", label: "Direction requests", source: "Google listing", from: "2025-06-01", to: "2026-11-14", delay: 4, sameDay: { days: 400, r: 0.4 }, ahead: { days: 380, r: 0.25, per20: 0.06 }, scored: 320, missWithout: 0.33, missWith: 0.31, verdict: "helps", ...over });
    const yes = forecastStory({ ...base, all: sum(sc()), recent: sum(sc({ days: 80 })), signals: [sig({})] })!;
    const p = yes.points.find((x) => x.key === "signal")!;
    expect(p.title).toBe("Direction requests on your Google listing run ahead of sales");
    expect(p.detail).toContain("about 6% over the forecast");
    expect(p.detail).toContain("from 33% to 31%");
    expect(p.action).toBeNull();
    expect(yes.next).toMatch(/^Direction requests on your Google listing passed the test/);
    const no = forecastStory({ ...base, all: sum(sc()), recent: sum(sc({ days: 80 })), signals: [sig({ verdict: "noHelp" }), sig({ verdict: "thin" })] })!;
    expect(no.points.some((x) => x.key === "signal")).toBe(false);
    expect(no.next).toMatch(/^Next, the forecast learns/);
  });

  it("says when interest on Google is built in, where it stands now, and that there's nothing to do", () => {
    const r = (over: Partial<SignalResult> = {}): SignalResult => ({ key: "combined", label: "Online interest", source: "Combined", from: "2025-05-27", to: "2026-11-15", delay: 3, sameDay: { days: 400, r: 0.5 }, ahead: { days: 390, r: 0.22, per20: 0.07 }, scored: 330, missWithout: 0.32, missWith: 0.3, verdict: "helps", ...over });
    const stored: StoredSignal = { rules: 3, learnedOn: "2026-11-18", members: ["Search clicks", "Listing views"], level: 0.15, near: { slope: 0.35, meanX: 0.01, used: true }, week: { slope: 0.2, meanX: 0.01, used: false } };
    const online = { members: stored.members, near: r(), week: r({ verdict: "noHelp" }), stored };
    const s = forecastStory({ ...base, all: sum(sc()), recent: sum(sc({ days: 80 })), online, signals: [r({ key: "gsc.clicks", label: "Search clicks", source: "Google Search" })] })!;
    const p = s.points.find((x) => x.key === "online")!;
    expect(p.title).toBe("Interest on Google is now built into the forecast");
    expect(p.detail).toContain("Search clicks and Listing views over the last week");
    expect(p.detail).toContain("from 32% to 30%");
    // 0.35 × (0.15 − 0.01) ≈ +5%.
    expect(p.detail).toContain("running 15% above the month before, which adds about 5% to the coming days");
    expect(p.action).toMatch(/^Nothing to do/);
    // It's in, so it isn't also listed as "next to go in".
    expect(s.points.some((x) => x.key === "signal")).toBe(false);
    expect(s.next).toMatch(/^Next, the forecast learns/);

    const quiet = forecastStory({ ...base, all: sum(sc()), recent: sum(sc({ days: 80 })), online: { ...online, stored: { ...stored, level: 0.01 } } })!;
    expect(quiet.points.find((x) => x.key === "online")!.detail).toContain("about normal");
    const off = forecastStory({ ...base, all: sum(sc()), recent: sum(sc({ days: 80 })), online: { ...online, stored: { ...stored, near: { ...stored.near, used: false } } } })!;
    expect(off.points.some((x) => x.key === "online")).toBe(false);
  });

  it("lists the holidays coming up with what the forecast plans for each, ahead of the good-to-know points", () => {
    const h = (kind: UpcomingHoliday["kind"], from: string, to: string, over: Partial<UpcomingHoliday> = {}): UpcomingHoliday => ({ kind, from, to, factor: 1, days: 6, closed: false, used: false, ...over });
    const upcoming = [
      h("thanksgivingEve", "2026-11-25", "2026-11-25", { factor: 1.45, used: true }),
      h("thanksgiving", "2026-11-26", "2026-11-26", { factor: 0, closed: true, used: true }),
      h("blackFriday", "2026-11-27", "2026-11-27"),
      h("thanksgivingWeekend", "2026-11-28", "2026-11-29", { factor: 0.85, used: true }),
      h("christmasEve", "2026-12-15", "2026-12-15"),
    ];
    const s = forecastStory({ ...base, all: sum(sc({ wape: 0.33 }), { f14: sc({ wape: 0.34 }) }), recent: sum(sc({ days: 80, wape: 0.33 })), holidays: { upcoming } })!;
    const p = s.points.find((x) => x.key === "holidays")!;
    expect(p.title).toBe("The forecast now plans for the holidays coming up");
    expect(p.detail).toBe(
      "Thanksgiving Eve (Wed Nov 25): 45% above a usual Wednesday. Thanksgiving (Thu Nov 26): closed, as every year so far. Black Friday (Fri Nov 27): no steady pattern yet, so treated as a usual Friday. Thanksgiving weekend (Nov 28 to Nov 29): 15% below usual. 1 more after that.",
    );
    expect(p.action).toMatch(/yours is used instead/);
    // It comes before "no worse two weeks out", which is only good to know.
    expect(s.points.map((x) => x.key)).toEqual(["holidays", "ahead"]);
    expect(s.next).toMatch(/big local events/);

    const none = forecastStory({ ...base, all: sum(sc()), recent: sum(sc({ days: 80 })), holidays: { upcoming: [h("blackFriday", "2026-11-27", "2026-11-27")] } })!;
    expect(none.points.find((x) => x.key === "holidays")!.title).toBe("Holidays are coming that the forecast can't call yet");
    expect(forecastStory({ ...base, all: sum(sc()), recent: sum(sc({ days: 80 })), holidays: { upcoming: [] } })!.points.some((x) => x.key === "holidays")).toBe(false);
  });

  it("ignores weather groups with too few days or too small an effect", () => {
    const s = forecastStory({ ...base, all: sum(sc()), recent: sum(sc({ days: 80 })), byWeather: [g("snow", 5, 0.8, -0.5), g("rain", 200, 0.12, -0.03)] })!;
    expect(s.points.some((p) => p.key === "weather")).toBe(false);
  });

  it("names the weekdays it can't call and how small they are", () => {
    const s = forecastStory({ ...base, all: sum(sc({ wape: 0.33 })), recent: sum(sc({ days: 80, wape: 0.33 })), byWeekday: [g("1", 154, 0.77), g("2", 55, 0.72), g("5", 401, 0.31), g("6", 402, 0.27)] })!;
    const p = s.points.find((x) => x.key === "weekdays")!;
    expect(p.title).toBe("Mondays and Tuesdays are close to a guess");
    expect(p.action).toMatch(/go by what you know is booked/);
  });

  it("flags event days only when they're clearly worse than ordinary days", () => {
    const worse = forecastStory({ ...base, all: sum(sc()), recent: sum(sc({ days: 80 })), byEvent: [g("normal", 1000, 0.1), g("event", 40, 0.35)] })!;
    expect(worse.points.find((p) => p.key === "events")!.link).toEqual({ href: "/events", label: "Events" });
    const same = forecastStory({ ...base, all: sum(sc()), recent: sum(sc({ days: 80 })), byEvent: [g("normal", 1000, 0.1), g("event", 40, 0.11)] })!;
    expect(same.points.some((p) => p.key === "events")).toBe(false);
  });

  it("says when planning two weeks ahead costs nothing, or when it does", () => {
    const flat = forecastStory({ ...base, all: sum(sc({ wape: 0.33 }), { f14: sc({ wape: 0.34 }) }), recent: sum(sc({ days: 80, wape: 0.33 })) })!;
    expect(flat.points.find((p) => p.key === "ahead")).toMatchObject({ tone: "neutral", title: "It's no worse two weeks out than the night before" });
    const solid = forecastStory({ ...base, all: sum(sc({ wape: 0.1 }), { f14: sc({ wape: 0.105 }) }), recent: sum(sc({ days: 80, wape: 0.1 })) })!;
    expect(solid.points.find((p) => p.key === "ahead")!.tone).toBe("good");
    const worse = forecastStory({ ...base, all: sum(sc({ wape: 0.12 }), { f14: sc({ wape: 0.2 }) }), recent: sum(sc({ days: 80 })) })!;
    expect(worse.points.find((p) => p.key === "ahead")!.action).toMatch(/firm them up a week out/);
  });

  it("mentions a steady lean and keeps to five points", () => {
    const s = forecastStory({
      ...base,
      all: sum(sc({ wape: 0.33 }), { f14: sc({ wape: 0.34 }) }),
      recent: sum(sc({ days: 80, wape: 0.33, bias: 0.09 })),
      byWeather: [g("snow", 53, 0.55, -0.24), g("hot", 160, 0.3, 0.12)],
      byWeekday: [g("1", 154, 0.77)],
      byEvent: [g("normal", 1000, 0.3), g("event", 40, 0.6)],
      byMonth: [g("12", 200, 0.4, -0.15)],
    })!;
    expect(s.points).toHaveLength(5);
    expect(s.points.find((p) => p.key === "lean")!.title).toBe("Lately it runs 9% high");
  });

  it("mentions a month that runs off the forecast only when it's this month or next", () => {
    const args = { ...base, all: sum(sc()), recent: sum(sc({ days: 80 })), byMonth: [g("12", 200, 0.4, -0.15), g("6", 200, 0.4, 0.3)] };
    expect(forecastStory({ ...args, today: "2026-11-18" })!.points.find((p) => p.key === "season")!.title).toBe("December runs 15% under the forecast");
    expect(forecastStory({ ...args, today: "2026-12-30" })!.points.find((p) => p.key === "season")!.title).toMatch(/^December/);
    expect(forecastStory({ ...args, today: "2026-08-05" })!.points.some((p) => p.key === "season")).toBe(false);
  });

  it("gives the yardstick for the same stretch as the verdict", () => {
    const s = forecastStory({ ...base, all: sum(sc(), { skill: 0.14 }), recent: sum(sc({ days: 80 }), { skill: -0.09 }) })!;
    expect(s.skill).toBe(-0.09);
    expect(s.points[0]).toMatchObject({ key: "yardstick", title: "Lately the same day last week has been the better guide" });
    const fine = forecastStory({ ...base, all: sum(sc()), recent: sum(sc({ days: 80 })) })!;
    expect(fine.points.some((p) => p.key === "yardstick")).toBe(false);
  });
});
