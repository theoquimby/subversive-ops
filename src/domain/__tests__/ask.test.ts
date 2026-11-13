import { describe, expect, it } from "vitest";
import { clampPeriod, findPeriod, namedPeriod, routeQuestion, SUGGESTED_QUESTIONS } from "../ask";

const today = "2026-11-13"; // a Friday

describe("ask routing", () => {
  it("knows named periods", () => {
    expect(namedPeriod("last week", today)).toMatchObject({ from: "2026-11-02", to: "2026-11-09" });
    expect(namedPeriod("this month", today)).toMatchObject({ from: "2026-11-01", to: "2026-12-01" });
    expect(namedPeriod("last month", "2026-01-15")).toMatchObject({ from: "2025-12-01", to: "2026-01-01" });
    expect(namedPeriod("last 7 days", today)).toMatchObject({ from: "2026-11-06", to: today });
    expect(findPeriod("food cost yesterday?", today)?.from).toBe("2026-11-12");
  });

  it("routes the common questions", () => {
    expect(routeQuestion("What was food cost last week?", today)).toEqual({ tool: "period_kpis", args: { from: "2026-11-02", to: "2026-11-09" } });
    expect(routeQuestion("Which items lost margin this month?", today)?.tool).toBe("menu_margins");
    expect(routeQuestion("who's over 35 hours?", today)).toEqual({ tool: "schedule_week", args: { week_start: "2026-11-09", over_hours: 35 } });
    expect(routeQuestion("what do I need to order", today)?.tool).toBe("order_plans");
    expect(routeQuestion("tell me a joke", today)).toBeNull();
  });

  it("routes certificate questions before margin and schedule words", () => {
    expect(routeQuestion("who has an expired ATAP?", today)).toEqual({ tool: "cert_status", args: { cert: "ATAP", status: "expired" } });
    expect(routeQuestion("Who's missing harassment training?", today)).toEqual({ tool: "cert_status", args: { cert: "harassment", status: "missing" } });
    expect(routeQuestion("food handler cards expiring soon", today)).toEqual({ tool: "cert_status", args: { cert: "Food Handler", status: "expiring" } });
    expect(routeQuestion("are we compliant on certificates?", today)).toEqual({ tool: "cert_status", args: {} });
    expect(routeQuestion("what went missing since the last count?", today)?.tool).toBe("margin_gap");
  });

  it("every suggested question routes", () => {
    for (const q of SUGGESTED_QUESTIONS) expect(q.route(today).tool).toBeTruthy();
  });

  it("clamps bad periods", () => {
    expect(clampPeriod("2026-11-09", "2026-11-01", today)).toMatchObject({ from: "2026-11-09", to: "2026-11-10" });
    expect(clampPeriod("nope", undefined, today).from).toBe("2026-11-02");
    expect(clampPeriod("2020-01-01", "2026-01-01", today).from).toBe("2024-12-31");
  });
});

describe("insights questions", () => {
  const today = "2026-11-13";
  it("routes opportunity and model questions to the insights tool", () => {
    expect(routeQuestion("What should I do to make more money?", today)).toEqual({ tool: "insights", args: {} });
    expect(routeQuestion("What's my break-even?", today)).toEqual({ tool: "insights", args: { topic: "drivers" } });
    expect(routeQuestion("What if I raise the price of the burger?", today)).toEqual({ tool: "insights", args: { topic: "price" } });
    expect(routeQuestion("Am I overstaffed on Saturdays?", today)).toEqual({ tool: "insights", args: { topic: "staffing" } });
    expect(routeQuestion("Which menu items are stars and dogs?", today)).toEqual({ tool: "insights", args: { topic: "menu" } });
  });
  it("leaves supplier price and schedule questions alone", () => {
    expect(routeQuestion("What went up in price lately?", today)?.tool).toBe("price_moves");
    expect(routeQuestion("Who's over 35 hours this week?", today)?.tool).toBe("schedule_week");
  });
});
