import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HELP, getHelp } from "../content";
import { TOURS, tourForPath } from "../tours";

const APP = path.resolve(__dirname, "../../app/(app)");
const SRC = path.resolve(__dirname, "../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const pages = walk(APP).filter((f) => f.endsWith(`${path.sep}page.tsx`));
const routeOf = (f: string) => "/" + path.relative(APP, path.dirname(f)).split(path.sep).join("/");
const sources = walk(SRC).filter((f) => f.endsWith(".tsx") && !f.includes("__tests__"));
const allSource = sources.map((f) => readFileSync(f, "utf8")).join("\n");

// Pages with nothing to explain on their own: the help center itself, setup, a scanned keg's landing page, an email preview,
// and old addresses that only redirect (Connect Google moved to Settings → Connections → Google).
const NO_HELP = new Set(["/help", "/help/[id]", "/welcome", "/kegs/k/[code]", "/settings/notifications/preview/[template]", "/website/analytics/google"]);
const norm = (r: string) => (r === "/." ? "/" : r);

describe("every page has help", () => {
  it("has a help entry for its route or a help id on its header", () => {
    const routes = new Set(HELP.map((e) => e.route).filter(Boolean));
    const missing: string[] = [];
    for (const f of pages) {
      const route = norm(routeOf(f));
      if (NO_HELP.has(route)) continue;
      const src = readFileSync(f, "utf8");
      const headerHelp = [...src.matchAll(/\bhelp="([^"]+)"/g)].map((m) => m[1]);
      if (!routes.has(route) && headerHelp.length === 0) missing.push(route);
      for (const id of headerHelp) expect(getHelp(id), `${route} → ${id}`).toBeDefined();
    }
    expect(missing).toEqual([]);
  });

  it("only uses help ids that exist", () => {
    const ids = new Set<string>();
    for (const m of allSource.matchAll(/<Help(?:Tip|Zone)\b[^>]*?\bid="([^"]+)"/g)) ids.add(m[1]);
    for (const m of allSource.matchAll(/<(?:PageHeader|DataTable|CardTitle)\b[^>]*?\bhelp="([^"]+)"/g)) ids.add(m[1]);
    const unknown = [...ids].filter((id) => !getHelp(id));
    expect(unknown).toEqual([]);
  });

  it("points every tour step at something on a page", () => {
    const targets = new Set<string>();
    for (const m of allSource.matchAll(/\b(?:data-tour|tour)="([^"]+)"/g)) targets.add(m[1]);
    for (const m of allSource.matchAll(/data-tour=\{[^}]*?"([^"]+)"[^}]*\}/g)) targets.add(m[1]);
    for (const m of allSource.matchAll(/tours=\{\{([^}]+)\}\}/g)) for (const t of m[1].matchAll(/"([^"]+)"/g)) targets.add(t[1]);
    const missing: string[] = [];
    for (const t of TOURS) for (const s of t.steps) if (s.target && !s.target.includes("${") && !targets.has(s.target) && !s.target.startsWith("connections.")) missing.push(`${t.id}: ${s.target}`);
    expect(missing).toEqual([]);
  });

  it("offers each manager tour on its own page", () => {
    for (const t of TOURS) {
      const route = t.steps[0].route;
      if (!route) continue;
      expect(tourForPath(route)?.id, `${t.id} on ${route}`).toBe(t.id);
    }
  });
});
