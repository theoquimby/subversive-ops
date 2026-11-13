import { describe, expect, it } from "vitest";
import { appendEvent, approvalNeedsNote, canAutoApprove, currentApproval, parseHistory } from "../invoiceHistory";

describe("invoice history", () => {
  it("appends without losing earlier approvals when reopened", () => {
    let h = appendEvent([], { at: "2026-11-01T10:00:00Z", by: "Max", action: "approved", status: "PRICE_ISSUE", note: "Agreed with rep" });
    h = appendEvent(h, { at: "2026-11-02T10:00:00Z", by: "Max", action: "reopened" });
    expect(h).toHaveLength(2);
    expect(h[0].note).toBe("Agreed with rep");
    expect(currentApproval(h)).toBeNull();
    h = appendEvent(h, { at: "2026-11-03T10:00:00Z", by: "auto", action: "auto-approved", status: "MATCHED" });
    expect(currentApproval(h)?.by).toBe("auto");
  });
  it("parses defensively", () => {
    expect(parseHistory("nope")).toEqual([]);
    expect(parseHistory(JSON.stringify([{ at: "x", by: "Max", action: "approved" }, { bad: 1 }]))).toHaveLength(1);
  });
  it("needs a note unless the match is clean", () => {
    expect(approvalNeedsNote("MATCHED")).toBe(false);
    expect(approvalNeedsNote("QTY_ISSUE")).toBe(true);
  });
  it("auto-approves only a clean three-way match", () => {
    expect(canAutoApprove({ status: "MATCHED", orderStatus: "RECEIVED", duplicate: false })).toBe(true);
    expect(canAutoApprove({ status: "MATCHED", orderStatus: "SENT", duplicate: false })).toBe(false);
    expect(canAutoApprove({ status: "MATCHED", orderStatus: null, duplicate: false })).toBe(false);
    expect(canAutoApprove({ status: "MATCHED", orderStatus: "RECEIVED", duplicate: true })).toBe(false);
    expect(canAutoApprove({ status: "PRICE_ISSUE", orderStatus: "RECEIVED", duplicate: false })).toBe(false);
    const reopened = appendEvent([], { at: "2026-11-02T10:00:00Z", by: "Max", action: "reopened" });
    expect(canAutoApprove({ status: "MATCHED", orderStatus: "RECEIVED", duplicate: false, history: reopened })).toBe(false);
  });
});
