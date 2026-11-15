import { describe, expect, it } from "vitest";
import { classifyDiscount, feeDays, FeePayment, FeeRefund, feeSign, givenAway, netFees, orderDiscountLines, parseDiscountMapping, StoredDiscount, summarizeDiscounts, UNNAMED_DISCOUNT } from "../squareMoney";

const m = (amount: number) => ({ amount });
const day = (iso: string) => iso.slice(0, 10);
const pay = (id: string, at: string, fee: number | null, o: Partial<FeePayment> = {}): FeePayment => ({
  id,
  createdAt: at,
  status: "COMPLETED",
  sourceType: "CARD",
  totalCents: 2000,
  fees: fee == null ? [] : [{ effective_at: at, type: "INITIAL", amount_money: m(fee) }],
  ...o,
});
const refund = (id: string, at: string, fee: number, status = "COMPLETED"): FeeRefund => ({ id, createdAt: at, status, fees: [{ type: "INITIAL", amount_money: m(fee) }] });

describe("feeDays", () => {
  it("adds fees per day the payment was taken, with fee adjustments", () => {
    const ps = [
      pay("a", "2026-11-10T20:00:00Z", 59),
      { ...pay("b", "2026-11-10T21:00:00Z", 34), fees: [{ type: "INITIAL", amount_money: m(34) }, { type: "ADJUSTMENT", amount_money: m(-4) }] },
      pay("c", "2026-11-11T19:00:00Z", 100, { totalCents: 3500 }),
    ];
    const [d1, d2] = feeDays(ps, [], ["2026-11-10", "2026-11-11"], day);
    expect(d1).toMatchObject({ cardFees: 0.89, feesReturned: 0, feePayments: 2, feeVolume: 40 });
    expect(d2).toMatchObject({ cardFees: 1, feePayments: 1, feeVolume: 35 });
  });

  it("takes fees returned on refunds off the day of the refund (Square's example: +34 on the payment, −34 on its refund)", () => {
    const [d1, d2] = feeDays([pay("a", "2026-11-10T20:00:00Z", 34)], [refund("r", "2026-11-11T15:00:00Z", -34)], ["2026-11-10", "2026-11-11"], day);
    expect(d1.cardFees).toBe(0.34);
    expect(d2).toMatchObject({ cardFees: 0, feesReturned: 0.34 });
    expect(netFees(d1) + netFees(d2)).toBeCloseTo(0, 6);
  });

  it("reads the other sign convention (fees negative on payments) the same way", () => {
    const ps = [pay("a", "2026-11-10T20:00:00Z", -425), pay("b", "2026-11-10T21:00:00Z", -100)];
    expect(feeSign(ps)).toBe(-1);
    const [d] = feeDays(ps, [refund("r", "2026-11-10T22:00:00Z", 100)], ["2026-11-10"], day);
    expect(d).toMatchObject({ cardFees: 5.25, feesReturned: 1 });
  });

  it("gives every date a row, skips failed refunds and duplicates, and counts card payments still waiting for a fee", () => {
    const ps = [pay("a", "2026-11-10T20:00:00Z", 50), pay("a", "2026-11-10T20:00:00Z", 50), pay("cash", "2026-11-10T20:00:00Z", null, { sourceType: "CASH" }), pay("new", "2026-11-10T23:00:00Z", null), pay("x", "2026-11-10T23:00:00Z", 80, { status: "FAILED" }), pay("out", "2026-11-12T01:00:00Z", 999)];
    const [d1, d2] = feeDays(ps, [refund("r", "2026-11-10T22:00:00Z", -50, "FAILED")], ["2026-11-10", "2026-11-11"], day);
    expect(d1).toMatchObject({ cardFees: 0.5, feesReturned: 0, feePayments: 1, feePending: 1 });
    expect(d2).toMatchObject({ cardFees: 0, feesReturned: 0, feePayments: 0, feePending: 0 });
  });
});

describe("orderDiscountLines", () => {
  it("names each applied discount and spots a line given away whole", () => {
    const lines = orderDiscountLines({
      id: "o1",
      discounts: [{ uid: "d1", name: "Comp", type: "FIXED_PERCENTAGE", percentage: "100", scope: "LINE_ITEM" }, { uid: "d2", name: "Happy hour", scope: "ORDER" }],
      line_items: [
        { catalog_object_id: "burger", name: "Burger", quantity: "1", gross_sales_money: m(1600), total_discount_money: m(1600), applied_discounts: [{ discount_uid: "d1", applied_money: m(1600) }] },
        { catalog_object_id: "ipa", name: "IPA", variation_name: "Pint", quantity: "2", gross_sales_money: m(1400), total_discount_money: m(200), applied_discounts: [{ discount_uid: "d2", applied_money: m(200) }] },
        { catalog_object_id: "fries", name: "Fries", quantity: "1", gross_sales_money: m(500), total_discount_money: m(0) },
        { name: "Gift card", item_type: "GIFT_CARD", quantity: "1", gross_sales_money: m(5000), total_discount_money: m(500), applied_discounts: [{ discount_uid: "d2", applied_money: m(500) }] },
      ],
    });
    expect(lines).toEqual([
      { orderId: "o1", name: "Comp", squareId: "burger", itemName: "Burger", qty: 1, full: true, cents: 1600, percentage: "100" },
      { orderId: "o1", name: "Happy hour", squareId: "ipa", itemName: "IPA · Pint", qty: 2, full: false, cents: 200, percentage: null },
    ]);
  });

  it("keeps discount money with no named discount, and returns come off", () => {
    const lines = orderDiscountLines({
      id: "o2",
      line_items: [{ catalog_object_id: "nachos", name: "Nachos", quantity: "1", gross_sales_money: m(1200), total_discount_money: m(300) }],
      returns: [{ return_discounts: [{ uid: "r1", name: "Spill" }], return_line_items: [{ catalog_object_id: "ipa", name: "IPA", quantity: "1", gross_return_money: m(700), total_discount_money: m(700), applied_discounts: [{ discount_uid: "r1", applied_money: m(700) }] }] }],
    });
    expect(lines.map((l) => [l.name, l.cents, l.qty])).toEqual([[UNNAMED_DISCOUNT, 300, 1], ["Spill", -700, -1]]);
  });
});

describe("classifyDiscount", () => {
  it("reads the name, then a 100% discount, else a promo", () => {
    expect(classifyDiscount("Comp")).toBe("comp");
    expect(classifyDiscount("Manager comp")).toBe("comp");
    expect(classifyDiscount("On the house")).toBe("comp");
    expect(classifyDiscount("Spill")).toBe("waste");
    expect(classifyDiscount("Remake - wrong order")).toBe("waste");
    expect(classifyDiscount("Staff meal")).toBe("staff");
    expect(classifyDiscount("Employee 50%")).toBe("staff");
    expect(classifyDiscount("Staff comp")).toBe("staff");
    expect(classifyDiscount("Happy hour")).toBe("promo");
    expect(classifyDiscount("Industry night", { percentage: "100" })).toBe("comp");
    expect(classifyDiscount("Birthday", { full: true })).toBe("comp");
    expect(classifyDiscount("Compost bin")).toBe("promo");
  });

  it("lets a setting win, matched on the name without case or extra spaces", () => {
    const mapping = parseDiscountMapping({ "  happy   HOUR ": "comp", Comp: "waste", junk: "nope", n: 3 });
    expect(mapping).toEqual({ "happy hour": "comp", comp: "waste" });
    expect(classifyDiscount("Happy Hour", {}, mapping)).toBe("comp");
    expect(classifyDiscount("COMP", {}, mapping)).toBe("waste");
  });
});

describe("summarizeDiscounts", () => {
  const r = (o: Partial<StoredDiscount>): StoredDiscount => ({ date: "2026-11-10", name: "Comp", squareId: "burger", itemName: "Burger", teamMemberId: "", amount: 16, qty: 1, full: true, percentage: "100", ...o });
  it("rolls up by class, reason, item, staff and day, leaving out ignored items", () => {
    const s = summarizeDiscounts(
      [
        r({}),
        r({ teamMemberId: "tm1" }),
        r({ name: "Spill", squareId: "ipa", itemName: "IPA", amount: 7, full: true, percentage: null, date: "2026-11-11" }),
        r({ name: "Spill", squareId: "ipa", itemName: "IPA", amount: -7, qty: -1, date: "2026-11-11" }),
        r({ name: "Happy hour", squareId: "ipa", itemName: "IPA", amount: 4, qty: 2, full: false, percentage: null }),
        r({ name: "Comp", squareId: "tshirt", itemName: "T-shirt", amount: 25 }),
      ],
      {},
      { ignored: new Set(["tshirt"]), staffName: (id) => (id === "tm1" ? "Sam" : "?") },
    );
    expect(s.total).toBe(36);
    expect(s.byClass).toEqual({ comp: 32, waste: 0, staff: 0, promo: 4 });
    expect(givenAway(s.byClass)).toBe(32);
    expect(s.byReason.map((g) => [g.label, g.amount, g.cls])).toEqual([["Comp", 32, "comp"], ["Happy hour", 4, "promo"]]);
    expect(s.byItem.map((g) => [g.label, g.amount, g.qty])).toEqual([["Burger", 32, 2], ["IPA", 4, 2]]);
    expect(s.byStaff.map((g) => [g.label, g.amount])).toEqual([["Not recorded", 20], ["Sam", 16]]);
    expect(s.byDay.get("2026-11-10")?.total).toBe(36);
    expect(s.byDay.get("2026-11-11")?.total).toBe(0);
  });
});
