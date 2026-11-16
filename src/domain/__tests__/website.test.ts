import { describe, expect, it } from "vitest";
import { cleanUrl, parseAddress, parseLinks, parsePhone } from "../websiteContact";
import { feedEvent, feedWindow, isClosed, slugFor, type EventIn, type WebEventIn } from "../websiteEvents";
import { dayRangeLabel, hhmmLabel, liveNotice, parseExactHours, parseNotice, parseTypedTime, webDay, webSeasons, webWeek } from "../websiteHours";
import { allowedOrigins, checkInquiry, HONEYPOT_FIELD, inquiryNotes, inquiryType, withinLimit } from "../websiteInquiry";
import { beerItem, buildMenu, guessFamily, guessPlace, halfAndFull, isDraftBeerCategory, kebab, placementOf, pourSizes, recipeItem, type MenuRecipeIn, type TapBeerIn } from "../websiteMenu";
import { eventsFeedSchema, menuSchema, siteFeedSchema, type SiteFeed } from "../websiteSchema";

// ---- Hours ------------------------------------------------------------------------------

describe("website hours", () => {
  it("uses Ops whole hours when there are no exact times", () => {
    expect(webDay([16, 20], undefined).hours).toEqual({ open: "16:00", close: "20:00", kitchenClose: "20:00" });
    expect(webDay(undefined, { open: "16:30" }).hours).toBeNull();
  });

  it("layers exact open, close and kitchen close inside the Ops hours", () => {
    const r = webDay([16, 21], { open: "16:30", close: "20:30", kitchenClose: "20:15" });
    expect(r.hours).toEqual({ open: "16:30", close: "20:30", kitchenClose: "20:15" });
    expect(r.stale).toEqual([]);
  });

  it("ignores exact times that no longer fit and reports them", () => {
    const r = webDay([12, 19], { open: "16:30", close: "20:30", kitchenClose: "21:00" });
    expect(r.hours).toEqual({ open: "12:00", close: "19:00", kitchenClose: "19:00" });
    expect(r.stale).toEqual(["open", "close", "kitchenClose"]);
  });

  it("midnight close becomes the last minute the website can say", () => {
    expect(webDay([17, 24], undefined).hours).toEqual({ open: "17:00", close: "23:59", kitchenClose: "23:59" });
  });

  it("builds the whole week Monday-keyed, matching the website's site.json", () => {
    const week = { 0: [12, 19], 1: [16, 20], 3: [16, 20], 4: [16, 20], 5: [16, 21], 6: [12, 21] } as Record<number, [number, number]>;
    const exact = { mon: { open: "16:30" }, wed: { open: "16:30" }, thu: { open: "16:30" }, fri: { open: "16:30", close: "20:30", kitchenClose: "20:15" }, sat: { close: "20:30", kitchenClose: "20:15" }, sun: { close: "18:30", kitchenClose: "18:15" } };
    const { hours, stale } = webWeek(week, exact);
    expect(hours).toEqual({
      mon: { open: "16:30", close: "20:00", kitchenClose: "20:00" },
      tue: null,
      wed: { open: "16:30", close: "20:00", kitchenClose: "20:00" },
      thu: { open: "16:30", close: "20:00", kitchenClose: "20:00" },
      fri: { open: "16:30", close: "20:30", kitchenClose: "20:15" },
      sat: { open: "12:00", close: "20:30", kitchenClose: "20:15" },
      sun: { open: "12:00", close: "18:30", kitchenClose: "18:15" },
    });
    expect(stale).toEqual({});
    expect(webSeasons([{ id: "s", label: "Summer", from: "06-01", to: "09-07", hours: { 2: [16, 20] } }], {})[0]).toEqual({ label: "Summer", from: "06-01", to: "09-07", hours: { mon: null, tue: { open: "16:00", close: "20:00", kitchenClose: "20:00" }, wed: null, thu: null, fri: null, sat: null, sun: null } });
  });

  it("reads typed times and labels them", () => {
    expect(parseTypedTime("4:30pm")).toBe("16:30");
    expect(parseTypedTime("4.30 PM")).toBe("16:30");
    expect(parseTypedTime("20:15")).toBe("20:15");
    expect(parseTypedTime("12am")).toBe("00:00");
    expect(parseTypedTime("noon")).toBe("12:00");
    expect(parseTypedTime("")).toBeNull();
    expect(parseTypedTime("25:00")).toBeUndefined();
    expect(parseTypedTime("13pm")).toBeUndefined();
    expect(hhmmLabel("16:30")).toBe("4:30pm");
    expect(hhmmLabel("12:00")).toBe("12pm");
    expect(dayRangeLabel({ open: "16:30", close: "20:00" })).toBe("4:30–8pm");
    expect(dayRangeLabel({ open: "11:00", close: "14:00" })).toBe("11am–2pm");
    expect(dayRangeLabel(null)).toBe("Closed");
  });

  it("parses stored exact hours defensively", () => {
    expect(parseExactHours({ mon: { open: "16:30", close: "nope" }, xyz: { open: "10:00" }, tue: "x" })).toEqual({ mon: { open: "16:30" } });
    expect(parseExactHours(null)).toEqual({});
  });
});

describe("website notice", () => {
  it("shows until the end of its last day, then goes", () => {
    const n = { text: " Closed for a private event Saturday ", until: "2026-11-21" };
    expect(liveNotice(n, "2026-11-21")).toEqual({ text: "Closed for a private event Saturday", until: "2026-11-21" });
    expect(liveNotice(n, "2026-11-22")).toBeNull();
    expect(liveNotice({ text: "Hi", until: null }, "2030-01-01")).toEqual({ text: "Hi", until: null });
    expect(liveNotice({ text: "  ", until: null }, "2026-01-01")).toBeNull();
  });
  it("parses stored notices", () => {
    expect(parseNotice({ text: "x", until: "bad" })).toEqual({ text: "x", until: null });
    expect(parseNotice({ text: "" })).toBeNull();
    expect(parseNotice("x")).toBeNull();
  });
});

// ---- Contact --------------------------------------------------------------------------

describe("website contact", () => {
  it("splits an address line", () => {
    expect(parseAddress("96 West Bridge Street, Catskill, NY 12414")).toEqual({ street: "96 West Bridge Street", city: "Catskill", state: "NY", zip: "12414", geo: null });
    expect(parseAddress("96 West Bridge Street, Catskill NY 12414")).toEqual({ street: "96 West Bridge Street", city: "Catskill", state: "NY", zip: "12414", geo: null });
    expect(parseAddress("96 West Bridge St, Unit 2, Catskill, NY, 12414")).toEqual({ street: "96 West Bridge St, Unit 2", city: "Catskill", state: "NY", zip: "12414", geo: null });
    expect(parseAddress("96 West Bridge Street, Catskill, NY")).toMatchObject({ city: "Catskill", state: "NY", zip: "" });
    expect(parseAddress("somewhere")).toBeNull();
    expect(parseAddress("")).toBeNull();
  });
  it("formats US phones the way the website wants", () => {
    expect(parsePhone("518-303-1270")).toEqual({ display: "(518) 303-1270", tel: "+15183031270" });
    expect(parsePhone("+1 (518) 303 1270")).toEqual({ display: "(518) 303-1270", tel: "+15183031270" });
    expect(parsePhone("303-1270")).toBeNull();
  });
  it("cleans links", () => {
    expect(cleanUrl("instagram.com/subversivebeer")).toBe("https://instagram.com/subversivebeer");
    expect(cleanUrl("javascript:alert(1)")).toBeNull();
    expect(cleanUrl("nope")).toBeNull();
    expect(parseLinks({ instagram: "https://www.instagram.com/subversivebeer/", facebook: "", junk: "https://x.com" })).toEqual({ instagram: "https://www.instagram.com/subversivebeer/" });
  });
});

describe("site feed schema", () => {
  const ok: SiteFeed = {
    timezone: "America/New_York",
    hours: { mon: { open: "16:30", close: "20:00", kitchenClose: "20:00" }, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null },
    notice: { text: "Closed Thanksgiving", until: "2026-11-26" },
    season: null,
    seasons: [],
    name: "Subversive",
    address: { street: "96 West Bridge Street", city: "Catskill", state: "NY", zip: "12414", geo: null },
    phone: { display: "(518) 303-1270", tel: "+15183031270", note: "" },
    email: "hello@example.com",
    links: { instagram: "https://www.instagram.com/subversivebeer/" },
    updatedAt: "2026-11-15T12:00:00.000Z",
    announcements: [{ id: "thanksgiving-2026", text: "Closed Thanksgiving Day.", tone: "closure", from: "2026-11-20", until: "2026-11-26" }],
  };
  it("accepts a good feed and refuses extra or wrong fields", () => {
    expect(siteFeedSchema.safeParse(ok).success).toBe(true);
    expect(siteFeedSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
    expect(siteFeedSchema.safeParse({ ...ok, hours: { ...ok.hours, mon: { open: "4:30", close: "20:00", kitchenClose: "20:00" } } }).success).toBe(false);
    expect(siteFeedSchema.safeParse({ ...ok, phone: { display: "x", tel: "5183031270", note: "" } }).success).toBe(false);
    expect(siteFeedSchema.safeParse({ ...ok, links: { tiktok: "https://t.co" } }).success).toBe(false);
  });
});

// ---- Menu -----------------------------------------------------------------------------

const web = (over: Partial<NonNullable<MenuRecipeIn["web"]>> = {}): NonNullable<MenuRecipeIn["web"]> => ({ onWebsite: true, name: null, description: null, tags: [], badge: null, modifiers: null, place: null, section: null, sort: 0, showPrice: true, availableFrom: null, availableUntil: null, ...over });
const recipe = (over: Partial<MenuRecipeIn> = {}): MenuRecipeIn => ({ id: "r1", name: "Classic", category: "Burgers", kind: "MENU", menuPrice: 18, active: true, web: web(), ...over });
const tap = (over: Partial<TapBeerIn> = {}): TapBeerIn => ({ beerId: "b1", name: "New York Nectar", style: "New York IPA", abv: 7, description: "Our flagship IPA.", color: "#e8b23a", house: true, diet: null, pours: [{ label: "10 oz", oz: 10, price: 5 }, { label: "16 oz", oz: 16, price: 8 }], web: null, ...over });

describe("website menu pieces", () => {
  it("guesses food or drinks, and the beer family the website filters on", () => {
    expect(guessPlace("Burgers")).toBe("food");
    expect(guessPlace("Cocktails")).toBe("drinks");
    expect(guessPlace("Non-alcoholic")).toBe("drinks");
    expect(isDraftBeerCategory("Beer")).toBe(true);
    expect(isDraftBeerCategory("Beer cocktails")).toBe(false);
    expect(guessFamily("Europils")).toBe("Light");
    expect(guessFamily("New York IPA")).toBe("Hoppy");
    expect(guessFamily("German-style lager")).toBe("Light");
    expect(guessFamily("Classic farmhouse ale")).toBe("Farmhouse");
    expect(guessFamily("Black currant sour ale")).toBe("Sour");
    expect(guessFamily("Festbier")).toBe("Malty");
    expect(guessFamily("Mystery")).toBeNull();
  });

  it("kebabs like the website", () => {
    expect(kebab("Subversive Overtime: Knicks vs. Blazers")).toBe("subversive-overtime-knicks-vs-blazers");
    expect(kebab("Lil’ Burger — Märzen")).toBe("lil-burger-marzen");
  });

  it("turns a recipe into an item with web name, tags and window", () => {
    expect(recipeItem(recipe({ web: web({ name: "The Classic", description: "Lettuce, cheese.", tags: ["vegetarian", "nope", "vegetarian"], badge: "New", availableFrom: "2026-10-01", availableUntil: "2026-10-31" }) }))).toEqual({
      name: "The Classic",
      description: "Lettuce, cheese.",
      price: 18,
      tags: ["vegetarian"],
      badge: "New",
      seasonal: true,
      availableFrom: "2026-10-01",
      availableUntil: "2026-10-31",
    });
    expect(recipeItem(recipe({ web: web({ showPrice: false }) }))).toEqual({ name: "Classic" });
    expect(placementOf(recipe({ web: web({ section: "Smash burgers" }) }))).toEqual({ place: "food", section: "Smash burgers", sectionId: "smash-burgers" });
  });

  it("makes a full beer item from style, ABV and two pours", () => {
    const b = beerItem(tap({ web: { onWebsite: true, family: null, badge: "Flagship", hazy: true } }));
    expect(b.full).toBe(true);
    expect(b.item).toEqual({ name: "New York Nectar", description: "Our flagship IPA.", badge: "Flagship", style: "New York IPA", abv: 7, prices: { half: 5, full: 8 }, color: "#e8b23a", hazy: true });
    expect(halfAndFull([{ label: "16 oz", oz: 16, price: 8 }])).toBeNull();
    // A taster isn't a half pour; the 10 oz is.
    expect(halfAndFull([{ label: "4 oz", oz: 4, price: 2.5 }, { label: "10 oz", oz: 10, price: 5 }, { label: "16 oz", oz: 16, price: 8 }])).toEqual({ half: { label: "10 oz", oz: 10, price: 5 }, full: { label: "16 oz", oz: 16, price: 8 } });
    expect(halfAndFull([{ label: "4 oz", oz: 4, price: 2.5 }, { label: "16 oz", oz: 16, price: 8 }])).toBeNull();
    expect(pourSizes([tap(), tap()])).toEqual({ half: "10 oz", full: "16 oz" });
    expect(pourSizes([])).toEqual({ half: "Half", full: "Full" });
  });

  it("falls back to a plain item when a beer is missing details", () => {
    const b = beerItem(tap({ style: null, pours: [{ label: "16 oz", oz: 16, price: 8 }] }));
    expect(b.full).toBe(false);
    expect(b.missing).toEqual(["style", "two pour sizes with prices"]);
    expect(b.item).toEqual({ name: "New York Nectar", description: "7% · Our flagship IPA.", price: 8 });
  });
});

describe("website menu", () => {
  const today = "2026-11-15";
  const build = (recipes: MenuRecipeIn[], taps: TapBeerIn[] = []) => buildMenu({ recipes, sections: [], taps, notices: ["If you have a food allergy, tell us."], today, updated: today });

  it("builds sections in the website's shape and passes the website's schema", () => {
    const { menu, warnings, counts } = build(
      [
        recipe({ id: "a", name: "Classic", category: "Burgers", web: web({ sort: 2 }) }),
        recipe({ id: "b", name: "Double", category: "Burgers", web: web({ sort: 1 }) }),
        recipe({ id: "c", name: "Fries", category: "Sides", menuPrice: 6 }),
        recipe({ id: "d", name: "Gin & Tonic", category: "Cocktails", menuPrice: 14 }),
        recipe({ id: "e", name: "Hidden", category: "Burgers", web: web({ onWebsite: false }) }),
        recipe({ id: "f", name: "Bacon", category: "Add-ons", kind: "MODIFIER", menuPrice: 3 }),
      ],
      [tap(), tap({ beerId: "b2", name: "Puff Puff Pils", style: "Europils", abv: 4.2, color: "#f2d675" }), tap({ beerId: "b3", name: "Guest Stout", style: "Stout", abv: 6, house: false, color: "#2a1a12" })],
    );
    expect(menuSchema.safeParse(menu).success).toBe(true);
    expect(menu.food.map((s) => [s.id, s.items.map((i) => i.name)])).toEqual([["burgers", ["Double", "Classic"]], ["sides", ["Fries"]], ["add-ons", ["Bacon"]]]);
    expect(menu.drinks.map((s) => s.id)).toEqual(["house-beer", "guest-beer", "other-beverages"]);
    expect(menu.drinks[0].groups.map((g) => g.title)).toEqual(["Light", "Hoppy"]);
    expect(menu.drinks[1].groups.map((g) => g.title)).toEqual(["Malty"]);
    expect(menu.drinks[2].groups).toEqual([{ title: "Cocktails", items: [{ name: "Gin & Tonic", price: 14 }] }]);
    expect(menu._meta).toEqual({ source: "Subversive Ops", verify: [], pourSizes: { half: "10 oz", full: "16 oz" }, updated: today });
    expect(counts).toEqual({ food: 4, drinks: 1, beers: 3 });
    expect(warnings).toEqual([]);
  });

  it("leaves off archived recipes, beer pours, expired items and beers turned off, with reasons", () => {
    const { menu, warnings } = build(
      [recipe({ id: "a", active: false }), recipe({ id: "b", name: "IPA · 16 oz", category: "Beer" }), recipe({ id: "c", web: web({ availableUntil: "2026-10-31" }) })],
      [tap({ web: { onWebsite: false, family: null, badge: null, hazy: false } }), tap({ beerId: "b9", name: "Odd", style: null })],
    );
    expect(menu.food).toEqual([]);
    expect(menu.drinks[0].groups[0].items).toEqual([{ name: "Odd", description: "7% · Our flagship IPA.", price: 8 }]);
    expect(warnings.map((w) => w.id)).toEqual(["a", "b", "b9"]);
    const odd = build([], [tap({ pours: [{ label: "10 oz", oz: 10, price: 9 }, { label: "16 oz", oz: 16, price: 8 }] })]);
    expect(odd.warnings[0].message).toBe("The 10 oz pour costs more than the 16 oz — check the prices on Kegs → Beers");
  });

  it("uses section details and sends nothing private", () => {
    const { menu } = buildMenu({
      recipes: [recipe({ id: "a", web: web({ section: "Smash burgers", modifiers: "Add bacon +3" }) })],
      sections: [{ id: "smash-burgers", title: "Subversive smash burgers", place: "food", intro: "Two patties.", note: null, modifiers: "Gluten-free bun +2", sort: 1, availableFrom: null, availableUntil: null }],
      taps: [],
      notices: [],
      today,
      updated: today,
    });
    expect(menu.food[0]).toEqual({ id: "smash-burgers", title: "Subversive smash burgers", intro: "Two patties.", modifiers: "Gluten-free bun +2", items: [{ name: "Classic", modifiers: "Add bacon +3", price: 18 }] });
    expect(JSON.stringify(menu)).not.toMatch(/cost|supplier|recipeId|r1/i);
  });

  it("the mirrored schema accepts the website's own menu shape and rejects strays", () => {
    const fromWebsite = {
      _meta: { source: "x", verify: [], pourSizes: { half: "9 oz", full: "16 oz" }, updated: "2026-10-23" },
      drinks: [{ id: "house-beer", title: "House-brewed beer", note: "n", groups: [{ title: "Hoppy", items: [{ name: "New York Nectar", style: "New York IPA", abv: 7.0, description: "d", prices: { half: 5, full: 8 }, badge: "Flagship", color: "#E8A93A" }] }] }],
      food: [{ id: "weekly-features", title: "Weekly features", items: [{ name: "Wing Wednesday Special", description: "d", price: 16, availability: { days: ["wed"], label: "Wednesdays only", title: "Wing Wednesday" } }] }],
      notices: ["If you have a food allergy or intolerance, please notify us."],
    };
    expect(menuSchema.safeParse(fromWebsite).success).toBe(true);
    expect(menuSchema.safeParse({ ...fromWebsite, food: [{ ...fromWebsite.food[0], items: [{ name: "X", cost: 3 }] }] }).success).toBe(false);
    expect(menuSchema.safeParse({ ...fromWebsite, food: [{ ...fromWebsite.food[0], items: [{ name: "X", availableFrom: "2026-11-02", availableUntil: "2026-11-01" }] }] }).success).toBe(false);
  });
});

// ---- Events ---------------------------------------------------------------------------

const ev = (over: Partial<EventIn> = {}): EventIn => ({ id: "e1", date: "2026-11-21", title: "Subversive Overtime: Knicks vs. Blazers", kind: "GAME", startTime: "19:30", endTime: "22:00", notes: "Tipoff 7:30.", updatedAt: "2026-11-10T10:00:00.000Z", ...over });
const w = (over: Partial<WebEventIn> = {}): WebEventIn => ({ slug: "2026-11-21-subversive-overtime-knicks-vs-blazers", hidden: false, webKind: null, closed: null, imageUrl: null, imageAlt: null, ticketUrl: null, rsvpUrl: null, priceLabel: null, featured: false, kitchenCloseOverride: null, barCloseOverride: null, updatedAt: "2026-11-12T10:00:00.000Z", ...over });

describe("website events", () => {
  it("slugs are date + kebab title, unique", () => {
    expect(slugFor("2026-11-21", "Knicks vs. Blazers", new Set())).toBe("2026-11-21-knicks-vs-blazers");
    expect(slugFor("2026-11-21", "Knicks vs. Blazers", new Set(["2026-11-21-knicks-vs-blazers"]))).toBe("2026-11-21-knicks-vs-blazers-2");
    expect(slugFor("2026-11-21", "!!!", new Set())).toBe("2026-11-21-event");
  });

  it("closed: closures always, holidays when set, an override wins", () => {
    expect(isClosed("CLOSURE", null, { holidaysClosed: false })).toBe(true);
    expect(isClosed("HOLIDAY", null, { holidaysClosed: false })).toBe(false);
    expect(isClosed("HOLIDAY", null, { holidaysClosed: true })).toBe(true);
    expect(isClosed("HOLIDAY", false, { holidaysClosed: true })).toBe(false);
    expect(isClosed("GAME", true, { holidaysClosed: false })).toBe(true);
  });

  it("sends only the base fields when there are no web fields", () => {
    expect(feedEvent(ev(), null, { holidaysClosed: false })).toEqual({ id: "e1", date: "2026-11-21", title: "Subversive Overtime: Knicks vs. Blazers", kind: "GAME", closed: false, startTime: "19:30", endTime: "22:00", description: "Tipoff 7:30.", updatedAt: "2026-11-10T10:00:00.000Z" });
  });

  it("adds the web fields the website understands", () => {
    const e = feedEvent(ev({ kind: "OTHER", title: "Trivia" }), w({ webKind: "TRIVIA", imageUrl: "https://ops.example.com/api/public/images/abc", imageAlt: "Trivia night", ticketUrl: "https://tickets.example.com/x", priceLabel: "Free", featured: true, kitchenCloseOverride: "20:15", barCloseOverride: "22:30" }), { holidaysClosed: false });
    expect(e).toMatchObject({ kind: "TRIVIA", slug: "2026-11-21-subversive-overtime-knicks-vs-blazers", imageUrl: "https://ops.example.com/api/public/images/abc", imageAlt: "Trivia night", ticketUrl: "https://tickets.example.com/x", priceLabel: "Free", featured: true, kitchenCloseOverride: "20:15", barCloseOverride: "22:30", updatedAt: "2026-11-12T10:00:00.000Z" });
    expect(e).not.toHaveProperty("rsvpUrl");
    expect(eventsFeedSchema.safeParse({ timezone: "America/New_York", events: [e] }).success).toBe(true);
  });

  it("never sends private or hidden events, and drops bad links and times", () => {
    expect(feedEvent(ev({ kind: "PRIVATE" }), null, { holidaysClosed: false })).toBeNull();
    expect(feedEvent(ev(), w({ hidden: true }), { holidaysClosed: false })).toBeNull();
    const e = feedEvent(ev({ startTime: "7pm" }), w({ ticketUrl: "javascript:alert(1)", kitchenCloseOverride: "8:15" }), { holidaysClosed: false })!;
    expect(e.startTime).toBeNull();
    expect(e).not.toHaveProperty("ticketUrl");
    expect(e).not.toHaveProperty("kitchenCloseOverride");
    expect(feedEvent(ev({ kind: "WEIRD" }), null, { holidaysClosed: false })!.kind).toBe("OTHER");
  });

  it("sends a featured event's page, and keeps the event if the page wouldn't pass", () => {
    const page = { hero: "https://ops.example.com/api/public/images/abc", heroAlt: "The long tables in the yard", intro: "Two days in the yard.", schedule: [{ time: "12:00", what: "First pour" }] };
    const e = feedEvent(ev(), w({ featured: true, page }), { holidaysClosed: false })!;
    expect(e.page).toEqual(page);
    expect(eventsFeedSchema.safeParse({ timezone: "America/New_York", events: [e] }).success).toBe(true);
    const bad = feedEvent(ev(), w({ page: { hero: "http://localhost/x.jpg" } }), { holidaysClosed: false })!;
    expect(bad.id).toBe("e1");
    expect(bad).not.toHaveProperty("page");
  });

  it("reads days and pastDays", () => {
    expect(feedWindow(new URLSearchParams(""))).toEqual({ days: 120, pastDays: 0 });
    expect(feedWindow(new URLSearchParams("days=30&pastDays=60"))).toEqual({ days: 30, pastDays: 60 });
    expect(feedWindow(new URLSearchParams("days=9999&pastDays=-4"))).toEqual({ days: 365, pastDays: 0 });
    expect(feedWindow(new URLSearchParams("days=0"))).toEqual({ days: 1, pastDays: 0 });
  });

  it("the feed schema refuses unknown fields and bad slugs", () => {
    const e = feedEvent(ev(), null, { holidaysClosed: false })!;
    expect(eventsFeedSchema.safeParse({ timezone: "America/New_York", events: [{ ...e, impact: 1.3 }] }).success).toBe(false);
    expect(eventsFeedSchema.safeParse({ timezone: "America/New_York", events: [{ ...e, slug: "Bad Slug" }] }).success).toBe(false);
  });
});

// ---- Inquiry --------------------------------------------------------------------------

describe("website inquiry", () => {
  const today = "2026-11-15";
  it("accepts a good inquiry and cleans it", () => {
    const r = checkInquiry({ name: " Sam Lee ", email: "sam@example.com", date: "2026-12-12", guests: "40", type: "Birthday", message: "Back room?" }, today);
    expect(r).toEqual({ ok: true, value: { name: "Sam Lee", email: "sam@example.com", phone: null, date: "2026-12-12", guests: 40, typeText: "Birthday", type: "PARTY", message: "Back room?" } });
  });
  it("needs a name and a way to reply", () => {
    expect(checkInquiry({ email: "a@b.co" }, today)).toMatchObject({ ok: false, field: "name" });
    expect(checkInquiry({ name: "Sam" }, today)).toMatchObject({ ok: false, field: "email" });
    expect(checkInquiry({ name: "Sam", phone: "518 303 1270" }, today)).toMatchObject({ ok: true });
    expect(checkInquiry({ name: "Sam", email: "not-an-email" }, today)).toMatchObject({ ok: false, field: "email" });
  });
  it("checks date and guests", () => {
    expect(checkInquiry({ name: "Sam", email: "a@b.co", date: "2026-11-14" }, today)).toMatchObject({ ok: false, field: "date" });
    expect(checkInquiry({ name: "Sam", email: "a@b.co", date: "2026-02-30" }, today)).toMatchObject({ ok: false, field: "date" });
    expect(checkInquiry({ name: "Sam", email: "a@b.co", guests: "lots" }, today)).toMatchObject({ ok: false, field: "guests" });
    expect(checkInquiry({ name: "x".repeat(200), email: "a@b.co" }, today)).toMatchObject({ ok: false, field: "name" });
  });
  it("spots bots: the honeypot, or a message full of links", () => {
    expect(checkInquiry({ name: "Sam", email: "a@b.co", [HONEYPOT_FIELD]: "http://spam" }, today)).toEqual({ ok: "bot" });
    expect(checkInquiry({ name: "Sam", email: "a@b.co", message: "http://a http://b http://c" }, today)).toEqual({ ok: "bot" });
  });
  it("maps the kind of event", () => {
    expect(inquiryType("Rehearsal dinner")).toBe("REHEARSAL");
    expect(inquiryType("Wedding reception")).toBe("WEDDING");
    expect(inquiryType("Team offsite for work")).toBe("CORPORATE");
    expect(inquiryType("Full buyout")).toBe("BUYOUT");
    expect(inquiryType("")).toBe("PARTY");
    expect(inquiryType("Book club")).toBe("OTHER");
  });
  it("rate limits per sender", () => {
    expect(withinLimit(0, 0)).toBe(true);
    expect(withinLimit(3, 3)).toBe(false);
    expect(withinLimit(1, 8)).toBe(false);
  });
  it("notes and origins", () => {
    expect(inquiryNotes({ name: "S", email: null, phone: "1", date: null, guests: null, typeText: "Birthday", type: "PARTY", message: "Hi" })).toBe("From the website form · Birthday.\n\nHi");
    expect(allowedOrigins("https://drinksubversive.com")).toEqual(["https://drinksubversive.com", "https://www.drinksubversive.com"]);
    expect(allowedOrigins("http://localhost:3000")).toEqual(["http://localhost:3000", "http://www.localhost:3000"]);
    expect(allowedOrigins(null)).toEqual([]);
  });
});
