import { describe, expect, it } from "vitest";
import { fees } from "../areas/fees";
import { getHelp } from "../content";

describe("card fees and comps help", () => {
  it("covers every new zone and stays short", () => {
    for (const id of ["pnl.fees", "pnl.comps", "settings.money.discounts", "pnl.headline", "pnl.caveats", "pnl.notes"]) {
      const e = getHelp(id);
      expect(e, id).toBeTruthy();
      expect(e!.body.length, id).toBeLessThan(330);
    }
  });

  it("links only to entries that exist", () => {
    for (const e of [...fees, getHelp("pnl.page")!]) for (const r of e.related ?? []) expect(getHelp(r), `${e.id} → ${r}`).toBeTruthy();
  });

  it("uses plain words, not native browser UI or AI hype", () => {
    for (const e of fees) expect(e.body, e.id).not.toMatch(/\b(dropdown|checkbox|AI-powered|seamless|leverage)\b/i);
  });
});
