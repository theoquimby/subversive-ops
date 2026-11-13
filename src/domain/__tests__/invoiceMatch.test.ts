import { describe, expect, it } from "vitest";
import {
  creditItems,
  creditRequestText,
  descriptionSimilarity,
  findDuplicate,
  matchInvoice,
  matchProduct,
  normInvoiceNumber,
  parsePastedLines,
  pickOrder,
  suggestSupplier,
  type CatalogProduct,
} from "../invoiceMatch";

const catalog: CatalogProduct[] = [
  { id: "fries", sku: "50215", description: "Fries 3/8 skin-on 6/5 lb", currentPrice: 42 },
  { id: "chicken", sku: "40112", description: "Chicken thigh bnls sknls 4/10 lb", currentPrice: 104 },
  { id: "butter", sku: "20010", description: "Butter unsalted 36/1 lb", currentPrice: 151 },
  { id: "lettuce", sku: "10450", description: "Lettuce green leaf 24 ct", currentPrice: 46 },
];

describe("matchProduct", () => {
  it("matches by sku, ignoring leading zeros and punctuation", () => {
    expect(matchProduct({ sku: "0050-215", description: "anything" }, catalog)).toEqual({ id: "fries", by: "sku" });
  });
  it("falls back to a fuzzy description match", () => {
    expect(matchProduct({ sku: "999", description: "FRIES SKIN ON 3/8 6/5LB" }, catalog)?.id).toBe("fries");
    expect(matchProduct({ description: "Chkn thigh boneless skinless" }, catalog)?.id).toBe("chicken");
  });
  it("keeps a hand-picked product", () => {
    expect(matchProduct({ description: "Mystery", supplierProductId: "butter" }, catalog)).toEqual({ id: "butter", by: "manual" });
  });
  it("leaves unrelated lines unmatched", () => {
    expect(matchProduct({ description: "Fuel surcharge" }, catalog)).toBeNull();
  });
  it("scores similarity between 0 and 1", () => {
    expect(descriptionSimilarity("butter unsalted", "Butter unsalted 36/1 lb")).toBe(1);
    expect(descriptionSimilarity("zzz qqq", "Butter unsalted")).toBe(0);
  });
});

describe("matchInvoice", () => {
  const order = [
    { supplierProductId: "fries", orderedQty: 2, receivedQty: 2, unitPrice: null },
    { supplierProductId: "chicken", orderedQty: 1, receivedQty: 1, unitPrice: 104 },
  ];

  it("matches a clean invoice", () => {
    const r = matchInvoice({
      lines: [
        { sku: "50215", description: "Fries", qty: 2, unitPrice: 42 },
        { sku: "40112", description: "Chicken", qty: 1, unitPrice: 104.01 },
      ],
      catalog,
      orderLines: order,
      invoiceTotal: 188.01,
    });
    expect(r.status).toBe("MATCHED");
    expect(r.lines.map((l) => l.status)).toEqual(["OK", "OK"]);
    expect(r.lines[0].expectedPrice).toBe(42); // no PO price → price on record
    expect(r.totalGap).toBe(0);
  });

  it("flags a price increase beyond tolerance", () => {
    const r = matchInvoice({ lines: [{ sku: "40112", description: "Chicken", qty: 1, unitPrice: 109 }, { sku: "50215", description: "Fries", qty: 2, unitPrice: 42 }], catalog, orderLines: order });
    expect(r.lines[0].status).toBe("PRICE");
    expect(r.lines[0].expectedPrice).toBe(104);
    expect(r.status).toBe("PRICE_ISSUE");
  });

  it("checks billed quantity against received, falling back to ordered", () => {
    const r = matchInvoice({
      lines: [{ sku: "50215", description: "Fries", qty: 3, unitPrice: 42 }, { sku: "40112", description: "Chicken", qty: 1, unitPrice: 104 }],
      catalog,
      orderLines: [{ ...order[0], receivedQty: null }, order[1]],
    });
    expect(r.lines[0].expectedQty).toBe(2);
    expect(r.lines[0].status).toBe("QTY");
    expect(r.status).toBe("QTY_ISSUE");
  });

  it("reports both issues", () => {
    const r = matchInvoice({ lines: [{ sku: "50215", description: "Fries", qty: 3, unitPrice: 45 }, { sku: "40112", description: "Chicken", qty: 1, unitPrice: 104 }], catalog, orderLines: order });
    expect(r.lines[0].status).toBe("PRICE_QTY");
    expect(r.status).toBe("PRICE_AND_QTY");
  });

  it("splits expected quantity across repeated lines for the same product", () => {
    const r = matchInvoice({
      lines: [
        { sku: "50215", description: "Fries", qty: 1, unitPrice: 42 },
        { sku: "50215", description: "Fries", qty: 2, unitPrice: 42 },
        { sku: "40112", description: "Chicken", qty: 1, unitPrice: 104 },
      ],
      catalog,
      orderLines: order,
    });
    expect(r.lines.map((l) => l.expectedQty)).toEqual([1, 1, 1]);
    expect(r.lines[1].status).toBe("QTY");
  });

  it("billed but never ordered is a quantity issue", () => {
    const r = matchInvoice({ lines: [{ sku: "20010", description: "Butter", qty: 1, unitPrice: 151 }], catalog, orderLines: [] });
    expect(r.lines[0].expectedQty).toBe(0);
    expect(r.lines[0].status).toBe("QTY");
  });

  it("without an order only prices are checked", () => {
    const r = matchInvoice({ lines: [{ sku: "20010", description: "Butter", qty: 5, unitPrice: 151 }], catalog, orderLines: null });
    expect(r.lines[0].expectedQty).toBeNull();
    expect(r.status).toBe("MATCHED");
  });

  it("respects tolerance", () => {
    const r = matchInvoice({ lines: [{ sku: "20010", description: "Butter", qty: 5, unitPrice: 151.5 }], catalog, orderLines: null, tolerance: { price: 1, qty: 0 } });
    expect(r.status).toBe("MATCHED");
  });

  it("needs review for unmatched lines, total gaps, empty invoices and duplicates", () => {
    expect(matchInvoice({ lines: [{ description: "Fuel surcharge", qty: 1, unitPrice: 5 }], catalog, orderLines: null }).status).toBe("NEEDS_REVIEW");
    expect(matchInvoice({ lines: [{ sku: "20010", description: "Butter", qty: 1, unitPrice: 151 }], catalog, orderLines: null, invoiceTotal: 160 }).status).toBe("NEEDS_REVIEW");
    expect(matchInvoice({ lines: [], catalog, orderLines: null }).status).toBe("NEEDS_REVIEW");
    expect(matchInvoice({ lines: [{ sku: "20010", description: "Butter", qty: 1, unitPrice: 151 }], catalog, orderLines: null, forceReview: true }).status).toBe("NEEDS_REVIEW");
  });

  it("lists received items missing from the bill", () => {
    const r = matchInvoice({ lines: [{ sku: "50215", description: "Fries", qty: 2, unitPrice: 42 }], catalog, orderLines: order });
    expect(r.notBilled.map((l) => l.supplierProductId)).toEqual(["chicken"]);
    expect(r.status).toBe("QTY_ISSUE");
  });
});

describe("duplicates, suppliers, orders", () => {
  it("normalises invoice numbers", () => {
    expect(normInvoiceNumber("INV-000123")).toBe("123");
    expect(normInvoiceNumber("inv 123")).toBe("123");
    expect(findDuplicate("123", [{ id: "a", invoiceNumber: "INV-0123" }])?.id).toBe("a");
    expect(findDuplicate("123", [{ id: "a", invoiceNumber: "INV-0123" }], "a")).toBeNull();
    expect(findDuplicate("", [{ id: "a", invoiceNumber: "" }])).toBeNull();
  });
  it("suggests a supplier from the name on the invoice", () => {
    const suppliers = [{ id: "hvf", name: "Hudson Valley Foodservice" }, { id: "cbc", name: "Catskill Bread Co." }];
    expect(suggestSupplier("HUDSON VALLEY FOODSERVICE INC", suppliers)?.id).toBe("hvf");
    expect(suggestSupplier("Catskill Bread Company", suppliers)?.id).toBe("cbc");
    expect(suggestSupplier("Sysco", suppliers)).toBeNull();
  });
  it("picks the newest sent/received order, preferring uninvoiced ones", () => {
    const orders = [
      { id: "old", supplierId: "s", status: "RECEIVED", deliveryDate: "2026-11-01", invoiced: false },
      { id: "new", supplierId: "s", status: "RECEIVED", deliveryDate: "2026-11-08", invoiced: true },
      { id: "draft", supplierId: "s", status: "DRAFT", deliveryDate: "2026-11-10", invoiced: false },
      { id: "other", supplierId: "x", status: "SENT", deliveryDate: "2026-11-09", invoiced: false },
    ];
    expect(pickOrder(orders, "s")?.id).toBe("old");
    expect(pickOrder(orders.map((o) => ({ ...o, invoiced: false })), "s")?.id).toBe("new");
    expect(pickOrder(orders.map((o) => ({ ...o, invoiced: false })), "s", "2026-11-05")?.id).toBe("old");
    expect(pickOrder(orders, "nobody")).toBeNull();
  });
});

describe("credit request", () => {
  it("lists short and overcharged lines with amounts", () => {
    const items = creditItems([
      { description: "Lettuce", sku: "10450", qty: 2, unitPrice: 46, expectedQty: 1, expectedPrice: 46 },
      { description: "Chicken", sku: "40112", qty: 2, unitPrice: 109, expectedQty: 2, expectedPrice: 104 },
      { description: "Fries", sku: "50215", qty: 2, unitPrice: 40, expectedQty: 2, expectedPrice: 42 },
    ]);
    expect(items).toEqual([
      { description: "Lettuce", sku: "10450", kind: "short", detail: "billed 2, received 1", amount: 46 },
      { description: "Chicken", sku: "40112", kind: "overcharge", detail: "charged $109.00, agreed $104.00 × 2", amount: 10 },
    ]);
    const { subject, body, total } = creditRequestText({ supplierName: "HVF", invoiceNumber: "77", invoiceDate: "2026-11-10", items, senderName: "Max", business: "Subversive" });
    expect(total).toBe(56);
    expect(subject).toContain("invoice 77");
    expect(body).toContain("Total credit requested: $56.00");
    expect(body).toContain("- Lettuce (#10450): short — billed 2, received 1: $46.00");
  });
  it("doesn't charge an overcharge on units never received", () => {
    const items = creditItems([{ description: "X", sku: null, qty: 3, unitPrice: 12, expectedQty: 1, expectedPrice: 10 }]);
    expect(items.map((i) => i.amount)).toEqual([24, 2]);
  });
});

describe("parsePastedLines", () => {
  it("reads sku/description/qty/price rows and skips headers", () => {
    const text = "Item #\tDescription\tQty\tPrice\n50215\tFries 6/5 lb\t2\t$42.00\n40112\tChicken thigh\t1\t104\n\tFuel surcharge\t1\t5.00\n";
    expect(parsePastedLines(text)).toEqual([
      { sku: "50215", description: "Fries 6/5 lb", qty: 2, unitPrice: 42 },
      { sku: "40112", description: "Chicken thigh", qty: 1, unitPrice: 104 },
      { sku: null, description: "Fuel surcharge", qty: 1, unitPrice: 5 },
    ]);
  });
  it("works without a sku column and derives price from the line total", () => {
    expect(parsePastedLines("Sourdough loaf\t4\t\t26.00")).toEqual([{ sku: null, description: "Sourdough loaf", qty: 4, unitPrice: 6.5 }]);
  });
});
