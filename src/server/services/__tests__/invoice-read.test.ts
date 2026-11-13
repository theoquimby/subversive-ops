import { beforeEach, describe, expect, it, vi } from "vitest";

// The reader is tested with Claude mocked out: no key, no network, no database.
vi.mock("server-only", () => ({}));
vi.mock("../../db", () => ({ db: {}, num: (d: { toNumber(): number } | number | null) => (d == null ? null : typeof d === "number" ? d : d.toNumber()) }));
vi.mock("../../env", () => ({ env: { BUSINESS_TIMEZONE: "America/New_York" } }));
vi.mock("../../integrations/claude", () => ({
  claudeJSON: vi.fn(),
  claudeReady: vi.fn(async () => false),
  fileBlock: (bytes: Uint8Array, type: string) =>
    type === "application/pdf" ? { type: "document", bytes: bytes.length } : type.startsWith("image/") ? { type: "image", bytes: bytes.length } : null,
}));

const { extractInvoice } = await import("../invoices");
const { STUB_INVOICE } = await import("../invoiceStub");

const page = (type = "image/jpeg") => ({ bytes: new Uint8Array([1, 2, 3]), type });

describe("extractInvoice (Claude mocked)", () => {
  beforeEach(() => {
    delete process.env.INVOICE_READER_STUB;
  });

  it("sends every page in one request, in order, with a page label each", async () => {
    const json = vi.fn(async () => ({ ok: true as const, data: STUB_INVOICE }));
    const r = await extractInvoice([page(), page(), page()], "invoice", { json: json as never });
    expect(r.ok).toBe(true);
    expect(json).toHaveBeenCalledTimes(1);
    const content = (json.mock.calls[0] as unknown as [{ content: unknown[] }])[0].content;
    expect(content.filter((c) => typeof c === "object")).toHaveLength(3);
    expect(content).toContain("Page 2 of 3:");
    expect(String(content.at(-1))).toMatch(/supplier invoice.*all 3 pages/);
  });

  it("tells Claude when it's a store receipt", async () => {
    const json = vi.fn(async () => ({ ok: true as const, data: STUB_INVOICE }));
    await extractInvoice([page()], "receipt", { json: json as never });
    const content = (json.mock.calls[0] as unknown as [{ content: unknown[] }])[0].content;
    expect(String(content.at(-1))).toMatch(/store receipt/);
    expect(content).not.toContain("Page 1 of 1:");
  });

  it("passes Claude's calm error through", async () => {
    const json = vi.fn(async () => ({ ok: false as const, error: "Claude is busy right now. Try again in a minute." }));
    expect(await extractInvoice([page("application/pdf")], "auto", { json: json as never })).toEqual({ ok: false, error: "Claude is busy right now. Try again in a minute." });
  });

  it("refuses files that aren't photos or PDFs, and empty sets", async () => {
    const json = vi.fn();
    expect(await extractInvoice([page("text/plain")], "auto", { json: json as never })).toMatchObject({ ok: false });
    expect(await extractInvoice([], "auto", { json: json as never })).toMatchObject({ ok: false });
    expect(json).not.toHaveBeenCalled();
  });

  it("uses the sample reader when INVOICE_READER_STUB is set (dev only)", async () => {
    process.env.INVOICE_READER_STUB = "receipt";
    const r = await extractInvoice([page()], "auto");
    expect(r.ok && r.data.documentType).toBe("receipt");
  });
});
