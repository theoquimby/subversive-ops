import { describe, expect, it } from "vitest";
import { cardsToPlace, guestPlaces, milesBetween, normalPostal, PLACES_MIN, placeFor, placesPoint, placesReady, tallyProfiles, type PlaceInfo, type PlacePayment, type PlaceProfile, type PlaceRow } from "../places";

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

describe("where payers live", () => {
  it("tidies a postal code and drops an empty one", () => {
    expect(normalPostal(" 12414-1234 ")).toBe("12414");
    expect(normalPostal("124141234")).toBe("12414");
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

describe("which postal code belongs to which card", () => {
  const today = "2026-11-20";

  it("asks only about cards not placed yet, or asked a while ago with nothing found", () => {
    const known = new Map([
      ["placed", { postal: "12414", source: "profile" as const, checkedOn: "2026-01-01" }],
      ["askedLately", { postal: null, source: "none" as const, checkedOn: "2026-11-01" }],
      ["askedLongAgo", { postal: null, source: "none" as const, checkedOn: "2026-06-01" }],
    ]);
    const want = cardsToPlace(
      [
        { cardKey: "placed", customerId: "c1", postal: null },
        { cardKey: "askedLately", customerId: "c2", postal: null },
        { cardKey: "askedLongAgo", customerId: "c3", postal: null },
        { cardKey: "new", customerId: "c4", postal: null },
        { cardKey: "new", customerId: "c4", postal: null },
        { cardKey: "new", customerId: "c5", postal: "07030" },
        // Cash: no card to remember a place for.
        { cardKey: null, customerId: "c6", postal: "10001" },
      ],
      known,
      today,
      daysBetween,
    );
    expect([...want.keys()].sort()).toEqual(["askedLongAgo", "new"]);
    expect(want.get("new")).toEqual({ customerIds: ["c4", "c5"], cardPostal: "07030" });
  });

  it("keeps the profile's postal code first, then the card's, else remembers that Square had none", () => {
    const profiles = new Map<string, PlaceProfile>([
      ["c1", { postal: null, source: "INSTANT_PROFILE" }],
      ["c2", { postal: "12534", source: "LOYALTY" }],
    ]);
    expect(placeFor({ customerIds: ["c1", "c2"], cardPostal: "07030" }, profiles)).toEqual({ postal: "12534", source: "profile" });
    expect(placeFor({ customerIds: ["c1"], cardPostal: "07030" }, profiles)).toEqual({ postal: "07030", source: "card" });
    expect(placeFor({ customerIds: ["c9"], cardPostal: null }, profiles)).toEqual({ postal: null, source: "none" });
  });
});

describe("the map of where cards come from", () => {
  const home = { lat: 42.2173, lon: -73.8646 };
  const gaz: Record<string, PlaceInfo> = {
    "12414": { lat: 42.2276, lon: -73.8985, city: "CATSKILL", state: "NY", country: "US" },
    "12413": { lat: 42.3075, lon: -74.0036, city: "Cairo", state: "NY", country: "US" },
    "12534": { lat: 42.2464, lon: -73.7556, city: "Hudson", state: "NY", country: "US" },
    "10001": { lat: 40.7484, lon: -73.9967, city: "New York", state: "NY", country: "US" },
    "10011": { lat: 40.7402, lon: -73.9996, city: "New York", state: "NY", country: "US" },
    "11211": { lat: 40.7093, lon: -73.9565, city: "Brooklyn", state: "NY", country: "US" },
    "98101": { lat: 47.6114, lon: -122.3305, city: "Seattle", state: "WA", country: "US" },
  };
  const lookup = (z: string) => gaz[z] ?? null;
  const rows: PlaceRow[] = [
    { postal: "12414", kind: "local", people: 60, sales: 9000 },
    { postal: "12414", kind: "visitor", people: 4, sales: 200 },
    { postal: "12413", kind: "local", people: 20, sales: 2500 },
    { postal: "12534", kind: "local", people: 10, sales: 1200 },
    { postal: "10001", kind: "visitor", people: 30, sales: 1500 },
    { postal: "10011", kind: "visitor", people: 10, sales: 500 },
    { postal: "11211", kind: "visitor", people: 25, sales: 1100 },
    { postal: "98101", kind: "visitor", people: 2, sales: 90 },
    { postal: "11211", kind: "occasional", people: 5, sales: 400 },
    // Not in the gazetteer: counted as placed, but not drawn.
    { postal: "SW1A 1AA", kind: "visitor", people: 3, sales: 150 },
  ];

  it("measures distance in miles", () => {
    expect(milesBetween(home, gaz["10001"])).toBeGreaterThan(95);
    expect(milesBetween(home, gaz["10001"])).toBeLessThan(105);
    expect(milesBetween(home, home)).toBe(0);
  });

  it("puts every postal code of a town in one bubble, and counts each kind by town and by distance", () => {
    const p = guestPlaces(rows, { guests: 1500, checked: 1200 }, lookup, home);
    expect(p.placed).toBe(169);
    expect(p.unknown).toBe(3);
    expect(p.towns.map((t) => t.key)).toEqual(["Catskill, NY", "New York, NY", "Brooklyn, NY", "Cairo, NY", "Hudson, NY", "Seattle, WA"]);
    const ny = p.towns.find((t) => t.key === "New York, NY")!;
    expect(ny.people).toEqual({ local: 0, visitor: 40, occasional: 0, all: 40 });
    // Placed at the middle of its postal codes, weighted by people.
    expect(ny.lat).toBeCloseTo((40.7484 * 30 + 40.7402 * 10) / 40, 4);
    expect(p.towns[0].name).toBe("Catskill");
    const near = p.bands.find((b) => b.key === "near")!;
    expect(near.people.local).toBe(90);
    expect(near.people.visitor).toBe(4);
    expect(p.bands.find((b) => b.key === "trip")!.people.visitor).toBe(65);
    expect(p.bands.find((b) => b.key === "far")!.people.visitor).toBe(2);
    expect(p.far).toEqual([{ state: "WA", people: 2 }]);
    expect(p.median.local).toBeLessThan(15);
    expect(p.median.visitor).toBeGreaterThan(90);
    // Too few occasional cards for a middle distance.
    expect(p.median.occasional).toBeNull();
  });

  it("tells the story once enough cards are placed, and not before", () => {
    const p = guestPlaces(rows, { guests: 1500, checked: 1200 }, lookup, home);
    expect(p.placed).toBeGreaterThanOrEqual(PLACES_MIN);
    expect(placesReady(p)).toBe(true);
    const point = placesPoint(p)!;
    expect(point.title).toBe("Half your visitors come from about 100 miles away or more");
    expect(point.detail).toContain("Visitors come most from New York, Brooklyn and Catskill");
    expect(point.detail).toContain("mostly from Catskill, Cairo and Hudson");
    expect(point.detail).toContain("Based on the 169 cards (11% of last year's)");
    expect(point.action).toContain("Google listing");
    const few = guestPlaces(rows.slice(0, 2), { guests: 1500, checked: 100 }, lookup, home);
    expect(placesReady(few)).toBe(false);
    expect(placesPoint(few)).toBeNull();
    expect(placesReady(null)).toBe(false);
  });
});
