/**
 * Sample reads for INVOICE_READER_STUB (local dev and browser tests only — never
 * used in production). Shaped exactly like the Claude extraction.
 */

export const STUB_INVOICE = {
  documentType: "invoice",
  supplierName: "DRISCOLL FOODS INC",
  invoiceNumber: "D-448210",
  invoiceDate: "2026-11-12",
  dueDate: "2026-12-12",
  subtotal: 285.96,
  tax: null,
  total: 285.96,
  paymentMethod: null,
  lines: [
    { kind: "item", sku: "152016", description: "BREAD CRUMB PANKO", packText: "1/25 LB", unit: "CS", qtyOrdered: null, qty: 2, unitPrice: 29.1, lineTotal: 58.2 },
    { kind: "item", sku: "013602", description: "BUTTER SOLID AA UNSALTED", packText: "36/1 LB", unit: "LB", qtyOrdered: null, qty: 36, unitPrice: 2.22, lineTotal: 79.92 },
    { kind: "item", sku: "230529", description: "CHEESE PEPPER JACK SLICED", packText: "6/1.5 LB", unit: "CS", qtyOrdered: 2, qty: 1, unitPrice: 31.23, lineTotal: 31.23 },
    { kind: "item", sku: "999001", description: "CHKN BRST BNLS SKNLS 4/10 LB", packText: "4/10 LB", unit: "CS", qtyOrdered: null, qty: 1, unitPrice: 98.4, lineTotal: 98.4 },
    { kind: "item", sku: "752432", description: "CARROTS LOOSE 25LB", packText: "1/25 LB", unit: "CS", qtyOrdered: null, qty: 1, unitPrice: 12.36, lineTotal: 13.26 },
    { kind: "fee", sku: null, description: "FUEL SURCHARGE", packText: null, unit: null, qtyOrdered: null, qty: 1, unitPrice: 4.95, lineTotal: 4.95 },
  ],
};

export const STUB_RECEIPT = {
  documentType: "receipt",
  supplierName: "PRICE CHOPPER #172 CATSKILL",
  invoiceNumber: null,
  invoiceDate: "2026-11-12",
  dueDate: null,
  subtotal: 24.95,
  tax: 0,
  total: 24.95,
  paymentMethod: "Visa 4821",
  lines: [
    { kind: "item", sku: null, description: "FRESH DILL", packText: null, unit: null, qtyOrdered: null, qty: 2, unitPrice: 2.49, lineTotal: 4.98 },
    { kind: "item", sku: null, description: "ORG BNNS 2.31LB", packText: null, unit: "LB", qtyOrdered: null, qty: 2.31, unitPrice: 0.79, lineTotal: 1.82 },
    { kind: "item", sku: null, description: "MUSHRM CRMNI 8OZ", packText: "8 OZ", unit: null, qtyOrdered: null, qty: 3, unitPrice: 2.99, lineTotal: 8.97 },
    { kind: "item", sku: null, description: "HVY CRM 1QT", packText: "1 QT", unit: null, qtyOrdered: null, qty: 2, unitPrice: 4.49, lineTotal: 8.98 },
    { kind: "deposit", sku: null, description: "BTL DEP", packText: null, unit: null, qtyOrdered: null, qty: 4, unitPrice: 0.05, lineTotal: 0.2 },
  ],
};
