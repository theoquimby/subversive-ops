import "server-only";
import { cache } from "react";
import { db } from "../db";
import { buildChecklist, historyFact, menuLinksFact, pricesFact, recipesFact, type SetupChecklist, type SetupFacts } from "@/domain/setupChecklist";
import { isSecretName } from "@/domain/secretFormats";
import { getSecret } from "./secrets";
import { isSquareConnected } from "./square";
import { getBackfill } from "./square-sync";
import { isQuickBooksConnected } from "./quickbooks";
import { loadCutoffRules } from "./planning";
import { AREAS_KEY } from "./inventory";
import { MORNING_HOUR_KEY } from "./morningBrief";
import { hasAppRoute } from "./whatsNew";

/**
 * The setup checklist (Overview "Finish setting up" card and /welcome/checklist),
 * each item ticked off from what's really there. Never throws: a check that
 * fails just shows as not done yet.
 */

const quiet = <T,>(p: Promise<T>, fallback: T) => p.catch(() => fallback);

async function secretSet(name: string) {
  if (!isSecretName(name)) return false;
  return !!(await quiet(getSecret(name), null));
}

export const setupChecklist = cache(async (): Promise<SetupChecklist> => {
  const [square, backfill, firstSale, mappings, linked, suppliers, rules, settings, staff, prep, beers, ai, qbo, website, recipeIngredients, documents, recipes, kegs] = await Promise.all([
    quiet(isSquareConnected(), false),
    quiet(getBackfill(), null),
    db.dailySale.aggregate({ _min: { date: true } }),
    db.squareMapping.count({ where: { ignored: false } }),
    db.squareMapping.count({ where: { ignored: false, recipeId: { not: null } } }),
    db.supplier.findMany({ where: { active: true }, select: { id: true, deliveryDays: true } }),
    quiet(loadCutoffRules(), {}),
    db.setting.findMany({ where: { key: { in: [AREAS_KEY, MORNING_HOUR_KEY, "taps.board", "google.connection"] } }, select: { key: true, value: true } }),
    db.user.count({ where: { active: true, role: "STAFF" } }),
    db.prepSetting.count(),
    db.beer.count(),
    secretSet("ANTHROPIC_API_KEY"),
    quiet(isQuickBooksConnected(), false),
    secretSet("WEBSITE_URL"),
    // Ingredients active recipes use, and whether each has a price from any supplier.
    db.ingredient.findMany({
      where: { active: true, recipeLines: { some: { recipe: { active: true } } } },
      select: { products: { where: { active: true, prices: { some: {} } }, select: { id: true }, take: 1 } },
    }),
    Promise.all([db.invoice.count(), db.priceImport.count()]).then(([a, b]) => a + b),
    db.recipe.count({ where: { active: true, lines: { some: {} } } }),
    db.keg.count(),
  ]);
  const has = (k: string) => settings.some((s) => s.key === k);
  const areas = (() => {
    try {
      const v = JSON.parse(settings.find((s) => s.key === AREAS_KEY)?.value ?? "[]");
      return Array.isArray(v) ? v.length : 0;
    } catch {
      return 0;
    }
  })();
  const withDays = suppliers.filter((s) => s.deliveryDays.length > 0).length;
  const withRules = suppliers.filter((s) => rules[s.id]).length;

  const facts: SetupFacts = {
    square: { done: square },
    history: historyFact(!!backfill?.finishedAt, firstSale._min.date ? Math.floor((Date.now() - firstSale._min.date.getTime()) / 86_400_000) : 0),
    menuLinks: menuLinksFact(linked, mappings),
    suppliers: {
      done: suppliers.length > 0 && withDays === suppliers.length && withRules > 0,
      detail: suppliers.length ? `${withDays} of ${suppliers.length} with delivery days${withRules ? `, ${withRules} with deadlines` : ""}` : undefined,
    },
    prices: pricesFact({ usedInRecipes: recipeIngredients.length, priced: recipeIngredients.filter((i) => i.products.length > 0).length, documents }),
    recipes: recipesFact(recipes),
    kegs: { done: kegs > 0, detail: kegs ? `${kegs} ${kegs === 1 ? "keg" : "kegs"}` : undefined },
    areas: { done: areas > 0, detail: areas ? `${areas} areas` : undefined },
    team: { done: staff > 0, detail: staff ? `${staff} staff ${staff === 1 ? "login" : "logins"}` : undefined },
    morning: { done: has(MORNING_HOUR_KEY) },
    prep: { done: prep > 0, detail: prep ? `${prep} items set up` : undefined },
    beers: { done: beers > 0 && has("taps.board"), detail: beers ? `${beers} ${beers === 1 ? "beer" : "beers"}${has("taps.board") ? ", TV link made" : ""}` : undefined },
    ai: { done: ai },
    quickbooks: { done: qbo },
    website: { done: website },
    google: { done: has("google.connection") },
  };
  return buildChecklist(facts, hasAppRoute);
});
