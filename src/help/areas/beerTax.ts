import type { HelpEntry } from "../types";

/** Beer tax: /beer-tax — the removals worksheet and the returns it feeds. */
export const beerTax: HelpEntry[] = [
  {
    id: "beertax.page",
    area: "beertax",
    route: "/beer-tax",
    tour: "beertax",
    title: "Beer tax",
    body: "How much of your own beer left the brewery in a period, from the keg history, and the federal and New York tax on it — with each return's due date.",
    article: `Open it from **Numbers → Beer tax**.

**Where the numbers come from**

- **Kegs tapped in the taproom** — every keg of a house beer scanned as tapped.
- **Kegs sent to accounts** — every keg of a house beer scanned out to a bar, restaurant or distributor.
- **Not in a keg** — gallons you type in: cans or crowlers filled from the tank and sold, beer returned to the brewery, beer dumped.
- **Guest beers never count.** Their brewery paid the tax.

Growlers and crowlers filled from a taproom keg are already counted when that keg was tapped, so don't type them in again.

**The returns**

- **Federal excise** (TTB F 5000.24): taxable barrels × the rate. Small brewers usually file quarterly, or yearly when the tax is under $1,000.
- **Brewer's report of operations** (TTB F 5130.9 or 5130.26): what you brewed, packaged and removed.
- **New York beer tax** (MT-40): taxable gallons × the rate, less the small brewer credit on the first 500,000 gallons a year — often $0, but the return is still due.

Mark each return **filed** once it's in. Until then, one that's due within 10 days or late shows on the Overview and in the morning brief.

This is a worksheet, not tax advice: confirm the rates, how often you file and the due dates with your accountant, and change them under **Rates and due dates**.`,
    related: ["beertax.returns", "beertax.worksheet", "beertax.adjustments", "beertax.settings"],
    keywords: ["excise", "ttb", "brewer's report", "brop", "5130", "5000.24", "mt-40", "tax", "barrels", "removals", "federal", "new york", "nys"],
  },
  { id: "beertax.disclaimer", area: "beertax", route: "/beer-tax", title: "Not tax advice", body: "The rates and due dates are the usual ones for a small brewery. Confirm them with your accountant and change them under Rates and due dates.", related: ["beertax.settings"] },
  { id: "beertax.returns", area: "beertax", route: "/beer-tax", title: "Returns", body: "Each return's last finished period, when it's due and whether it's filed. Mark filed records the date and what you paid.", related: ["beertax.page", "beertax.filed"] },
  { id: "beertax.taxable", area: "beertax", route: "/beer-tax", title: "Taxable removals", body: "House beer that left the brewery: kegs tapped in the taproom, kegs sent out and anything typed in, less beer returned. 31 gallons to the barrel.", related: ["beertax.worksheet"] },
  { id: "beertax.federal", area: "beertax", route: "/beer-tax", title: "Federal excise", body: "Taxable barrels × the federal rate ($3.50 a barrel on a small brewer's first 60,000 barrels a year).", related: ["beertax.settings"] },
  { id: "beertax.ny", area: "beertax", route: "/beer-tax", title: "New York beer tax", body: "Taxable gallons × the New York rate, less the small brewer credit on the first 500,000 gallons of the year.", related: ["beertax.settings"] },
  { id: "beertax.packaged", area: "beertax", route: "/beer-tax", title: "Packaged", body: "House beer put in kegs this period (from keg fills), plus cans or bottles typed in. For the brewer's report.", related: ["beertax.adjustments"] },
  { id: "beertax.taproom", area: "beertax", route: "/beer-tax", title: "Kegs tapped in the taproom", body: "Every keg of a house beer scanned as tapped in this period, at its full size.", related: ["beertax.moves"] },
  { id: "beertax.accounts", area: "beertax", route: "/beer-tax", title: "Kegs sent to accounts", body: "Every keg of a house beer scanned out to an account in this period. Undone scans don't count.", related: ["beertax.moves"] },
  { id: "beertax.worksheet", area: "beertax", route: "/beer-tax", title: "Worksheet", body: "The lines for the returns: removals by kind, taxable removals, and the tax at your rates, for the period and the year so far.", related: ["beertax.page"] },
  { id: "beertax.byBeer", area: "beertax", route: "/beer-tax", title: "By beer", body: "Gallons filled, tapped and sent out per house beer, and its taxable barrels.", related: ["beertax.worksheet"] },
  { id: "beertax.adjustments", area: "beertax", route: "/beer-tax", title: "Not in a keg", body: "Beer the keg history can't see: cans or crowlers from the tank, beer returned to the brewery, or dumped. Type gallons or barrels.", related: ["beertax.page"] },
  { id: "beertax.moves", area: "beertax", route: "/beer-tax", title: "Keg by keg", body: "Every keg counted in this period, so you can check it against the cellar log. Tap a keg code to open its history.", related: ["beertax.taproom", "beertax.accounts"] },
  { id: "beertax.settings", area: "beertax", route: "/beer-tax", title: "Rates and due dates", body: "The federal and New York rates, the NY small brewer credit, and how often each return is filed and how many days after the period it's due.", related: ["beertax.disclaimer"] },
  { id: "beertax.filed", area: "beertax", route: "/beer-tax", title: "Filed", body: "Returns you've marked filed, newest first, with what you paid.", related: ["beertax.returns"] },
];
