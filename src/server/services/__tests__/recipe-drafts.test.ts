import { describe, expect, it, vi } from "vitest";
import type { DraftItem, ExampleRecipe } from "@/domain/recipeDraft";

// Drafting with Claude mocked out: no key, no network, no database.
vi.mock("server-only", () => ({}));
vi.mock("../../db", () => ({ db: {}, num: (d: { toNumber(): number } | number | null) => (d == null ? null : typeof d === "number" ? d : d.toNumber()) }));
vi.mock("../../env", () => ({ env: { BUSINESS_TIMEZONE: "America/New_York" } }));
vi.mock("../../integrations/claude", () => ({
  claudeJSON: vi.fn(),
  claudeReady: vi.fn(async () => false),
  CLAUDE_NOT_SET_UP: "AI features turn on once a Claude key is added in Settings → Connections.",
  fileBlock: () => null,
}));

vi.mock("../square", () => ({ readSettingJSON: vi.fn(async () => null), writeSettingJSON: vi.fn() }));
vi.mock("../square-menu", () => ({ loadSquareMenu: vi.fn() }));
vi.mock("../sales", () => ({ businessToday: () => "2026-11-13", squareCatalogMeta: vi.fn(async () => ({})) }));
vi.mock("../insights", () => ({ targetFoodCost: async () => 0.3 }));
vi.mock("../costing", () => ({ buildContext: vi.fn(), loadCostingSnapshot: vi.fn(), safeCost: vi.fn() }));

const { draftAll } = await import("../recipe-drafts");
const { indexItems } = await import("@/domain/recipeDraft");

const items: DraftItem[] = [
  { key: "i:beef", name: "Ground beef (Kilcoyne)", kind: "ingredient", category: "Meat", baseUnit: "g", conversions: [], units: ["g", "oz", "lb"], costPerBase: 0.0154 },
  { key: "i:bun", name: "Milk bun", kind: "ingredient", category: "Bakery", baseUnit: "each", conversions: [{ unit: "bun", baseQty: 1 }], units: ["each", "bun"], costPerBase: 0.6 },
  { key: "i:bacon", name: "Bacon", kind: "ingredient", category: "Meat", baseUnit: "g", conversions: [{ unit: "slice", baseQty: 20 }], units: ["g", "oz", "slice"], costPerBase: 0.012 },
];
const examples: ExampleRecipe[] = [
  { id: "classic", name: "Classic Burger", kind: "MENU", category: "Burgers", menuPrice: 18, yieldQty: 1, yieldUnit: "each", lines: [{ itemKey: "i:beef", qty: 5.7, unit: "oz" }, { itemKey: "i:bun", qty: 1, unit: "bun" }] },
];
const ctx = { items, examples, ix: indexItems(items, examples), defaultTarget: 0.3 };
const pending = [
  { target: { name: "Bacon Burger", kind: "MENU" as const, category: "Burgers", price: 20, description: "Beef patty, bacon, brioche bun" }, recipeId: null, squareIds: ["SQ1"], source: "Square item" },
  { target: { name: "Wings", kind: "MENU" as const, category: "Wings", price: 13 }, recipeId: "r1", squareIds: [], source: "Empty recipe" },
];

describe("draftAll", () => {
  it("drafts from similar recipes when AI is off, without calling Claude", async () => {
    const json = vi.fn();
    const r = await draftAll(ctx, pending, { ready: async () => false, json: json as never });
    expect(json).not.toHaveBeenCalled();
    expect(r.ai).toBe(false);
    expect(r.drafts[0]).toMatchObject({ method: "similar", basis: ["Classic Burger"], menuPrice: 20, target: { squareIds: ["SQ1"], recipeId: null } });
    expect(r.drafts[0].lines.map((l) => l.itemKey)).toEqual(expect.arrayContaining(["i:beef", "i:bun", "i:bacon"]));
  });

  it("uses Claude's schema-shaped answer when AI is on, sending the ingredient list", async () => {
    const json = vi.fn(async () => ({
      ok: true as const,
      data: {
        drafts: [{
          ref: "T0", name: "Bacon Burger", kind: "MENU" as const, category: "Burgers", yieldQty: 1, yieldUnit: "each", notes: "",
          lines: [
            { item: "Ground beef (Kilcoyne)", isNew: false, qty: 6, unit: "oz", note: "" },
            { item: "Bacon", isNew: false, qty: 3, unit: "slice", note: "" },
            { item: "Brioche bun", isNew: true, qty: 1, unit: "each", note: "Square says brioche" },
          ],
        }],
      },
    }));
    const r = await draftAll(ctx, pending, { ready: async () => true, json: json as never });
    expect(json).toHaveBeenCalledTimes(1);
    const args = (json.mock.calls[0] as unknown as [{ system: string; content: string[] }])[0];
    expect(args.system).toMatch(/- Ground beef \(Kilcoyne\)/);
    expect(args.system).toMatch(/Classic Burger/);
    expect(args.content[0]).toMatch(/ref: T0[\s\S]*description: Beef patty, bacon, brioche bun/);
    expect(r.ai).toBe(true);
    expect(r.drafts[0]).toMatchObject({ method: "ai", name: "Bacon Burger", menuPrice: 20 });
    expect(r.drafts[0].lines).toEqual([
      expect.objectContaining({ itemKey: "i:beef", qty: 6, unit: "oz" }),
      expect.objectContaining({ itemKey: "i:bacon", qty: 3, unit: "slice" }),
      expect.objectContaining({ itemKey: null, newName: "Brioche bun", unit: "each" }),
    ]);
    // Claude said nothing about T1: it keeps its heuristic draft.
    expect(r.drafts[1].method).not.toBe("ai");
  });

  it("falls back to the heuristic and reports the error when Claude fails", async () => {
    const json = vi.fn(async () => ({ ok: false as const, error: "Claude is busy right now. Try again in a minute." }));
    const r = await draftAll(ctx, pending, { ready: async () => true, json: json as never });
    expect(r.aiError).toMatch(/busy/);
    expect(r.drafts[0].method).toBe("similar");
  });
});
