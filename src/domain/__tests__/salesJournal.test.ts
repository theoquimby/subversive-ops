import { describe, expect, it } from "vitest";
import type { QboAccount } from "../quickbooks";
import {
  buildQboJournal,
  isBalanced,
  journalAction,
  journalDocNumber,
  journalLines,
  journalRequestId,
  missingJournalAccounts,
  modeConflict,
  parseJournalSettings,
  suggestJournalAccounts,
  summarize,
  type JournalAccounts,
  type SalesDayFigures,
} from "../salesJournal";

const day = (date: string, over: Partial<SalesDayFigures> = {}): SalesDayFigures => ({
  date,
  food: 1200,
  beverage: 1800.55,
  other: 40,
  discounts: { food: 30, beverage: 20.1, other: 0 },
  tax: 243.24,
  tips: 512.33,
  cardFees: 92.17,
  cardVolume: 3300.4,
  feePending: 0,
  ...over,
});

const ACCOUNTS: JournalAccounts = { foodSales: "1", beverageSales: "2", otherSales: "3", discounts: "4", salesTax: "5", tips: "6", cardFees: "7", cardClearing: "8", cashClearing: "9" };

describe("summaries", () => {
  it("makes one entry per day, leaving out today and closed days", () => {
    const s = summarize([day("2026-10-30"), day("2026-10-31", { food: 0, beverage: 0, other: 0, discounts: { food: 0, beverage: 0, other: 0 }, tax: 0, tips: 0, cardFees: 0, cardVolume: 0 }), day("2026-11-15")], "daily", "2026-11-15");
    expect(s.map((x) => x.key)).toEqual(["day:2026-10-30"]);
    expect(s[0]).toMatchObject({ txnDate: "2026-10-30", notReady: [] });
  });

  it("makes one entry per month, booked on its last day, not ready until it ends", () => {
    const s = summarize([day("2026-10-01"), day("2026-10-02"), day("2026-11-01")], "monthly", "2026-11-15");
    expect(s.map((x) => [x.key, x.txnDate, x.days])).toEqual([
      ["month:2026-10", "2026-10-31", 2],
      ["month:2026-11", "2026-11-30", 1],
    ]);
    expect(s[0].food).toBe(2400);
    expect(s[0].notReady).toEqual([]);
    expect(s[1].notReady).toEqual(["The month isn't over yet."]);
  });

  it("isn't ready while Square data is missing", () => {
    const [s] = summarize([day("2026-10-01", { tax: null, cardFees: null, feePending: 2 })], "daily", "2026-11-15");
    expect(s.notReady).toEqual(["Sales tax isn't in from Square yet.", "Card fees aren't in from Square yet.", "Square is still adding fees to 2 payments."]);
    expect(buildQboJournal(s, ACCOUNTS)).toMatchObject({ ok: false, error: "Sales tax isn't in from Square yet." });
  });
});

describe("journal lines", () => {
  it("balances to the cent with cash as the plug", () => {
    const [s] = summarize([day("2026-10-01")], "daily", "2026-11-15");
    const j = journalLines(s);
    const by = Object.fromEntries(j.lines.map((l) => [l.key, l]));
    expect(by.foodSales).toMatchObject({ posting: "Credit", amount: 1230 });
    expect(by.beverageSales).toMatchObject({ posting: "Credit", amount: 1820.65 });
    expect(by.otherSales).toMatchObject({ posting: "Credit", amount: 40 });
    expect(by.discounts).toMatchObject({ posting: "Debit", amount: 50.1 });
    expect(by.salesTax).toMatchObject({ posting: "Credit", amount: 243.24 });
    expect(by.tips).toMatchObject({ posting: "Credit", amount: 512.33 });
    expect(by.cardFees).toMatchObject({ posting: "Debit", amount: 92.17 });
    expect(by.cardClearing).toMatchObject({ posting: "Debit", amount: 3208.23 });
    // takings 1200 + 1800.55 + 40 + 243.24 + 512.33 = 3796.12; card 3300.40 → cash 495.72
    expect(by.cashClearing).toMatchObject({ posting: "Debit", amount: 495.72 });
    expect(j.debits).toBe(j.credits);
    expect(j.balanced).toBe(true);
    expect(isBalanced(j.lines)).toBe(true);
  });

  it("caps card clearing when card payments are more than the takings", () => {
    const [s] = summarize([day("2026-10-01", { cardVolume: 9999 })], "daily", "2026-11-15");
    const j = journalLines(s);
    expect(j.lines.find((l) => l.key === "cashClearing")).toBeUndefined();
    expect(j.notes[0]).toMatch(/capped/);
    expect(j.balanced).toBe(true);
  });

  it("moves negative figures (a refund day, fees given back) to the other side", () => {
    const [s] = summarize([day("2026-10-01", { food: -50, beverage: 0, other: 0, discounts: { food: 0, beverage: 0, other: 0 }, tax: -4, tips: 0, cardFees: -1.2, cardVolume: 0 })], "daily", "2026-11-15");
    const j = journalLines(s);
    expect(j.lines.find((l) => l.key === "foodSales")).toMatchObject({ posting: "Debit", amount: 50 });
    expect(j.lines.find((l) => l.key === "cardFees")).toMatchObject({ posting: "Credit", amount: 1.2 });
    expect(j.balanced).toBe(true);
  });

  it("rejects an unbalanced or one-line entry", () => {
    expect(isBalanced([{ posting: "Debit", amount: 10 }, { posting: "Credit", amount: 9.99 }])).toBe(false);
    expect(isBalanced([{ posting: "Debit", amount: 0 }, { posting: "Credit", amount: 0 }])).toBe(false);
    expect(isBalanced([{ posting: "Debit", amount: 0.1 }, { posting: "Debit", amount: 0.2 }, { posting: "Credit", amount: 0.3 }])).toBe(true);
  });
});

describe("QuickBooks payload", () => {
  it("follows the JournalEntry shape", () => {
    const [s] = summarize([day("2026-10-01")], "daily", "2026-11-15");
    const b = buildQboJournal(s, ACCOUNTS);
    if (!b.ok) throw new Error(b.error);
    expect(b.payload.TxnDate).toBe("2026-10-01");
    expect(b.payload.DocNumber).toBe("SQ-20261001");
    expect(b.payload.Line[0]).toEqual({ DetailType: "JournalEntryLineDetail", Amount: 3208.23, Description: "Square 2026-10-01: card payments less fees", JournalEntryLineDetail: { PostingType: "Debit", AccountRef: { value: "8" } } });
    expect(b.payload.Line.every((l) => l.Amount > 0)).toBe(true);
    expect(b.hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("needs every account the lines use", () => {
    const [s] = summarize([day("2026-10-01")], "daily", "2026-11-15");
    const b = buildQboJournal(s, { ...ACCOUNTS, tips: null, salesTax: null });
    expect(b).toMatchObject({ ok: false, error: "Choose a QuickBooks account for Sales tax payable, Tips payable first." });
  });

  it("keeps doc numbers within 21 characters", () => {
    expect(journalDocNumber({ mode: "monthly", label: "2026-10" })).toBe("SQ-2026-10");
    expect(journalDocNumber({ mode: "daily", label: "2026-10-01" }).length).toBeLessThanOrEqual(21);
  });
});

describe("idempotency", () => {
  it("creates once, skips unchanged, updates changed", () => {
    expect(journalAction(null, "abc")).toBe("create");
    expect(journalAction({ qboId: null, hash: null, status: "error" }, "abc")).toBe("create");
    expect(journalAction({ qboId: "77", hash: "abc", status: "ok" }, "abc")).toBe("skip");
    expect(journalAction({ qboId: "77", hash: "abc", status: "ok" }, "def")).toBe("update");
  });

  it("hashes the same content the same way, and different content differently", () => {
    const [a] = summarize([day("2026-10-01")], "daily", "2026-11-15");
    const [b] = summarize([day("2026-10-01")], "daily", "2026-11-15");
    const [c] = summarize([day("2026-10-01", { tips: 512.34 })], "daily", "2026-11-15");
    const h = (s: typeof a) => {
      const r = buildQboJournal(s, ACCOUNTS);
      return r.ok ? r.hash : "";
    };
    expect(h(a)).toBe(h(b));
    expect(h(a)).not.toBe(h(c));
  });

  it("makes stable request ids of at most 50 characters", () => {
    const id = journalRequestId("day:2026-10-01", "0123456789abcdef", null);
    expect(id).toBe(journalRequestId("day:2026-10-01", "0123456789abcdef", null));
    expect(id).not.toBe(journalRequestId("day:2026-10-01", "0123456789abcdef", "77"));
    expect(id.length).toBeLessThanOrEqual(50);
  });

  it("never books a day twice when switching daily and monthly", () => {
    expect(modeConflict("month:2026-10", new Set(["day:2026-10-03"]))).toMatch(/already sent one by one/);
    expect(modeConflict("month:2026-10", new Set(["day:2026-09-30"]))).toBeNull();
    expect(modeConflict("day:2026-10-03", new Set(["month:2026-10"]))).toMatch(/one monthly entry/);
    expect(modeConflict("day:2026-10-03", new Set(["month:2026-09"]))).toBeNull();
  });
});

describe("settings and suggestions", () => {
  it("is off by default and drops accounts from another company", () => {
    expect(parseJournalSettings(null, "123")).toMatchObject({ enabled: false, mode: "daily" });
    const saved = { enabled: true, mode: "monthly", realmId: "123", accounts: { foodSales: "41", tips: "bad id!" } };
    expect(parseJournalSettings(saved, "123").accounts).toMatchObject({ foodSales: "41", tips: null });
    expect(parseJournalSettings(saved, "999").accounts.foodSales).toBeNull();
    expect(missingJournalAccounts(parseJournalSettings(saved, "123").accounts)).toHaveLength(8);
  });

  it("suggests accounts of the right kind by name", () => {
    const a = (id: string, name: string, type: string, subType: string | null = null): QboAccount => ({ id, name, fullName: name, type, subType, active: true });
    const accounts = [
      a("1", "Sales", "Income"),
      a("2", "Food Sales", "Income"),
      a("3", "Beer & Bar Sales", "Income"),
      a("4", "Discounts given", "Income", "DiscountsRefundsGiven"),
      a("5", "Sales Tax Payable", "Other Current Liability", "SalesTaxPayable"),
      a("6", "Tips Payable", "Other Current Liability"),
      a("7", "Bank Charges & Fees", "Expense", "BankCharges"),
      a("8", "Square Clearing", "Other Current Asset"),
      a("9", "Undeposited Funds", "Other Current Asset", "UndepositedFunds"),
      a("10", "Cash on hand", "Bank", "CashOnHand"),
      a("11", "Merchandise Sales", "Income"),
    ];
    expect(suggestJournalAccounts(accounts)).toEqual({ foodSales: "2", beverageSales: "3", otherSales: "11", discounts: "4", salesTax: "5", tips: "6", cardFees: "7", cardClearing: "8", cashClearing: "10" });
  });
});
