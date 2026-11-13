import { describe, expect, it } from "vitest";
import { detectEntity, fillsFromHistory, flattenRecord, guessMapping, headersOf, parseAction, parseStatus, parseWhen, planKegImport, type SourceSpec } from "../kegImport";

const kegsCsv = {
  name: "Keg Inventory.csv",
  records: [
    { "Keg ID": "SB-0001", "Keg Size": "1/2 BBL", Status: "At Customer", Product: "Golden Lager", "Batch #": "GL-24-07", "Fill Date": "07/02/2024", Customer: "Catskill Tap House", Owner: "Company", Color: "Blue", "Purchase Price": "120" },
    { "Keg ID": "SB-0002", "Keg Size": "1/6", Status: "Full - Cooler", Product: "New York Nectar", Location: "Walk-in", Position: "Back left" },
    { "Keg ID": "sb 0002", "Keg Size": "", Status: "", Notes: "dented" },
    { "Keg ID": "SB-0003", "Keg Size": "Half", Status: "Lost" },
  ],
};
const customers = {
  name: "Customers.xlsx · Customers",
  records: [{ "Customer Name": "Catskill Tap House", "Customer Type": "Bar", "Contact Name": "Jo", Email: "jo@example.com", Phone: "518-555-0101", Address: "1 Main St", "Credit Terms": "Net 30" }],
};
const history = {
  name: "Keg Activity Report.csv",
  records: [
    { "Keg ID": "SB-0001", Date: "06/30/2024 3:15 PM", Activity: "Filled", Product: "Golden Lager", "Batch #": "GL-24-07", User: "Ben" },
    { "Keg ID": "SB-0001", Date: "07/02/2024 10:00 AM", Activity: "Delivered", Customer: "Catskill Tap House", "Order #": "1042", User: "Ben" },
    { "Keg ID": "SB-0009", Date: "2024-07-05", Activity: "Tapped", Product: "Oatmeal Stout" },
    { "Keg ID": "SB-0009", Date: "2024-07-09", Activity: "Kicked" },
    { "Keg ID": "SB-0009", Date: "not a date", Activity: "Cleaned" },
    { "Keg ID": "SB-0009", Date: "2024-07-10", Activity: "Spear replaced" },
  ],
};

const specs = (srcs: { name: string; records: Record<string, unknown>[] }[]): SourceSpec[] => srcs.map((source) => ({ source, ...detectEntity(source) }));

describe("reading raw records", () => {
  it("flattens nested API JSON", () => {
    expect(flattenRecord({ id: 7, customer: { name: "Bar", address: { city: "Catskill" } }, tags: ["a"] })).toEqual({ id: 7, "customer.name": "Bar", "customer.address.city": "Catskill", tags: '["a"]' });
    expect(headersOf([{ a: 1 }, { b: { c: 2 } }])).toEqual(["a", "b.c"]);
  });
  it("detects what each file is", () => {
    expect(detectEntity(kegsCsv).entity).toBe("kegs");
    expect(detectEntity(customers).entity).toBe("accounts");
    expect(detectEntity(history).entity).toBe("events");
    expect(detectEntity({ name: "Sheet1", records: [{ foo: 1 }] }).entity).toBe("skip");
  });
  it("guesses columns", () => {
    const m = guessMapping("kegs", headersOf(kegsCsv.records));
    expect(m).toMatchObject({ code: "Keg ID", size: "Keg Size", status: "Status", beer: "Product", batch: "Batch #", filledOn: "Fill Date", account: "Customer", owner: "Owner", area: "Location", spot: "Position" });
    const a = guessMapping("accounts", headersOf(customers.records));
    expect(a).toMatchObject({ name: "Customer Name", kind: "Customer Type", contact: "Contact Name", email: "Email", phone: "Phone", address: "Address" });
    const nested = guessMapping("accounts", headersOf([{ id: 1, name: "Bar", contact: { email: "x@y.z", phone: "1" } }]));
    expect(nested).toMatchObject({ name: "name", email: "contact.email", phone: "contact.phone" });
  });
  it("reads dates, statuses and actions", () => {
    expect(parseWhen("06/30/2024 3:15 PM")).toBe("2024-06-30T15:15:00.000Z");
    expect(parseWhen("2024-07-05")).toBe("2024-07-05T12:00:00.000Z");
    expect(parseWhen(45474)).toBe("2024-07-01T00:00:00.000Z");
    expect(parseWhen(1720000000000)).toBe(new Date(1720000000000).toISOString());
    expect(parseWhen("nope")).toBeNull();
    expect(parseStatus("Full - Cooler").status).toBe("COLD");
    expect(parseStatus("At Customer").status).toBe("OUT");
    expect(parseStatus("Dirty").status).toBe("CLEANING");
    expect(parseStatus("Lost").inactive).toBe(true);
    expect(parseAction("Delivered")).toBe("OUT");
    expect(parseAction("Picked up")).toBe("RETURNED");
    expect(parseAction("Washed")).toBe("CLEANED");
    expect(parseAction("Spear replaced")).toBe("NOTE");
  });
});

describe("planning an import", () => {
  const plan = planKegImport(specs([kegsCsv, customers, history]));

  it("dedupes kegs on their code and keeps earlier values", () => {
    const codes = plan.kegs.map((k) => k.legacyCode);
    expect(codes).toEqual(["SB-0001", "SB-0002", "SB-0003", "SB-0009"]);
    const k2 = plan.kegs.find((k) => k.legacyCode === "SB-0002")!;
    expect(k2).toMatchObject({ sizeId: "sixtel", status: "COLD", beer: "New York Nectar", area: "Walk-in", spot: "Back left", notes: "dented" });
  });
  it("maps keg fields and keeps unmapped columns", () => {
    const k1 = plan.kegs.find((k) => k.legacyCode === "SB-0001")!;
    expect(k1).toMatchObject({ sizeId: "half", status: "OUT", owner: "OURS", beer: "Golden Lager", batch: "GL-24-07", filledOn: "2024-07-02", account: "Catskill Tap House" });
    expect(k1.extra).toEqual({ "Keg Inventory.csv": { Color: "Blue", "Purchase Price": "120" } });
    expect(plan.kegs.find((k) => k.legacyCode === "SB-0003")!.active).toBe(false);
  });
  it("brings accounts with contact details", () => {
    expect(plan.accounts).toHaveLength(1);
    expect(plan.accounts[0]).toMatchObject({ name: "Catskill Tap House", kind: "bar", contact: "Jo", email: "jo@example.com", phone: "518-555-0101", address: "1 Main St" });
    expect(plan.accounts[0].extra).toEqual({ "Customers.xlsx · Customers": { "Credit Terms": "Net 30" } });
  });
  it("turns the activity report into history, with stable keys", () => {
    expect(plan.events.map((e) => e.action)).toEqual(["FILLED", "OUT", "TAPPED", "KICKED", "NOTE"]);
    expect(plan.events[1]).toMatchObject({ account: "Catskill Tap House", user: "Ben", note: "Order 1042", toStatus: "OUT" });
    expect(plan.events[4].note).toBe("Spear replaced");
    const again = planKegImport(specs([kegsCsv, customers, history]));
    expect(again.events.map((e) => e.importKey)).toEqual(plan.events.map((e) => e.importKey));
  });
  it("adds kegs only seen in the history, with their latest state", () => {
    const k9 = plan.kegs.find((k) => k.legacyCode === "SB-0009")!;
    expect(k9).toMatchObject({ fromHistory: true, status: "KICKED" });
    expect(plan.beers.map((b) => b.name).sort()).toEqual(["Golden Lager", "New York Nectar", "Oatmeal Stout"]);
    expect(plan.spots).toEqual([{ area: "Walk-in", name: "Back left" }]);
  });
  it("lists what's worth a look", () => {
    const text = plan.issues.map((i) => i.message).join("\n");
    expect(text).toMatch(/couldn't read the date "not a date"/);
    expect(text).toMatch(/only in the history/);
    expect(plan.sources.map((s) => [s.entity, s.rows, s.used])).toEqual([["kegs", 4, 4], ["accounts", 1, 1], ["events", 6, 5]]);
  });
  it("asks for a missing required column", () => {
    const p = planKegImport([{ source: kegsCsv, entity: "kegs", mapping: {} }]);
    expect(p.kegs).toHaveLength(0);
    expect(p.issues[0].message).toMatch(/pick the Keg code/);
  });
  it("reads deliveries and returns reports", () => {
    const p = planKegImport([
      { source: { name: "Deliveries", records: [{ keg: "A1", customer: "Bar X", delivered: "2024-05-01" }] }, entity: "deliveries", mapping: { code: "keg", account: "customer", date: "delivered" } },
      { source: { name: "Returns", records: [{ keg: "A1", returned: "2024-05-20" }] }, entity: "returns", mapping: { code: "keg", date: "returned" } },
    ]);
    expect(p.events.map((e) => [e.action, e.toStatus])).toEqual([["OUT", "OUT"], ["RETURNED", "CLEANING"]]);
    expect(p.kegs[0].status).toBe("CLEANING");
  });
});

describe("fills from history", () => {
  it("pairs taps with kicks", () => {
    const f = fillsFromHistory([
      { at: "2024-07-01T10:00:00Z", action: "FILLED", beer: "Lager", batch: "L1" },
      { at: "2024-07-05T18:00:00Z", action: "TAPPED", beer: null, batch: null },
      { at: "2024-07-09T21:00:00Z", action: "KICKED", beer: null, batch: null },
      { at: "2024-07-10T10:00:00Z", action: "CLEANED", beer: null, batch: null },
      { at: "2024-07-12T10:00:00Z", action: "FILLED", beer: "Stout", batch: null },
      { at: "2024-07-15T10:00:00Z", action: "OUT", beer: null, batch: null },
    ]);
    expect(f).toEqual([
      { beer: "Lager", batch: "L1", filledOn: "2024-07-01T10:00:00Z", tappedAt: "2024-07-05T18:00:00Z", kickedAt: "2024-07-09T21:00:00Z" },
      { beer: "Stout", batch: null, filledOn: "2024-07-12T10:00:00Z", tappedAt: null, kickedAt: null },
    ]);
  });
});
