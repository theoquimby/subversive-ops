import { describe, expect, it } from "vitest";
import { checkEventPage, emptyPage, feedPage, heroProblem, paragraphs, parseStoredPage, pageSummary } from "../websiteEventPage";
import { feedEventPageSchema } from "../websiteSchema";

describe("checkEventPage", () => {
  it("tidies and keeps what fits", () => {
    const r = checkEventPage({
      intro: "  Two days in the yard. ",
      sections: [{ title: " Food ", body: "Brats and pretzels.\r\n\r\n\r\n\r\nAnd a vegan plate.  " }, { title: "", body: "" }],
      schedule: [{ time: "12:00", what: "First pour" }, { time: "", what: "" }],
      links: [{ label: "Tickets", href: "tickets.example.com/okt" }],
    });
    expect(r).toEqual({
      ok: true,
      value: {
        intro: "Two days in the yard.",
        sections: [{ title: "Food", body: "Brats and pretzels.\n\nAnd a vegan plate." }],
        schedule: [{ time: "12:00", what: "First pour" }],
        links: [{ label: "Tickets", href: "https://tickets.example.com/okt" }],
      },
    });
  });

  it("says plainly what doesn't fit", () => {
    const r = checkEventPage({
      intro: "x".repeat(601),
      sections: [{ title: "", body: "Body without a title" }, { title: "t".repeat(81), body: "ok" }, { title: "No body", body: "" }],
      schedule: [{ time: "21 characters of time", what: "x" }, { time: "Noon", what: "" }],
      links: [{ label: "", href: "https://a.example.com" }, { label: "Plain", href: "http://a.example.com" }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toEqual([
      "Intro: keep it to 600 characters (it's 601).",
      "Section 1: add a heading.",
      "Section 2: keep the heading to 80 characters.",
      "Section 3: add some words under the heading.",
      "Schedule row 1: keep the time to 20 characters.",
      "Schedule row 2: say what happens.",
      "Link 1: add the words to show, like Tickets.",
      "Link 2: use an https:// address.",
    ]);
  });

  it("holds at most 8 sections, 24 schedule rows and 6 links", () => {
    const many = <T,>(n: number, f: (i: number) => T) => Array.from({ length: n }, (_, i) => f(i));
    const r = checkEventPage({ intro: "", sections: many(9, (i) => ({ title: `S${i}`, body: "b" })), schedule: many(25, (i) => ({ time: `${i}`, what: "w" })), links: many(7, (i) => ({ label: `L${i}`, href: `https://x${i}.example.com` })) });
    expect(r).toMatchObject({ ok: false, errors: ["Up to 8 sections.", "Up to 24 schedule rows.", "Up to 6 links."] });
  });
});

describe("parseStoredPage", () => {
  it("reads what was saved and copes with anything else", () => {
    expect(parseStoredPage(null)).toEqual(emptyPage());
    expect(parseStoredPage("nonsense")).toEqual(emptyPage());
    expect(parseStoredPage({ intro: "Hi", sections: [{ title: "A", body: "B" }, { title: 3 }], schedule: "x", links: [{ label: "T", href: "https://t.example.com" }] })).toEqual({ intro: "Hi", sections: [{ title: "A", body: "B" }], schedule: [], links: [{ label: "T", href: "https://t.example.com" }] });
  });
});

describe("feedPage", () => {
  const content = { intro: "Two days in the yard.", sections: [{ title: "Food", body: "Paragraphs." }], schedule: [{ time: "12:00", what: "First pour" }], links: [{ label: "Tickets", href: "https://tickets.example.com/" }] };

  it("sends the page in the website's shape, the photo only from https", () => {
    const p = feedPage(content, { url: "https://ops.example.com/api/public/images/abc", alt: "The long tables in the yard" });
    expect(p).toEqual({ hero: "https://ops.example.com/api/public/images/abc", heroAlt: "The long tables in the yard", ...content });
    expect(feedEventPageSchema.safeParse(p).success).toBe(true);
    expect(feedPage(content, { url: "http://localhost:3100/api/public/images/abc", alt: "x" })).toEqual(content);
  });

  it("leaves out empty parts and sends nothing for an empty page", () => {
    expect(feedPage(emptyPage(), null)).toBeUndefined();
    expect(feedPage({ ...emptyPage(), intro: "Just this." }, null)).toEqual({ intro: "Just this." });
    expect(feedPage(emptyPage(), { url: "https://ops.example.com/api/public/images/a", alt: "" })).toEqual({ hero: "https://ops.example.com/api/public/images/a" });
  });

  it("drops a page that wouldn't pass, never the event", () => {
    expect(feedPage({ ...emptyPage(), sections: Array.from({ length: 9 }, () => ({ title: "t", body: "b" })) }, null)).toBeUndefined();
  });
});

describe("hero photo and preview helpers", () => {
  it("wants landscape, at least 1600 px wide", () => {
    expect(heroProblem(2000, 1333)).toBeNull();
    expect(heroProblem(1600, 900)).toBeNull();
    expect(heroProblem(1200, 800)).toMatch(/1200 px wide.*1600/);
    expect(heroProblem(1600, 2400)).toMatch(/taller than it is wide/);
    expect(heroProblem(1600, 1600)).toMatch(/wider than/);
  });

  it("splits a body into paragraphs at blank lines", () => {
    expect(paragraphs("One\nstill one\n\nTwo\n\n\nThree")).toEqual(["One\nstill one", "Two", "Three"]);
  });

  it("sums a page up in a few words", () => {
    expect(pageSummary(emptyPage(), false)).toBe("No page");
    expect(pageSummary({ intro: "x", sections: [{ title: "a", body: "b" }, { title: "c", body: "d" }], schedule: [{ time: "1", what: "w" }], links: [] }, true)).toBe("Photo · intro · 2 sections · schedule");
  });
});
