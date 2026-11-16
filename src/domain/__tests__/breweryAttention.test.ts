import { describe, expect, it } from "vitest";
import { breweryAttentionItems } from "../breweryAttention";
import type { BrewSuggestion, TodoItem } from "../tankPlan";

const today = "2026-11-16";
const todo = (over: Partial<TodoItem>): TodoItem => ({ key: "k", kind: "transfer", title: "FV1: transfer Lager", detail: "Due today · day 14 of 14", tone: "warn", on: today, ...over });
const sug = (over: Partial<BrewSuggestion>): BrewSuggestion => ({ beerId: "b", name: "Lager", runOutOn: "2026-12-10", leadDays: 21, brewBy: "2026-11-19", daysToBrewBy: 3, alreadyOut: false, state: "soon", planned: null, ...over });

describe("brewery attention", () => {
  it("is empty when nothing is due", () => {
    expect(breweryAttentionItems({ today, todos: [], suggestions: [] })).toEqual([]);
  });
  it("lists one transfer by tank, several as a count", () => {
    const [one] = breweryAttentionItems({ today, todos: [todo({})], suggestions: [] });
    expect(one).toMatchObject({ key: "brewery.transfer", title: "FV1: transfer Lager", href: "/brewery", tone: "warn" });
    const [many] = breweryAttentionItems({ today, todos: [todo({}), todo({ key: "x", title: "FV2: transfer IPA", tone: "bad", on: "2026-11-12" })], suggestions: [] });
    expect(many).toMatchObject({ title: "2 tanks ready to transfer", tone: "bad" });
  });
  it("keeps only transfers and packaging due today or before", () => {
    expect(breweryAttentionItems({ today, todos: [todo({ on: "2026-11-17" })], suggestions: [] })).toEqual([]);
    const [p] = breweryAttentionItems({ today, todos: [todo({ kind: "package", title: "BT1: package Lager" })], suggestions: [] });
    expect(p.key).toBe("brewery.package");
  });
  it("flags clashes in the next 14 days only", () => {
    const near = todo({ kind: "clash", title: "Two brews in FV1 at once", on: "2026-11-25" });
    const far = todo({ kind: "clash", title: "Two brews in FV2 at once", on: "2026-12-20" });
    const items = breweryAttentionItems({ today, todos: [near, far], suggestions: [] });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ key: "brewery.clash", href: "/brewery/schedule" });
  });
  it("suggests a brew due within a week that isn't planned", () => {
    const items = breweryAttentionItems({ today, todos: [], suggestions: [sug({}), sug({ beerId: "c", name: "Stout", daysToBrewBy: 12, brewBy: "2026-11-28" }), sug({ beerId: "d", name: "IPA", state: "planned", planned: { batchId: "p", code: "26-1", on: "2026-11-18", inTanks: false } })] });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ key: "brewery.suggest", title: "Brew Lager by Thu", href: "/brewery/schedule" });
  });
  it("says when a beer is already too late", () => {
    const [i] = breweryAttentionItems({ today, todos: [], suggestions: [sug({ daysToBrewBy: -2, brewBy: "2026-11-14", state: "late" })] });
    expect(i).toMatchObject({ title: "Brew Lager as soon as you can", tone: "bad" });
  });
});
