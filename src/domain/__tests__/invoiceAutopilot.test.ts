import { describe, expect, it } from "vitest";
import {
  baseUnitForPack,
  checkInvoiceMath,
  cleanItemName,
  codeFromDescription,
  expandReceiptText,
  knownStore,
  looksLikeReceipt,
  packFromDescription,
  planPriceRecords,
  printedShorts,
  receiveFromInvoice,
  shouldRecordPricesOnApprove,
  suggestIngredient,
  suggestLink,
} from "../invoiceAutopilot";
import { matchInvoice } from "../invoiceMatch";

describe("store receipts", () => {
  it("recognises the stores from how they print their name", () => {
    expect(knownStore("PRICE CHOPPER #172 CATSKILL")).toBe("Price Chopper");
    expect(knownStore("Market 32 by Price Chopper")).toBe("Price Chopper");
    expect(knownStore("RESTAURANT DEPOT #45")).toBe("Restaurant Depot");
    expect(knownStore("hannaford supermarket")).toBe("Hannaford");
    expect(knownStore("COSTCO WHOLESALE")).toBe("Costco");
    expect(knownStore("Driscoll Foods Inc")).toBeNull();
    expect(knownStore(null)).toBeNull();
  });

  it("treats a known store or a reader's 'receipt' as a receipt", () => {
    expect(looksLikeReceipt({ documentType: "invoice", supplierName: "HANNAFORD" })).toBe(true);
    expect(looksLikeReceipt({ documentType: "receipt", supplierName: "Corner Deli" })).toBe(true);
    expect(looksLikeReceipt({ documentType: "invoice", supplierName: "Sysco Albany" })).toBe(false);
  });

  it("expands receipt shorthand into readable names", () => {
    expect(expandReceiptText("ORG BNNS 2.31LB").text).toBe("Organic Bananas 2.31 lb");
    expect(expandReceiptText("CHKN BRST BNLS SKNLS").text).toBe("Chicken Breast Boneless Skinless");
    expect(expandReceiptText("HVY CRM 1QT").text).toBe("Heavy Cream 1 qt");
    expect(expandReceiptText("MUSHRM CRMNI 8OZ").text).toBe("Mushroom Cremini 8 oz");
  });

  it("splits off a leading item code and drops trailing tax flags", () => {
    expect(expandReceiptText("4011 BANANAS F")).toEqual({ sku: null, text: "4011 Bananas" });
    expect(expandReceiptText("07203600023 KS EVOO 2L T")).toEqual({ sku: "07203600023", text: "Kirkland Signature Extra Virgin Olive Oil 2 l" });
  });

  it("keeps words it doesn't know, in title case", () => {
    expect(expandReceiptText("SRIRACHA HUY FONG").text).toBe("Sriracha Huy Fong");
  });
});

describe("pack sizes", () => {
  it("finds the pack printed in a description", () => {
    expect(packFromDescription("CHKN BRST BNLS 4/10 LB")).toBe("4/10 LB");
    expect(packFromDescription("Carrots Loose 25LB")).toBe("25LB");
    expect(packFromDescription("Olive oil 4/3 L")).toBe("4/3 L");
    expect(packFromDescription("Romaine hearts")).toBeNull();
  });

  it("guesses the base unit from the pack", () => {
    expect(baseUnitForPack("4/10 LB")).toBe("g");
    expect(baseUnitForPack("6/1 GAL")).toBe("ml");
    expect(baseUnitForPack("1/200CT")).toBe("each");
    expect(baseUnitForPack(null, "lb")).toBe("g");
    expect(baseUnitForPack(null, "case")).toBeNull();
  });

  it("makes readable names and stable codes", () => {
    expect(cleanItemName("CHKN BRST BNLS SKNLS 4/10 LB")).toBe("Chicken Breast Boneless Skinless");
    expect(codeFromDescription("ORG BNNS")).toBe("ORGANIC-BANANAS");
  });
});

describe("checkInvoiceMath", () => {
  it("passes when lines, subtotal and total agree", () => {
    const r = checkInvoiceMath({ lines: [{ description: "A", qty: 2, unitPrice: 10, lineTotal: 20 }, { description: "B", qty: 1, unitPrice: 5.5 }], subtotal: 25.5, total: 25.5 });
    expect(r.issues).toEqual([]);
    expect(r.linesTotal).toBe(25.5);
  });

  it("flags a line whose extension doesn't match qty × price", () => {
    const r = checkInvoiceMath({ lines: [{ description: "Carrots", qty: 1, unitPrice: 12.36, lineTotal: 13.26 }], total: 13.26 });
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ kind: "line", lineIndex: 0, diff: 0.9 });
    expect(r.issues[0].message).toContain("Carrots");
  });

  it("adds header tax when there's no tax line, and flags a missing line against the total", () => {
    expect(checkInvoiceMath({ lines: [{ description: "A", qty: 1, unitPrice: 100 }], tax: 8, total: 108 }).issues).toEqual([]);
    const r = checkInvoiceMath({ lines: [{ description: "A", qty: 1, unitPrice: 100 }], total: 140 });
    expect(r.issues[0]).toMatchObject({ kind: "total", diff: 40 });
    expect(r.issues[0].message).toMatch(/missing/);
  });

  it("doesn't double-count tax already read as a line", () => {
    const r = checkInvoiceMath({ lines: [{ description: "A", qty: 1, unitPrice: 100 }, { description: "Sales tax", qty: 1, unitPrice: 8, kind: "tax" }], subtotal: 100, tax: 8, total: 108 });
    expect(r.issues).toEqual([]);
  });

  it("accepts a subtotal that excludes fees and deposits", () => {
    const r = checkInvoiceMath({ lines: [{ description: "Milk", qty: 2, unitPrice: 4 }, { description: "Btl dep", qty: 4, unitPrice: 0.05, kind: "deposit" }], subtotal: 8, total: 8.2 });
    expect(r.issues).toEqual([]);
  });

  it("lists lines that print fewer shipped than ordered", () => {
    const lines = [{ qty: 1, orderedQty: 2 }, { qty: 3, orderedQty: 3 }, { qty: 2 }];
    expect(printedShorts(lines)).toEqual([{ line: lines[0], short: 1 }]);
  });
});

describe("line linking", () => {
  const catalog = [
    { id: "p-panko", sku: "152016", description: "Bread Crumb Panko" },
    { id: "p-butter", sku: "013602", description: "Butter Solid Aa Unsalted" },
    { id: "p-dill", sku: "PC-FRESH-DILL", description: "Fresh dill" },
  ];
  const ingredients = [
    { id: "i-chicken", name: "Chicken breast", baseUnit: "g" as const },
    { id: "i-oil", name: "Oil", baseUnit: "ml" as const },
    { id: "i-olive", name: "Olive oil", baseUnit: "ml" as const },
    { id: "i-mush", name: "Mushrooms, cremini", baseUnit: "g" as const },
  ];

  it("links by item code first, then by description", () => {
    expect(suggestLink({ sku: "0152016", description: "PANKO" }, catalog, ingredients)).toEqual({ kind: "linked", productId: "p-panko", by: "sku" });
    expect(suggestLink({ description: "FRESH DILL" }, catalog, ingredients)).toMatchObject({ kind: "linked", productId: "p-dill", by: "description" });
  });

  it("leaves fees, deposits and tax alone", () => {
    expect(suggestLink({ description: "FUEL SURCHARGE", kind: "fee" }, catalog, ingredients)).toEqual({ kind: "skip" });
  });

  it("offers a weaker description match as a one-tap suggestion", () => {
    const s = suggestLink({ sku: "777", description: "BUTTER UNSALTED SOLID PRINTS 36/1 LB" }, catalog, ingredients);
    expect(s.kind === "linked" || s.kind === "product").toBe(true);
  });

  it("doesn't suggest a product whose name has a word the line contradicts", () => {
    const withThighs = [...catalog, { id: "p-thighs", sku: "090853", description: "Chkn Thighs Boneless Skinless" }];
    expect(suggestLink({ sku: "999001", description: "CHKN BRST BNLS SKNLS 4/10 LB" }, withThighs, ingredients).kind).toBe("create");
  });

  it("proposes a new product with a suggested ingredient and pack size", () => {
    const s = suggestLink({ sku: "999001", description: "CHKN BRST BNLS SKNLS 4/10 LB" }, catalog, ingredients);
    expect(s.kind).toBe("create");
    if (s.kind !== "create") return;
    expect(s.plan).toMatchObject({ sku: "999001", packText: "4/10 LB", purchaseUnit: "case", ingredient: { id: "i-chicken", name: "Chicken breast" } });
    expect(s.plan.packQtyBase).toBeCloseTo(40 * 453.592, 0);
  });

  it("names the new ingredient when nothing fits, and codes receipt items by name", () => {
    const used = new Set<string>();
    const s = suggestLink({ description: "Organic Bananas 2.31 lb" }, catalog, ingredients, { receipt: true, usedSkus: used });
    expect(s.kind).toBe("create");
    if (s.kind !== "create") return;
    expect(s.plan.ingredient).toBeNull();
    expect(s.plan.newIngredient).toEqual({ name: "Organic Bananas", baseUnit: "g" });
    expect(s.plan.purchaseUnit).toBe("lb");
    expect(s.plan.packText).toBeNull();
    expect(s.plan.packQtyBase).toBeCloseTo(453.59, 1);
    expect(s.plan.sku).toBe("ORGANIC-BANANAS");
    // A second line with the same code gets a distinct one.
    const again = suggestLink({ description: "Organic Bananas 2.31 lb" }, catalog, ingredients, { receipt: true, usedSkus: used });
    expect(again.kind === "create" && again.plan.sku).toBe("ORGANIC-BANANAS-2");
  });

  it("prefers the most specific ingredient", () => {
    expect(suggestIngredient("OLIVE OIL EXTRA VIRGIN 4/3 L", ingredients)?.ingredient.id).toBe("i-olive");
    expect(suggestIngredient("MUSHRM CRMNI 8OZ", ingredients)?.ingredient.id).toBe("i-mush");
    expect(suggestIngredient("NAPKINS 1/500", ingredients)).toBeNull();
  });

  it("never matches fee lines to products in the three-way match", () => {
    const r = matchInvoice({
      lines: [{ sku: "152016", description: "Panko", qty: 1, unitPrice: 27.87 }, { description: "Fuel surcharge", qty: 1, unitPrice: 4.95, kind: "fee" }],
      catalog: [{ id: "p-panko", sku: "152016", description: "Bread Crumb Panko", currentPrice: 27.87 }],
      orderLines: null,
      invoiceTotal: 32.82,
    });
    expect(r.lines[1]).toMatchObject({ supplierProductId: null, status: "OK" });
    expect(r.status).toBe("MATCHED");
  });
});

describe("prices on approval", () => {
  it("records the last billed price per linked item where it changed", () => {
    const current: Record<string, number | null> = { a: 10, b: 5, c: null };
    const r = planPriceRecords(
      [
        { supplierProductId: "a", unitPrice: 10.5, qty: 1 },
        { supplierProductId: "a", unitPrice: 11, qty: 1 },
        { supplierProductId: "b", unitPrice: 5.001, qty: 2 },
        { supplierProductId: "c", unitPrice: 3, qty: 1 },
        { supplierProductId: null, unitPrice: 9, qty: 1 },
      ],
      (id) => current[id],
    );
    expect(r).toEqual([
      { supplierProductId: "a", from: 10, to: 11 },
      { supplierProductId: "c", from: null, to: 3 },
    ]);
  });

  it("ignores credits, returns, fees and free lines", () => {
    const r = planPriceRecords(
      [
        { supplierProductId: "a", unitPrice: 0, qty: 1 },
        { supplierProductId: "a", unitPrice: 12, qty: -1 },
        { supplierProductId: "b", unitPrice: 4, qty: 1, kind: "deposit" },
      ],
      () => 10,
    );
    expect(r).toEqual([]);
  });

  it("is on unless turned off", () => {
    expect(shouldRecordPricesOnApprove(undefined)).toBe(true);
    expect(shouldRecordPricesOnApprove("true")).toBe(true);
    expect(shouldRecordPricesOnApprove("false")).toBe(false);
  });
});

describe("receiveFromInvoice", () => {
  const order = [
    { id: "o1", supplierProductId: "a", qty: 4, receivedQty: null },
    { id: "o2", supplierProductId: "b", qty: 2, receivedQty: null },
    { id: "o3", supplierProductId: "b", qty: 1, receivedQty: null },
    { id: "o4", supplierProductId: "c", qty: 1, receivedQty: null },
  ];

  it("copies shipped quantities and flags shorts and extras", () => {
    const r = receiveFromInvoice(order, [
      { supplierProductId: "a", qty: 3 },
      { supplierProductId: "b", qty: 2 },
      { supplierProductId: "b", qty: 2 },
      { supplierProductId: null, qty: 1, kind: "fee" },
      { supplierProductId: "z", qty: 2 },
    ]);
    expect(r.updates).toEqual([
      { orderLineId: "o1", receivedQty: 3 },
      { orderLineId: "o2", receivedQty: 2 },
      { orderLineId: "o3", receivedQty: 2 },
    ]);
    expect(r.shorts).toEqual([{ supplierProductId: "a", ordered: 4, shipped: 3 }]);
    expect(r.overs).toEqual([{ supplierProductId: "b", ordered: 3, shipped: 4 }]);
    expect(r.notOnInvoice).toEqual(["o4"]);
    expect(r.notOnOrder).toEqual([{ supplierProductId: "z", shipped: 2 }]);
  });

  it("spreads a short shipment over a product's lines in order", () => {
    const r = receiveFromInvoice(order.slice(1, 3), [{ supplierProductId: "b", qty: 1 }]);
    expect(r.updates).toEqual([
      { orderLineId: "o2", receivedQty: 1 },
      { orderLineId: "o3", receivedQty: 0 },
    ]);
    expect(r.shorts).toHaveLength(1);
  });
});
