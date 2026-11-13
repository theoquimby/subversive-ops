import { describe, expect, it } from "vitest";
import { estimateRating, fallbackReply, operationalHint, keywordSentiment, keywordThemes, parsePastedReviews, parseRating, parseReviewDate, reviewFingerprint, rollingRating, themeCounts } from "../reviews";

const TODAY = "2026-11-13";

describe("keywordThemes", () => {
  it("finds operational themes", () => {
    expect(keywordThemes("Great hazy IPA but the burger took forever, waited 45 minutes")).toEqual(["service-speed", "food", "beer"]);
    expect(keywordThemes("Brought the kids and our dog, staff were so friendly")).toEqual(["staff", "family", "dogs"]);
    expect(keywordThemes("Bathrooms were dirty and it was packed, no tables")).toEqual(["cleanliness", "wait"]);
    expect(keywordThemes("A bit pricey for what you get")).toEqual(["price"]);
  });
  it("returns nothing for text with no signal", () => {
    expect(keywordThemes("Okay.")).toEqual([]);
  });
});

describe("keywordSentiment", () => {
  it("is led by the rating", () => {
    expect(keywordSentiment(5, "Love it")).toBe("positive");
    expect(keywordSentiment(1, "Love it")).toBe("negative");
  });
  it("marks a complaining 4-star as mixed", () => {
    expect(keywordSentiment(4, "Beer was great but the food was slow")).toBe("mixed");
  });
  it("reads 3-star wording", () => {
    expect(keywordSentiment(3, "Food was bland and slow")).toBe("negative");
    expect(keywordSentiment(3, "Great beer, nice spot")).toBe("positive");
  });
});

describe("estimateRating", () => {
  it("guesses from wording", () => {
    expect(estimateRating("Amazing beer, friendly staff, highly recommend")).toBe(5);
    expect(estimateRating("Terrible, slow, rude, never again")).toBe(1);
  });
});

describe("fallbackReply", () => {
  it("thanks happy guests by first name and mentions what they liked", () => {
    const r = fallbackReply({ author: "Dana K.", rating: 5, themes: ["beer", "dogs"], sentiment: "positive" });
    expect(r).toMatch(/^Hi Dana,/);
    expect(r).toMatch(/beer/);
    expect(r).toMatch(/pup/);
  });
  it("apologises and names a fix for slow service", () => {
    const r = fallbackReply({ author: null, rating: 2, themes: ["service-speed"], sentiment: "negative" });
    expect(r).toMatch(/^Hi there,/);
    expect(r).toMatch(/Sorry/);
    expect(r).toMatch(/busiest shifts/);
  });
});

describe("parseRating", () => {
  it("reads common formats", () => {
    expect(parseRating("★★★★☆")).toBe(4);
    expect(parseRating("5 stars")).toBe(5);
    expect(parseRating("Rated 4.0 out of 5")).toBe(4);
    expect(parseRating("3/5")).toBe(3);
    expect(parseRating("2 star rating")).toBe(2);
    expect(parseRating("Two stars")).toBe(2);
    expect(parseRating("We had 6 beers")).toBeNull();
  });
});

describe("parseReviewDate", () => {
  it("reads absolute dates", () => {
    expect(parseReviewDate("Oct 3, 2026", TODAY)).toBe("2026-10-03");
    expect(parseReviewDate("October 3rd 2026", TODAY)).toBe("2026-10-03");
    expect(parseReviewDate("10/3/2026", TODAY)).toBe("2026-10-03");
    expect(parseReviewDate("2026-09-14", TODAY)).toBe("2026-09-14");
    expect(parseReviewDate("Date of visit: September 2026", TODAY)).toBe("2026-09-01");
    expect(parseReviewDate("Written 12 March 2026", TODAY)).toBe("2026-03-12");
  });
  it("reads relative dates", () => {
    expect(parseReviewDate("2 weeks ago", TODAY)).toBe("2026-10-30");
    expect(parseReviewDate("a month ago", TODAY)).toBe("2026-10-14");
    expect(parseReviewDate("yesterday", TODAY)).toBe("2026-11-12");
  });
  it("puts a yearless future date in last year", () => {
    expect(parseReviewDate("Dec 20", TODAY)).toBe("2025-12-20");
  });
});

describe("parsePastedReviews", () => {
  it("parses a Google-style paste with several reviews", () => {
    const text = `Dana Kim
Local Guide · 42 reviews · 120 photos
★★★★★ 2 weeks ago
Best hazy IPA in the Catskills. Our dog got a treat too!
Like
Share

Mark R.
3 reviews
★★☆☆☆ a month ago
Waited 50 minutes for a burger on a Saturday. Beer was good though.
Response from the owner 3 weeks ago
Sorry Mark, we were slammed.`;
    const r = parsePastedReviews(text, TODAY);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ author: "Dana Kim", rating: 5, date: "2026-10-30", source: "GOOGLE" });
    expect(r[0].text).toBe("Best hazy IPA in the Catskills. Our dog got a treat too!");
    expect(r[1]).toMatchObject({ author: "Mark R.", rating: 2, date: "2026-10-14" });
    expect(r[1].text).not.toMatch(/slammed/);
  });

  it("keeps multi-paragraph reviews together", () => {
    const text = `Jess P.
4 stars
Oct 3, 2026
Lovely patio by the creek.

The pretzel was huge, fries a bit soggy.

Tom
5/5
Sep 20, 2026
Great beer.`;
    const r = parsePastedReviews(text, TODAY);
    expect(r).toHaveLength(2);
    expect(r[0].text).toBe("Lovely patio by the creek.\n\nThe pretzel was huge, fries a bit soggy.");
    expect(r[1]).toMatchObject({ author: "Tom", rating: 5, date: "2026-09-20", text: "Great beer." });
  });

  it("treats plain blocks as one review each and splits on ---", () => {
    expect(parsePastedReviews("Great spot.\n\nLoved the stout.", TODAY)).toHaveLength(2);
    const r = parsePastedReviews("Yelp\nAnna B.\nAlbany, NY\n5 star rating\n9/1/2026\nPerfect afternoon.\n---\nOk beer.", TODAY, "MANUAL");
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ source: "YELP", rating: 5, date: "2026-09-01", text: "Perfect afternoon." });
    expect(r[1]).toMatchObject({ rating: null, author: null, text: "Ok beer." });
  });

  it("ignores empty input", () => {
    expect(parsePastedReviews("   \n\n ", TODAY)).toEqual([]);
  });
});

describe("reviewFingerprint", () => {
  it("is stable and whitespace-insensitive", () => {
    const a = reviewFingerprint({ author: "Tom", date: "2026-09-20", text: "Great  beer." });
    expect(a).toBe(reviewFingerprint({ author: "tom", date: "2026-09-20", text: "Great beer." }));
    expect(a).not.toBe(reviewFingerprint({ author: "Tom", date: "2026-09-21", text: "Great beer." }));
  });
});

describe("summaries", () => {
  const rs = [
    { rating: 5, postedAt: "2026-11-02", themes: ["beer"], sentiment: "positive" },
    { rating: 3, postedAt: "2026-11-04", themes: ["beer", "service-speed"], sentiment: "mixed" },
    { rating: 1, postedAt: "2026-11-10", themes: ["service-speed"], sentiment: "negative" },
  ];
  it("computes a rolling average", () => {
    expect(rollingRating(rs, 2).map((x) => x.avg)).toEqual([5, 4, 2]);
  });
  it("counts themes by sentiment", () => {
    expect(themeCounts(rs)).toEqual([
      { theme: "service-speed", total: 2, positive: 0, negative: 1, mixed: 1 },
      { theme: "beer", total: 2, positive: 1, negative: 0, mixed: 1 },
    ]);
  });
});

describe("operationalHint", () => {
  const day = { date: "2026-10-17", sales: 5200, forecast: 4000, scheduledHours: 22, neededHours: 30, workedHours: null, overTarget: [] };
  it("connects slow service to short staffing and a surge", () => {
    const h = operationalHint(["service-speed"], day)!;
    expect(h).toMatch(/22 h on the floor vs 30 h needed/);
    expect(h).toMatch(/\+30% over forecast/);
  });
  it("connects food complaints to items over target", () => {
    const h = operationalHint(["food"], { ...day, overTarget: [{ name: "Smash burger", foodCostPct: 0.36, target: 0.3, sold: 40 }] })!;
    expect(h).toMatch(/Smash burger/);
    expect(h).not.toMatch(/Short-staffed/);
  });
  it("says nothing when operations looked fine", () => {
    expect(operationalHint(["service-speed"], { ...day, sales: 4000, scheduledHours: 30 })).toBeNull();
    expect(operationalHint(["beer"], undefined)).toBeNull();
  });
});
