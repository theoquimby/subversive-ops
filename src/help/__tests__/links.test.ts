import { describe, expect, it } from "vitest";
import { canFollowHelpLink } from "../content";

describe("canFollowHelpLink", () => {
  it("lets managers follow anything", () => {
    expect(canFollowHelpLink("/settings", "MANAGER")).toBe(true);
    expect(canFollowHelpLink("/help?tour=overview", "MANAGER")).toBe(true);
  });
  it("keeps staff on pages they can open", () => {
    expect(canFollowHelpLink("/settings", "STAFF")).toBe(false);
    expect(canFollowHelpLink("/welcome", "STAFF")).toBe(false);
    expect(canFollowHelpLink("/count", "STAFF")).toBe(true);
    expect(canFollowHelpLink("/waste#recent", "STAFF")).toBe(true);
    expect(canFollowHelpLink("/myself", "STAFF")).toBe(false);
  });
  it("hides manager tours and articles from staff", () => {
    expect(canFollowHelpLink("/help?tour=overview", "STAFF")).toBe(false);
    expect(canFollowHelpLink("/help?tour=counting", "STAFF")).toBe(true);
    expect(canFollowHelpLink("/help/count.start", "STAFF")).toBe(true);
    expect(canFollowHelpLink("/help/ordering.builder.onHand", "STAFF")).toBe(false);
  });
});
