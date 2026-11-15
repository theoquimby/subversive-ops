import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { canFollowHelpLink, getHelp } from "../content";
import { getTour } from "../tours";
import { groupByDate, showMeHref, unseenEntries, WHATS_NEW, whatsNewFor } from "../whatsNew";

const APP = path.resolve(__dirname, "../../app/(app)");

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// Every page route, as a matcher (dynamic segments match anything).
const routes = walk(APP)
  .filter((f) => f.endsWith(`${path.sep}page.tsx`))
  .map((f) => "/" + path.relative(APP, path.dirname(f)).split(path.sep).join("/"))
  .map((r) => (r === "/." ? "/" : r))
  .map((r) => new RegExp(`^${r.replace(/\[[^\]]+\]/g, "[^/]+")}$`));
const isRoute = (href: string) => routes.some((re) => re.test(new URL(href, "http://x").pathname));
const pageExists = (route: string) => isRoute(route);

describe("what's new", () => {
  it("has unique ids and real dates", () => {
    expect(new Set(WHATS_NEW.map((e) => e.id)).size).toBe(WHATS_NEW.length);
    for (const e of WHATS_NEW) {
      expect(e.date, e.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(e.date)), e.id).toBe(false);
      expect(e.title.length, e.id).toBeLessThan(45);
      expect(e.line.length, e.id).toBeLessThan(110);
    }
  });

  it("links every entry to a real page (features still landing only while their page exists)", () => {
    for (const e of WHATS_NEW) {
      if (e.requiresRoute && !pageExists(e.requiresRoute)) continue;
      expect(isRoute(e.href), `${e.id} → ${e.href}`).toBe(true);
      if (e.requiresRoute) expect(isRoute(e.requiresRoute), e.id).toBe(true);
    }
  });

  it("only names tours and help entries that exist", () => {
    for (const e of WHATS_NEW) {
      if (e.requiresRoute && !pageExists(e.requiresRoute)) continue;
      if (e.tour) expect(getTour(e.tour), `${e.id} → tour ${e.tour}`).toBeDefined();
      if (e.help) expect(getHelp(e.help), `${e.id} → help ${e.help}`).toBeDefined();
      if (e.href.startsWith("/help/") && e.href !== "/help/releases") expect(getHelp(e.href.slice(6)), e.id).toBeDefined();
    }
  });

  it("gives staff only things they can open, with tours they may take", () => {
    const staff = whatsNewFor("STAFF", pageExists);
    expect(staff.length).toBeGreaterThan(0);
    for (const e of staff) {
      expect(e.audience, e.id).not.toBe("manager");
      expect(canFollowHelpLink(e.href, "STAFF"), `${e.id} → ${e.href}`).toBe(true);
      if (e.tour) expect(getTour(e.tour)?.audience, `${e.id} → tour ${e.tour}`).toBe("all");
      if (e.help) expect(canFollowHelpLink(`/help/${e.help}`, "STAFF"), `${e.id} → help ${e.help}`).toBe(true);
    }
    expect(whatsNewFor("MANAGER").some((e) => e.audience === "staff")).toBe(false);
  });

  it("hides entries whose page hasn't landed", () => {
    const withAll = whatsNewFor("MANAGER", () => true).length;
    const without = whatsNewFor("MANAGER", () => false).length;
    expect(without).toBe(withAll - WHATS_NEW.filter((e) => e.requiresRoute && e.audience !== "staff").length);
  });

  it("lists newest first and groups by date", () => {
    const list = whatsNewFor("MANAGER");
    for (let i = 1; i < list.length; i++) expect(list[i - 1].date >= list[i].date).toBe(true);
    const groups = groupByDate(list);
    expect(groups.map(([d]) => d)).toEqual([...new Set(list.map((e) => e.date))]);
  });

  it("knows what's new to someone", () => {
    const list = whatsNewFor("MANAGER");
    expect(unseenEntries(list, null, "2000-01-01")).toHaveLength(list.length);
    expect(unseenEntries(list, { ids: list.map((e) => e.id), at: "" }, "2000-01-01")).toHaveLength(0);
    // Someone who joined after everything shipped isn't told it's new.
    expect(unseenEntries(list, null, "2999-01-01")).toHaveLength(0);
  });

  it("adds the tour to Show me links", () => {
    expect(showMeHref({ href: "/ordering", tour: "ordering" })).toBe("/ordering?tour=ordering");
    expect(showMeHref({ href: "/ordering?tab=orders", tour: "ordering" })).toBe("/ordering?tab=orders&tour=ordering");
    expect(showMeHref({ href: "/settings#x" })).toBe("/settings#x");
  });
});

describe("setup checklist links", () => {
  it("sends every Do it to a real page", async () => {
    const { SETUP_ITEMS } = await import("@/domain/setupChecklist");
    for (const i of SETUP_ITEMS) {
      if (i.requiresRoute && !pageExists(i.requiresRoute)) continue;
      expect(isRoute(i.href), `${i.id} → ${i.href}`).toBe(true);
    }
  });
});
