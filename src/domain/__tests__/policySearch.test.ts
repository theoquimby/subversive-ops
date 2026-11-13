import { describe, expect, it } from "vitest";
import { chunkText, searchPolicies, stem, terms } from "../policySearch";
import { decodePdfString, textFromContentStream } from "../pdfText";

const handbook = {
  id: "h",
  title: "Staff handbook",
  text: `Welcome to Subversive.

Meal breaks. Anyone working a shift longer than six hours gets an unpaid 30 minute meal break. Tell the shift lead before you take it.

Shift swaps. You can offer a shift on My shifts. A swap is final once a manager approves it.

Dress code. Closed-toe non-slip shoes in the kitchen at all times.`,
};
const sick = { id: "s", title: "Paid sick leave policy", text: "You earn 1 hour of paid sick leave for every 30 hours worked, up to 40 hours a year. Request sick time on My shifts." };

describe("policy search", () => {
  it("stems and drops stop words", () => {
    expect(stem("breaks")).toBe("break");
    expect(stem("requesting")).toBe("request");
    expect(terms("How do I get a meal break?")).toEqual(["meal", "break"]);
  });

  it("chunks long text on paragraph boundaries", () => {
    const chunks = chunkText(handbook.text, 120);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((c) => c.length <= 240)).toBe(true);
  });

  it("finds the passage that answers the question", () => {
    const r = searchPolicies([handbook, sick], "when do I get a meal break?");
    expect(r[0].title).toBe("Staff handbook");
    expect(r[0].snippet).toMatch(/meal break/i);
  });

  it("ranks the sick policy for sick questions", () => {
    expect(searchPolicies([handbook, sick], "how many sick hours do I earn")[0].docId).toBe("s");
  });

  it("returns nothing rather than guessing", () => {
    expect(searchPolicies([handbook, sick], "parking garage validation")).toEqual([]);
    expect(searchPolicies([handbook], "   ")).toEqual([]);
  });
});

describe("pdf text", () => {
  it("decodes escapes", () => {
    expect(decodePdfString("a\\(b\\) \\101\\n")).toBe("a(b) A\n");
  });

  it("pulls text from Tj and TJ with line breaks", () => {
    const s = "BT /F1 12 Tf 72 720 Td (Meal breaks) Tj 0 -14 Td [(Thirty ) -250 (minutes)] TJ ET BT <48656C6C6F> Tj ET";
    expect(textFromContentStream(s)).toBe("Meal breaks\nThirty minutes\nHello");
  });
});
