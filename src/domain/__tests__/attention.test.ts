import { describe, expect, it } from "vitest";
import { attentionItems, clockLabel, dueLabel, type AttentionInput } from "../attention";

const base: AttentionInput = { today: "2026-11-13", cutoffs: [], invoicesToReview: 0, invoiceIssues: 0, timeOff: 0, swaps: 0, draftShifts: 0, dryTaps: [], certsExpired: 0, certsExpiring: 0, badReviews: 0 };
const cutoff = (o: Partial<AttentionInput["cutoffs"][number]>) => ({ supplierId: "s1", supplier: "Driscoll", cutoffDate: "2026-11-14", cutoffTime: "10:00", hoursToCutoff: 20, sent: false, drafted: false, ...o });

describe("labels", () => {
  it("formats clock times and due days", () => {
    expect(clockLabel("14:00")).toBe("2pm");
    expect(clockLabel("00:30")).toBe("12:30am");
    expect(clockLabel("12:00")).toBe("12pm");
    expect(dueLabel("2026-11-13", "2026-11-13", "14:00")).toBe("today 2pm");
    expect(dueLabel("2026-11-13", "2026-11-14", "10:00")).toBe("tomorrow 10am");
    expect(dueLabel("2026-11-13", "2026-11-16", "10:00")).toBe("Mon 10am");
  });
});

describe("attentionItems", () => {
  it("is empty when nothing needs a manager", () => {
    expect(attentionItems(base)).toEqual([]);
  });

  it("lists one order cutoff by supplier, skipping sent and far-off ones", () => {
    const items = attentionItems({ ...base, cutoffs: [cutoff({ drafted: true }), cutoff({ supplierId: "s2", supplier: "Baldor", sent: true }), cutoff({ supplierId: "s3", supplier: "Sysco", hoursToCutoff: 60 })] });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ key: "order.s1", title: "Order from Driscoll", detail: "Draft ready · due tomorrow 10am", href: "/ordering/s1", tone: "warn" });
  });

  it("groups several cutoffs and turns red inside 6 hours", () => {
    const items = attentionItems({ ...base, cutoffs: [cutoff({ supplierId: "a", supplier: "A", hoursToCutoff: 30 }), cutoff({ supplierId: "b", supplier: "B", hoursToCutoff: 4, cutoffDate: "2026-11-13", cutoffTime: "14:00" }), cutoff({ supplierId: "c", supplier: "C", hoursToCutoff: 10 })] });
    expect(items[0]).toMatchObject({ key: "orders", title: "3 orders to place", detail: "B, C and 1 more · first due today 2pm", href: "/ordering", tone: "bad" });
  });

  it("orders items by urgency", () => {
    const items = attentionItems({ ...base, invoicesToReview: 1, invoiceIssues: 2, timeOff: 1, swaps: 1, draftShifts: 12, dryTaps: ["Festbier"], certsExpired: 1, certsExpiring: 2, badReviews: 1, cutoffs: [cutoff({})] });
    expect(items.map((i) => i.key)).toEqual(["order.s1", "invoices", "certs", "kegs", "requests", "schedule", "reviews"]);
    expect(items.find((i) => i.key === "invoices")).toMatchObject({ title: "3 invoices to approve", detail: "2 with a price or quantity issue", tone: "warn" });
    expect(items.find((i) => i.key === "requests")).toMatchObject({ title: "2 staff requests to answer", detail: "1 time-off request · 1 shift swap" });
    expect(items.find((i) => i.key === "certs")).toMatchObject({ title: "1 certificate expired", detail: "and 2 expiring soon", tone: "bad", href: "/team/training" });
    expect(items.find((i) => i.key === "kegs")).toMatchObject({ title: "Festbier: no full keg behind it" });
  });
});
