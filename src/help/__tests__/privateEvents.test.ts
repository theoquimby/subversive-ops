import { describe, expect, it } from "vitest";
import { getHelp, searchHelp } from "../content";
import { privateEvents } from "../areas/privateEvents";
import { getTour, tourForPath } from "../tours";

describe("private events help", () => {
  it("has every zone and tip the private events pages use", () => {
    for (const id of [
      "events.private.page", "events.private.stats", "events.private.new", "events.private.table", "events.private.board", "events.private.detail",
      "events.private.stages", "events.private.details", "events.private.followup", "events.private.quote", "events.private.bar", "events.private.service",
      "events.private.deposit", "events.private.totals", "events.private.share", "events.private.payments", "events.private.setup", "events.private.packages",
      "events.private.spaces", "events.private.defaults",
    ]) expect(getHelp(id), id).toBeDefined();
  });

  it("keeps popovers short and links only to entries that exist", () => {
    for (const e of privateEvents) {
      expect(e.body.length, e.id).toBeLessThan(330);
      for (const r of e.related ?? []) expect(getHelp(r), `${e.id} → ${r}`).toBeDefined();
    }
  });

  it("is found by the words Max uses", () => {
    expect(searchHelp("buyout").map((e) => e.id)).toContain("events.private.page");
    expect(searchHelp("deposit").map((e) => e.id)).toContain("events.private.payments");
    expect(searchHelp("service charge").map((e) => e.id)).toContain("events.private.service");
  });

  it("has a short tour from inquiry to deposit, found from the page", () => {
    const t = getTour("private-events")!;
    expect(t).toBeDefined();
    expect(t.steps.length).toBeLessThanOrEqual(10);
    expect(t.steps[0].target).toBe("private.new");
    expect(t.steps.some((s) => s.target === "private.payments")).toBe(true);
    for (const s of t.steps) if (s.helpId) expect(getHelp(s.helpId), s.helpId).toBeDefined();
    expect(tourForPath("/events/private")?.id).toBe("private-events");
    expect(tourForPath("/events/private/abc")?.id).toBe("private-events");
  });
});
