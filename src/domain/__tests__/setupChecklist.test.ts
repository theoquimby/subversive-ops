import { describe, expect, it } from "vitest";
import { buildChecklist, historyFact, menuLinksFact, SETUP_ITEMS } from "../setupChecklist";

describe("setup checklist", () => {
  it("has unique ids, both groups, and essentials first", () => {
    expect(new Set(SETUP_ITEMS.map((i) => i.id)).size).toBe(SETUP_ITEMS.length);
    const groups = SETUP_ITEMS.map((i) => i.group);
    expect(groups.lastIndexOf("essentials")).toBeLessThan(groups.indexOf("nice"));
  });

  it("counts done items per group and points at the next essential", () => {
    const c = buildChecklist({ square: { done: true }, history: { done: true }, ai: { done: true } });
    expect(c.essentials.done).toBe(2);
    expect(c.nice.done).toBe(1);
    expect(c.essentialsDone).toBe(false);
    expect(c.next?.id).toBe("menuLinks");
  });

  it("moves on to nice-to-haves once the essentials are done", () => {
    const facts = Object.fromEntries(SETUP_ITEMS.filter((i) => i.group === "essentials").map((i) => [i.id, { done: true }]));
    const c = buildChecklist(facts);
    expect(c.essentialsDone).toBe(true);
    expect(c.next?.group).toBe("nice");
  });

  it("leaves out items whose page hasn't landed", () => {
    const c = buildChecklist({}, (r) => !r.startsWith("/website"));
    expect(c.items.some((i) => i.id === "website" || i.id === "google")).toBe(false);
    expect(c.items.some((i) => i.id === "square")).toBe(true);
  });

  it("calls menu links done at 80% and history done at a season or a finished import", () => {
    expect(menuLinksFact(0, 0).done).toBe(false);
    expect(menuLinksFact(7, 10)).toEqual({ done: false, detail: "7 of 10 linked" });
    expect(menuLinksFact(8, 10).done).toBe(true);
    expect(historyFact(false, 30).done).toBe(false);
    expect(historyFact(false, 120).done).toBe(true);
    expect(historyFact(true, 0)).toEqual({ done: true, detail: undefined });
  });
});
