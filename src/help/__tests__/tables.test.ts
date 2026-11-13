import { describe, expect, it } from "vitest";
import { getHelp, searchHelp } from "../content";
import { tables } from "../areas/tables";

describe("data table help", () => {
  it("has every zone and tip the tables use", () => {
    for (const id of ["app.tables", "app.tables.keys", "app.tables.bulk", "app.tables.panel", "sales.squareMenu.table", "prices.list", "ingredients.grid", "menu.list", "invoices.list", "sales.mapping", "prices.link", "prices.list.price", "ingredients.cost", "ingredients.yield", "ingredients.buffer", "ingredients.countIn", "ingredients.onHand", "ingredients.minOnHand", "menu.list.price", "menu.list.cost", "menu.list.change", "menu.list.target", "ordering.builder.daysOfCover", "ordering.builder.onHand", "ordering.builder.needed"]) {
      expect(getHelp(id), id).toBeDefined();
    }
  });
  it("keeps popovers short", () => {
    for (const e of tables) expect(e.body.length, e.id).toBeLessThan(330);
  });
  it("is found by the words people use", () => {
    expect(searchHelp("bulk").map((e) => e.id)).toContain("app.tables.bulk");
    expect(searchHelp("keyboard shortcut").map((e) => e.id)).toContain("app.tables.keys");
    expect(searchHelp("filter").map((e) => e.id)).toContain("app.tables");
  });
});
