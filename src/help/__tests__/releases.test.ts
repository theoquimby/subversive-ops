import { describe, expect, it } from "vitest";
import { groupByRelease, RELEASES } from "../releases";
import { WHATS_NEW } from "../whatsNew";

describe("release notes", () => {
  it("every What's new card is in exactly one release", () => {
    for (const e of WHATS_NEW) expect(RELEASES.filter((r) => r.entries.includes(e.id)).length, e.id).toBe(1);
  });
  it("every release lists real cards and has at least one (so it pops up)", () => {
    const ids = new Set(WHATS_NEW.map((e) => e.id));
    for (const r of RELEASES) {
      expect(r.entries.length, r.version).toBeGreaterThan(0);
      for (const id of r.entries) expect(ids.has(id), `${r.version}: ${id}`).toBe(true);
    }
  });
  it("versions are unique and newest first", () => {
    const v = RELEASES.map((r) => r.version);
    expect(new Set(v).size).toBe(v.length);
    const num = (s: string) => s.split(".").map(Number).reduce((a, n) => a * 1000 + n, 0);
    for (let i = 1; i < v.length; i++) expect(num(v[i - 1])).toBeGreaterThan(num(v[i]));
    for (let i = 1; i < RELEASES.length; i++) expect(RELEASES[i - 1].date >= RELEASES[i].date).toBe(true);
  });
  it("groups cards by release in release order", () => {
    const g = groupByRelease(WHATS_NEW);
    expect(g[0].release?.version).toBe(RELEASES[0].version);
    expect(g.reduce((s, x) => s + x.items.length, 0)).toBe(WHATS_NEW.length);
  });
});
