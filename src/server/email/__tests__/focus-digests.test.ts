import { describe, expect, it } from "vitest";
import type { MorningBrief } from "@/server/services/morningBrief";
import type { WeeklyBrief } from "@/server/services/brief";
import { briefDigest } from "../brief-digest";
import { morningDigest } from "../morning-digest";

// Just the fields the digests read.
const morning = {
  today: "2026-11-16",
  yesterday: "2026-11-15",
  weekdayName: "Monday",
  monday: false,
  y: { closed: false, line: "$4,210 in sales, 8% over forecast.", flags: [] },
  day: { closed: false, forecast: 3150, busy: { label: "5–8pm" }, weather: null, events: [] },
  parties: { today: [], tomorrow: [] },
  crew: { people: 6, check: { line: "Short one person 6–8pm.", tone: "warn" } },
  tonight: [
    { key: "deadline:sysco", kind: "deadline", title: "Order from Sysco", detail: "Due today 4pm", href: "/ordering/sysco", tone: "warn", urgency: 93 },
    { key: "invoices", kind: "invoices", title: "2 invoices to approve", detail: "Waiting for a look", href: "/invoices", tone: "neutral", urgency: 40 },
    { key: "brewery.transfer", kind: "brewery", title: "FV3: Hazy ready to transfer", detail: "Day 12 of 10", href: "/brewery", tone: "warn", urgency: 52 },
    { key: "upkeep.down", kind: "other", title: "Glycol chiller is down", detail: "Since today", href: "/upkeep", tone: "bad", urgency: 70 },
    { key: "tap-3", kind: "kegs", title: "Pils is almost gone", detail: "Line 3", href: "/kegs/taps", tone: "neutral" },
  ],
  prep: true,
  notes: [],
  wrap: null,
} as unknown as MorningBrief;

describe("morning digest by focus", () => {
  it("no focus: everything, and no focus fields at all", () => {
    const d = morningDigest(morning, null);
    expect(d.tonight).toHaveLength(5);
    expect(d.yesterday?.line).toContain("$4,210");
    expect(d.today?.headline).toBe("$3,150 forecast · busiest 5–8pm");
    expect(d.prepPath).toBe("/prep");
    expect("focus" in d).toBe(false);
    expect("elsewhere" in d).toBe(false);
    expect(morningDigest(morning, null, [])).toEqual(d);
  });

  it("brewery only: brewery lines plus urgent ones; the rest a line per area", () => {
    const d = morningDigest(morning, null, ["brewery"]);
    expect(d.tonight.map((t) => t.title)).toEqual(["Order from Sysco", "FV3: Hazy ready to transfer", "Glycol chiller is down"]);
    expect(d.yesterday).toBeNull();
    expect(d.today).toBeNull();
    expect(d.prepPath).toBeNull();
    expect(d.focus).toEqual(["Brewery"]);
    expect(d.elsewhere).toEqual([
      { label: "Business", count: 0, line: "Today: $3,150 forecast · busiest 5–8pm", path: "/pnl" },
      { label: "Kegs", count: 1, line: "Pils is almost gone", path: "/kegs/taps" },
      { label: "Kitchen", count: 1, line: "2 invoices to approve", path: "/invoices" },
      { label: "People", count: 0, line: "6 on today. Short one person 6–8pm.", path: "/schedule" },
      { label: "Online", count: 0, line: "Nothing waiting", path: "/online" },
    ]);
  });

  it("business and kitchen: yesterday, today and their lines; brewery and kegs elsewhere unless urgent", () => {
    const d = morningDigest(morning, null, ["business", "kitchen"]);
    expect(d.tonight.map((t) => t.title)).toEqual(["Order from Sysco", "2 invoices to approve", "Glycol chiller is down"]);
    expect(d.yesterday).not.toBeNull();
    expect(d.today).not.toBeNull();
    expect(d.prepPath).toBe("/prep");
    expect(d.elsewhere!.map((g) => `${g.label}:${g.count}`)).toEqual(["Brewery:1", "Kegs:1", "People:0", "Online:0"]);
  });
});

const weekly = {
  today: "2026-11-15",
  week: "2026-11-16",
  orders: [{ supplierId: "s1", supplier: "Sysco", items: 4, total: 300, minOrder: null, deliveryDate: "2026-11-17", existingDraftId: null }],
  schedule: { published: 0, drafts: 12, open: 0, hours: 120, cost: 2000, missingRates: 0, laborPct: 0.27 },
  requests: { timeOff: 1, swaps: 0 },
  reviews: { unreplied: 0, alerts: [] },
  increases: [],
  overTarget: [],
  gap: null,
  unmapped: { count: 0, sales: 0, top: [] },
  decisions: [],
  training: { hasTypes: true, expired: [{ person: "Jamie", cert: "Food handler" }], expiring: [], missing: [], overdue: [] },
  counts: { last: "2026-11-12", daysSince: 3, overdue: false },
  forecast: { total: 24000, busiest: [], events: [] },
  budget: null,
  lastWeek: null,
  kegs: null,
} as unknown as WeeklyBrief;

describe("weekly digest by focus", () => {
  it("no focus: as before, no focus fields", () => {
    const d = briefDigest(weekly);
    expect(d.todo.map((t) => t.title)).toEqual(["Order from Sysco", "Publish the schedule", "Answer staff requests", "Training & certificates"]);
    expect(d.forecastTotal).toBe(24000);
    expect("elsewhere" in d).toBe(false);
  });

  it("brewery only: the brewery's to-dos, anything red, and Elsewhere", () => {
    const d = briefDigest(weekly, {
      focus: ["brewery"],
      brewery: [{ key: "brewery.suggest", title: "Brew Pils by Thu", detail: "Full kegs run out around Nov 30", href: "/brewery/schedule", tone: "warn", urgency: 42 }],
    });
    expect(d.todo.map((t) => t.title)).toEqual(["Brew Pils by Thu", "Training & certificates"]);
    expect(d.clear).toEqual([]);
    expect(d.forecastTotal).toBe(0);
    expect(d.focus).toEqual(["Brewery"]);
    expect(d.elsewhere!.map((g) => `${g.label}:${g.count}`)).toEqual(["Business:0", "Kegs:0", "Kitchen:1", "People:2", "Online:0"]);
  });

  it("the brewery's to-dos only join for someone who looks after the brewery", () => {
    const d = briefDigest(weekly, { focus: ["kitchen"], brewery: [{ key: "brewery.suggest", title: "Brew Pils", detail: "", href: "/brewery", tone: "warn", urgency: 42 }] });
    expect(d.todo.map((t) => t.title)).toEqual(["Order from Sysco", "Training & certificates"]);
  });
});
