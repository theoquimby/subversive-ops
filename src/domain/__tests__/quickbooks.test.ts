import { describe, expect, it } from "vitest";
import { validateSecret } from "../secretFormats";
import {
  accessTokenStale,
  accountForLine,
  basicAuth,
  billAccounts,
  billHasPayment,
  billRequestId,
  buildQboBill,
  defaultBillAccount,
  DOC_NUMBER_MAX,
  EMPTY_MAPPING,
  faultErrors,
  fingerprint,
  friendlyQboError,
  isRealmId,
  matchVendor,
  missingAccounts,
  normalizeName,
  qboApiHost,
  qboAuthorizeUrl,
  qboMapping,
  qboQuote,
  refreshDaysLeft,
  suggestAccount,
  tokensFrom,
  vendorDisplayName,
  type QboAccount,
  type QboMapping,
} from "../quickbooks";

const acct = (id: string, fullName: string, type = "Cost of Goods Sold", subType: string | null = null, active = true): QboAccount => ({ id, name: fullName.split(":").pop()!, fullName, type, subType, active });

const CHART: QboAccount[] = [
  acct("1", "Checking", "Bank"),
  acct("80", "Cost of Goods Sold"),
  acct("81", "Cost of Goods Sold:Food Cost"),
  acct("82", "Cost of Goods Sold:Beer & Wine"),
  acct("60", "Supplies & Materials", "Expense", "SuppliesMaterials"),
  acct("61", "Rent", "Expense", "RentOrLeaseOfBuildings"),
  acct("62", "Old account", "Expense", null, false),
  acct("70", "Penalties", "Other Expense"),
  acct("33", "Accounts Payable (A/P)", "Accounts Payable"),
];

const mapping = (over: Partial<QboMapping> = {}): QboMapping => ({ ...EMPTY_MAPPING, realmId: "123", defaultAccountId: "80", ...over });

describe("OAuth", () => {
  it("builds the authorize URL Intuit documents", () => {
    const u = new URL(qboAuthorizeUrl({ clientId: "ABC", redirectUri: "https://x.app/api/quickbooks/oauth/callback", state: "s1" }));
    expect(u.origin + u.pathname).toBe("https://appcenter.intuit.com/connect/oauth2");
    expect(Object.fromEntries(u.searchParams)).toEqual({ client_id: "ABC", response_type: "code", scope: "com.intuit.quickbooks.accounting", redirect_uri: "https://x.app/api/quickbooks/oauth/callback", state: "s1" });
  });

  it("uses Basic auth of id:secret", () => {
    expect(basicAuth("id", "secret")).toBe(`Basic ${Buffer.from("id:secret").toString("base64")}`);
  });

  it("picks the API host by environment", () => {
    expect(qboApiHost("production")).toBe("https://quickbooks.api.intuit.com");
    expect(qboApiHost("sandbox")).toBe("https://sandbox-quickbooks.api.intuit.com");
  });

  it("only accepts digit realm ids", () => {
    expect(isRealmId("1231434565226279")).toBe(true);
    expect(isRealmId("12/../x")).toBe(false);
    expect(isRealmId("")).toBe(false);
    expect(isRealmId(undefined)).toBe(false);
  });

  it("turns a token response into expiry times", () => {
    const now = new Date("2026-11-13T12:00:00Z");
    const t = tokensFrom({ access_token: "a", refresh_token: "r", expires_in: 3600, x_refresh_token_expires_in: 8640000 }, now);
    expect(t.accessExpiresAt).toBe("2026-11-13T13:00:00.000Z");
    expect(t.refreshExpiresAt).toBe("2027-02-21T12:00:00.000Z"); // 100 days
    expect(() => tokensFrom({ access_token: "a" } as never, now)).toThrow();
  });

  it("refreshes a few minutes before the hour is up", () => {
    const now = new Date("2026-11-13T12:00:00Z");
    expect(accessTokenStale("2026-11-13T12:30:00Z", now)).toBe(false);
    expect(accessTokenStale("2026-11-13T12:04:00Z", now)).toBe(true);
    expect(accessTokenStale(null, now)).toBe(true);
    expect(refreshDaysLeft("2026-11-23T12:00:00Z", now)).toBe(10);
    expect(refreshDaysLeft(null, now)).toBeNull();
  });
});

describe("query quoting", () => {
  it("escapes apostrophes", () => {
    expect(qboQuote("Adam's Candy Shop")).toBe("'Adam\\'s Candy Shop'");
    expect(qboQuote("a\\b")).toBe("'a\\\\b'");
  });
});

describe("vendors", () => {
  const vendors = [
    { id: "1", name: "Hudson Valley Foodservice, Inc." },
    { id: "2", name: "The Catskill Bread Co" },
    { id: "3", name: "Greene County Beef & Pork" },
    { id: "4", name: "Sysco" },
  ];

  it("normalizes names", () => {
    expect(normalizeName("The Catskill Bread Co., Inc.")).toBe("catskill bread");
    expect(normalizeName("Café Olé LLC")).toBe("cafe ole");
    expect(normalizeName("Co")).toBe("co");
  });

  it("matches the same business regardless of Inc/Co/punctuation", () => {
    expect(matchVendor("Hudson Valley Foodservice", vendors)).toEqual({ vendor: vendors[0], sure: true });
    expect(matchVendor("Catskill Bread Co.", vendors)).toEqual({ vendor: vendors[1], sure: true });
  });

  it("suggests (not sure) when one name extends the other", () => {
    expect(matchVendor("Greene County Beef", vendors)).toEqual({ vendor: vendors[2], sure: false });
  });

  it("doesn't guess on unrelated names", () => {
    expect(matchVendor("House brewery", vendors)).toBeNull();
    expect(matchVendor("Sy", vendors)).toBeNull();
  });

  it("cleans display names", () => {
    expect(vendorDisplayName("A:B\tC  D")).toBe("A B C D");
    expect(vendorDisplayName("   ")).toBe("Supplier");
  });
});

describe("accounts", () => {
  it("lists only active cost and expense accounts, COGS first", () => {
    expect(billAccounts(CHART).map((a) => a.id)).toEqual(["80", "82", "81", "61", "60", "70"]);
  });

  it("finds the default cost of goods account", () => {
    expect(defaultBillAccount(CHART)?.id).toBe("80");
    expect(defaultBillAccount([acct("9", "Food purchases")])?.id).toBe("9");
    expect(defaultBillAccount([acct("1", "Checking", "Bank")])).toBeNull();
  });

  it("suggests food, beverage and supplies accounts by category", () => {
    expect(suggestAccount("Beer", CHART)?.id).toBe("82");
    expect(suggestAccount("Produce", CHART)?.id).toBe("81");
    expect(suggestAccount("Protein", CHART)?.id).toBe("81");
    expect(suggestAccount("Paper & cleaning supplies", CHART)?.id).toBe("60");
    expect(suggestAccount("Beer", [acct("80", "Cost of Goods Sold")])).toBeNull();
  });

  it("reports mapped accounts that no longer exist", () => {
    expect(missingAccounts(mapping({ byCategory: { Beer: "82", Dairy: "999" }, bySupplier: { s: "62" } }), CHART)).toEqual(["999", "62"]);
  });
});

describe("mapping", () => {
  it("drops a mapping saved for another company but keeps the switches", () => {
    const saved = { realmId: "999", defaultAccountId: "80", autoSend: true, sendFrom: "2026-11-01" };
    expect(qboMapping(saved, "123")).toEqual({ ...EMPTY_MAPPING, realmId: "123", autoSend: true, sendFrom: "2026-11-01" });
  });

  it("cleans junk", () => {
    const m = qboMapping({ realmId: "123", defaultAccountId: "80", otherAccountId: "<script>", byCategory: { Beer: "82", Bad: 5 }, sendFrom: "soon" }, "123");
    expect(m.otherAccountId).toBeNull();
    expect(m.byCategory).toEqual({ Beer: "82" });
    expect(m.sendFrom).toBeNull();
  });

  it("picks category, then supplier, then default", () => {
    const m = mapping({ byCategory: { Beer: "82" }, bySupplier: { brew: "60" } });
    expect(accountForLine("Beer", "brew", m)).toBe("82");
    expect(accountForLine(null, "brew", m)).toBe("60");
    expect(accountForLine("Dairy", "other", m)).toBe("80");
  });
});

describe("buildQboBill", () => {
  const inv = {
    supplierId: "s1",
    supplierName: "Hudson Valley Foodservice",
    invoiceNumber: "INV-1001",
    invoiceDate: "2026-11-02",
    total: 130.5,
    lines: [
      { description: "Romaine", sku: "R1", qty: 2, unitPrice: 20, category: "Produce" },
      { description: "IPA keg", sku: null, qty: 1, unitPrice: 80, category: "Beer" },
      { description: "Lemons", sku: null, qty: 1, unitPrice: 5.25, category: "Produce" },
    ],
  };

  it("rolls lines up per account and adds the gap as other charges", () => {
    const r = buildQboBill(inv, "56", mapping({ byCategory: { Beer: "82" }, otherAccountId: "70" }), 30);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bill).toMatchObject({ VendorRef: { value: "56" }, TxnDate: "2026-11-02", DueDate: "2026-12-02", DocNumber: "INV-1001" });
    expect(r.bill.Line.map((l) => [l.AccountBasedExpenseLineDetail.AccountRef.value, l.Amount])).toEqual([
      ["80", 45.25],
      ["82", 80],
      ["70", 5.25],
    ]);
    expect(r.bill.Line[0].DetailType).toBe("AccountBasedExpenseLineDetail");
    expect(r.bill.Line[0].Description).toBe("Hudson Valley Foodservice — 2 lines");
    expect(r.total).toBe(130.5);
  });

  it("needs a default account", () => {
    expect(buildQboBill(inv, "56", { ...EMPTY_MAPPING }, 30)).toEqual({ ok: false, error: expect.stringContaining("Choose the account") });
  });

  it("refuses zero and negative bills", () => {
    expect(buildQboBill({ ...inv, total: null, lines: [] }, "56", mapping(), 30).ok).toBe(false);
    const credit = buildQboBill({ ...inv, total: -10, lines: [] }, "56", mapping(), 30);
    expect(credit.ok === false && credit.error).toMatch(/credit/);
  });

  it("makes a bill number when there isn't one and keeps it to 21 characters", () => {
    const a = buildQboBill({ ...inv, invoiceNumber: null }, "56", mapping(), 0);
    expect(a.ok && a.bill.DocNumber).toBe("HVF-20261102");
    expect(a.ok && a.bill.DueDate).toBe("2026-11-02");
    const long = buildQboBill({ ...inv, invoiceNumber: "A-VERY-LONG-INVOICE-NUMBER-12345" }, "56", mapping(), 30);
    expect(long.ok && long.bill.DocNumber.length).toBe(DOC_NUMBER_MAX);
    expect(long.ok && long.bill.PrivateNote).toContain("A-VERY-LONG-INVOICE-NUMBER-12345");
  });

  it("fingerprints the content, so the same invoice gives the same hash", () => {
    const a = buildQboBill(inv, "56", mapping(), 30);
    const b = buildQboBill({ ...inv, lines: [...inv.lines] }, "56", mapping(), 30);
    const c = buildQboBill({ ...inv, total: 131 }, "56", mapping(), 30);
    expect(a.ok && b.ok && a.hash === b.hash).toBe(true);
    expect(a.ok && c.ok && a.hash !== c.hash).toBe(true);
  });
});

describe("helpers", () => {
  it("fingerprints are order-independent for object keys", () => {
    expect(fingerprint({ a: 1, b: [1, 2] })).toBe(fingerprint({ b: [1, 2], a: 1 }));
    expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }));
    expect(fingerprint("x")).toHaveLength(16);
  });

  it("request ids stay under 50 characters and change when the bill was recreated", () => {
    const id = billRequestId("cmhxyz1234567890abcdefghij", "0123456789abcdef", null);
    expect(id.length).toBeLessThanOrEqual(50);
    expect(billRequestId("cmhxyz1234567890abcdefghij", "0123456789abcdef", "77")).not.toBe(id);
  });

  it("sees payments on a bill", () => {
    expect(billHasPayment({ TotalAmt: 100, Balance: 100 })).toBe(false);
    expect(billHasPayment({ TotalAmt: 100, Balance: 40 })).toBe(true);
    expect(billHasPayment({})).toBe(false);
  });
});

describe("errors", () => {
  it("reads Intuit faults in both casings", () => {
    expect(faultErrors({ Fault: { Error: [{ code: "6240", Message: "Duplicate Name Exists Error" }], type: "ValidationFault" } })[0].code).toBe("6240");
    expect(faultErrors({ fault: { error: [{ code: "3200", message: "message=ApplicationAuthenticationFailed" }] } })[0].Message).toContain("Authentication");
    expect(faultErrors(null)).toEqual([]);
  });

  it("says what to do in plain English", () => {
    expect(friendlyQboError(400, [], "invalid_grant")).toMatch(/Connect to QuickBooks again/);
    expect(friendlyQboError(401, [])).toMatch(/sign-in/);
    expect(friendlyQboError(0, [])).toMatch(/Couldn't reach QuickBooks/);
    expect(friendlyQboError(429, [])).toMatch(/too often/);
    expect(friendlyQboError(400, [{ code: "6240" }])).toMatch(/already has/);
    expect(friendlyQboError(400, [{ code: "2500", Detail: "Invalid Reference Id : Accounts element id 999" }])).toMatch(/no longer exists/);
    expect(friendlyQboError(400, [{ code: "6000", Detail: "A business validation error has occurred." }])).toBe("QuickBooks said: A business validation error has occurred.");
    expect(friendlyQboError(503, [])).toMatch(/having trouble/);
  });
});

describe("pasted QuickBooks keys", () => {
  const id = "ABcd3fGh1jKlMn0pQrStUvWxYz0123456789abcdefGHIJKL"; // 48
  const secret = "Zy9xWvUt8sRqPoNm7lKjIhGf6eDcBa5432109876"; // 40

  it("accepts real-looking keys", () => {
    expect(validateSecret("QUICKBOOKS_CLIENT_ID", ` ${id} `)).toEqual({ ok: true, value: id });
    expect(validateSecret("QUICKBOOKS_CLIENT_SECRET", secret)).toEqual({ ok: true, value: secret });
  });

  it("explains cut-short and wrong-box pastes", () => {
    expect(validateSecret("QUICKBOOKS_CLIENT_ID", id.slice(0, 25))).toMatchObject({ ok: false, error: expect.stringMatching(/cut short/) });
    expect(validateSecret("QUICKBOOKS_CLIENT_SECRET", "9130354998272356")).toMatchObject({ ok: false, error: expect.stringMatching(/company ID/) });
    expect(validateSecret("QUICKBOOKS_CLIENT_ID", "sq0idp-abcdefghijklmnop")).toMatchObject({ ok: false, error: expect.stringMatching(/Square/) });
    expect(validateSecret("QUICKBOOKS_CLIENT_SECRET", "abc def")).toMatchObject({ ok: false, error: expect.stringMatching(/space/) });
  });
});
