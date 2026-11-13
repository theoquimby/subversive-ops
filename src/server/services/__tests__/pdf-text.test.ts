import { describe, expect, it } from "vitest";
import { simplePdf } from "@/server/demo/final";
import { pdfTextLocal } from "../pdf-text";

describe("pdfTextLocal", () => {
  it("reads text back out of a Flate-compressed PDF", () => {
    const pdf = simplePdf("Meal breaks\nAnyone on a shift longer than six hours gets a 30 minute (unpaid) break.");
    const text = pdfTextLocal(new Uint8Array(pdf));
    expect(text).toContain("Meal breaks");
    expect(text).toContain("30 minute (unpaid) break.");
  });
  it("returns empty for non-PDF bytes", () => {
    expect(pdfTextLocal(new TextEncoder().encode("hello"))).toBe("");
  });
});
