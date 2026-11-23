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
    id: "kegs.home.fleet",
    area: "kegs",
    route: "/kegs",
    title: "The fleet right now",
    body: "Every keg in service as one bar, split by where it is: full, on tap, out at accounts, dirty, and clean.",
    article: `The bar is the whole fleet. A healthy one has a good share **full**, and not too much sitting **to clean** or **clean, empty**.

Beside it is the same split for each of the **last 12 weeks**, so you can see whether today is normal.

The line under the title is how hard the kegs work: how many times a year each is filled, and how many days a fill takes to come back dirty. [Analytics](/kegs/fleet) has the full picture.`,
    related: ["kegs.fleet", "kegs.fleet.look", "kegs.stock"],
    keywords: ["fleet", "dashboard", "summary", "how many kegs", "where are my kegs"],
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

**Empty, needs cleaning** sits under the big buttons on any keg that could still hold beer. Use it for a keg you find empty, whatever the app last heard: on tap it counts as kicked, out at an account it counts as come back, and full it counts as poured or sent out with no scan. It says **Marked empty, to clean** and can be undone like the rest.

**Undo** stays on screen for 10 seconds. No signal in the walk-in? The scan is kept on the phone and sent when you're back in range.

Old stickers from the previous keg app scan too.`,
    audience: "all",
    tour: "kegs",
    related: ["kegs.taps", "kegs.cooler"],
    keywords: ["scan", "qr", "camera", "kicked", "kick", "tap", "sticker", "barcode", "offline", "undo", "dirty", "empty", "needs cleaning", "mark dirty"],
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
    body: "What's in stock against what should be. Core beers are always listed, in red when none is full or it's under its alert level. Beers in rotation show while one is full or on tap, retired beers while kegs still hold them.",
    article: `**Core beers** come first: the ones you never want to run out of. One with nothing full is the number that matters.

**Also in stock** lists beers in rotation that have a full keg or one on tap, and retired beers until their last kegs are empty (marked *retired*).

Managers tap a beer for its own page: kegs by size, where the full ones are, and its fills over time. Staff go to the walk-in, filtered to that beer.`,
    audience: "all",
    related: ["kegs.standing", "kegs.cooler", "kegs.demand"],
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
- **Filter by beer** fades everything else. With many beers, the first dozen chips show and **Show more beers** has the rest; a beer opened from its own page comes first.
- On a phone, each spot lists its first 10 kegs, the one to take next at the top; **Show more kegs** has the rest.
- **Move a keg:** drag the tile to another spot, or tap the tile, then tap the spot. On a phone, tap the keg and pick the spot it went to
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

**On hand** is full kegs plus what's left on tap. **Need** is the forecast over the next 2 and 4 weeks, in kegs of the size you usually fill it in, at the pints per keg you actually get. **Fill** is what covers the next two weeks at the busy end of the range.

Beers are in three groups. **Core beers** get the plan and the Fill badge. **In rotation** shows the same pints a week and forecast for information, with no Fill. **Retired** beers are under **Show retired**.

**Search** finds a beer by name in every group, retired ones too. **In stock** keeps beers with a full keg or one on tap; **Sold lately** keeps beers that sold in the last four weeks. A long group shows its first few cards, with **Show more** for the rest.`,
    related: ["kegs.demand.beers", "kegs.standing", "kegs.yield", "insights.kegs"],
    keywords: ["forecast", "demand", "brew", "what to brew", "fill next", "pints a week", "seasonal"],
  },
  {
    id: "kegs.demand.beers",
    area: "kegs",
    route: "/kegs/demand",
    title: "Each beer",
    body: "Most urgent first. The grey bars are the last 26 weeks it sold, the colored ones the next four with their range. “Its year” is the beer's average pints by month. Tap a beer's name for its own page.",
    related: ["kegs.demand", "kegs.beer"],
  },
  {
    id: "kegs.standing",
    area: "kegs",
    route: "/kegs/setup",
    title: "Core, in rotation and retired",
    body: "Every beer has a standing. Core: you never want to run out, so it gets fill suggestions, run-out warnings and alerts. In rotation: brewed sometimes, shown in stock and on Demand but never nagged about. Retired: not brewed any more, hidden with its history kept.",
    article: `**Core** beers are the ones that should always be on. Only they get:
- "Fill N kegs" on the Kegs page and Demand
- the "nothing full behind it" warning on the Kegs page and the Overview
- keg alerts by email and push
- run-out findings in Insights

**In rotation** beers are brewed now and then. They show under Full kegs per beer while one is full or on tap, and on Demand with their pints a week, for information only.

**Retired** beers aren't brewed any more. They drop off stock lists, Demand, the walk-in's beer chips and the beer pickers. A retired beer with kegs still out or full stays listed, marked retired, until those kegs are empty. Its history stays on its own page, and Demand has **Show retired**.

**Pick your core beers** appears on Demand and Setup until one beer is core. It suggests a standing for each beer from the keg history and the last 90 days of sales:
- filled in the last 90 days and at least three times in the last year: core
- filled in the last year, or still selling (10 pints or more in 90 days), or added lately: in rotation
- not filled for over a year, or never, and not selling now: retired, with when it was last filled

Change any of them and **Save**. After that, set a beer's standing on [Setup](/kegs/setup) or on its own page.`,
    related: ["kegs.setup.beers", "kegs.demand", "kegs.stock", "kegs.beer"],
    keywords: ["core", "core beers", "flagship", "rotation", "seasonal", "retired", "retire a beer", "never run out", "stop nagging", "brew"],
  },
  {
    id: "kegs.beer",
    area: "kegs",
    route: "/kegs/beers/[id]",
    title: "One beer",
    body: "Where a beer stands: its standing, kegs of it right now by size (full, on tap, out), where the full ones are, which accounts have it, fills per month this year beside last, and pints a week from Square.",
    article: `Open it by tapping a beer on the Kegs page, on Demand, or the arrow beside its name on Beers or Setup.

- **Standing** saves as soon as you pick it.
- **Kegs of it right now** counts 1/2 bbl, 1/6 bbl and every other size in use: full in storage, on tap here, and out at accounts.
- **Where the full ones are** lists the oldest fill first, the one to use next: the first eight, then **Show more kegs**. **In All kegs** opens them as a list you can sort and export; **In the walk-in** opens the walk-in board filtered to this beer.
- **Out at accounts** shows who has kegs of it and the longest one has been there.
- **Fills over time** is kegs filled each month, this year beside last, when it was last filled, and how its fills ended: tapped here, sent out, still full, or back with no scan.
- **Pints a week** comes from Square. Core beers get the fill plan; for the others it's for information.

Everything is counted from keg scans, so a keg that moved without a scan is counted where it was last seen.`,
    related: ["kegs.standing", "kegs.stock", "kegs.demand", "kegs.fleet.went"],
    keywords: ["beer page", "brand", "per beer", "sixtel", "1/6", "1/2", "half barrel", "kegs by size", "how many kegs of"],
  },
  {
    id: "kegs.accounts",
    area: "kegs",
    route: "/kegs/accounts",
    title: "Accounts",
    body: "Every bar, restaurant and shop you send kegs to: how many kegs each has now, how long the oldest has been there, and how often you deliver.",
    article: `Sorted with the accounts holding the most kegs first; tap a column to sort by it instead. A tan badge means a keg has been there longer than the number of days set on [Setup](/kegs/setup).

Search by name, filter by **Type**, or show only accounts with **Kegs there now** or one **out over** the set days. **Group** by type, pick **View** columns, and **CSV** saves what's shown.

Tap an account for its own page. **Add account** makes a new one; accounts you no longer deliver to can be switched off on their page and sit under the **No longer used** tab (one still holding kegs stays under **In use**).

Everything here comes from scans: a delivery is a keg scanned **Out to an account**. A keg sent out with no scan won't show.`,
    related: ["kegs.accounts.page", "kegs.reports", "kegs.fleet.look"],
    keywords: ["buyers", "customers", "wholesale", "accounts", "bars", "kegs out", "who has my kegs"],
  },
  {
    id: "kegs.accounts.page",
    area: "kegs",
    route: "/kegs/accounts",
    title: "One account",
    body: "An account's details, the kegs it has right now and for how long, what it takes by beer, deliveries per month and its full delivery history.",
    article: `**Details** save as you type: contact, phone, email, address and notes.

**Kegs here now** lists each keg with the beer, size and days there, the longest first; a long list shows the first 10. Tap a code to open the keg.

**Delivery history** shows when each keg came back, up to the latest 1,000 deliveries. Search a keg code or beer, filter by beer, size or whether it came back, sort any column, group by beer or year, and save it as CSV. **No return scan** means the keg turned up somewhere else, or was filled again, without being scanned back in.

**Median days a keg stays** is the middle of every stay that has a scanned return, so one keg left for a year doesn't skew it.`,
    related: ["kegs.accounts", "kegs.reports"],
  },
  {
    id: "kegs.reports",
    area: "kegs",
    route: "/kegs/reports",
    title: "Keg reports",
    body: "Two reports you can export: volume for any period by where the beer went, by beer and by account; and the kegs sitting at each account, with the ones there too long counted.",
    article: `**Volume** counts barrels, gallons and kegs for the period you pick: tapped here, sent to accounts, and filled then back with no scan. Then the same by beer and by account. It counts scans, not sales, so a keg nobody scanned out is in the "no scan" line. For tax, use [Beer tax](/beer-tax).

**Kegs at accounts** lists every account holding kegs, how many, and how many have been there longer than the number of days you pick.

Each table has a search, sorts by any column and has a totals row. Its **CSV** button saves a file a spreadsheet can open: kegs and barrels for each row, then a total line, for the rows in view (so a search or filter narrows the file too).`,
    related: ["kegs.accounts", "kegs.fleet", "kegs.fleet.went"],
    keywords: ["report", "export", "csv", "volume", "consumption", "barrels", "snapshot", "TTB"],
  },
  {
    id: "kegs.orders",
    area: "kegs",
    route: "/kegs/orders",
    title: "Keg orders",
    body: "What your wholesale accounts have asked for: open orders with the soonest first, how many kegs have gone out on each, and every finished one under its own tab. Below them, how many full kegs are free to promise.",
    article: `An order is for one account: delivery or pickup, a date if there is one, and lines of beer, keg size and how many.

1. Tap **New order**, pick the account and add a line for each beer and size.
2. When the kegs are leaving, open the order and tap **Scan kegs for this order**. Each keg is checked against the order and sent out to the account in the same scan.
3. When every line has its kegs, tap **Mark fulfilled**.

**Today** means the order is due today; **Overdue** means its date has passed. Both show under Needs you on the [Overview](/).

**Open**, **Fulfilled** and **Cancelled** are tabs over one list (the latest 1,000 finished orders). The search finds an order by account, beer or order number. Filter by **Account**, **Beer**, **Month** (when it's due, or when it closed) or delivery and pickup, or show only orders **Due today or late** or with **Kegs to fill**. Group by account, month or status; **CSV** saves what's shown.`,
    related: ["kegs.orders.new", "kegs.orders.order", "kegs.orders.scan", "kegs.orders.availability", "kegs.accounts"],
    keywords: ["orders", "wholesale", "delivery", "pickup", "preorder", "reserve", "sales order", "distribrewtion"],
  },
  {
    id: "kegs.orders.new",
    area: "kegs",
    route: "/kegs/orders/new",
    title: "Making an order",
    body: "Pick the account, delivery or pickup and a date if you have one, then add a line for each beer and keg size. Under each line you see how many full kegs are free right now, and how many would need filling.",
    related: ["kegs.orders", "kegs.orders.availability"],
    keywords: ["new order", "add order", "lines", "quantity"],
  },
  {
    id: "kegs.orders.availability",
    area: "kegs",
    route: "/kegs/orders",
    title: "Available, reserved, preordered",
    body: "Available: full kegs no open order needs. Reserved: full kegs that open orders will take. Preordered: kegs on open orders that aren't full yet, so they still need filling. Full means filled or in cold storage.",
    related: ["kegs.orders", "kegs.demand"],
    keywords: ["available", "reserved", "preordered", "stock", "promise", "full kegs"],
  },
  {
    id: "kegs.orders.order",
    area: "kegs",
    route: "/kegs/orders",
    title: "One order",
    body: "An order's lines with how many kegs have gone out, the kegs scanned for it, its notes, and the buttons to fulfil or cancel it. While it's open you can change the lines, the date and delivery or pickup.",
    article: `While an order is **open**:

- **Kegs wanted**: change how many on a line, add a line, or remove one. Once a keg has gone out on a line its beer and size are fixed; you can still change how many.
- **Delivered without scanning** is for kegs whose stickers can't be read. Type how many went out on that line. They count toward the order and a note says who marked them, but no keg is changed, so those kegs still show wherever the app last saw them.
- **Details**: delivery or pickup and the date save as you change them. The account can change until the first keg goes out.

A tan line above the scan button means the order needs more kegs than are full right now.

**Mark fulfilled** shows when every line has its kegs. **Fulfil with 2 of 3** closes the order short. **Cancel order** closes it without fulfilling; kegs already sent out stay out at the account, so scan them back in when they return.

Fulfilled and cancelled orders can't be changed. Notes can still be added.`,
    related: ["kegs.orders", "kegs.orders.scan", "kegs.orders.availability"],
    keywords: ["fulfil", "fulfill", "cancel", "short", "notes", "edit order", "without scanning"],
  },
  {
    id: "kegs.orders.scan",
    area: "kegs",
    route: "/kegs",
    title: "Scanning kegs for an order",
    body: "Open the order and scan each keg as it leaves. The app checks the keg is full and the right beer and size, sends it out to the account, and counts it on the order.",
    article: `1. On **Kegs**, tap the order under **Orders to send out**. A manager can also open the order and tap **Scan kegs for this order**.
2. Scan each keg's sticker. A tick means the keg was sent out to the account and counted on the order.
3. When nothing is left to scan, tap **Mark fulfilled**.

A keg is refused, and nothing changes, when it:

- isn't full (the app says what it is: empty, on tap, already out)
- is a beer or a size the order doesn't have
- is already on this order
- belongs to a line that already has all its kegs

**Undo** sits on the last keg in the list and puts it back where it was. With no signal, scans wait on the page and send themselves when signal is back; keep the page open until they have. For a worn sticker, tap **Type a code instead**.`,
    audience: "all",
    related: ["kegs.scan", "kegs.scanMany"],
    keywords: ["order", "delivery", "load", "truck", "fulfil", "scan out", "wrong beer"],
  },
  {
    id: "kegs.scanMany",
    area: "kegs",
    route: "/kegs/scan",
    title: "Scanning many kegs at once",
    body: "On Scan, switch to Many kegs, say once what's happening to them, then scan each one. One scan is one keg done. Good for a stack of empties, a cleaning run, or a filling day.",
    article: `1. Tap **Scan**, then **Many kegs**.
2. Pick what's happening:
- **Empty, to clean** for any empty keg, whatever the app last heard. A keg that was on tap is kicked, one that was out comes back, and a full one nobody scanned out is taken as poured.
- **Cleaned** after washing.
- **Filled** with one beer (and a batch, if you use them). Tap a batch the brewery packaged, or type a code: a typed code finds that beer's batch or starts a new one, and a batch of a different beer is refused.
- **Into cold storage** or **Out to an account** for full kegs.
3. Tap **Start scanning** and scan each sticker. Each keg shows in the list with a tick, or a reason it couldn't be done.

**Undo** sits on the last keg in the list. A sticker scanned twice is skipped. With no signal, scans wait on the page and send themselves when signal is back; keep the page open until they have.`,
    audience: "all",
    related: ["kegs.scan", "kegs.oldStickers"],
    keywords: ["bulk", "batch scan", "many", "stack", "cleaning run", "filling day"],
  },
  {
    id: "kegs.oldStickers",
    area: "kegs",
    route: "/kegs/scan",
    title: "Stickers from your old keg app",
    body: "Kegs keep the stickers they already have. Scan one inside Scan and its keg opens. A sticker the app hasn't seen can be added as a new keg on the spot.",
    article: `Kegs brought in with [Import](/kegs/import) remember their old sticker, so scanning it here finds the keg.

**Scan inside the app.** The phone's own camera reads the old sticker's link and opens the old app's site, not this one.

**A sticker the app doesn't know** shows "This sticker isn't in the app yet". Pick the size and tap **Add this keg**. Staff can do this for stickers from Distribrewtion; a manager can add any sticker. To add a lot at once, a manager can use **Many kegs → Add kegs to the app**.

Every keg also has one of our own codes. When an old sticker wears out, print a new label from [All kegs](/kegs/all).`,
    audience: "all",
    related: ["kegs.scan", "kegs.scanMany", "kegs.import", "kegs.labels"],
    keywords: ["distribrewtion", "old sticker", "existing qr", "reuse stickers", "add keg", "unknown sticker"],
  },
  {
    id: "kegs.fleet",
    area: "kegs",
    route: "/kegs/fleet",
    title: "Fleet & trends",
    body: "Opens with fills that have no tap or delivery scan, which are missing from beer tax. Then kegs to look at, out too long, probably lost (over 180 days) and not seen lately.",
    article: `Everything here comes from the keg history, including history imported from your old keg app. Nothing is typed in.

**Where the fleet was** stacks the kegs by state at the end of each week. If most of the fleet is usually dirty or clean, you own more kegs than you need. If it's nearly all full or out, you're one busy weekend from having nothing to fill.

**Kegs filled per month** puts this year beside last year. Pick a beer to see just that one.

**Fleet by status and size** is every keg right now. Export gives the same grid as a file.`,
    related: ["kegs.fleet.turns", "kegs.fleet.went", "kegs.fleet.look", "kegs.history"],
    keywords: ["trends", "graphs", "charts", "fleet", "cooperage", "turns", "cycle", "report"],
  },
  {
    id: "kegs.fleet.turns",
    area: "kegs",
    route: "/kegs/fleet",
    title: "Turns and cycles",
    body: "Turns is how many times the average keg was filled in the last 12 months. Days per cycle is the middle number of days from a fill to that keg coming back dirty.",
    related: ["kegs.fleet"],
  },
  {
    id: "kegs.fleet.went",
    area: "kegs",
    route: "/kegs/fleet",
    title: "Where the beer went",
    body: "Each month's fills by what happened next: tapped here, sent out to an account, still full, or back dirty with no tap or delivery scan in between.",
    article: `A fill counts as **Tapped here** or **Sent out** by its first tap or delivery scan. **Still full** is beer you have in stock now.

**No scan** means the keg was filled and later came back dirty, and nobody scanned it going on tap or out the door. The beer went somewhere, but the history can't say where. Those kegs are also missing from the [beer tax](/beer-tax) worksheet, which counts taps and deliveries.

The fix is the habit, not the app: scan a keg when it goes on and when it goes out.`,
    related: ["kegs.fleet", "kegs.scan"],
    keywords: ["no scan", "missing", "unknown", "where did it go", "beer tax"],
  },
  {
    id: "kegs.fleet.look",
    area: "kegs",
    route: "/kegs/fleet",
    title: "Kegs that need a look",
    body: "Kegs out at an account too long, kegs nobody has scanned in a long time, and kegs out over 180 days, listed apart as probably lost.",
    article: `**Out too long** is every keg at an account for more than 14 days, grouped by account with the longest wait first. Call the account or pick the kegs up.

**Not seen lately** is every keg that isn't out and hasn't been scanned for 90 days. Find it and scan it. If it's gone, **Retire** takes it off the boards and keeps its history; it's still under [All kegs](/kegs/all) → Retired if it turns up. Tick several and **Retire** them together.

Both lists search by keg, beer or account, filter by account, beer, size or last status, sort by any column and save as CSV.

Both numbers of days can be changed on [Setup](/kegs/setup) under Taps and storage.`,
    related: ["kegs.fleet", "kegs.all", "kegs.setup"],
    keywords: ["overdue", "lost keg", "limbo", "missing keg", "out too long", "retire"],
  },
  {
    id: "kegs.all",
    area: "kegs",
    route: "/kegs/all",
    title: "All kegs",
    body: "Every keg with its code, beer, status and where it is. Search, filter and sort; open one to change its size, owner, old sticker code or retire it.",
    article: `**In service** shows the kegs in use; retired ones are under the **Retired** tab, or **All kegs** for both.

- **Search** by our code, the old sticker's code, the beer, the account or the keg's label.
- **Filter** by status, beer, size, owner, or where it is (an area, a spot in it, on tap, or at an account). Status, beer, size and place stay in the address, so a filtered list can be bookmarked or sent.
- **Sort** by code, status, how long it has been in that status, or any column; **Group** by status, beer, size or place.
- **CSV** saves what's shown. Tick kegs (or tick the header for everything shown) and **Print labels** prints just those.

Tap a keg to open it.`,
    related: ["kegs.labels", "kegs.import"],
    keywords: ["keg list", "find a keg", "filter", "export", "retired kegs", "print labels"],
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
    related: ["kegs.setup.beers", "kegs.setup.needs", "kegs.setup.spots", "kegs.setup.pours", "kegs.setup.accounts"],
  },
  {
    id: "kegs.setup.needs",
    area: "kegs",
    route: "/kegs/setup",
    title: "Needs a look",
    body: "Things around your beers that didn't link up on their own: beers with no keg ingredient, Square pours not linked to a beer, keg batches with a brew code but no brew, brews saved as a different beer from their recipe, and a typed ABV that differs from the brewery's. Nothing here was changed for you.",
    article: `The app links a beer to its keg ingredient, a Square pour to its beer and a keg batch to its brew only when exactly one thing matches. Anything else waits here, with the obvious fix one tap away.

- **Beers with no keg ingredient**: pick it (the one named “<beer> (keg)” is offered first), or set the beer up on Draft beer.
- **Square pours not linked to a beer**: items that sold in the last 90 days and look like draft beer. Link each to its beer.
- **Keg batches with a brew code but no brew**: **Join brew** when a brew has that code and the same beer.
- **Brews saved as a different beer from their recipe**: a brew pours as its recipe's beer; **Make it …** puts it right (its keg batch follows).
- **ABV typed differs from the brewery's**: more than 0.3% apart from the latest packaged brew's OG and FG. **Use …%** puts the measured one on the board.

The list is gone when there's nothing to look at.`,
    related: ["kegs.setup.beers", "menu.draftBeer", "brewery.batches.one"],
    keywords: ["needs a look", "not linked", "unlinked", "duplicate", "keg ingredient", "square item", "abv", "batch"],
  },
  {
    id: "kegs.setup.beers",
    area: "kegs",
    route: "/kegs/setup",
    title: "Beers",
    body: "Each beer you keg, its standing (core, in rotation or retired), its color on the walk-in board, and the Square items that pour it. Alert under: for core beers, managers hear when full kegs drop below this. A beer's cost per pint comes from its keg cost (Menu → Draft beer).",
    article: `Type in any cell to change it; it saves when you leave the cell. On a phone, tap a beer to edit it.

### Square items
Open a beer to see the Square items linked to it, link another or unlink one. Sales of a linked item count for that beer whatever the item is called, so renaming an item in Square changes nothing. Typed Square names (the part before the pour, like “New York Nectar*”) link every item they name that isn't linked yet, when they name only this beer; items not linked are still matched by name.

### Cost
A beer's cost per pint comes from its keg ingredient's price, which a packaged brew or the brewing recipe sets (see Draft beer). **Recipe (for cost)** is the old way, a kitchen prep recipe; it's only used for a beer with no keg cost and no live brewing recipe.

Search by name or Square item. **In use** shows core and in-rotation beers; **Core**, **In rotation** and **Retired** each have a tab, so retired beers stay out of the way until you want them. **No Square items** and **No recipe** find the ones still to set up.`,
    related: ["kegs.standing", "kegs.setup.pours", "kegs.demand"],
    keywords: ["beer list", "square names", "color", "recipe", "batch cost", "core", "retired"],
  },
  {
    id: "kegs.setup.spots",
    area: "kegs",
    route: "/kegs/setup",
    title: "Spots",
    body: "Named places inside an area, like “Back left” or “Door, top”. Staff pick one when they move a keg and can add a note like “stack 2”. Areas are the same storage areas as Counts. Every spot is in one list: search it, or pick an area's tab; add a spot under the list.",
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
    body: "Bars, restaurants, distributors and people your kegs go out to, with a contact. A keg sent out shows where it is until it's scanned back. Search, filter by type, and find accounts no longer used under their own tab.",
    related: ["kegs.import"],
    keywords: ["customers", "accounts", "deliveries", "returns", "out"],
  },
  {
    id: "kegs.history",
    area: "kegs",
    route: "/kegs/history",
    title: "Keg history",
    body: "Every scan and change, with who, when and from where to where. It's never edited or deleted; an undo strikes the entry through. Imported history from your old app is here too.",
    article: `The newest entries come first, 200 at a time: **Load older** under the list brings the next 200, back to the very first scan.

- **Search** a keg's code or old sticker to see just that keg. Anything else (a beer, an account, a person, a note) finds every entry that mentions it.
- **Filter** by what happened, beer, who did it and account, and pick dates: **Today**, **Last 7 days**, **Last 30 days**, **This year**, or your own from and to.
- Every filter applies to the whole history, not just what's loaded, and stays in the address, so a view can be bookmarked or sent.
- **CSV** saves every entry that matches, up to 20,000 at a time.

A keg's own card links to all of its entries.`,
    related: ["kegs.all", "kegs.scan"],
    keywords: ["log", "audit", "who kicked", "history", "activity", "export", "date range"],
  },
  {
    id: "kegs.import",
    area: "kegs",
    route: "/kegs/import",
    title: "Importing from your old keg app",
    body: "Drop every export at once — from Distribrewtion or any other keg app: kegs, products, batches, customers, deliveries, returns and the activity log. Say what each file is and check the columns; the review shows what's new before anything is saved.",
    article: `1. Export every report the old app offers (CSV or Excel) — in Distribrewtion, export each list (kegs, products, customers, deliveries and returns, history) one by one. JSON from its web app works too. There's no live link to Distribrewtion: import once when you switch over, and again later if you need to — re-importing only adds what's new.
2. Drop them all in. Each file's kind and columns are guessed; fix any guess. Next time, files with the same columns are set up the same way.
3. **Review import** shows how many kegs, beers, accounts and history entries are new, and anything worth a look.
4. **Import everything.**

- Kegs match on their **old code**, which is kept so old stickers still scan. Each keg also gets a new short code for when you reprint.
- Running the same files again updates instead of adding copies; history entries are added once.
- Columns that aren't mapped are kept with each record, so nothing is lost.
- **Distribrewtion's Consumed Volume reports** (by Beverage, by Buyer, Totals — CSV) are read as they are: by Beverage adds every beer with its lifetime barrels, by Buyer adds each customer as an account with their barrels and top beers in the notes, and Totals is shown as a summary only. These reports have no keg codes or dates, so they can't rebuild keg-by-keg history; for that, export the keg list or activity from Distribrewtion, or save the JSON its web pages load.
- Taps and kicks in the history calibrate pints per keg straight away.`,
    related: ["kegs.labels", "kegs.history"],
    keywords: ["import", "csv", "excel", "migrate", "old keg app", "distribrewtion", "export", "json", "history"],
  },
  {
    id: "insights.kegs",
    area: "insights",
    route: "/insights",
    title: "Kegs",
    body: "Which core beer runs out first: what's left on tap and full in the walk-in, against the next weeks' pints. A core beer that runs dry within ~10 days with nothing full behind it also shows up as one of your things to do. Beers in rotation are left out.",
    related: ["kegs.demand"],
    keywords: ["kegs", "runs out", "beer demand"],
  },
];
