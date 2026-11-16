import { describe, expect, it } from "vitest";
import { announcementWhen, checkAnnouncement, feedAnnouncements, publicIdFor, type StoredAnnouncement } from "../websiteAnnouncements";
import { feedAnnouncementSchema } from "../websiteSchema";

const input = (over: Partial<Parameters<typeof checkAnnouncement>[0]> = {}) => ({ text: "Closed Thanksgiving Day.", tone: "closure", linkHref: "", linkLabel: "", from: "", until: "", ...over });

describe("checkAnnouncement", () => {
  it("accepts a plain line and tidies spaces", () => {
    const r = checkAnnouncement(input({ text: "  Closed   Thanksgiving Day. " }));
    expect(r).toEqual({ ok: true, value: { text: "Closed Thanksgiving Day.", tone: "closure", linkHref: null, linkLabel: null, from: null, until: null } });
  });

  it("needs words, and 140 characters at most", () => {
    expect(checkAnnouncement(input({ text: "   " }))).toMatchObject({ ok: false, errors: { text: expect.any(String) } });
    expect(checkAnnouncement(input({ text: "x".repeat(140) })).ok).toBe(true);
    expect(checkAnnouncement(input({ text: "x".repeat(141) }))).toMatchObject({ ok: false, errors: { text: expect.stringContaining("140") } });
  });

  it("knows the three tones", () => {
    expect(checkAnnouncement(input({ tone: "event" })).ok).toBe(true);
    expect(checkAnnouncement(input({ tone: "info" })).ok).toBe(true);
    expect(checkAnnouncement(input({ tone: "red" })).ok).toBe(false);
  });

  it("takes a website path or an https address, with a short label", () => {
    expect(checkAnnouncement(input({ linkHref: "/events/2027-10-02-oktoberfest", linkLabel: "Details" }))).toMatchObject({ ok: true, value: { linkHref: "/events/2027-10-02-oktoberfest", linkLabel: "Details" } });
    expect(checkAnnouncement(input({ linkHref: "https://tickets.example.com/okt", linkLabel: "Tickets" })).ok).toBe(true);
    // a bare address gets https://
    expect(checkAnnouncement(input({ linkHref: "tickets.example.com/okt", linkLabel: "Tickets" }))).toMatchObject({ ok: true, value: { linkHref: "https://tickets.example.com/okt" } });
    expect(checkAnnouncement(input({ linkHref: "http://tickets.example.com", linkLabel: "Tickets" }))).toMatchObject({ ok: false, errors: { linkHref: expect.stringContaining("https") } });
    expect(checkAnnouncement(input({ linkHref: "//evil.example.com", linkLabel: "x" })).ok).toBe(false);
    expect(checkAnnouncement(input({ linkHref: "/events", linkLabel: "" }))).toMatchObject({ ok: false, errors: { linkLabel: expect.any(String) } });
    expect(checkAnnouncement(input({ linkHref: "/events", linkLabel: "x".repeat(41) }))).toMatchObject({ ok: false, errors: { linkLabel: expect.stringContaining("40") } });
    // a label with no link is dropped, not an error
    expect(checkAnnouncement(input({ linkLabel: "Details" }))).toMatchObject({ ok: true, value: { linkHref: null, linkLabel: null } });
  });

  it("checks the days", () => {
    expect(checkAnnouncement(input({ from: "2026-11-20", until: "2026-11-26" }))).toMatchObject({ ok: true, value: { from: "2026-11-20", until: "2026-11-26" } });
    expect(checkAnnouncement(input({ from: "2026-11-27", until: "2026-11-26" }))).toMatchObject({ ok: false, errors: { until: expect.any(String) } });
    expect(checkAnnouncement(input({ from: "2026-02-30" }))).toMatchObject({ ok: false, errors: { from: expect.any(String) } });
  });
});

describe("announcementWhen", () => {
  const today = "2026-11-16";
  it("says when it shows", () => {
    expect(announcementWhen("2026-11-20", "2026-11-26", today)).toEqual({ state: "upcoming", label: "Shows Nov 20 – Nov 26" });
    expect(announcementWhen("2026-11-20", null, today)).toEqual({ state: "upcoming", label: "Shows from Nov 20" });
    expect(announcementWhen(null, null, today)).toEqual({ state: "showing", label: "Showing now" });
    expect(announcementWhen("2026-11-16", "2026-11-16", today)).toEqual({ state: "showing", label: "Showing now · last day today" });
    expect(announcementWhen(null, "2026-11-26", today)).toEqual({ state: "showing", label: "Showing now · until Nov 26" });
    expect(announcementWhen(null, "2026-11-15", today)).toEqual({ state: "ended", label: "Ended" });
  });
  it("names the year when it isn't this one", () => {
    expect(announcementWhen("2027-10-01", "2027-10-03", today).label).toBe("Shows Oct 1, 2027 – Oct 3, 2027");
  });
});

describe("publicIdFor", () => {
  it("makes a readable, unique id of at most 64 characters", () => {
    expect(publicIdFor("Closed Thanksgiving Day.", "2026-11-16", new Set())).toBe("closed-thanksgiving-day-2026-11-16");
    expect(publicIdFor("Closed Thanksgiving Day.", "2026-11-16", new Set(["closed-thanksgiving-day-2026-11-16"]))).toBe("closed-thanksgiving-day-2026-11-16-2");
    const long = publicIdFor("Oktoberfest is October 2 and 3, with the oompah band, pretzels and our Festbier all weekend", "2026-11-16", new Set());
    expect(long.length).toBeLessThanOrEqual(64);
    expect(long).toMatch(/^oktoberfest-is-october-2-and-3[a-z0-9-]*-2026-11-16$/);
    expect(publicIdFor("!!!", "2026-11-16", new Set())).toBe("notice-2026-11-16");
  });
});

describe("feedAnnouncements", () => {
  const row = (over: Partial<StoredAnnouncement>): StoredAnnouncement => ({ publicId: "a", text: "Hello.", tone: "info", linkHref: null, linkLabel: null, from: null, until: null, sort: 0, active: true, ...over });

  it("sends active, unfinished ones in order, in the website's shape", () => {
    const out = feedAnnouncements(
      [
        row({ publicId: "okt", text: "Oktoberfest is October 2 and 3.", tone: "event", linkHref: "/events/oktoberfest-2027", linkLabel: "Details", sort: 2 }),
        row({ publicId: "thx", text: "Closed Thanksgiving Day.", tone: "closure", from: "2026-11-20", until: "2026-11-26", sort: 1 }),
        row({ publicId: "old", until: "2026-11-15" }),
        row({ publicId: "off", active: false }),
      ],
      "2026-11-16",
    );
    expect(out).toEqual([
      { id: "thx", text: "Closed Thanksgiving Day.", tone: "closure", from: "2026-11-20", until: "2026-11-26" },
      { id: "okt", text: "Oktoberfest is October 2 and 3.", tone: "event", link: { href: "/events/oktoberfest-2027", label: "Details" } },
    ]);
    for (const a of out) expect(feedAnnouncementSchema.safeParse(a).success).toBe(true);
  });

  it("keeps the last day, drops a bad row and a repeated id", () => {
    const out = feedAnnouncements([row({ publicId: "a", until: "2026-11-16" }), row({ publicId: "b", text: "" }), row({ publicId: "a", text: "Again" }), row({ publicId: "c", tone: "loud" }), row({ publicId: "d", linkHref: "javascript:alert(1)", linkLabel: "x" })], "2026-11-16");
    expect(out.map((a) => a.id)).toEqual(["a", "c", "d"]);
    // an unknown tone is sent as plain; a bad link is left off rather than losing the line
    expect(out[1].tone).toBe("info");
    expect(out[2].link).toBeUndefined();
  });
});
