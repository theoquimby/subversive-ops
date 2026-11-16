import type { HelpEntry } from "../types";

/** Brew day: the stage-by-stage log on a phone, timers, hops, finishing into a fermenter, °Plato, the ABV calculator and the printed brew sheet. */
export const breweryBrewDay: HelpEntry[] = [
  {
    id: "brewery.brewday",
    area: "brewery",
    route: "/brewery/brew",
    title: "Brew day",
    body: "Walk through Mash, Lauter / sparge, Boil, Fermentation and Packaging on a phone: the recipe's targets beside each reading, a timer per stage, the hop additions to tick off, and Finish brew day into a fermenter.",
    article: `### Starting

- From a recipe: **Brew this**.
- From **Brew day** in the brewery: tap **Start brew day** on a planned brew, or pick a recipe (and the fermenter if you know it).
- A recipe that already has a brew day going opens that one, and one planned within a week of today is used rather than making another.

Brew days still going are listed at the top of the Brew day page to carry on.

### Each stage

The tabs along the top are big enough for a wet thumb and stay put while scrolling. A green dot means something is written down there.

- **Mash**: strike and mash temperature, MT gravity, pH, start time (**Now** fills it in) and strike volume, with the grain bill beside.
- **Lauter / sparge**: BK gravity, sparge temperature, pre-boil volume and runoff time.
- **Boil**: boil start, KO gravity, OG and post-boil volume, and the hop additions.
- **Fermentation**: pitch and ferment temperature, the yeast, and **Finish brew day**.
- **Packaging**: final gravity, ½ and ⅙ barrel kegs, cases and CO₂ volumes, and **Mark packaged** once it's all in kegs.

Each reading shows the recipe's target under it and how far off it is: green when close, amber when not. Every stage has notes.

### Timers

Mash, lauter and boil each have a timer. It counts down from the recipe's mash rest or boil length (change the minutes on the timer), or up when there are none. It keeps the time it started, not a running count, so a locked phone or a reload loses nothing.

### Hop additions

The recipe's hops in the order they go in, with amounts for this brew's size. Tap one when it's in; the time is kept. With the boil timer running, boil hops turn amber when they're due.

### Saving, and no signal

Everything saves a moment after you type. With no signal it's kept on the phone and sent when the connection is back, even after a reload; the line at the top says which. If two phones change the same brew day, the later change wins.`,
    related: ["brewery.brewday.finish", "brewery.gravity", "brewery.abv", "brewery.brewsheet", "brewery.recipes.targets"],
    keywords: ["brew day", "brewday", "mash", "lauter", "sparge", "boil", "knock-out", "timer", "hops", "hop additions", "log", "offline", "phone"],
  },
  {
    id: "brewery.brewday.finish",
    area: "brewery",
    route: "/brewery/brew",
    title: "Finishing a brew day",
    body: "On Fermentation, pick the fermenter it went into, check the brew day, volume and OG, and press Finish brew day. The brew moves to fermenting in that tank and what it used comes out of brewing stock.",
    article: `**Finish brew day → into the fermenter** does what **Mark brewed** does on the tanks page:

- The brew moves to **fermenting** in the fermenter you pick (tanks with a brew in them can't be picked), on the brew day you give. If it was planned for another day, the rest of its plan moves by the same number of days.
- The **volume** and **OG** come from the boil readings (post-boil volume, then OG or KO gravity) unless you change them.
- Its ingredient cost is worked out from that day's prices and kept.
- What the recipe used, at this brew's size, comes out of brewing stock.

After that, transfers, gravity readings and packaging are on the tanks page; the brew day stays open for fermentation and packaging notes.`,
    related: ["brewery.brewday", "brewery.tanks"],
    keywords: ["finish", "brewed", "fermenter", "mark brewed", "og", "volume"],
  },
  {
    id: "brewery.gravity",
    area: "brewery",
    route: "/brewery/brew",
    title: "°Plato or SG",
    body: "Gravity is shown and typed in °Plato unless the brewery picks SG with the °P / SG switch. Either can be typed anywhere: 15.5P is Plato, 1.063 is SG.",
    article: `The switch is on the brew day and recipe pages, and applies to the whole brewery.

Gravity is always stored as specific gravity (to 4 decimals), so switching changes how it's shown, never what's kept.

- °P → SG: SG = 1 + P ÷ (258.6 − 0.879 × P), the formula Brew Manager uses. 15.5 °P is 1.063.
- SG → °P: the same formula turned round, so a Plato reading comes back as the same Plato.

Typing: **15.5P** or **15.5 °P** is always Plato, **1.063** (three or four decimals) is always SG, and a plain number is read in the chosen unit. With SG chosen, a number like 12 can only be Plato, so it's read as Plato.`,
    related: ["brewery.brewday", "brewery.abv"],
    keywords: ["plato", "°p", "sg", "specific gravity", "gravity unit", "brix"],
  },
  {
    id: "brewery.abv",
    area: "brewery",
    route: "/brewery/brew",
    title: "ABV calculator",
    body: "OG and FG in °P or SG give the standard ABV, (OG − FG) × 131.25, and the alternate, (76.08 × (OG − FG) ÷ (1.775 − OG)) × (FG ÷ 0.794), as Brew Manager shows them.",
    article: `Tap **ABV** on the brew day, the brew days list or a recipe. It starts with the brew's or recipe's numbers where there are some.

Plato is turned into SG first; both formulas use SG. The alternate is closer for strong beers; for most beers the two are within a few tenths.`,
    related: ["brewery.gravity"],
    keywords: ["abv", "alcohol", "calculator", "131.25", "alternate"],
  },
  {
    id: "brewery.brewsheet",
    area: "brewery",
    route: "/brewery/brew",
    title: "Brew sheet",
    body: "One printed page per brew for the clipboard: the recipe's targets, grain, hops and yeast for this brew's size, what's been written down so far, and blank lines for the rest.",
    article: `**Brew sheet** on the brew day opens it ready to print (at 100%, no headers or footers). It has:

- The batch: brew day, tanks, volume, style, OG and FG against their targets, ABV, yeast and timing.
- The targets: strike, mash, MT, BK, KO, OG and FG.
- Grain and other additions, yeast, and the hops with a box to tick and a line for the time each went in.
- Every brew-day reading by stage, with a blank line for each one not taken yet.
- The gravity log so far, with empty rows for more, and notes.`,
    related: ["brewery.brewday"],
    keywords: ["print", "brew sheet", "batch sheet", "clipboard", "paper"],
  },
];
