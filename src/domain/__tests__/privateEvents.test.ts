import { describe, expect, it } from "vitest";
import {
  canMove,
  cents,
  defaultDueDates,
  DEFAULT_CONFIG,
  forecastImpact,
  isQuoteToken,
  nextStage,
  parseConfig,
  prepPortions,
  privateEventAttention,
  quoteTotals,
  reminderText,
  stageAfterPayment,
  type AttentionBooking,
  type QuoteInput,
  type StageFacts,
} from "../privateEvents";

const base: QuoteInput = {
  headcount: 40,
  lines: [],
  roomFee: 0,
  bar: { kind: "NONE", tickets: 0, ticketPrice: 0, amount: 0 },
  serviceChargePct: 0.2,
  taxPct: 0.08,
  depositPct: 0.25,
  depositAmount: null,
  barCostPct: 0.25,
};

describe("quote totals", () => {
  it("adds a per-person package, drink tickets and a room fee, then service charge and NY tax", () => {
    const q = quoteTotals({
      ...base,
      lines: [{ label: "Taproom buffet", qty: 1, perPerson: true, unitPrice: 32, unitCost: 9.5 }],
      bar: { kind: "TICKETS", tickets: 80, ticketPrice: 7, amount: 0 },
      roomFee: 250,
    });
    expect(q.food).toBe(1280);
    expect(q.bar).toBe(560);
    expect(q.subtotal).toBe(2090);
    // Service charge on food + bar only, not the room fee.
    expect(q.serviceCharge).toBe(368);
    // Tax on everything, service charge included.
    expect(q.taxable).toBe(2458);
    expect(q.tax).toBe(196.64);
    expect(q.total).toBe(2654.64);
    expect(q.deposit).toBe(663.66);
    expect(q.balance).toBe(2654.64);
    expect(q.perGuest).toBe(66.37);
  });

  it("costs food and bar for the margin, leaving tax and service charge out", () => {
    const q = quoteTotals({
      ...base,
      headcount: 10,
      lines: [
        { label: "Wings platter", qty: 3, perPerson: false, unitPrice: 45, unitCost: 12 },
        { label: "Burger", qty: 1, perPerson: true, unitPrice: 18, unitCost: 5.25 },
      ],
      bar: { kind: "MINIMUM", tickets: 0, ticketPrice: 0, amount: 500 },
    });
    expect(q.food).toBe(315);
    expect(q.foodCost).toBe(88.5);
    expect(q.foodCostPct).toBeCloseTo(88.5 / 315, 6);
    expect(q.barCost).toBe(125);
    expect(q.margin).toBe(815 - 88.5 - 125);
    expect(q.marginPct).toBeCloseTo(601.5 / 815, 6);
    expect(q.costIncomplete).toBe(false);
  });

  it("flags food cost as incomplete when a priced line has no cost", () => {
    const q = quoteTotals({ ...base, lines: [{ label: "Cake (outside)", qty: 1, perPerson: false, unitPrice: 0, unitCost: null }, { label: "Special", qty: 2, perPerson: false, unitPrice: 20, unitCost: null }] });
    expect(q.costIncomplete).toBe(true);
    expect(q.foodCost).toBe(0);
  });

  it("uses a fixed deposit over the percent, never more than the total", () => {
    const lines = [{ label: "Buffet", qty: 1, perPerson: true, unitPrice: 10, unitCost: 3 }];
    expect(quoteTotals({ ...base, headcount: 10, lines, depositAmount: 50 }).deposit).toBe(50);
    expect(quoteTotals({ ...base, headcount: 1, lines, depositAmount: 500 }).deposit).toBe(quoteTotals({ ...base, headcount: 1, lines }).total);
    expect(quoteTotals({ ...base, headcount: 10, lines, depositAmount: 0 }).deposit).toBe(0);
  });

  it("takes payments off the balance and handles zero tax and service", () => {
    const q = quoteTotals({ ...base, headcount: 20, serviceChargePct: 0, taxPct: 0, lines: [{ label: "Pizza", qty: 1, perPerson: true, unitPrice: 15, unitCost: 4 }], paid: 100 });
    expect(q.total).toBe(300);
    expect(q.balance).toBe(200);
  });

  it("treats open tab as an estimate amount and ignores junk numbers", () => {
    const q = quoteTotals({ ...base, headcount: -5, lines: [{ label: "x", qty: Number.NaN, perPerson: true, unitPrice: 10, unitCost: 1 }], bar: { kind: "OPEN_TAB", tickets: 9, ticketPrice: 9, amount: 1000 } });
    expect(q.food).toBe(0);
    expect(q.bar).toBe(1000);
    expect(q.perGuest).toBeNull();
  });

  it("rounds to cents without float drift", () => {
    expect(cents(1.005)).toBe(1.01);
    expect(cents(0.1 + 0.2)).toBe(0.3);
    expect(cents(-2.675)).toBe(-2.68);
  });
});

describe("pipeline", () => {
  const facts: StageFacts = { date: "2026-12-12", headcount: 40, total: 2600, deposit: 650, paid: 0, today: "2026-11-15" };

  it("needs a date, headcount and a priced quote to be quoted", () => {
    expect(canMove("INQUIRY", "QUOTED", facts)).toEqual({ ok: true });
    expect(canMove("INQUIRY", "QUOTED", { ...facts, date: null })).toMatchObject({ ok: false, error: "Add a date first." });
    expect(canMove("INQUIRY", "QUOTED", { ...facts, headcount: 0 })).toMatchObject({ ok: false });
    expect(canMove("INQUIRY", "QUOTED", { ...facts, total: 0 })).toMatchObject({ ok: false, error: "Add something to the quote first." });
  });

  it("needs the deposit recorded before deposit paid or confirmed", () => {
    expect(canMove("QUOTED", "DEPOSIT", facts)).toMatchObject({ ok: false });
    expect(canMove("QUOTED", "CONFIRMED", facts)).toMatchObject({ ok: false });
    expect(canMove("QUOTED", "CONFIRMED", { ...facts, paid: 650 })).toEqual({ ok: true });
    // No deposit asked for: straight to confirmed.
    expect(canMove("QUOTED", "CONFIRMED", { ...facts, deposit: 0 })).toEqual({ ok: true });
  });

  it("checks every stage it skips", () => {
    expect(canMove("INQUIRY", "CONFIRMED", { ...facts, paid: 650, total: 0 })).toMatchObject({ ok: false, error: "Add something to the quote first." });
  });

  it("can't be done before the date", () => {
    expect(canMove("CONFIRMED", "DONE", facts)).toMatchObject({ ok: false, error: "It hasn't happened yet." });
    expect(canMove("CONFIRMED", "DONE", { ...facts, today: "2026-12-12" })).toEqual({ ok: true });
  });

  it("moves back freely, reopens lost as an inquiry, and done only back to confirmed", () => {
    expect(canMove("CONFIRMED", "QUOTED", facts)).toEqual({ ok: true });
    expect(canMove("QUOTED", "LOST", facts)).toEqual({ ok: true });
    expect(canMove("DONE", "LOST", facts)).toMatchObject({ ok: false });
    expect(canMove("LOST", "QUOTED", facts)).toMatchObject({ ok: false });
    expect(canMove("LOST", "INQUIRY", facts)).toEqual({ ok: true });
    expect(canMove("DONE", "INQUIRY", facts)).toMatchObject({ ok: false });
    expect(canMove("DONE", "CONFIRMED", facts)).toEqual({ ok: true });
    expect(canMove("QUOTED", "QUOTED", facts)).toMatchObject({ ok: false });
  });

  it("moves to deposit paid once payments cover the deposit", () => {
    expect(stageAfterPayment("QUOTED", 650, 649.99)).toBeNull();
    expect(stageAfterPayment("QUOTED", 650, 650)).toBe("DEPOSIT");
    expect(stageAfterPayment("INQUIRY", 0, 100)).toBe("DEPOSIT");
    expect(stageAfterPayment("CONFIRMED", 650, 2000)).toBeNull();
    expect(nextStage("INQUIRY")).toBe("QUOTED");
    expect(nextStage("DONE")).toBeNull();
    expect(nextStage("LOST")).toBeNull();
  });
});

describe("settings and dates", () => {
  it("keeps defaults for anything missing or out of range", () => {
    expect(parseConfig(null)).toEqual(DEFAULT_CONFIG);
    const c = parseConfig({ taxPct: 0.0875, serviceChargePct: 3, spaces: [{ name: " Mezzanine ", buyout: false, capacity: 30 }, { name: "" }] });
    expect(c.taxPct).toBe(0.0875);
    expect(c.serviceChargePct).toBe(0.5);
    expect(c.spaces).toEqual([{ name: "Mezzanine", buyout: false, capacity: 30 }]);
  });

  it("sets the deposit a week out (never after the event) and the balance before the event", () => {
    expect(defaultDueDates("2026-11-15", "2026-12-12", DEFAULT_CONFIG)).toEqual({ depositDueOn: "2026-11-22", balanceDueOn: "2026-12-09" });
    expect(defaultDueDates("2026-11-15", "2026-11-18", DEFAULT_CONFIG)).toEqual({ depositDueOn: "2026-11-18", balanceDueOn: "2026-11-15" });
    expect(defaultDueDates("2026-11-15", null, DEFAULT_CONFIG).balanceDueOn).toBeNull();
  });
});

describe("forecast impact", () => {
  it("adds a room's sales to a normal day, and a buyout replaces it", () => {
    expect(forecastImpact({ eventSales: 1500, headcount: 40, buyout: false, baseline: 3000 })).toBe(1.5);
    expect(forecastImpact({ eventSales: 4500, headcount: 100, buyout: true, baseline: 3000 })).toBe(1.5);
    expect(forecastImpact({ eventSales: 0, headcount: 30, buyout: false, baseline: null })).toBe(1.3);
    expect(forecastImpact({ eventSales: 100000, headcount: 30, buyout: false, baseline: 1000 })).toBe(5);
  });
});

describe("needs you", () => {
  const today = "2026-11-15";
  const b = (o: Partial<AttentionBooking>): AttentionBooking => ({ id: "x", title: "Smith party", stage: "QUOTED", date: "2026-12-12", createdOn: "2026-11-01", followUpOn: null, quoteSent: true, accepted: false, deposit: 500, depositDueOn: "2026-11-20", balance: 2000, balanceDueOn: "2026-12-09", paid: 0, headcount: 40, ...o });

  it("flags overdue deposits first, then balances coming due", () => {
    const items = privateEventAttention(today, [
      b({ id: "a", depositDueOn: "2026-11-13" }),
      b({ id: "b", stage: "CONFIRMED", paid: 500, deposit: 500, balanceDueOn: "2026-11-17" }),
      b({ id: "c", depositDueOn: "2026-11-30" }),
    ]);
    expect(items.map((i) => i.key)).toEqual(["private.deposit.a", "private.balance.b"]);
    expect(items[0]).toMatchObject({ tone: "bad", title: "Deposit overdue: Smith party", href: "/events/private/a" });
    expect(items[1].detail).toBe("$2,000 due in 2 days");
  });

  it("reminds about follow-ups, unanswered inquiries and events to close out", () => {
    const items = privateEventAttention(today, [
      b({ id: "f", stage: "INQUIRY", followUpOn: "2026-11-14", quoteSent: false }),
      b({ id: "n", stage: "INQUIRY", quoteSent: false, createdOn: "2026-11-12" }),
      b({ id: "fresh", stage: "INQUIRY", quoteSent: false, createdOn: "2026-11-15" }),
      b({ id: "p", stage: "CONFIRMED", date: "2026-11-14", balance: 0 }),
      b({ id: "l", stage: "LOST", depositDueOn: "2026-11-01" }),
    ]);
    expect(items.map((i) => i.key)).toEqual(["private.follow.f", "private.close.p", "private.reply.n"]);
  });

  it("nudges to confirm when the deposit's in and the date is close", () => {
    expect(privateEventAttention(today, [b({ stage: "DEPOSIT", paid: 500, date: "2026-11-25", balanceDueOn: "2026-11-22" })])[0].key).toBe("private.confirm.x");
  });
});

describe("prep portions", () => {
  it("multiplies per-guest lines by headcount and explodes packages", () => {
    const pk = new Map([["pk1", [{ recipeId: "wings", perGuest: 0.5 }, { recipeId: "fries", perGuest: 1 }]]]);
    const out = prepPortions(40, [
      { kind: "PACKAGE", recipeId: null, packageId: "pk1", label: "Pub package", qty: 1, perPerson: true },
      { kind: "ITEM", recipeId: "wings", packageId: null, label: "Wings", qty: 5, perPerson: false },
      { kind: "CUSTOM", recipeId: null, packageId: null, label: "Cake", qty: 1, perPerson: false },
    ], pk);
    expect(Object.fromEntries(out)).toEqual({ wings: 25, fries: 40 });
  });
});

describe("quote link and reminders", () => {
  it("only accepts 43-character base64url tokens", () => {
    expect(isQuoteToken("a".repeat(43))).toBe(true);
    expect(isQuoteToken("a".repeat(42))).toBe(false);
    expect(isQuoteToken(`${"a".repeat(42)}/`)).toBe(false);
    expect(isQuoteToken(null)).toBe(false);
  });

  it("writes a plain reminder", () => {
    const t = reminderText({ clientName: "Jane Smith", eventLabel: "your party on Dec 12", amount: 663.66, dueOn: "2026-11-22", kind: "deposit", link: "https://x/quote/abc", business: "Subversive" });
    expect(t).toContain("Hi Jane,");
    expect(t).toContain("deposit of $663.66 for your party on Dec 12 is due by Sunday, November 22.");
    expect(t).toContain("https://x/quote/abc");
  });
});
