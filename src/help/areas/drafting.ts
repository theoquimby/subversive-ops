import type { HelpEntry } from "../types";

// ---- Recipe drafts (/menu/drafts) ----------------------------------------------------

export const drafting: HelpEntry[] = [
  {
    id: "menu.drafts",
    area: "menu",
    route: "/menu/drafts",
    title: "Recipe drafts",
    body: "Suggested ingredient lines for dishes that aren't costed yet, with an estimated plate cost and food cost %. Nothing is saved until you accept a draft. Edit any line first, or discard it.",
    article: `Drafts get every Square item costed without typing each recipe from scratch.

### Where drafts come from
- **Menu from Square**: tick items, then **Draft recipes**. Or open one item and press **Draft recipe**.
- **Menu costs**: tick recipes with no ingredients, then **Draft ingredients**. Or open an empty recipe.
- **A photo** of a recipe card or brewing sheet (needs AI features).
- **Pasted text**: a recipe from Notes or an email, one ingredient per line.

### How a draft is made
Without AI, a draft copies your most similar recipe. A new burger starts from Classic Burger, then the lines change for the words in the name ("bacon" adds bacon, "Impossible" swaps the patty). With AI features on, Claude also reads the Square description and uses only ingredients you buy.

### Reviewing
Each card shows plate cost, food cost % against your target, and the price. Change an ingredient, amount or unit, remove a line or type a new one. **Accept** saves it as a recipe and links the Square items. **Accept all** saves every draft as it is.

Lines marked **New ingredient** add an ingredient with no price yet. Link a supplier product on the ingredient to price it.`,
    related: ["menu.drafts.intake", "menu.drafts.review", "menu.drafts.beer", "menu.editor", "sales.squareMenu"],
    keywords: ["draft", "suggest recipe", "ai recipe", "recipe card", "photo", "auto cost", "copy recipe"],
  },
  {
    id: "menu.drafts.intake",
    area: "menu",
    route: "/menu/drafts",
    title: "From a photo or your notes",
    body: "Snap a recipe card, binder page or brewing sheet (several pages are fine), or paste a recipe as text, one ingredient per line. Lines like \"Yield: 2 qt\", \"Serves 4\" or \"Batch size: 7 bbl\" are understood. Photos need AI features turned on.",
    related: ["menu.drafts", "menu.drafts.beer"],
    keywords: ["photo", "camera", "paste", "notes", "recipe card", "binder"],
  },
  {
    id: "menu.drafts.review",
    area: "menu",
    route: "/menu/drafts",
    title: "Reviewing a draft",
    body: "Check the lines, amounts and units. The cost updates as you change them. The grey note under a line says why it's there (e.g. \"in place of American cheese\"). Accept saves the recipe; Discard throws the draft away.",
    related: ["menu.drafts", "menu.editor.summary", "menu.editor.units"],
    keywords: ["accept", "discard", "edit draft"],
  },
  {
    id: "menu.drafts.beer",
    area: "menu",
    route: "/menu/drafts",
    title: "Beer recipes",
    body: "Brewing sheets become prep recipes with the batch size as the yield in bbl or hl: grain in lb, hops in oz or g, yeast in packs. Malts and hops you don't buy yet are added as new ingredients. Price them to get the cost per pint.",
    related: ["menu.drafts.intake", "menu.editor.yield", "menu.draftBeer"],
    keywords: ["beer", "brew", "batch", "barrel", "bbl", "hops", "malt", "grain bill", "zane"],
  },
  {
    id: "menu.drafts.start",
    area: "menu",
    route: "/menu",
    title: "Draft ingredients",
    body: "This recipe has no ingredients yet. Draft them from your most similar recipe (or with Claude when AI is on), or read them from a photo or your notes. You review the draft before anything is saved.",
    related: ["menu.drafts", "menu.drafts.intake"],
    keywords: ["empty recipe", "no ingredients"],
  },
];
