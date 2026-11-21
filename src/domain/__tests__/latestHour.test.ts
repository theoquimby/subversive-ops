import { describe, expect, it } from "vitest";
import { parseLatestHour } from "../timecards";

describe("parseLatestHour", () => {
  it("reads typed times", () => {
    expect(parseLatestHour("10p")).toBe(22);
    expect(parseLatestHour("10pm")).toBe(22);
    expect(parseLatestHour("22:00")).toBe(22);
    expect(parseLatestHour("midnight")).toBe(24);
    expect(parseLatestHour("9 PM")).toBe(21);
  });
  it("keeps the old 24-hour numbers working", () => {
    expect(parseLatestHour("22")).toBe(22);
    expect(parseLatestHour("23")).toBe(23);
  });
  it("reads a bare evening hour as pm", () => {
    expect(parseLatestHour("10")).toBe(22);
    expect(parseLatestHour("9")).toBe(21);
  });
  it("wants whole hours", () => {
    expect(parseLatestHour("10:30p")).toBeNull();
    expect(parseLatestHour("late")).toBeNull();
    expect(parseLatestHour("")).toBeNull();
  });
});
