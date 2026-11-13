import { describe, expect, it } from "vitest";
import { esc, link } from "../layout";
import { DEFAULT_PREFS, eventsFor, parsePrefs } from "../prefs";
import { purchaseOrderEmail, SAMPLES, shiftUpdateEmail, TEMPLATE_KEYS } from "../templates";
import { shiftUpdatePush } from "../templates/shift-update";

describe("email templates", () => {
  for (const key of TEMPLATE_KEYS) {
    describe(key, () => {
      const r = SAMPLES[key].render();
      it("has a subject, html and text", () => {
        expect(r.subject.length).toBeGreaterThan(5);
        expect(r.html).toMatch(/^<!doctype html>/);
        expect(r.html).toContain("</html>");
        expect(r.text.length).toBeGreaterThan(20);
      });
      it("plain text has no markup", () => {
        expect(r.text).not.toMatch(/<\/?[a-z][^>]*>/i);
        expect(r.text).not.toMatch(/&(amp|lt|gt|quot|#39);/);
      });
      it("html is phone-friendly (viewport, max width, no external CSS)", () => {
        expect(r.html).toContain('name="viewport"');
        expect(r.html).toContain("max-width:560px");
        expect(r.html).not.toMatch(/<link|<script/i);
      });
      it("inline styles never contain a double quote (it would end the attribute)", () => {
        for (const m of r.html.matchAll(/style="([^"]*)"(\S?)/g)) expect(m[2] === "" || m[2] === ">" || m[2] === "/").toBe(true);
        expect(r.html).not.toContain('"Segoe');
      });
      it("matches the snapshot", () => {
        expect({ subject: r.subject, text: r.text }).toMatchSnapshot();
      });
    });
  }

  it("purchase order lists every line with qty, unit and sku, and totals priced lines", () => {
    const r = SAMPLES["purchase-order"].render();
    expect(r.subject).toBe("Order from Subversive — delivery Tue, Nov 17");
    expect(r.html).toContain("#4127783");
    expect(r.html).toContain("<strong>1.5</strong> case");
    expect(r.text).toContain("- 4 case — Beef, ground 80/20 fresh chub (#4127783) @ $62.40");
    expect(r.text).toContain("Estimated total: $652.80");
    expect(r.html).toContain("Back door after 9 am please.");
  });

  it("purchase order without prices drops the price column", () => {
    const r = purchaseOrderEmail({ supplierName: "Bread Co", deliveryDate: "2026-11-18", senderName: "Max", csvFilename: "x.csv", lines: [{ sku: "1", description: "Brioche buns", qty: 10, unit: "dozen", unitPrice: null }] });
    expect(r.html).not.toContain("Our price");
    expect(r.text).not.toContain("Estimated total");
  });

  it("purchase order shows the delivery address and phone from Settings", () => {
    const base = { supplierName: "Bread Co", deliveryDate: "2026-11-18", senderName: "Max", csvFilename: "x.csv", lines: [{ sku: "1", description: "Buns", qty: 1, unit: "dozen", unitPrice: null }] };
    const r = purchaseOrderEmail({ ...base, business: { address: "1 Main St, Catskill, NY", phone: "(518) 555-0100" } });
    expect(r.html).toContain("1 Main St, Catskill, NY · (518) 555-0100");
    expect(r.text).toContain("1 Main St, Catskill, NY · (518) 555-0100");
    expect(purchaseOrderEmail(base).html).toContain("Catskill, NY");
  });

  it("escapes user content in html", () => {
    const r = purchaseOrderEmail({ supplierName: "<Evil & Co>", deliveryDate: "2026-11-18", senderName: "Max", csvFilename: "x.csv", lines: [{ sku: "1", description: `Fries "3/8" <b>`, qty: 1, unit: "cs", unitPrice: 1 }] });
    expect(r.html).toContain("&lt;Evil &amp; Co&gt;");
    expect(r.html).not.toContain("<b>");
    expect(r.text).toContain(`Fries "3/8" <b>`); // plain text stays literal
  });

  it("schedule email links to /my and sums hours", () => {
    const r = SAMPLES["schedule-published"].render();
    expect(r.subject).toBe("Your shifts for the week of Nov 16");
    expect(r.html).toContain('href="https://ops.example.com/my"');
    expect(r.text).toContain("3 shifts · 18.5 h");
    expect(r.text).toContain("Wed, Nov 18: 4:00 pm – 10:00 pm · Server");
  });

  it("shift updates cover added, removed, changed, swaps and time off", () => {
    const s = { date: "2026-11-18", startMin: 960, endMin: 1320, position: "Server" };
    const sub = (u: Parameters<typeof shiftUpdateEmail>[0]["update"]) => shiftUpdateEmail({ name: "Jamie", baseUrl: "https://x", update: u }).subject;
    expect(sub({ kind: "changed", before: null, after: s })).toBe("New shift: Wed, Nov 18");
    expect(sub({ kind: "changed", before: null, after: s, added: false })).toBe("Shift updated: Wed, Nov 18");
    expect(sub({ kind: "changed", before: s, after: null })).toBe("Shift removed: Wed, Nov 18");
    expect(sub({ kind: "changed", before: s, after: { ...s, startMin: 1020 } })).toBe("Shift changed: Wed, Nov 18");
    expect(sub({ kind: "swap", role: "taker", approved: true, shift: s, otherName: "Sam" })).toBe("You picked up Wed, Nov 18");
    expect(sub({ kind: "swap", role: "requester", approved: false, shift: s, otherName: null })).toBe("Swap not approved: Wed, Nov 18");
    expect(sub({ kind: "timeOff", approved: false, startDate: "2026-11-26", endDate: "2026-11-26" })).toBe("Time off not approved: Nov 26");
    expect(shiftUpdatePush({ kind: "timeOff", approved: true, startDate: "2026-11-26", endDate: "2026-11-28" })).toEqual({
      title: "Your time off is approved",
      body: "Thu, Nov 26 – Sat, Nov 28. You won't be scheduled on these days.",
    });
  });

  it("weekly brief subject counts what needs you", () => {
    expect(SAMPLES["weekly-brief"].render().subject).toBe("Week of Nov 16: 3 things need you");
  });

  it("certificate reminders speak to the person or roll up for managers", () => {
    expect(SAMPLES["cert-reminder"].render().subject).toBe("Your ATAP expires this week");
    const team = SAMPLES["cert-roundup"].render();
    expect(team.subject).toBe("1 certificate has expired, 2 expiring");
    expect(team.text).toContain("- Dana Russo: ATAP — expired Mon, Nov 9");
    expect(team.html).toContain('href="https://ops.example.com/team/training"');
  });

  it("credit request totals the lines", () => {
    const r = SAMPLES["credit-request"].render();
    expect(r.subject).toBe("Credit request — invoice 88123401");
    expect(r.text).toContain("Total credit requested: $49.00");
  });
});

describe("layout helpers", () => {
  it("escapes and joins urls", () => {
    expect(esc(`a&b<"'>`)).toBe("a&amp;b&lt;&quot;&#39;&gt;");
    expect(link("https://x.com/", "/my")).toBe("https://x.com/my");
    expect(link("https://x.com", "brief")).toBe("https://x.com/brief");
  });
});

describe("notification prefs", () => {
  it("falls back to defaults for bad or partial json", () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs("{nope")).toEqual(DEFAULT_PREFS);
    const p = parsePrefs(JSON.stringify({ email: " max@x.com ", events: { weeklyBrief: { email: false } } }));
    expect(p.email).toBe("max@x.com");
    expect(p.events.weeklyBrief).toEqual({ email: false, push: true });
    expect(p.events.priceSpikes).toEqual(DEFAULT_PREFS.events.priceSpikes);
  });
  it("staff only see staff events", () => {
    expect(eventsFor("STAFF")).toEqual(["schedulePublished", "shiftChanges", "certificates"]);
    expect(eventsFor("MANAGER")).toHaveLength(10);
  });
});
