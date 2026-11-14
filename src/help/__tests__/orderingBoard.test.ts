import { describe, expect, it } from "vitest";
import { getHelp, searchHelp } from "../content";
import { orderingBoard } from "../areas/orderingBoard";
import { ordering } from "../areas/operations";
import { getTour } from "../tours";

describe("ordering board help", () => {
  it("has every zone and tip the Ordering page uses", () => {
    for (const id of ["ordering.page", "ordering.today", "ordering.board", "ordering.board.suggested", "ordering.board.panel", "ordering.board.bulk", "ordering.suppliers", "ordering.recent", "ordering.cutoffs", "app.tables.keys"]) expect(getHelp(id), id).toBeDefined();
  });
  it("keeps popovers short and no longer talks about cards", () => {
    for (const e of [...orderingBoard, ...ordering.filter((x) => ["ordering.page", "ordering.suppliers", "ordering.recent"].includes(x.id))]) {
      expect(e.body.length, e.id).toBeLessThan(330);
      expect(e.body, e.id).not.toMatch(/\bcards?\b/i);
    }
  });
  it("is found by the words people use", () => {
    expect(searchHelp("countdown").map((e) => e.id)).toContain("ordering.today");
    expect(searchHelp("draft all").map((e) => e.id)).toContain("ordering.board.bulk");
  });
  it("tours the new page: Today, the table, then into a supplier's order", () => {
    const t = getTour("ordering")!;
    const targets = t.steps.map((s) => s.target ?? s.routeFrom);
    expect(targets.slice(0, 2)).toEqual(["ordering.today", "ordering.suppliers"]);
    expect(t.steps.some((s) => s.routeFrom === "ordering.supplier-card")).toBe(true);
    for (const s of t.steps) expect(s.body, s.title).not.toMatch(/\bcards?\b/i);
  });
});
