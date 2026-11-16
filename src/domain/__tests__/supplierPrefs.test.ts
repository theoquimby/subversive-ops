import { describe, expect, it } from "vitest";
import { DEFAULT_SUPPLIER_PREFS, parseAllSupplierPrefs, parseSupplierPrefs, patchSupplierPrefs, prefsFromColumns, prefsToColumns } from "../supplierPrefs";

describe("parseSupplierPrefs", () => {
  it("falls back to calm defaults", () => {
    expect(parseSupplierPrefs(undefined)).toEqual(DEFAULT_SUPPLIER_PREFS);
    expect(parseSupplierPrefs("nonsense")).toEqual(DEFAULT_SUPPLIER_PREFS);
    expect(DEFAULT_SUPPLIER_PREFS).toMatchObject({ alert: null, first: "4h", lastCallMins: 60, recipients: "managers", people: [], sendBy: "email", phone: null });
  });
  it("keeps valid values and drops bad ones", () => {
    const p = parseSupplierPrefs({ alert: "off", first: "morning", lastCallMins: 120, recipients: "people", people: ["u1", 7, "u2"], sendBy: "text", phone: " (518) 555-0142 ", portal: "Driscoll's app", portalUrl: "javascript:alert(1)" });
    expect(p).toMatchObject({ alert: "off", first: "morning", lastCallMins: 120, recipients: "people", people: ["u1", "u2"], sendBy: "text", phone: "(518) 555-0142", portal: "Driscoll's app", portalUrl: null });
    expect(parseSupplierPrefs({ alert: "loud", first: "1y", lastCallMins: -5, sendBy: "fax" })).toMatchObject({ alert: null, first: "4h", lastCallMins: 60, sendBy: "email" });
    expect(parseSupplierPrefs({ lastCallMins: null }).lastCallMins).toBeNull();
    expect(parseSupplierPrefs({ portalUrl: "https://order.example.com/" }).portalUrl).toBe("https://order.example.com/");
  });
  it("parses the whole map keyed by supplier id", () => {
    const all = parseAllSupplierPrefs(JSON.stringify({ a: { sendBy: "phone" }, b: "x" }));
    expect(all.a.sendBy).toBe("phone");
    expect(all.b).toEqual(DEFAULT_SUPPLIER_PREFS);
    expect(parseAllSupplierPrefs("{")).toEqual({});
  });
  it("patches without losing other fields", () => {
    const p = patchSupplierPrefs({ ...DEFAULT_SUPPLIER_PREFS, sendBy: "text", phone: "5185550142" }, { first: "24h" });
    expect(p).toMatchObject({ sendBy: "text", phone: "5185550142", first: "24h" });
  });
});

describe("the supplier's own columns", () => {
  const defaults = { orderAlert: null, orderFirst: "4h", orderLastCallMins: 60, orderRecipients: "managers", orderPeople: [], sendBy: "email", orderPhone: null, portalName: null, portalUrl: null };
  it("reads the column defaults as the default preferences", () => {
    expect(prefsFromColumns(defaults)).toEqual(DEFAULT_SUPPLIER_PREFS);
  });
  it("round-trips through the columns", () => {
    const p = parseSupplierPrefs({ alert: "low", first: "24h", lastCallMins: null, recipients: "people", people: ["u1"], sendBy: "portal", phone: "518 555 0142", portal: "Cut+Dry", portalUrl: "https://cutanddry.com/" });
    const cols = prefsToColumns(p);
    expect(cols).toEqual({ orderAlert: "low", orderFirst: "24h", orderLastCallMins: null, orderRecipients: "people", orderPeople: ["u1"], sendBy: "portal", orderPhone: "518 555 0142", portalName: "Cut+Dry", portalUrl: "https://cutanddry.com/" });
    expect(prefsFromColumns(cols)).toEqual(p);
  });
  it("ignores a bad value in a column the same way the JSON did", () => {
    expect(prefsFromColumns({ ...defaults, sendBy: "fax", orderFirst: "1y", portalUrl: "ftp://x" })).toMatchObject({ sendBy: "email", first: "4h", portalUrl: null });
  });
});
