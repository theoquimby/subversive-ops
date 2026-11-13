import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getHelp } from "../content";
import { ITEMS, searchSettings, SECTIONS } from "@/app/(app)/settings/registry";

const appDir = path.join(__dirname, "../../app/(app)");
const settingsDir = path.join(appDir, "settings");
const pageExists = (href: string) => {
  const p = href.split(/[?#]/)[0];
  return existsSync(path.join(appDir, p, "page.tsx"));
};

describe("Settings index", () => {
  it("gives every setting a help entry and a page that exists", () => {
    for (const it of ITEMS) {
      expect(it.help && getHelp(it.help), `${it.id} help ${it.help}`).toBeTruthy();
      expect(pageExists(it.href), `${it.id} → ${it.href}`).toBe(true);
      expect(it.what.length, it.id).toBeLessThan(110);
    }
    for (const s of SECTIONS) for (const p of s.pages) expect(pageExists(p.href), p.href).toBe(true);
  });

  it("has unique ids and every section has settings", () => {
    expect(new Set(ITEMS.map((i) => i.id)).size).toBe(ITEMS.length);
    for (const s of SECTIONS) expect(ITEMS.some((i) => i.section === s.id), s.id).toBe(true);
  });

  it("finds settings by the words people use", () => {
    expect(searchSettings("overtime")[0].id).toBe("pay.overtime");
    expect(searchSettings("rent")[0].id).toBe("money.fixed");
    expect(searchSettings("tuesday").map((i) => i.id)).toContain("business.hours");
    expect(searchSettings("pin")[0].id).toBe("people.logins");
    expect(searchSettings("sales tax")[0].id).toBe("money.tax");
    expect(searchSettings("walk-in").map((i) => i.id)).toContain("food.areas");
    expect(searchSettings("")).toEqual([]);
    expect(searchSettings("zzqq")).toEqual([]);
  });

  it("searches current values too", () => {
    expect(searchSettings("catskill", { "business.weather": "Catskill, NY" }).map((i) => i.id)).toContain("business.weather");
  });

  it("has a help entry for every help zone and tip on the Settings pages", () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d, { withFileTypes: true })) {
        if (f.isDirectory()) walk(path.join(d, f.name));
        else if (f.name.endsWith(".tsx")) files.push(path.join(d, f.name));
      }
    };
    walk(settingsDir);
    const src = files.map((f) => readFileSync(f, "utf8")).join("\n");
    const ids = new Set([...src.matchAll(/(?:id|help)="([a-z]+\.[a-zA-Z.]+)"/g)].map((m) => m[1]));
    expect(ids.size).toBeGreaterThan(15);
    for (const id of ids) expect(getHelp(id), id).toBeDefined();
  });
});
