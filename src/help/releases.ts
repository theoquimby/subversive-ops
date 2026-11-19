/**
 * Release notes: every deploy that changes something people use gets a version
 * here, newest first. The What's new sheet groups its cards by release and pops
 * up once per person when a release has cards they haven't seen; the Release
 * notes page (/help/releases) lists every version in full.
 *
 * When shipping: add a release at the TOP with the next version, today's date,
 * a short title, one-sentence summary, the ids of its What's new cards
 * (./whatsNew.ts — every release needs at least one card so it pops up), and
 * plain-English "fixed" lines for smaller changes.
 */

export interface Release {
  version: string;
  /** YYYY-MM-DD it went live. */
  date: string;
  title: string;
  summary: string;
  /** What's new card ids in this release. */
  entries: string[];
  /** Smaller improvements and fixes, one short line each. */
  fixed?: string[];
}

export const RELEASES: Release[] = [
  {
    version: "1.41",
    date: "2026-11-19",
    title: "Customers: who comes back",
    summary: "A new Customers page shows how much of the business regulars carry, how many first-timers return, who looks local and who was passing through, and how many regulars have gone quiet. Worked out from card payments, with no names kept.",
    entries: ["2026-11-19.customers"],
    fixed: [
      "Regulars (four or more days a year): how many there are and their share of card sales.",
      "First-timers who come back within a month, three months and a year.",
      "Regulars of the year before who've been away far longer than is usual for them, and what they spent.",
      "Locals and visitors, read from when cards come, and new against returning cards week by week.",
      "Ops keeps only a scrambled mark per card per day. No name, card number, email or phone is read or kept, so the figures are a floor and nobody can be contacted from them.",
      "Press Load card visits from Square once to bring in the history; the nightly sync keeps it current after that.",
    ],
  },
  {
    version: "1.40",
    date: "2026-11-18",
    title: "Did it work?",
    summary: "The Events page now gives an honest verdict on each thing you've put on: whether it added sales, cost sales, or can't be told apart from chance yet, and what would settle it.",
    entries: ["2026-11-18.did-it-work"],
    fixed: [
      "Each event is compared with an ordinary day of that weekday at that time of year, so a weekly night that has run for months is still measured against how that weekday did before it began.",
      "Events with the same name are judged together, and a result is only called when the nights clear what chance does about 19 times in 20. You get the size, the range, and dollars a night.",
      "When it can't tell yet, it says how many more nights would settle it, or that skipping a few weeks would get there much faster.",
      "It replaces Learned impact, which took a single night's result at face value. The button to set upcoming events now scales the number back when the result isn't settled.",
      "To score something you've already run, add it with past dates: first night, Weekly until today.",
    ],
  },
  {
    version: "1.39",
    date: "2026-11-18",
    title: "A steadier usual day",
    summary: "The forecast's starting point, the usual for each weekday, no longer counts stray-sale days as open days and no longer lets one freak day pull it for weeks. Used only where the replay shows it's closer.",
    entries: ["2026-11-18.usual-day"],
    fixed: [
      "A day with only a stray sale (under a tenth of a typical day, like a gift card bought on a closed Tuesday) isn't counted as an open day, in the forecast or on the scorecard.",
      "One freak day, a holiday or a single huge order, counts for at most one-and-a-half usual days, so the weeks after it aren't forecast too high.",
      "Both are replayed beside the old method every night and switched on only when they're at least 1% closer over all the history and no worse over the last 12 months. The scorecard shows the result under The usual day.",
    ],
  },
  {
    version: "1.38",
    date: "2026-11-18",
    title: "The forecast knows the holidays",
    summary: "The sales forecast now plans for holidays and school breaks from what they've done here in past years, shows days you close every year as closed, and lists what's coming up on the scorecard.",
    entries: ["2026-11-18.holidays"],
    fixed: [
      "It knows the calendar for any year: the named holidays, Thanksgiving Eve through the weekend after, Christmas Eve to New Year's Eve, long weekends, the February school break and the weeks either side of Easter.",
      "Each one is learned from past years and switched on only where replaying those years with it landed at least 5% closer. The scorecard shows each, On or Off, under Holidays and school breaks.",
      "A holiday you've been closed on at each of the last three is forecast as closed. Add an event on the day if you're opening.",
      "Your own event or adjustment on a day always wins over the holiday.",
      "The top of the scorecard lists the holidays in the next four weeks and what the forecast plans for each. Tap a day on Sales & forecast to see the holiday's line in the breakdown.",
    ],
  },
  {
    version: "1.37",
    date: "2026-11-18",
    title: "The forecast follows interest on Google",
    summary: "Searches and activity on your Google listing now feed the sales forecast for the coming week, as one combined reading, wherever that has made the forecast closer.",
    entries: ["2026-11-18.online-in-forecast"],
    fixed: [
      "The numbers that passed the test are combined into one reading: the last week on file against the four weeks before.",
      "It's replayed for the next few days and for a week ahead, and each part is only switched on where it beat the forecast without it. The scorecard shows both, On or Off, under Online signals.",
      "It can move a day by a fifth at most, and it's learned again every night.",
      "Tap a day on Sales & forecast: when it's moving that day, the breakdown shows Interest on Google.",
    ],
  },
  {
    version: "1.36",
    date: "2026-11-18",
    title: "Online numbers tested against sales",
    summary: "The forecast scorecard now tests every number from Google and the website against sales: whether it moves with sales on the day, and whether it would have made the forecast closer ahead of time.",
    entries: ["2026-11-18.online-signals"],
    fixed: [
      "Tested: direction requests, views, calls and website clicks from the Google listing; clicks and times shown from Google Search; visitors and actions on the website.",
      "Each gets a plain verdict under The numbers behind it → Online signals: Helps, No help, or Too soon when there isn't enough history.",
      "The ahead-of-time test only uses what had arrived when the forecast was made, since Google's numbers run days late.",
      "Nothing changes the forecast yet. A number that passes is next in line to go in.",
    ],
  },
  {
    version: "1.35",
    date: "2026-11-18",
    title: "The forecast knows rain from snow",
    summary: "The sales forecast now allows for rain, heavy rain, snow, heat and cold separately, each by what it has measurably done to sales here, and only where that has made the forecast closer.",
    entries: ["2026-11-18.weather-effects"],
    fixed: [
      "Each kind of weather gets its own effect, learned from every day on file against NOAA's weather record. It replaces the single rain adjustment.",
      "A kind is only switched on if replaying every past day with it lands closer than without it. The scorecard shows each one, On or Off, under By weather.",
      "It learns again every night. Four or more days out, only part of the effect is applied, because the weather forecast is only a chance by then.",
      "The scorecard's advice follows: where the forecast now allows for the weather, it says so and no longer tells you to shade for it yourself.",
      "Tap a day on Sales & forecast to see what weather is expected and how much the forecast moved for it.",
    ],
  },
  {
    version: "1.34",
    date: "2026-11-18",
    title: "The scorecard says what to do",
    summary: "The forecast scorecard now opens with a plain verdict on how far to trust the forecast and a short list of what to do differently, with the tables folded underneath.",
    entries: ["2026-11-18.scorecard-story"],
    fixed: [
      "The verdict: solid, use with a cushion, or a rough guide, going by the last 90 days, with a typical day's miss in dollars and how many days in ten land close.",
      "What to do with it: bad-weather days and how much less to plan for, weekdays the forecast can't call, event days, a steady lean high or low, and whether planning two weeks ahead costs any accuracy.",
      "The tables (how far ahead, weather, weekday, events, month, every scored day) are folded under The numbers behind it.",
      "The menu's highlight now follows the page you're on; it used to stay on Overview.",
    ],
  },
  {
    version: "1.33",
    date: "2026-11-18",
    title: "Instagram and Facebook guide corrected",
    summary: "The steps for connecting Instagram and the Facebook Page now match Meta's current screens: two use cases, the right permissions, and the right place for the redirect address.",
    entries: ["2026-11-18.meta-guide"],
    fixed: [
      "A Before you start list: a Business or Creator Instagram account linked to the Page, and full control of the Page on your own Facebook profile.",
      "A warning not to press Add all required permissions on the Instagram use case, because it adds posting.",
      "If your Page doesn't show up or Instagram says it lacks permission: what to do when the Page sits in a business portfolio.",
      "If Instagram only answers to your own Facebook sign-in, the status says which day to connect again by, and Online and Settings remind you ten days before.",
      "Pages held in a business portfolio are now asked for at sign-in, so they show up in the list.",
    ],
  },
  {
    version: "1.32",
    date: "2026-11-18",
    title: "Weather from the National Weather Service",
    summary: "The weather behind the sales forecast now comes from US government sources that are free for a business to use: the National Weather Service for the week ahead, and NOAA's record for every past day with sales.",
    entries: ["2026-11-18.weather-noaa"],
    fixed: [
      "The forecast for the week ahead is the National Weather Service's for Catskill: highs and lows, rain by the hour, snow, wind and the feels-like high. It reaches seven days ahead where the old service reached sixteen.",
      "What the weather actually was comes from NOAA's daily record at Albany International Airport, for every day back to your first sale. It loads by itself each night; the scorecard has a button to load it now.",
      "The scorecard's By weather table now covers all your history, not just the last few months.",
      "Settings → Business looks up the weather location from a street address (US Census Bureau).",
      "The previous weather service's free plan was for non-commercial use only, so Ops no longer calls it.",
    ],
  },
  {
    version: "1.31",
    date: "2026-11-18",
    title: "A scorecard for the forecast",
    summary: "Sales & forecast has a scorecard: every past open day forecast again as it would have been made, compared with what sold, and broken down by weekday, month, weather and event days.",
    entries: ["2026-11-18.forecast-scorecard"],
    fixed: [
      "Scorecard: the typical daily miss over all your history and over the last 90 days, how the forecast does against simply repeating last week's same day, and how it holds up a week and two weeks ahead.",
      "By weather shows how far sales ran over or under the forecast on rainy, snowy, hot and freezing days. Rain is counted from 11am to 9pm, when it changes who comes out.",
      "Each night's forecast is now kept as it was made, weather included, and scored once those days have sold.",
      "The nightly weather now also keeps snowfall, wind, the feels-like high and rain during the day.",
    ],
  },
  {
    version: "1.30",
    date: "2026-11-16",
    title: "Beers linked up, nothing kept twice",
    summary: "A beer now has one keg cost, set by the brewery when a brew is packaged, and used by menu costs, the P&L and demand alike. Square pours link to their beer, keg batches follow their brew, and anything that doesn't link up cleanly waits under Kegs → Setup → Needs a look.",
    entries: ["2026-11-16.beer-links"],
    fixed: [
      "Packaging a brew with a cost records its cost per keg on the beer's keg ingredient. With no packaged brew, Draft beer offers the brewing recipe's cost. Kegs on file says where each keg cost comes from.",
      "Running Draft beer again for a beer reuses its keg ingredient instead of making a second one.",
      "Square items link to the beer they pour (open a beer on Kegs → Setup). Linked items count for that beer whatever they're called; the rest are matched by name as before.",
      "Filling a keg puts it on a batch of the same beer: a tapped batch chip is used as is, a typed code finds that beer's batch or starts a new one, and another beer's batch is refused.",
      "A keg batch made at packaging takes its beer and dates from the brew, and follows when they're changed.",
      "A brew with a recipe pours as the recipe's beer; change it on the recipe and its planned brews follow.",
      "OG and FG come from a brew's gravity readings: deleting a reading moves them, and typing OG or FG keeps it as a reading.",
      "With no ABV typed, the tap list, TV board and website show the ABV of the beer's latest packaged brew. A typed ABV more than 0.3% from it gets a note on the beer.",
      "Existing beers, Square items, keg batches and brews were linked where exactly one thing matched; nothing was changed or removed.",
    ],
  },
  {
    version: "1.29",
    date: "2026-11-16",
    title: "One record each, linked",
    summary: "Suppliers, private events, tanks and beer tax each read from one record instead of keeping copies that could drift apart.",
    entries: ["2026-11-16.one-record"],
    fixed: [
      "A supplier's reminders, how it takes orders and its order deadline are kept on the supplier itself. Everything set before is carried over.",
      "Brewery suppliers keep their own lead time (days before brew, dry-hop or packaging day); the kitchen's lead time (days before delivery) is separate and no longer overwritten.",
      "Brewery orders marked placed stay placed when the supplier is renamed, on the Brewery or in Settings.",
      "Beer tax adds cases packaged (2.25 gallons a case) and dumped brews from the brewery, and checks each brew's keg counts against the kegs scanned. Periods already marked filed don't change.",
      "A buyout shows on the website as Closed for a private event, with nothing about who booked it. On Events, a booking's entry is read-only and opens the booking.",
      "Google reviews follow the Google listing picked under the Google sign-in, so there's one business, not two.",
      "Each tank on Brewery setup has an Upkeep link to its service and repair log; a repair that marks it down shows on the Tanks page and the schedule.",
      "Deleting a position takes it off certificates, checklists, training and onboarding. A checklist or training only for that position is switched off rather than becoming everyone's.",
    ],
  },
  {
    version: "1.28",
    date: "2026-11-16",
    title: "Overview and briefs lead with what you look after",
    summary: "Each manager can pick what they look after (business, brewery, kegs, kitchen, people, online). The Overview and the morning and weekly briefs lead with those areas; the rest folds into a short Elsewhere list, and anything urgent always shows.",
    entries: ["2026-11-16.focus"],
    fixed: [
      "Pick yours in Settings → Notifications or from the prompt on the Overview; managers can set it for each other from Team. Nothing picked means everything, as before.",
      "Brewery on the Overview: what's in each tank, what's due to transfer or package, brewery orders and the next brew, for anyone who looks after the brewery.",
      "The morning brief (page, email and phone) and the weekly brief (page and email) are built for each person's areas, with the brewery's to-dos in the weekly brief for whoever looks after the brewery.",
      "It changes what shows first, never what anyone can open or do.",
    ],
  },
  {
    version: "1.27",
    date: "2026-11-16",
    title: "Brew Manager recipes count toward stock and costs",
    summary: "Recipe lines from Brew Manager are now linked to ingredients, so brewing stock, ordering and costs include them. One press links any that aren't.",
    entries: ["2026-11-16.brew-link-ingredients"],
    fixed: [
      "Each malt, hop and yeast gets one ingredient named the same way everywhere, like Pils malt (NYS) · Hudson Valley Malt or Cascade hops (NYS) · NY Hop Guild. New York grown stays in the name.",
      "Ingredients that name a brewery supplier are set up as bought from them, so ordering says who to order from. Subversive's own malt has no supplier.",
      "Importing from Brew Manager links its recipes' lines on its own and says how many it linked and which it left, with why.",
      "Recipes says how many lines aren't linked, with a Link them button; Brewing stock has Link ingredients while its list is empty.",
    ],
  },
  {
    version: "1.26",
    date: "2026-11-16",
    title: "Notices you can write ahead",
    summary: "The website notice and team announcements can be written now and set to start later, so they don't have to go up the moment they're written.",
    entries: ["2026-11-16.schedule-notices"],
    fixed: [
      "Website → Hours & notice has a Start showing day beside the last day. Until that day the website doesn't see the notice; the editor says Scheduled, Showing now or Ended, and the button says Schedule notice.",
      "Each morning Ops tells the website when a scheduled notice has started or ended, so it changes over within minutes instead of waiting for the next save.",
      "Team announcements take a Show from day and time. Staff don't see them until then; managers find them under Scheduled on Team and Schedule, where they can edit one or show it now.",
      "A start after the last day is turned down with a plain message.",
    ],
  },
  {
    version: "1.25",
    date: "2026-11-16",
    title: "Ordering speaks up only when it should",
    summary: "Driscoll, Kilcoyne and See & Be keep their every-delivery reminders; every other supplier only alerts when counts and sales say something will run short. Alerts can be set per supplier, and orders can go out by text, call or a supplier's website.",
    entries: ["2026-11-16.order-cadence", "2026-11-16.order-send"],
    fixed: [
      "Staff whose employee record is switched off (on Team, or by the Square team sync when they leave) can no longer sign in with their PIN. Manager logins are unaffected.",
      "Each supplier is Every delivery or When stock runs low. When stock runs low works out, item by item, whether anything would fall below its safety level before the delivery after next; items not counted in three weeks say a count is needed instead of nagging.",
      "Alerts per supplier: a first reminder (the day before, four hours before or the morning of), a last call before the cutoff, and who gets them (managers, chosen people or whoever is on shift). A cutoff missed with no order shows as Missed, with the next chance.",
      "Send orders by text (opens Messages with the order written out), phone (a call script) or the supplier's website (the order with item numbers to copy, as a file, or ticked off line by line). Nothing is ever sent by itself.",
      "Staff picked to place orders get a guided path on their phone, with why each amount is suggested and warnings for an unusually big amount, an empty order or a missed cutoff.",
      "Brewery suppliers and ingredients stay out of kitchen ordering and counts; they're ordered from the Brewery.",
    ],
  },
  {
    version: "1.24",
    date: "2026-11-16",
    title: "Brew Manager, inside Ops",
    summary: "Everything Zane's Brew Manager did now lives in the Brewery: brew day on a phone, °Plato, the tank floor plan, timing profiles and locked releases, packaging counts, split batches, a calendar for Google, and brewing stock, ordering and costs kept apart from the kitchen.",
    entries: ["2026-11-16.brew-day", "2026-11-16.brewery-floor", "2026-11-16.brewery-stock", "2026-11-16.brewery-costs"],
    fixed: [
      "Brew day: mash, lauter, boil, fermentation and packaging, each with the recipe's targets beside your readings, a timer that survives closing the phone, a hop checklist and autosave. Finish puts the brew in a fermenter and takes its ingredients out of stock.",
      "Gravity in °Plato everywhere (or SG, your pick), with an ABV calculator and a printable brew sheet.",
      "Recipes keep strike and mash temperatures, mash, kettle and knock-out targets, a timing profile, and development beers with what's still missing and whether the artwork is done.",
      "Tanks: a floor plan laid out like the brewery (back wall, front, separate room), FV to FV, to brite and BBT to BBT moves, Mark conditioning, packaging counts (½ and ⅙ kegs, cases, CO₂) and Fill N kegs straight into the scanner.",
      "Schedule: Hazy, Sour, Lager and Pale timings with transfers on Monday or Tuesday and packaging on Wednesday, locked release dates that hold when a brew moves, a year view, split batches, and an address to add the brewery calendar to Google Calendar.",
      "Stock and orders: malt, hops and yeast on hand from counts and deliveries less what each brew used, and what to order from whom by when for every planned brew, from each supplier's lead time.",
      "Costs: cost per batch, barrel, keg and pint against what it sells for, with a what-if for price changes, batch size and loss.",
      "Import: Brew Manager's recipes, development beers, 2026 schedule, tanks and supplier lead times come in from one file; its backup file brings brews.",
    ],
  },
  {
    version: "1.23",
    date: "2026-11-16",
    title: "Announcements and event pages",
    summary: "Short announcements in a band at the top of every website page, a page of its own for big nights like Oktoberfest, and your latest Instagram posts served to the website from Ops.",
    entries: ["2026-11-16.website-announcements", "2026-11-16.website-event-pages"],
    fixed: [
      "Website → Announcements: write a line of up to 140 characters, pick orange (closure), yellow (event) or plain, link it to an event's page or any https:// address, and pick its first and last day. A phone preview shows it as guests will.",
      "The website shows the first three that are on today, in your order; arrows change the order. Visitors can close a line. Show again to people who closed it brings a new message back for everyone.",
      "Website → Events → Add page: a landscape photo (at least 1600 px wide; the app says plainly when one is too small or upright), an intro, up to 8 sections, a schedule of up to 24 rows and up to 6 links, with a preview.",
      "The website is told at once when an announcement or an event page is saved, once its connection is set up.",
      "The website can now read your five latest Instagram posts from Ops, so it no longer needs its own Instagram key that runs out every 60 days. Pictures whose Instagram address has run out are left out until the nightly sync brings fresh ones.",
      "Changing an event's web address also updates announcements that link to it.",
    ],
  },
  {
    version: "1.22",
    date: "2026-11-16",
    title: "Feedback from any page",
    summary: "A Feedback button beside Help on every page sends an idea, a problem, a question or praise with the page attached, and managers get one inbox to reply, plan and copy notes for Claude.",
    entries: ["2026-11-16.feedback"],
    fixed: [
      "Feedback: pick Idea, Problem, Question or Love it, write a line, add a photo or screenshot if it helps. The page, its title, your device and the app version go along by themselves.",
      "No signal? The note waits on the phone and sends when the connection is back.",
      "Your feedback (in the same sheet) lists what you've sent with its status — New, Planned, Done or Won't do — and any reply.",
      "Settings → Feedback: every note in one table, filtered to New and Planned to start, with search, filters by kind, who and page area, CSV and bulk status changes. A note opens with its photo, a status and a reply box.",
      "Copy for Claude turns the notes shown, or the ones ticked, into one tidy Markdown list to paste into Claude Code.",
      "New feedback shows as one quiet line in the morning brief and a count beside Feedback in Settings.",
      "Overview: Today so far no longer reads \"714329% ahead\" on a quiet morning. Pace waits until the forecast expects a real share of the day, and one big order (a deposit or event payment) is shown on its own, left out of the pace.",
    ],
  },
  {
    version: "1.21",
    date: "2026-11-16",
    title: "Long lists in Kegs and the Brewery",
    summary: "Every long list in Kegs and the Brewery now searches, filters, sorts, groups and exports, and keg history reaches back to the very first scan.",
    entries: ["2026-11-16.keg-tables", "2026-11-16.keg-history-paging"],
    fixed: [
      "All kegs: every keg, with retired ones under their own tab. Search by code, old sticker, beer or account; filter by status, beer, size, owner or place; sort by how long a keg has been in its status. Tick kegs to print just their labels.",
      "Keg history: search a keg's code to see that keg, or any beer, account, person or note. Filter by what happened, beer, who and account, pick dates, and load older entries 200 at a time. CSV saves everything that matches.",
      "Accounts, orders, reports and Fleet: each list searches, filters, sorts and exports. Orders puts open, fulfilled and cancelled under tabs, with account, beer and month filters. Reports have a totals row.",
      "An account's delivery history now holds up to 1,000 deliveries, with beer, size and came-back filters.",
      "Setup: beers, spots and accounts are searchable tables you still type straight into. Retired beers and accounts no longer used are one tab away.",
      "Demand: a search, In stock and Sold lately, and long groups shortened with Show more.",
      "Short lists that can grow (a beer's full kegs, kegs at an account, the walk-in's beer chips, Needs you, a brew's kegs) show the first few with Show more.",
      "Brewery: brews, recipes and ingredient prices search, filter, sort and export. Recipes hide archived ones until you pick their tab.",
    ],
  },
  {
    version: "1.20",
    date: "2026-11-16",
    title: "The Brewery",
    summary: "A new Brewery under Floor: what's in every tank, a tank schedule, brewing recipes costed live from ingredient prices, every brew from brew day to kegs, and an import from Brew Manager.",
    entries: ["2026-11-16.brewery-tanks", "2026-11-16.brewery-recipes", "2026-11-16.brewery-import"],
    fixed: [
      "Tanks: each fermenter and brite tank with the beer in it, day N of M, and Ready to transfer? or Ready to package? when it's due. Brew, transfer, record gravity, package or dump from the tank's card.",
      "Schedule: every tank across the next 12 weeks. Plan a brew and it finds the first free fermenter and brite tank, and says if two brews would clash.",
      "Suggested brews: for core beers, the last day to brew so a full keg is ready before the last one runs out, from keg sales.",
      "Recipes: grain bill, hops, yeast and process give OG, FG, ABV, IBU (Tinseth) and colour (Morey) as you type. Cost per batch, barrel, 1/2 and 1/6 keg and pint comes from the same prices as everything else; anything without a price is listed, never counted as free.",
      "A beer whose brewing recipe is fully priced gets its keg pint cost from that recipe.",
      "Brews: every brew with its path through the tanks, gravity readings, cost, and the kegs it filled. Packaging a brew makes a keg batch, offered as a one-tap choice when filling kegs.",
      "Transfers and packaging that are due, tank clashes and brews to start soon show in Overview and the morning brief.",
      "Import: upload Brew Manager's backup file (Settings → Backup → Export backup JSON there) to bring in its recipes and brews, and the tanks they used. Running it again updates rather than duplicates.",
    ],
  },
  {
    version: "1.19",
    date: "2026-11-16",
    title: "Everything Google in one place",
    summary: "Every Google connection now lives on one page, Settings → Connections → Google, with each part's state and the one thing to do next.",
    entries: ["2026-11-16.google-hub"],
    fixed: [
      "The page explains it in a sentence: Google needs one sign-in (Search Console, your Google listing and, soon, Google Analytics) and one key (Google reviews). Nothing is ever posted or changed on Google.",
      "Each part says whether it's working, waiting on Google, needs fixing or isn't set up, which page it feeds, and when it last synced. The full setup steps are folded away under How to set this up.",
      "While Google reviews the request to read your listing, the Google listing row says so calmly: the sign-in is fine and nothing needs fixing.",
      "Google Analytics shows what to get ready before it's brought in: add the sign-in's Google account as a Viewer and note the property ID.",
      "Settings → Connections is grouped by what each connection is for: Sales and money, Online, and Messages and helpers. One Google card replaces the two there were.",
      "Old links to Connect Google and to the Google reviews card land on the new page.",
    ],
  },
  {
    version: "1.18",
    date: "2026-11-16",
    title: "Core beers, a page per beer, and dirty kegs",
    summary: "Pick the beers you never want to run out of: only they get fill suggestions and alerts. Every beer gets its own page, and any keg can be marked empty, to clean, from its card.",
    entries: ["2026-11-16.core-beers", "2026-11-16.beer-page", "2026-11-16.mark-dirty"],
    fixed: [
      "Every beer is now Core, In rotation or Retired, set on Kegs → Setup or the beer's own page. Pick your core beers on Demand or Setup suggests one for each beer from its fills and recent sales.",
      "Fill suggestions, run-out warnings, the “nothing full behind it” warning, keg alerts, the Overview and briefs, and the Insights keg tile and findings are now for core beers only.",
      "Full kegs per beer on the Kegs page lists core beers always, then beers in rotation with a full keg or one on tap, and retired beers only while kegs still hold them.",
      "Demand per beer is in three groups: core with the plan, in rotation for information, and retired under Show retired.",
      "The walk-in's beer chips and Find the next keg of… follow the same rule. Beer pickers for filling a keg or an order list core beers first and leave retired ones out.",
      "A beer's page: kegs of it right now by size (1/2 bbl, 1/6 bbl and the rest), where the full ones are, which accounts have it, fills per month this year beside last, and pints a week.",
      "A keg's card has Empty, needs cleaning under the big buttons, for a keg found empty whatever the app last heard. It works offline and can be undone.",
    ],
  },
  {
    version: "1.17",
    date: "2026-11-16",
    title: "Instagram and your Facebook Page",
    summary: "Online now brings in Instagram and the Facebook Page: followers, how far your posts travel, what people tap, and every recent post with its numbers.",
    entries: ["2026-11-16.instagram", "2026-11-16.facebook-page"],
    fixed: [
      "Online → Instagram: followers and their change, views and accounts reached over time, taps on the profile's buttons, and your posts and reels sortable by reach, with the best and the quietest named in a sentence.",
      "Online → Facebook: the same for the Page, plus visits to the Page itself.",
      "Connect both with one Facebook sign-in, from Online → Instagram or Settings → Connections. A step-by-step guide covers the one-time setup. Read-only: nothing is ever posted.",
      "Online → Overview: How people found you is now in four groups (Search, Maps and the listing, Website, Social), and What they did next shows Instagram and Facebook beside the Google listing and the website.",
      "Worth a look can now mention a fall in followers, three weeks without a post, or a post that reached far more than usual.",
      "Instagram no longer gives apps profile visits or website-link taps for the whole account, so the page counts them another way and says how.",
    ],
  },
  {
    version: "1.16",
    date: "2026-11-16",
    title: "Online: how guests find you",
    summary: "A new Online section in the menu puts Google Search, the Google listing, the website and reviews side by side, with a page of its own for the listing.",
    entries: ["2026-11-16.online", "2026-11-16.google-listing"],
    fixed: [
      "A keg's own page shows its working life: how many times it's been filled, how long a fill usually lasts, and where each fill went.",
      "Keg history: look up one keg by its code or old sticker, and shorter, cleaner rows.",
      "All kegs: search by code, beer or account, with the table first.",
      "The menu has a new Online group: Overview, Website, Google listing and Reviews. Website and Reviews moved there from Numbers; every link still works.",
      "Online → Overview: how often you showed up in Google Search and on the Google listing, and how many visited the website, then what people did next on the listing and on the website, side by side.",
      "Online → Google listing: times shown on Maps and in Search, on phones and computers; calls, direction requests, website clicks and menu views over time; and what people searched for. It says Waiting on Google's approval until Google grants access.",
      "Worth a look: a short list for a count that dropped sharply, a source not set up yet, or reviews waiting for a reply.",
      "Periods on the Online pages are whole weeks ending yesterday, and Google's rows end on the last day Google has reported, so late numbers never read as a drop.",
      "Website → Analytics no longer repeats Google's numbers; it links to their new home.",
    ],
  },
  {
    version: "1.15",
    date: "2026-11-16",
    title: "Wholesale keg orders",
    summary: "Take an order from an account, see how many full kegs are free to promise, and fill it by scanning each keg as it leaves.",
    entries: ["2026-11-16.keg-orders", "2026-11-16.keg-order-scan"],
    fixed: [
      "The Kegs home now leads with the fleet: one bar showing where every keg is, the last 12 weeks beside it, and a single Needs you list (taps about to run dry, what to fill, kegs out too long, kegs gone quiet).",
      "Orders is in the Kegs menu and on the Kegs page. Open orders also show on the Kegs page, for whoever is loading them.",
      "Each account's page lists its orders, with a New order button.",
      "Overview: keg orders due today or overdue show under Needs you.",
      "Undoing a keg's last scan from its card also takes it off the open order it was scanned for.",
    ],
  },
  {
    version: "1.14",
    date: "2026-11-16",
    title: "Kegs everywhere you look",
    summary: "What the keg history knows now reaches the Overview, the morning and weekly briefs and Insights, not just the keg pages.",
    entries: ["2026-11-16.keg-signals"],
    fixed: [
      "Overview: kegs out at accounts too long and kegs not scanned in a long time sit at the bottom of Needs you.",
      "Morning brief: those two show on Mondays, or on the day another keg crosses the line, so they don't nag daily.",
      "Weekly brief: a Kegs section with fills, taps, kegs sent out and how many came back with no scan.",
      "Insights: the keg tile shows turns, days per cycle and the scan gap, and the feed can raise the scan gap or a fleet with kegs to spare.",
      "Insights no longer prints $0 a month on a finding that has no dollar figure.",
      "The Kegs menu is six sections with icons (Taps, Scan, Walk-in, Analytics, Wholesale, Manage); the pages inside a section are tabs at the top of the page.",
    ],
  },
  {
    version: "1.13",
    date: "2026-11-16",
    title: "Keg accounts and reports",
    summary: "A page for every account you send kegs to, and two reports you can export: volume for any period, and kegs sitting at accounts.",
    entries: ["2026-11-16.keg-accounts", "2026-11-16.keg-reports"],
    fixed: [
      "Accounts and Reports are in the Kegs menu and on the Kegs page.",
      "On Keg setup, each account's name links to its page.",
    ],
  },
  {
    version: "1.12",
    date: "2026-11-16",
    title: "Scan many kegs, keep your stickers",
    summary: "Scan a whole stack of kegs in one go, keep using the stickers already on your kegs, and find every keg page from the menu.",
    entries: ["2026-11-16.scan-many", "2026-11-16.old-stickers", "2026-11-16.nav-sublists"],
    fixed: [
      "Scanning a sticker from Distribrewtion now finds its keg. Before, only typing the long code from the sticker worked.",
      "A keg's card shows how many times it has been filled.",
      "Fleet & trends has a button at the top of the Kegs page.",
    ],
  },
  {
    version: "1.11",
    date: "2026-11-16",
    title: "Keg fleet and trends",
    summary: "Graphs of how the keg fleet is used, worked out from every scan, and two lists of kegs that need a look: out at an account too long, and not scanned in a long time.",
    entries: ["2026-11-16.keg-fleet"],
    fixed: [
      "Kegs brought in from your old keg app show how long they've really been in their state, not the day they were imported. Press Fix dates on the keg import page once for kegs already brought in.",
      "Keg setup has two new numbers: how many days out at an account is too long, and how many days without a scan is too quiet.",
    ],
  },
  {
    version: "1.10",
    date: "2026-11-16",
    title: "Your team, end to end",
    summary: "Shift swaps and pickups that check the rules for you, new-hire checklists, shout-outs, a payroll hand-off for Square Payroll or Gusto, covers next to sales, and a fuller staff home.",
    entries: ["2026-11-16.swap-board", "2026-11-16.my-everything", "2026-11-16.swap-rules", "2026-11-16.onboarding", "2026-11-16.shoutouts", "2026-11-16.payroll-handoff", "2026-11-16.covers"],
    fixed: [
      "A swap request no longer counts as waiting on a manager until someone says they'll take the shift.",
      "Withdrawn swaps are kept in the history instead of disappearing.",
      "Staff can see their own clock-ins for the pay period and flag a mistake before it's approved.",
    ],
  },
  {
    version: "1.9",
    date: "2026-11-16",
    title: "Running the floor and the brewery",
    summary: "Opening and closing checklists anyone can tick on a phone, upkeep for the draft lines and everything else, and the beer tax worked out from your kegs.",
    entries: ["2026-11-16.checklists", "2026-11-16.upkeep", "2026-11-16.beer-tax"],
    fixed: [
      "The Overview and the morning brief now flag a closing list left unfinished, an overdue upkeep job, equipment down for repair and a beer tax return coming due.",
      "Jobs staff can do, like cleaning the draft lines, show on Checklists when they're due and are logged with their name.",
    ],
  },
  {
    version: "1.8",
    date: "2026-11-16",
    title: "Getting your data in",
    summary: "Everything Square sends in one list, price sheets from paper, products and count frequencies worked out for you, and a setup checklist in the order things build on each other.",
    entries: ["2026-11-16.datain-square-all", "2026-11-16.datain-paper-prices", "2026-11-16.datain-link-products", "2026-11-16.datain-count-every", "2026-11-16.datain-checklist", "2026-11-16.plate-cost-breakdown", "2026-11-16.numbers-explain", "2026-11-16.live-roles"],
    fixed: [
      "Switching a login off, or from manager to staff, now takes away access straight away instead of when their sign-in ran out.",
      "Insights says in plain English when an update didn't run, with the technical details tucked away for whoever looks after the app.",
      "Insights' “How it all connects” counts sales with no recipe at a typical 30% (like the Overview and P&L) and shows rent in the sum, so profit isn't overstated.",
      "An Insights card about undoing a price change says what you'd get back, never a negative “gain”.",
      "Ordering says when no supplier has delivery days yet, instead of “no deadlines”.",
      "The inventory value on Counts says how many items it's based on.",
      "“What staff can open” lists everything staff really see: prep, kegs, shift notes and checklists too.",
      "Help popovers no longer flash in the corner before they settle into place.",
      "Pages with tables no longer report a hydration error while charts are still loading.",
      "New positions that come in from Square jobs take Square's tip-eligible setting, and kitchen jobs land in Back of house.",
      "A store added from a receipt (Price Chopper and the like) starts as a Local supplier, and each supplier shows Local or Distributor on phones.",
      "Invoice and product matching no longer mistakes a short word for a longer one (\"Pork Butt\" isn't Buttermilk, \"Cont\" isn't Cornstarch).",
      "Suppliers works out delivery days and deadlines from your invoices the first time you open it, instead of waiting for the night.",
      "QuickBooks lists exactly what goes over (bills and vendors) and what doesn't, before you connect.",
      "Keg import says it takes Distribrewtion's exports.",
    ],
  },
  {
    version: "1.7",
    date: "2026-11-16",
    title: "Link your sales",
    summary: "A step-by-step way to give every Square item a cost, biggest sellers first, with each link's effect shown before saving and Undo on every change.",
    entries: ["2026-11-16.link-sales"],
    fixed: [
      "Draft beer pours can be costed from the keg right where they're linked, all sizes at once.",
      "Cans, bottles and merch can carry a cost each and count as linked, instead of being left out of sales.",
      "Inside a recipe, the ingredient list marks Ingredient or Prep recipe, shows each one's cost for the line, and offers the prep recipe for house-made things.",
      "Overview and P&L “Link items” go straight to the new page.",
    ],
  },
  {
    version: "1.6",
    date: "2026-11-16",
    title: "Counts anyone can do right",
    summary: "Set up the count once, let staff count with guardrails, approve what they send, and see what the shelves are worth.",
    entries: ["2026-11-16.count-setup", "2026-11-16.count-clearer", "2026-11-16.count-approve", "2026-11-16.count-value", "2026-11-16.order-packs"],
    fixed: [
      "Count units now include every pack an item is bought in (the piece inside a case, other suppliers' packs), plus volume for weighed items once a cup weight is known.",
      "Prep items (sauces, portioned proteins) can be counted in pans and containers; an approved count updates the prep list.",
      "Slow movers can be counted monthly or only when they change; their last count carries into the value.",
      "Count things where you find them: items can live in more than one area, anything can be added to an area for one count, and the total adds up across places.",
      "An ingredient can have several packs: add one from its page with “Also bought as”.",
    ],
  },
  {
    version: "1.5",
    date: "2026-11-16",
    title: "Honest numbers and safer saving",
    summary: "The Overview tells you when a figure is missing data, older sales get food costs, and waste and counts never claim to save when they didn't.",
    entries: ["2026-11-16.honest-numbers"],
    fixed: [
      "Waste and counts: a page left open from before an update now says to reload instead of “saved on this phone”. Reload once and anything waiting sends.",
      "Days before your first prices are costed at the earliest prices on file (marked as an estimate) instead of $0.",
      "Help mode: moving the mouse onto a tip no longer jumps to the section underneath.",
      "Prep list says “1 batch”, not “1 batches”.",
    ],
  },
  {
    version: "1.4",
    date: "2026-11-15",
    title: "Month-end for your accountant",
    summary: "A closing checklist, sales tax and inventory value for the month, and one-click files for your accountant.",
    entries: ["2026-11-15.accounting"],
  },
  {
    version: "1.3",
    date: "2026-11-15",
    title: "Staff Today, faster pages and your website",
    summary: "A home screen for staff, pages that load quicker, the website run from here with its own analytics, and this release-notes panel.",
    entries: ["2026-11-15.release-notes", "2026-11-15.quick-start", "2026-11-15.setup-checklist", "2026-11-15.staff-today", "2026-11-15.my-today", "2026-11-15.website", "2026-11-15.website-analytics"],
    fixed: [
      "Overview, P&L, Sales and the brief load with far fewer database trips.",
      "Counts and waste keep working with no signal and send when it's back.",
      "Prep amounts include confirmed private events.",
      "Grey text is a little darker so it's easier to read.",
    ],
  },
  {
    version: "1.2",
    date: "2026-11-15",
    title: "Morning brief, prep list, tap list and parties",
    summary: "A daily brief on your phone, shift notes, the kitchen's prep list, a tap list for the TV and website, card fees and comps in the P&L, and private events.",
    entries: ["2026-11-15.morning-brief", "2026-11-15.shift-notes", "2026-11-15.prep", "2026-11-15.taps", "2026-11-15.pnl-fees", "2026-11-15.private-events"],
    fixed: ["The Overview's week profit now takes off card fees, matching the P&L."],
  },
  {
    version: "1.1",
    date: "2026-11-14",
    title: "Ordering, Overview and Insights redesigned",
    summary: "Ordering became one power table with a Today strip, the Overview and P&L tell the story, and Insights got a graphic for every finding.",
    entries: ["2026-11-14.ordering", "2026-11-14.overview", "2026-11-14.insights"],
    fixed: ["Changing a login to Manager no longer hangs on “Saving…”."],
  },
  {
    version: "1.0",
    date: "2026-11-13",
    title: "Kegs, power tables and smarter invoices",
    summary: "Keg tracking with phone scanning, tables with search and bulk actions everywhere, invoices read from photos, recipe drafts, tips from Square and settings that learn.",
    entries: ["2026-11-13.invoices", "2026-11-13.recipe-drafts", "2026-11-13.deadlines", "2026-11-13.kegs", "2026-11-13.kegs-scan", "2026-11-13.tips", "2026-11-13.settings-learn", "2026-11-13.count", "2026-11-13.storage-areas", "2026-11-13.tables", "2026-11-13.settings", "2026-11-13.quickbooks"],
  },
];

export const CURRENT_VERSION = RELEASES[0].version;

/** The release a card belongs to (or null for a card not yet in one). */
export function releaseOf(entryId: string): Release | null {
  return RELEASES.find((r) => r.entries.includes(entryId)) ?? null;
}

/**
 * Group visible cards by release, newest first. Cards not in any release
 * (shouldn't happen — a test checks) fall into a dated group at the end.
 */
export function groupByRelease<T extends { id: string; date: string }>(entries: T[]): { release: Release | null; date: string; items: T[] }[] {
  const out: { release: Release | null; date: string; items: T[] }[] = [];
  for (const r of RELEASES) {
    const items = entries.filter((e) => r.entries.includes(e.id));
    if (items.length) out.push({ release: r, date: r.date, items });
  }
  const loose = entries.filter((e) => !releaseOf(e.id));
  if (loose.length) out.push({ release: null, date: loose[0].date, items: loose });
  return out;
}
