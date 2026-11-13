import type { HelpEntry } from "../types";

/** Kegs: scanning on a phone, taps, the walk-in, demand per beer, labels, setup and importing. */
export const kegs: HelpEntry[] = [
  {
    id: "kegs.page",
    area: "kegs",
    route: "/kegs",
    title: "Kegs",
    body: "What's on each tap and how much is left, full kegs per beer, and a big Scan button. Staff scan a keg when it kicks, goes on, or moves; everything else follows from that.",
    audience: "all",
    tour: "kegs",
    related: ["kegs.scan", "kegs.taps", "kegs.cooler"],
    keywords: ["kegs", "draft", "taps", "beer", "walk-in", "keg tracking"],
  },
  {
    id: "kegs.scan",
    area: "kegs",
    route: "/kegs/scan",
    title: "Scanning a keg",
    body: "Tap Scan and point the phone at the keg's sticker. The keg's card opens with the next likely step as a big button — on tap it's Kicked, one tap and done. Undo is there for 10 seconds.",
    article: `The sticker's QR code is a link, so the phone's own camera opens the keg too.

1. Tap **Scan** (bottom of the screen on a phone).
2. Point at the sticker. No signal or a worn sticker? **Type the code instead** — the letters under the QR, dashes optional.
3. Press the button for what happened:
- **On tap → Kicked.** Then pick the next keg of the same beer; it shows exactly where it is in the walk-in.
- **In the walk-in → Tapped on line…** or **Moved to…**
- **Filled → Into the walk-in.**
- **Out at an account → Came back.**

**Undo** stays on screen for 10 seconds. No signal in the walk-in? The scan is kept on the phone and sent when you're back in range.

Old stickers from the previous keg app scan too.`,
    audience: "all",
    tour: "kegs",
    related: ["kegs.taps", "kegs.cooler"],
    keywords: ["scan", "qr", "camera", "kicked", "kick", "tap", "sticker", "barcode", "offline", "undo"],
  },
  {
    id: "kegs.taps",
    area: "kegs",
    route: "/kegs",
    title: "On tap",
    body: "Each tap line with its keg, how long it's been on and about how much is left: Square pours of that beer since it was tapped against what the keg holds. “Full behind it” is how many full kegs of it are in storage.",
    article: `**How much is left** comes from Square. Every pour of the beer since the keg went on (Full Pour 16 oz, Half Pour 8 oz and so on — see [pour sizes](/kegs/setup)) is taken off what the keg holds, after foam and line loss.

Square only gives totals by day, so on the day a keg was tapped we count the share of that day's sales after the tap time. Two kegs of the same beer on at once split the pours.

**Days left** is what's left at the last four weeks' pace.

If a keg has poured more than it should hold, it says **Should have kicked — check it**: either it was kicked without a scan, or a pour size is wrong.`,
    audience: "all",
    related: ["kegs.yield", "kegs.setup.pours"],
    keywords: ["tap lines", "gauge", "percent left", "days left", "pours"],
  },
  {
    id: "kegs.stock",
    area: "kegs",
    route: "/kegs",
    title: "Full kegs per beer",
    body: "How many full kegs of each beer are filled or in cold storage, how many are on tap or out, and the empties waiting to be cleaned. Red when it's under the beer's alert level.",
    audience: "all",
    related: ["kegs.cooler", "kegs.demand"],
  },
  {
    id: "kegs.yield",
    area: "kegs",
    route: "/kegs/demand",
    title: "Pints per keg",
    body: "What you really pour from a keg. Every kicked keg compares Square pours with what it holds; the typical result sets the pints per 1/2 bbl. Until a few kegs kick it assumes 90%.",
    article: `A 1/2 bbl holds 1,984 oz — 124 pints on paper. Foam, line flushes, tasters and the last pint mean you sell fewer. Each time a keg is scanned **Kicked**, we add up its Square pours since it was tapped and compare.

The middle of the recent kicks is used (odd ones, like a keg tapped without a scan, are left out). One or two kicks only nudge the 90% starting point; by three it's measured.

This is the real yield for draft costing: if it's well under the yield on [Draft beer](/menu/draft-beer), your pour cost is higher than the menu shows.`,
    related: ["kegs.taps"],
    keywords: ["yield", "pints per keg", "pour cost", "variance", "loss", "foam"],
  },
  {
    id: "kegs.cooler",
    area: "kegs",
    route: "/kegs/cooler",
    title: "The walk-in",
    body: "Every keg that isn't on tap or out, by spot. Solid tiles are full, dashed are empty. Find the next keg of a beer to see exactly where the oldest full one is. On a tablet, drag a keg to move it.",
    article: `- **Find the next keg of…** picks the oldest full keg of that beer (cold before just-filled) and lights it up, with its spot written out.
- **Filter by beer** fades everything else.
- **Move a keg:** drag the tile to another spot, or tap the tile, then tap the spot. On a phone, open the keg and press **Moved to…**
- Spots are set by a manager on [Setup](/kegs/setup).`,
    audience: "all",
    tour: "kegs",
    related: ["kegs.setup.spots", "kegs.stock"],
    keywords: ["walk-in", "cooler", "keg cooler", "where", "find", "spot", "move", "shuffle"],
  },
  {
    id: "kegs.demand",
    area: "kegs",
    route: "/kegs/demand",
    title: "Demand per beer",
    body: "Pints a week per beer from Square, the next four weeks as a range, and full kegs on hand against what you'll need — so the brewer knows what to fill next.",
    article: `**The forecast** is the beer's last four weeks of pouring, adjusted for the time of year. The time of year comes from all your draft sales across every year of history, so a new beer still knows December is slower than July.

**The range** is how far the same method was off for this beer in past weeks. A wide range means its sales jump around.

**On hand** is full kegs plus what's left on tap. **Need** is the forecast over the next 2 and 4 weeks, in kegs of the size you usually fill it in, at the pints per keg you actually get. **Fill** is what covers the next two weeks at the busy end of the range.`,
    related: ["kegs.demand.beers", "kegs.yield", "insights.kegs"],
    keywords: ["forecast", "demand", "brew", "what to brew", "fill next", "pints a week", "seasonal"],
  },
  {
    id: "kegs.demand.beers",
    area: "kegs",
    route: "/kegs/demand",
    title: "Each beer",
    body: "Most urgent first. The grey bars are the last 26 weeks, the colored ones the next four with their range. “Its year” is the beer's average pints by month.",
    related: ["kegs.demand"],
  },
  {
    id: "kegs.all",
    area: "kegs",
    route: "/kegs/all",
    title: "All kegs",
    body: "Every keg with its code, beer, status and where it is. Filter by status; open one to change its size, owner, old sticker code or retire it.",
    related: ["kegs.labels", "kegs.import"],
  },
  {
    id: "kegs.labels",
    area: "kegs",
    route: "/kegs/all",
    title: "Adding kegs and printing labels",
    body: "Add kegs in a batch and each gets a short code like 7Q3-MX, then print QR stickers: 2″×2″ sheets, 1″×2⅝″ address sheets, or one at a time on a label printer.",
    article: `Codes leave out 0/O and 1/I/L so they can be read out loud, and the last letter is a check: a mistyped code isn't mistaken for another keg.

Print at **100% / Actual size** with headers and footers off. Use weatherproof (polyester or vinyl) labels on the keg's upper skirt or the side, away from the handles; steel kegs are cold and wet, so stick them at room temperature on a dry, clean keg.

Kegs that already have stickers from your old app keep them: import them and the old codes scan.`,
    related: ["kegs.all", "kegs.import"],
    keywords: ["labels", "stickers", "qr", "print", "avery", "codes"],
  },
  {
    id: "kegs.setup",
    area: "kegs",
    route: "/kegs/setup",
    title: "Keg setup",
    body: "Beers and the Square items that pour them, spots in the walk-in, how many tap lines, pour sizes, and the accounts kegs go out to.",
    related: ["kegs.setup.beers", "kegs.setup.spots", "kegs.setup.pours", "kegs.setup.accounts"],
  },
  {
    id: "kegs.setup.beers",
    area: "kegs",
    route: "/kegs/setup",
    title: "Beers",
    body: "Each beer you keg, its color on the walk-in board, and the Square item names that pour it. Alert under: managers hear when full kegs drop below this. Link the brewer's recipe to get a cost per pint.",
    related: ["kegs.setup.pours", "kegs.demand"],
    keywords: ["beer list", "square names", "color", "recipe", "batch cost"],
  },
  {
    id: "kegs.setup.spots",
    area: "kegs",
    route: "/kegs/setup",
    title: "Spots",
    body: "Named places inside an area, like “Back left” or “Door, top”. Staff pick one when they move a keg and can add a note like “stack 2”. Areas are the same storage areas as Counts.",
    related: ["kegs.cooler"],
    keywords: ["position", "slot", "shelf", "stack", "walk-in layout"],
  },
  {
    id: "kegs.setup.pours",
    area: "kegs",
    route: "/kegs/setup",
    title: "Pour sizes",
    body: "Ounces in each Square pour of a beer, used for how much is left in a keg and for demand. Guessed from the name; change any. 0 means it isn't poured from a keg, like cans.",
    related: ["kegs.taps"],
    keywords: ["full pour", "half pour", "taster", "growler", "crowler", "ounces"],
  },
  {
    id: "kegs.setup.accounts",
    area: "kegs",
    route: "/kegs/setup",
    title: "Accounts",
    body: "Bars, restaurants, distributors and people your kegs go out to, with a contact. A keg sent out shows where it is until it's scanned back.",
    related: ["kegs.import"],
    keywords: ["customers", "accounts", "deliveries", "returns", "out"],
  },
  {
    id: "kegs.history",
    area: "kegs",
    route: "/kegs/history",
    title: "Keg history",
    body: "Every scan and change, with who, when and from where to where. It's never edited or deleted; an undo strikes the entry through. Imported history from your old app is here too.",
    keywords: ["log", "audit", "who kicked", "history"],
  },
  {
    id: "kegs.import",
    area: "kegs",
    route: "/kegs/import",
    title: "Importing from your old keg app",
    body: "Drop every export at once: kegs, products, batches, customers, deliveries, returns and the activity log. Say what each file is and check the columns; the review shows what's new before anything is saved.",
    article: `1. Export every report the old app offers (CSV or Excel). JSON from its web app works too.
2. Drop them all in. Each file's kind and columns are guessed; fix any guess. Next time, files with the same columns are set up the same way.
3. **Review import** shows how many kegs, beers, accounts and history entries are new, and anything worth a look.
4. **Import everything.**

- Kegs match on their **old code**, which is kept so old stickers still scan. Each keg also gets a new short code for when you reprint.
- Running the same files again updates instead of adding copies; history entries are added once.
- Columns that aren't mapped are kept with each record, so nothing is lost.
- Taps and kicks in the history calibrate pints per keg straight away.`,
    related: ["kegs.labels", "kegs.history"],
    keywords: ["import", "csv", "excel", "migrate", "old keg app", "export", "json", "history"],
  },
  {
    id: "insights.kegs",
    area: "insights",
    route: "/insights",
    title: "Kegs",
    body: "Which beer runs out first: what's left on tap and full in the walk-in, against the next weeks' pints. A beer that runs dry within ~10 days with nothing full behind it also shows up as one of your things to do.",
    related: ["kegs.demand"],
    keywords: ["kegs", "runs out", "beer demand"],
  },
];
