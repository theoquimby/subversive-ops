import { describe, expect, it } from "vitest";
import { invoiceAutopilot } from "../areas/invoiceAutopilot";
import { getHelp } from "../content";

describe("invoice autopilot help", () => {
  it("covers every new zone and stays short", () => {
    for (const id of ["invoices.pages", "invoices.receipt", "invoices.math", "invoices.link", "invoices.prices", "invoices.received", "settings.money.pricesOnApprove"]) {
      const e = getHelp(id);
      expect(e, id).toBeTruthy();
      expect(e!.body.length, id).toBeLessThan(330);
    }
  });

  it("links only to entries that exist", () => {
    for (const e of invoiceAutopilot) for (const r of e.related ?? []) expect(getHelp(r), `${e.id} → ${r}`).toBeTruthy();
  });

  it("uses plain words, not native browser UI or AI hype", () => {
    for (const e of invoiceAutopilot) expect(e.body, e.id).not.toMatch(/\b(dropdown|checkbox|AI-powered|seamless|leverage)\b/i);
  });
});
