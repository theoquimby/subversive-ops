import { describe, expect, it } from "vitest";
import { durationLabel, firstName, greeting, quickActionOrder, relativeDay, shiftCountdown, sortTodos, type Todo } from "../staffHome";

const MIN = 60_000;

describe("shift countdown", () => {
  const start = 1_000_000_000_000;
  const end = start + 6 * 60 * MIN;
  it("counts down before the shift, flagging the last 90 minutes", () => {
    expect(shiftCountdown(start - 3 * 60 * MIN - 20 * MIN, start, end)).toEqual({ state: "upcoming", big: "3h 20m", small: "until you start" });
    expect(shiftCountdown(start - 45 * MIN, start, end).state).toBe("soon");
    expect(shiftCountdown(start - 45 * MIN, start, end).big).toBe("45 min");
  });
  it("says how long is left during the shift, and done after", () => {
    expect(shiftCountdown(start + 60 * MIN, start, end)).toEqual({ state: "now", big: "On now", small: "5h left" });
    expect(shiftCountdown(end, start, end).state).toBe("over");
  });
  it("rounds durations up so it never says 0 min before you start", () => {
    expect(durationLabel(10_000)).toBe("1 min");
    expect(durationLabel(2 * 60 * MIN)).toBe("2h");
    expect(durationLabel(50 * 60 * MIN)).toBe("2 days");
  });
});

describe("relative day", () => {
  it("names today, tomorrow and this week's weekdays", () => {
    expect(relativeDay("2026-11-15", "2026-11-15")).toBe("Today");
    expect(relativeDay("2026-11-16", "2026-11-15")).toBe("Tomorrow");
    expect(relativeDay("2026-11-20", "2026-11-15")).toBe("Friday");
    expect(relativeDay("2026-11-23", "2026-11-15")).toBeNull();
  });
});

describe("greeting and names", () => {
  it("fits the time of day", () => {
    expect(greeting(8)).toBe("Good morning");
    expect(greeting(14)).toBe("Good afternoon");
    expect(greeting(21)).toBe("Good evening");
  });
  it("uses the first name", () => expect(firstName(" Ava  Abbott ")).toBe("Ava"));
});

describe("quick actions", () => {
  it("puts the most likely tool first for each kind of job, always the same six", () => {
    expect(quickActionOrder(["Prep cook"])[0]).toBe("prep");
    expect(quickActionOrder(["Bartender"])[0]).toBe("scan");
    expect(quickActionOrder(["Server", "Host"])[0]).toBe("note");
    for (const p of [["Prep cook"], ["Bartender"], ["Server"], ["Bartender", "Line cook"]]) expect(new Set(quickActionOrder(p)).size).toBe(6);
  });
});

describe("to-do order", () => {
  it("puts overdue first, then due soon, then offers", () => {
    const t = (kind: Todo["kind"], tone: Todo["tone"]): Todo => ({ kind, tone, title: kind, detail: "", href: "/my" });
    expect(sortTodos([t("open", "neutral"), t("sign", "warn"), t("cert", "bad"), t("training", "warn")]).map((x) => x.kind)).toEqual(["cert", "sign", "training", "open"]);
  });
});
