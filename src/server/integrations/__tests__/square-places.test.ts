import { beforeEach, describe, expect, it, vi } from "vitest";

// Square is tested with fetch stubbed out: no network, no keys, no database.
vi.mock("server-only", () => ({}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const { placeCheck } = await import("../square-payments");
const { SQUARE_SCOPES } = await import("../square-auth");

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
// Not a real credential: built from parts so scanners don't flag it.
const client = { accessToken: ["test", "token"].join("-"), environment: "sandbox" as const, locationIds: ["L1"] };

const payments = {
  payments: [
    { status: "COMPLETED", customer_id: "c1", card_details: { entry_method: "CONTACTLESS" } },
    { status: "COMPLETED", customer_id: "c1", card_details: { entry_method: "CONTACTLESS" } },
    { status: "COMPLETED", customer_id: "c2", card_details: { entry_method: "EMV" } },
    { status: "COMPLETED", card_details: { entry_method: "KEYED", card: { billing_address: { postal_code: "07030-1234" } } } },
    { status: "COMPLETED" },
    { status: "FAILED", customer_id: "c9", card_details: { entry_method: "EMV" } },
  ],
};

describe("the place check", () => {
  beforeEach(() => fetchMock.mockReset());

  it("asks Square for the Customers permission when connecting", () => {
    expect(SQUARE_SCOPES).toContain("CUSTOMERS_READ");
    // Read-only, all of it.
    expect(SQUARE_SCOPES.every((s) => s.endsWith("_READ"))).toBe(true);
  });

  it("counts postal codes on the payments and on the profiles behind them", async () => {
    fetchMock.mockResolvedValueOnce(ok(payments)).mockResolvedValueOnce(
      ok({
        responses: {
          c1: { customer: { id: "c1", given_name: "Not", family_name: "Read", address: { address_line_1: "1 Main St", postal_code: "12414" }, creation_source: "LOYALTY" } },
          c2: { errors: [{ code: "NOT_FOUND", category: "INVALID_REQUEST_ERROR" }] },
        },
      }),
    );
    const c = await placeCheck(client, "2026-11-01T00:00:00Z", "2026-11-20T00:00:00Z");
    expect(c.payments).toBe(5);
    expect(c.withPostal).toBe(1);
    expect(c.withCustomer).toBe(3);
    expect(c.profiles).toMatchObject({ denied: false, customers: 2, found: 1, withPostal: 1, paymentsWithProfilePostal: 2, placed: 3, distinctPostal: 2 });
    if (c.profiles.denied) throw new Error("unreachable");
    expect(c.profiles.areas).toEqual([
      { area: "070", people: 1 },
      { area: "124", people: 1 },
    ]);
    expect(c.profiles.bySource).toEqual([{ source: "LOYALTY", customers: 1, withPostal: 1 }]);
    // Nothing but counts and three-digit areas comes back: no name, no street, no whole code, no profile id.
    const json = JSON.stringify(c);
    for (const secret of ["Not", "Read", "Main St", "12414", "07030", "c1", "c2"]) expect(json).not.toContain(secret);

    // The profiles are asked for by id, each once, in one call.
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(new URL(url).pathname).toBe("/v2/customers/bulk-retrieve");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ customer_ids: ["c1", "c2"] });
  });

  it("says so when the connection hasn't been given the Customers permission", async () => {
    fetchMock
      .mockResolvedValueOnce(ok(payments))
      .mockResolvedValueOnce(new Response(JSON.stringify({ errors: [{ category: "AUTHENTICATION_ERROR", code: "INSUFFICIENT_SCOPES", detail: "The merchant has not given your application sufficient permissions to do that." }] }), { status: 403 }));
    const c = await placeCheck(client, "2026-11-01T00:00:00Z", "2026-11-20T00:00:00Z");
    expect(c.payments).toBe(5);
    expect(c.profiles).toEqual({ denied: true });
  });

  it("makes no profile call when no payment is tied to one", async () => {
    fetchMock.mockResolvedValueOnce(ok({ payments: [{ status: "COMPLETED" }] }));
    const c = await placeCheck(client, "2026-11-01T00:00:00Z", "2026-11-20T00:00:00Z");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(c.profiles).toMatchObject({ denied: false, customers: 0 });
  });
});
