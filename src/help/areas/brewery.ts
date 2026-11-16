import type { HelpEntry } from "../types";

/** Brewery: tanks, the tank schedule, brewing recipes with live costs, brews and setup. */
export const brewery: HelpEntry[] = [
  {
    id: "brewery.tanks",
    area: "brewery",
    route: "/brewery",
    title: "Tanks",
    body: "What is in each fermenter and brite tank right now, how long it has been there, and what needs doing next.",
    keywords: ["brewery", "tank", "fermenter", "brite", "floor", "cellar"],
  },
  {
    id: "brewery.schedule",
    area: "brewery",
    route: "/brewery/schedule",
    title: "Tank schedule",
    body: "Every tank over the coming weeks: what is planned where, when each brew moves to a brite tank, and when it is packaged.",
    keywords: ["schedule", "rotation", "plan", "tank", "calendar", "brew day"],
  },
  {
    id: "brewery.recipes",
    area: "brewery",
    route: "/brewery/recipes",
    title: "Brewing recipes",
    body: "Every brewing recipe with its gravity, bitterness, colour and cost worked out live from ingredient prices.",
    keywords: ["recipe", "grain", "malt", "hops", "yeast", "cost", "ibu", "abv", "srm"],
  },
  {
    id: "brewery.batches",
    area: "brewery",
    route: "/brewery/batches",
    title: "Brews",
    body: "Every brew, planned or done: when it was brewed, where it sat, what it cost and the kegs it filled.",
    keywords: ["batch", "brew", "brew log", "history", "packaged"],
  },
  {
    id: "brewery.setup",
    area: "brewery",
    route: "/brewery/setup",
    title: "Brewery setup",
    body: "The tanks in the brewery, their sizes, and the usual days a beer spends fermenting and conditioning.",
    keywords: ["tanks", "setup", "fermenter", "brite", "capacity"],
  },
  {
    id: "brewery.import",
    area: "brewery",
    route: "/brewery/import",
    title: "Import brewing data",
    body: "Bring in recipes and brews from the Brew Manager app: press Export backup JSON there, then upload the file here.",
    keywords: ["import", "brew manager", "backup", "json"],
  },
];
