import type { HelpEntry } from "../types";

/** The tap list: staff view, beer details for the board, the TV board and the website feed. */
export const taps: HelpEntry[] = [
  {
    id: "taps.list",
    area: "kegs",
    route: "/kegs/taps",
    title: "Tap list",
    body: "What's pouring now, in the order the TV and website show it, with prices and about how much is left. Almost gone shows in the level line.",
    audience: "all",
    related: ["taps.tv", "taps.beers", "taps.comingSoon", "kegs.taps"],
    keywords: ["tap list", "whats on tap", "pouring", "board order", "reorder taps", "menu board"],
  },
  {
    id: "taps.beers",
    area: "kegs",
    route: "/kegs/beers",
    title: "Beers on the board",
    body: "Style, ABV, IBU, a one-line description, color or a small label image, and prices for each beer. Click a cell and type; it saves on Enter. These show on the TV board and the website. With no ABV typed, the board shows the ABV of the beer's latest packaged brew; a typed ABV more than 0.3% from it gets a note on the beer's page.",
    related: ["taps.prices", "taps.square", "taps.list"],
    keywords: ["abv", "ibu", "style", "description", "label", "logo", "image", "gluten", "beer details"],
  },
  {
    id: "taps.prices",
    area: "kegs",
    route: "/kegs/beers",
    title: "Prices on the board",
    body: "Taken from Square's prices for the beer's pours (or your draft beer pour recipes). Type your own, like “16 oz $8, 10 oz $6”, to override; clear the cell to go back to Square. Up to 3 pours show, smallest first.",
    related: ["taps.square", "kegs.setup.pours"],
    keywords: ["price", "pour price", "pint price", "override"],
  },
  {
    id: "taps.square",
    area: "kegs",
    route: "/kegs/beers",
    title: "Square check",
    body: "Whether the beer's Square item exists and its prices match the pour recipe or the prices typed here. Read from the catalog the nightly sync pulls; nothing is ever changed in Square. Fix a price in Square, then sync.",
    related: ["taps.prices"],
    keywords: ["square item", "price mismatch", "archived", "catalog"],
  },
  {
    id: "taps.comingSoon",
    area: "kegs",
    route: "/kegs/taps",
    title: "Coming soon",
    body: "The strip along the bottom of the TV. Beers not on tap with a full keg in cold storage show by themselves; pin one with Always, or hide it with Never, on the Beers page.",
    audience: "all",
    related: ["taps.list", "taps.beers"],
    keywords: ["coming soon", "next up", "upcoming beers"],
  },
  {
    id: "taps.tv",
    area: "kegs",
    route: "/kegs/setup#tv",
    title: "Put the tap list on a TV",
    body: "Kegs → Setup → Tap list on a TV: copy the link and open it in the TV's web browser, full screen. No sign-in needed; it updates every minute. New link turns off the old one.",
    article: `The board is a web page made for a TV across the room: big type, dark background, one or two columns for 6–16 taps, and a slight drift every few minutes so nothing burns in.

1. On a phone or laptop, go to **Kegs → Setup → Tap list on a TV** and tap **Copy**.
2. Send the link to yourself (text or email) so it's easy to open on the TV, or shorten it with a link shortener.
3. On the TV, open the link in a browser:
- **Fire TV stick:** install **Silk Browser** (or Firefox) from the app store, open the link, then press the menu button and choose full screen.
- **Smart TV (Samsung, LG, Roku TV):** open the built-in **Internet** / **Web Browser** app, open the link, then switch it to full screen.
- **Chromecast or Google TV:** open the link in Chrome on a laptop and choose **Cast… → Cast tab**, or use a browser app on Google TV.
4. Bookmark it on the TV so it's one click after a power cut.
5. In the TV's settings, turn off the screensaver / sleep timer for that input.

It refreshes every minute by itself — no reloading. If the network drops it keeps the last list and shows a small amber dot.

**Keep the link private.** Anyone with it can see the board (prices and what's pouring, nothing else). **New link** turns the old one off; each TV then says the link was replaced.`,
    related: ["taps.list", "taps.website"],
    keywords: ["tv", "television", "display", "fire stick", "firestick", "chromecast", "smart tv", "menu board", "screen", "kiosk", "full screen"],
  },
  {
    id: "taps.website",
    area: "kegs",
    route: "/kegs/setup#tv",
    title: "Tap list on the website",
    body: "Kegs → Setup has a snippet to paste into the website: an iframe of the live tap list that updates every minute. Developers can read the same list as JSON at /api/public/taps.",
    article: `Paste this where the tap list should go (Squarespace: an **Embed** or **Code** block; WordPress: a **Custom HTML** block). Copy the exact one from **Kegs → Setup**, it has the app's address in it:

\`<iframe src="https://<app>/api/public/taps/embed" title="On tap at Subversive" style="width:100%;height:640px;border:0" loading="lazy"></iframe>\`

Options, added to the address: \`?theme=dark\` or \`?theme=light\` (it follows the visitor's setting otherwise), \`?prices=0\` hides prices, \`?soon=0\` hides coming soon. Join two with \`&\`.

**For a developer:** \`GET /api/public/taps\` returns JSON (tap, beer, style, ABV, IBU, description, tag, color, label image, pours with prices, a "new" or "almost" badge, and coming soon). Any site can read it; it's cached for 60 seconds. It never includes keg codes, exact amounts left or sales.`,
    related: ["taps.tv"],
    keywords: ["website", "embed", "iframe", "squarespace", "wordpress", "json", "api", "widget"],
  },
];
