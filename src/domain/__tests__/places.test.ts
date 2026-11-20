import { describe, expect, it } from "vitest";
import { normalPostal, tallyProfiles, type PlacePayment, type PlaceProfile } from "../places";

describe("where payers live", () => {
  it("tidies a postal code and drops an empty one", () => {
    expect(normalPostal(" 12414-1234 ")).toBe("12414");
    expect(normalPostal("12414")).toBe("12414");
    expect(normalPostal("k1a 0b1")).toBe("K1A 0B1");
    expect(normalPostal("  ")).toBeNull();
    expect(normalPostal(null)).toBeNull();
    expect(normalPostal(undefined)).toBeNull();
  });

  it("counts profiles that hold a postal code, and the payments they place", () => {
    const payments: PlacePayment[] = [
      // One regular with an address on the profile, paying three times by tap.
      { customerId: "c1", postal: null },
      { customerId: "c1", postal: null },
      { customerId: "c1", postal: null },
      // A profile Square made by itself: nothing on it.
      { customerId: "c2", postal: null },
      // A profile Square didn't return, but the card was typed in.
      { customerId: "c3", postal: "07030" },
      // No profile, a typed-in card.
      { customerId: null, postal: "12414" },
      // Cash.
      { customerId: null, postal: null },
    ];
    const profiles = new Map<string, PlaceProfile>([
      ["c1", { postal: "12414", source: "DIRECTORY" }],
      ["c2", { postal: null, source: "INSTANT_PROFILE" }],
    ]);
    const t = tallyProfiles(payments, profiles);
    expect(t.payments).toBe(7);
    expect(t.customers).toBe(3);
    expect(t.found).toBe(2);
    expect(t.withPostal).toBe(1);
    expect(t.paymentsWithProfilePostal).toBe(3);
    // Three through the profile, one typed-in card with a profile, one without.
    expect(t.placed).toBe(5);
    expect(t.distinctPostal).toBe(2);
    // By people: the regular counts once however often they paid.
    expect(t.areas).toEqual([
      { area: "124", people: 2 },
      { area: "070", people: 1 },
    ]);
    expect(t.bySource).toEqual([
      { source: "DIRECTORY", customers: 1, withPostal: 1 },
      { source: "INSTANT_PROFILE", customers: 1, withPostal: 0 },
    ]);
  });

  it("prefers the profile's postal code to the card's, and copes with nothing at all", () => {
    const t = tallyProfiles([{ customerId: "c1", postal: "10001" }], new Map([["c1", { postal: "12414", source: null }]]));
    expect(t.areas).toEqual([{ area: "124", people: 1 }]);
    expect(t.bySource).toEqual([{ source: "OTHER", customers: 1, withPostal: 1 }]);
    const none = tallyProfiles([], new Map());
    expect(none).toMatchObject({ payments: 0, customers: 0, found: 0, withPostal: 0, placed: 0, distinctPostal: 0, areas: [], bySource: [] });
  });
});
