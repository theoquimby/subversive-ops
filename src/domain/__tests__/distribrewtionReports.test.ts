import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseConsumedVolume } from "../distribrewtionReports";
import { detectEntity, planKegImport } from "../kegImport";

const fx = (f: string) => readFileSync(join(__dirname, "fixtures", f), "utf8");

describe("Distribrewtion Consumed Volume reports", () => {
  it("reads beers with lifetime barrels, leaving out Unknown", () => {
    const r = parseConsumedVolume(fx("distribrewtion-by-beverage.csv"), "Consumed_Volume_by_Beverage.csv")!;
    expect(r.info.kind).toBe("beverage");
    expect(r.info.from).toBe("October 1, 2019");
    const recs = r.sources[0].records;
    expect(recs.length).toBe(51);
    expect(recs.find((x) => x.Name === "New York Nectar")?.["Barrels sold (Distribrewtion)"]).toBe(103.44);
    expect(recs.some((x) => x.Name === "Unknown")).toBe(false);
    expect(detectEntity(r.sources[0]).entity).toBe("beers");
  });

  it("reads buyers as accounts with their top beers, skipping buckets", () => {
    const r = parseConsumedVolume(fx("distribrewtion-by-buyer.csv"), "Consumed_Volume_by_Buyer.csv")!;
    const recs = r.sources[0].records;
    const names = recs.map((x) => x.Name);
    expect(names).toContain("Rose Hill Farm");
    expect(names).not.toContain("All Buyers");
    expect(names).not.toContain("Unknown");
    expect(names).not.toContain("Sold Wholesale Kegs");
    const rose = recs.find((x) => x.Name === "Rose Hill Farm")!;
    expect(String(rose.Notes)).toContain("Tiny Glasses 11.33");
    expect(recs.find((x) => x.Name === "Subversive Malting + Brewing")?.Type).toBe("Taproom");
    expect(detectEntity(r.sources[0]).entity).toBe("accounts");
  });

  it("keeps the totals as a summary the import skips", () => {
    const r = parseConsumedVolume(fx("distribrewtion-totals.csv"), "Totals.csv")!;
    expect(r.info.kind).toBe("totals");
    expect(r.sources[0].records.find((x) => x.Channel === "Taproom")?.Barrels).toBe(164.41);
    expect(detectEntity(r.sources[0]).entity).toBe("skip");
  });

  it("ignores ordinary CSVs", () => {
    expect(parseConsumedVolume("Name,Style\nIPA,IPA\n", "beers.csv")).toBeNull();
  });

  it("plans beers and accounts from the reports", () => {
    const b = parseConsumedVolume(fx("distribrewtion-by-beverage.csv"), "b.csv")!.sources[0];
    const a = parseConsumedVolume(fx("distribrewtion-by-buyer.csv"), "a.csv")!.sources[0];
    const plan = planKegImport([b, a].map((s) => ({ source: s, ...detectEntity(s) })) as never);
    expect(plan.beers.length).toBeGreaterThanOrEqual(51);
    expect(plan.accounts.length).toBeGreaterThan(10);
  });
});
