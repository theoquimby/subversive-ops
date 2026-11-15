import { describe, expect, it } from "vitest";
import type { CostRecipe } from "../costing";
import {
  amountText,
  coverWindow,
  DEFAULT_PREP_SETTINGS,
  defaultPrepUnit,
  estimatePrepOnHand,
  formatBatches,
  formatPrepQty,
  friendlyAmount,
  groupByStation,
  parsePrepUnit,
  planPrep,
  prepOrder,
  prepStep,
  prepUnitLabel,
  prepUsage,
  roundUpTo,
  runsOut,
  scaleRecipe,
  serviceShareAfter,
  windowLabel,
  type PrepDay,
  type PrepItemSettings,
  type PrepPlanItem,
} from "../prep";
import { toBase } from "../units";

const QT = toBase(1, "qt", "ml");
const FLOZ = toBase(1, "fl oz", "ml");

const recipe = (o: Partial<CostRecipe> & Pick<CostRecipe, "id">): CostRecipe => ({ name: o.id, yieldQty: 1, yieldUnit: "each", yieldBase: "each", menuPrice: null, lines: [], ...o });

// Garlic aioli: 3.5 qt batch, uses 8 oz roasted garlic. Burger uses 1 fl oz aioli; wings use 4 fl oz buffalo.
const roastedGarlic = recipe({ id: "rg", name: "Roasted Garlic", yieldQty: 65, yieldUnit: "oz", yieldBase: "g" });
const aioli = recipe({ id: "aioli", name: "Garlic Aioli", yieldQty: 112, yieldUnit: "fl oz", yieldBase: "ml", lines: [{ subRecipeId: "rg", qty: 8, unit: "oz" }, { ingredientId: "mayo", qty: 3, unit: "qt" }] });
const buffalo = recipe({ id: "buffalo", name: "Buffalo Sauce", yieldQty: 1, yieldUnit: "gal", yieldBase: "ml" });
const fries = recipe({ id: "fries", name: "Side of Fries", lines: [{ subRecipeId: "aioli", qty: 1, unit: "fl oz" }] });
const burger = recipe({ id: "burger", name: "Classic Burger", lines: [{ subRecipeId: "aioli", qty: 1, unit: "fl oz" }, { subRecipeId: "fries", qty: 1, unit: "each" }] });
const wings = recipe({ id: "wings", name: "Wings (10)", lines: [{ subRecipeId: "buffalo", qty: 4, unit: "fl oz" }] });
const ctx = { ingredients: new Map(), recipes: new Map([roastedGarlic, aioli, buffalo, fries, burger, wings].map((r) => [r.id, r])) };
const prepIds = new Set(["rg", "aioli", "buffalo", "fries"]);
const names = new Map([["burger", "Classic Burger"], ["wings", "Wings (10)"]]);

const day = (date: string, burgers: number, w = 0): PrepDay => ({ date, servings: new Map([["burger", burgers], ["wings", w]]) });
const item = (r: CostRecipe, onHandBase: number, s: Partial<PrepItemSettings> = {}, known = true): PrepPlanItem => ({ recipe: r, settings: { ...DEFAULT_PREP_SETTINGS, ...s }, onHandBase, onHandKnown: known, done: null });

describe("prep units", () => {
  it("defaults to quarts, pounds or each", () => {
    expect(defaultPrepUnit(aioli).name).toBe("qt");
    expect(defaultPrepUnit(roastedGarlic).name).toBe("lb");
    expect(defaultPrepUnit(recipe({ id: "sh", yieldQty: 14, yieldUnit: "oz", yieldBase: "g" })).name).toBe("oz");
    expect(defaultPrepUnit(recipe({ id: "cr", yieldQty: 30 })).name).toBe("each");
  });

  it("reads standard units and containers", () => {
    expect(parsePrepUnit("qt", "ml")).toEqual({ name: "qt", baseQty: QT });
    const c = parsePrepUnit("cambro = 6 qt", "ml");
    expect(c).toMatchObject({ name: "cambro", container: true });
    expect("baseQty" in c && c.baseQty).toBeCloseTo(6 * QT, 6);
    expect(parsePrepUnit("bottle 24 fl oz", "ml")).toMatchObject({ name: "bottle", baseQty: 24 * FLOZ });
    expect(parsePrepUnit("6 qt Cambro", "ml")).toMatchObject({ name: "cambro", baseQty: 6 * QT });
    expect(parsePrepUnit("tub = 2 lb", "ml")).toHaveProperty("error");
    expect(parsePrepUnit("cambro", "ml")).toHaveProperty("error");
    expect(parsePrepUnit("lb", "ml")).toHaveProperty("error");
    expect(parsePrepUnit("", "ml")).toHaveProperty("error");
  });

  it("writes units back", () => {
    expect(prepUnitLabel({ name: "cambro", baseQty: 6 * QT, container: true }, "ml")).toBe("cambro = 6 qt");
    expect(prepUnitLabel({ name: "qt", baseQty: QT }, "ml")).toBe("qt");
  });

  it("formats amounts and batches", () => {
    expect(formatPrepQty(4.2 * QT, { name: "qt", baseQty: QT })).toBe("4.2 qt");
    expect(formatPrepQty(12.4 * QT, { name: "qt", baseQty: QT })).toBe("12 qt");
    expect(formatPrepQty(2 * 6 * QT, { name: "cambro", baseQty: 6 * QT, container: true })).toBe("2 cambros");
    expect(formatPrepQty(29.6, { name: "each", baseQty: 1 })).toBe("30 each");
    expect(formatBatches(2)).toBe("2 batches");
    expect(formatBatches(1)).toBe("1 batch");
    expect(formatBatches(0.5)).toBe("½ batch");
    expect(formatBatches(1.5)).toBe("1½ batches");
    expect(amountText(7 * QT, 3.5 * QT, { name: "qt", baseQty: QT })).toBe("2 batches · 7 qt");
    expect(amountText(2.25 * QT, 3.5 * QT, { name: "qt", baseQty: QT })).toBe("2¼ qt");
    expect(formatPrepQty(2.3 * QT, { name: "qt", baseQty: QT })).toBe("2.3 qt");
    expect(formatPrepQty(0.5 * 6 * QT, { name: "cambro", baseQty: 6 * QT, container: true })).toBe("½ cambro");
  });

  it("rounds up to batches, half batches or a quarter unit", () => {
    const u = { name: "qt", baseQty: QT };
    expect(prepStep("batch", 3.5 * QT, u)).toBeCloseTo(3.5 * QT);
    expect(prepStep("half", 3.5 * QT, u)).toBeCloseTo(1.75 * QT);
    expect(prepStep("exact", 3.5 * QT, u)).toBeCloseTo(QT / 4);
    expect(prepStep("exact", 30, { name: "each", baseQty: 1 })).toBe(1);
    expect(roundUpTo(4.2, 3.5)).toBeCloseTo(7);
    expect(roundUpTo(7.0000001, 3.5)).toBeCloseTo(7);
    expect(roundUpTo(0, 3.5)).toBe(0);
  });
});

describe("prep usage", () => {
  it("finds prep use per serving through plated sub-recipes, and prep inside prep", () => {
    const u = prepUsage(ctx, prepIds);
    // Burger: 1 fl oz aioli + a side of fries, which is itself prep (stops there).
    expect(u.perServing.get("burger")?.get("aioli")).toBeCloseTo(FLOZ);
    expect(u.perServing.get("burger")?.get("fries")).toBe(1);
    expect(u.perServing.get("wings")?.get("buffalo")).toBeCloseTo(4 * FLOZ);
    expect(u.perBatch.get("aioli")?.get("rg")).toBeCloseTo(toBase(8, "oz", "g"));
    expect(u.perBatch.get("fries")?.get("aioli")).toBeCloseTo(FLOZ);
  });

  it("orders parents before the prep inside them", () => {
    const u = prepUsage(ctx, prepIds);
    const order = prepOrder(["rg", "aioli", "buffalo", "fries"], u.perBatch);
    expect(order.indexOf("fries")).toBeLessThan(order.indexOf("aioli"));
    expect(order.indexOf("aioli")).toBeLessThan(order.indexOf("rg"));
  });
});

describe("cover window and on hand", () => {
  it("covers N service days, skipping closed days", () => {
    const days = [day("2026-11-16", 50), day("2026-11-17", 0), day("2026-11-18", 40), day("2026-11-19", 40)];
    expect(coverWindow(days, 1)).toEqual(["2026-11-16"]);
    expect(coverWindow(days, 2)).toEqual(["2026-11-16", "2026-11-17", "2026-11-18"]);
  });

  it("labels the window", () => {
    expect(windowLabel(["2026-11-15"], "2026-11-15")).toBe("Today");
    expect(windowLabel(["2026-11-15", "2026-11-16"], "2026-11-15")).toBe("Today + tomorrow");
    expect(windowLabel(["2026-11-16", "2026-11-17", "2026-11-18"], "2026-11-15")).toBe("Tomorrow–Wed");
  });

  it("estimates on hand from the last count", () => {
    expect(estimatePrepOnHand({ countBase: 2000, madeSince: 3000, usedSince: 1500, wastedSince: 500 })).toEqual({ qty: 3000, known: true });
    expect(estimatePrepOnHand({ countBase: 100, madeSince: 0, usedSince: 500, wastedSince: 0 })).toEqual({ qty: 0, known: true });
    expect(estimatePrepOnHand({ countBase: null, madeSince: 0, usedSince: 0, wastedSince: 0 }).known).toBe(false);
  });

  it("knows how much of a day's service is still to come", () => {
    expect(serviceShareAfter(9, [16, 20])).toBe(1);
    expect(serviceShareAfter(18, [16, 20])).toBeCloseTo(0.5);
    expect(serviceShareAfter(22, [16, 20])).toBe(0);
    expect(serviceShareAfter(23, [17, 1])).toBeCloseTo(2 / 8);
    expect(serviceShareAfter(9, null)).toBe(1);
  });

  it("works out when stock runs out", () => {
    expect(runsOut(10, [4, 4, 4])).toBeCloseTo(2.5);
    expect(runsOut(2, [4, 4])).toBeCloseTo(0.5);
    expect(runsOut(20, [4, 4])).toBeNull();
  });
});

describe("planPrep", () => {
  const usage = prepUsage(ctx, prepIds);
  const base = { prepDate: "2026-11-16", today: "2026-11-16", usage, names };
  const days = [day("2026-11-16", 140, 20), day("2026-11-17", 60, 10), day("2026-11-18", 0), day("2026-11-19", 80, 10)];

  it("makes forecast use minus on hand, rounded to batches, with the reason", () => {
    const lines = planPrep({ ...base, days, coverDays: 1, items: [item(aioli, QT), item(buffalo, 0)] });
    const a = lines.find((l) => l.recipeId === "aioli")!;
    // 140 burgers × 1 fl oz = 140 fl oz = 4.375 qt; on hand 1 qt → need 3.375 qt → 1 batch (3.5 qt).
    expect(a.status).toBe("make");
    expect(a.usageBase).toBeCloseTo(140 * FLOZ);
    expect(a.needBase).toBeCloseTo(140 * FLOZ - QT);
    expect(a.batches).toBe(1);
    expect(a.amountText).toBe("1 batch · 3½ qt");
    expect(a.why).toBe("Today ~140 Classic Burger → 4.4 qt · on hand 1 qt");
    // Buffalo: nothing on hand, so it runs out first and leads the list.
    expect(lines[0].recipeId).toBe("buffalo");
    expect(lines[0].runsOutIn).toBe(0);
  });

  it("covers more service days when asked", () => {
    const [a] = planPrep({ ...base, days, coverDays: 2, items: [item(aioli, QT)] });
    // 200 burgers = 200 fl oz = 6.25 qt − 1 → 5.25 → 2 batches.
    expect(a.batches).toBe(2);
    expect(a.why.startsWith("Today + tomorrow ~200 Classic Burger")).toBe(true);
  });

  it("caps at what keeps within shelf life", () => {
    const [a] = planPrep({ ...base, days, coverDays: 4, items: [item(aioli, 0, { shelfLifeDays: 1, rounding: "exact" })] });
    expect(a.targetBase).toBeCloseTo(140 * FLOZ);
    expect(a.makeBase).toBeCloseTo(4.5 * QT); // 4.375 → quarter quart
    expect(a.amountText).toBe("4½ qt");
    expect(a.why).toContain("keeps 1 day: 4.4 qt");
  });

  it("warns when a whole batch is more than lasts", () => {
    const small = [day("2026-11-16", 20)];
    const [a] = planPrep({ ...base, days: small, coverDays: 1, items: [item(aioli, 0, { shelfLifeDays: 1 })] });
    expect(a.batches).toBe(1);
    expect(a.overShelf).toBe(true);
    const [h] = planPrep({ ...base, days: small, coverDays: 1, items: [item(aioli, 0, { shelfLifeDays: 1, rounding: "half" })] });
    expect(h.batches).toBe(0.5);
    expect(h.overShelf).toBe(true);
  });

  it("uses par as a minimum, and par alone without a forecast", () => {
    const [a] = planPrep({ ...base, days: [day("2026-11-16", 0)], coverDays: 1, items: [item(aioli, 0.5 * QT, { parBase: 2 * QT, rounding: "half" })] });
    expect(a.status).toBe("make");
    expect(a.batches).toBe(0.5);
    expect(a.why).toBe("par 2 qt · on hand ½ qt");
    const [e] = planPrep({ ...base, days: [day("2026-11-16", 0)], coverDays: 1, items: [item(aioli, 3 * QT, { parBase: 2 * QT })] });
    expect(e.status).toBe("enough");
    const [n] = planPrep({ ...base, days: [day("2026-11-16", 0)], coverDays: 1, items: [item(aioli, 0)] });
    expect(n.status).toBe("nodata");
  });

  it("plans prep inside prep from the parent's batches", () => {
    const lines = planPrep({ ...base, days, coverDays: 1, items: [item(aioli, 0), item(roastedGarlic, 0, { rounding: "exact" })] });
    const a = lines.find((l) => l.recipeId === "aioli")!;
    const g = lines.find((l) => l.recipeId === "rg")!;
    expect(a.batches).toBe(2); // 4.375 qt → 2 batches
    expect(g.usageBase).toBeCloseTo(2 * toBase(8, "oz", "g"));
    expect(g.why).toContain("for 2 batches Garlic Aioli");
    expect(g.amountText).toBe("1 lb");
  });

  it("says when nothing has been counted", () => {
    const [a] = planPrep({ ...base, days, coverDays: 1, items: [item(aioli, 0, {}, false)] });
    expect(a.why.endsWith("not counted yet")).toBe(true);
  });

  it("groups by station in priority order", () => {
    const lines = planPrep({ ...base, days, coverDays: 1, items: [item(aioli, QT, { station: "Sauces" }), item(buffalo, 0, { station: "Fry" }), item(roastedGarlic, 0, { station: "Sauces" })] });
    const groups = groupByStation(lines);
    expect(groups[0].station).toBe(lines[0].station);
    expect(groups.flatMap((g) => g.lines).length).toBe(3);
  });
});

describe("scaled recipe", () => {
  it("rewrites amounts the way a cook reads them", () => {
    expect(friendlyAmount(96, "fl oz")).toEqual({ qty: 3, unit: "qt" });
    expect(friendlyAmount(3, "tbsp")).toEqual({ qty: 3, unit: "tbsp" });
    expect(friendlyAmount(40, "oz")).toEqual({ qty: 2.5, unit: "lb" });
    expect(friendlyAmount(6, "oz")).toEqual({ qty: 6, unit: "oz" });
    expect(friendlyAmount(1500, "g")).toEqual({ qty: 1.5, unit: "kg" });
    expect(friendlyAmount(2.5, "clove")).toEqual({ qty: 2.5, unit: "clove" });
  });

  it("scales lines to the amount being made", () => {
    const s = scaleRecipe(aioli, 7 * QT);
    expect(s.factor).toBeCloseTo(2);
    expect(s.lines[0]).toEqual({ index: 0, qty: 1, unit: "lb" });
    expect(s.lines[1]).toEqual({ index: 1, qty: 1.5, unit: "gal" });
  });
});
