import type { HelpEntry } from "../types";

/** Website → Analytics: the website's own cookieless analytics, and connecting Google (its numbers show on the Online pages). */
export const websiteAnalytics: HelpEntry[] = [
  {
    id: "website.analytics",
    area: "website",
    route: "/website/analytics",
    title: "Website analytics",
    body: "Who visits the website, where they came from and what they did next: call, get directions, order, book or ask about a private event. No cookies and no IP addresses are kept, so no cookie banner is needed.",
    article: `The website sends a tiny message to Ops on every page and on the taps that matter. Ops counts them; nothing identifies a person.

- **People** — different visitors each day. The app can't recognise anyone from one day to the next, on purpose, so someone who visits on two days counts twice.
- **Visits** — one sitting. A visit ends after 30 minutes without a click, or when someone comes back from a new search or post.
- **Actions** — calls, directions, order online, ticket and RSVP taps, and private-event inquiries.
- **Visits that act** — the share of visits with at least one action. The number to grow.

Changes against the period before are only coloured when they're bigger than normal ups and downs.

Google's own numbers have their own pages: Google Search on [Online → Overview](/online) and the listing on [Online → Google listing](/online/google).`,
    tour: "webanalytics",
    related: ["website.analytics.funnel", "website.analytics.sources", "website.analytics.salesLink", "website.analytics.setup", "website.analytics.googleSetup"],
    keywords: ["analytics", "traffic", "visitors", "conversion", "google analytics", "website stats", "utm"],
  },
  {
    id: "website.analytics.findings",
    area: "website",
    route: "/website/analytics",
    title: "Worth knowing",
    body: "Findings from the last 28 days that pass a check for chance, e.g. which source sends most direction clicks. Worked out nightly; they also appear in Insights, below the findings with dollars attached.",
    related: ["insights.page"],
  },
  {
    id: "website.analytics.trend",
    area: "website",
    route: "/website/analytics",
    title: "Visits a day",
    body: "Visits each day in the period you picked. The dashed line is the same day in the period before, so a Saturday sits next to a Saturday. Tap a day for its numbers.",
  },
  {
    id: "website.analytics.visitors",
    area: "website",
    route: "/website/analytics",
    title: "People",
    body: "Different visitors, counted per day and added up. The app can't tell it's the same person on two days (that's what keeps it private), so someone who comes back tomorrow counts again.",
  },
  {
    id: "website.analytics.visits",
    area: "website",
    route: "/website/analytics",
    title: "Visits",
    body: "One sitting on the website. It ends after 30 minutes without a click, or when someone comes back from a new Google search, post or link.",
  },
  {
    id: "website.analytics.views",
    area: "website",
    route: "/website/analytics",
    title: "Pages viewed",
    body: "Every page opened, including the same page twice. More pages a visit usually means people are looking around, not lost.",
  },
  {
    id: "website.analytics.actions",
    area: "website",
    route: "/website/analytics",
    title: "Actions taken",
    body: "Taps that lead to a visit or a sale: Call, Directions, Order online, a ticket or RSVP link, and a private-event inquiry. Menu and event views aren't counted here; they're the step before.",
  },
  {
    id: "website.analytics.rate",
    area: "website",
    route: "/website/analytics",
    title: "Visits that act",
    body: "The share of visits with at least one action: the website's conversion rate. A change is coloured only when it's bigger than chance; 'about the same' means it isn't yet.",
  },
  {
    id: "website.analytics.funnel",
    area: "website",
    route: "/website/analytics",
    title: "From visit to visit-in-person",
    body: "Three steps: all visits, the ones that looked at the menu or an event, and the ones that then called, got directions, ordered, booked or inquired. The biggest drop is where to look first.",
  },
  {
    id: "website.analytics.actionList",
    area: "website",
    route: "/website/analytics",
    title: "What people did",
    body: "Each kind of action with its count, the change against the period before, and where most of them came from (e.g. 60% of direction clicks from Google Maps).",
  },
  {
    id: "website.analytics.sources",
    area: "website",
    route: "/website/analytics",
    title: "Where visits come from",
    body: "Each visit is credited to where it started: Google Search, Google Maps, the Google listing, Instagram, typed in, and so on. 'Better' or 'Lower' shows only when its action rate differs from the site's by more than chance.",
    article: `How a source is worked out, in order:

1. Tags on the link (\`utm_source\`, \`utm_medium\`, \`utm_campaign\`). Put them on links you control so they're counted right, e.g. the Google listing's website link: \`?utm_source=gbp&utm_medium=organic\`, Instagram bio: \`?utm_source=instagram&utm_medium=social\`.
2. Ad click ids (Google, Microsoft).
3. The page people came from: Google, Maps, Instagram, Facebook, Yelp, Untappd…
4. Nothing at all: typed in, a bookmark, or an app that hides where it came from.

Under 30 visits is too few to judge a rate, so it says "Too few".`,
    keywords: ["referrer", "utm", "campaign", "instagram", "google maps"],
  },
  {
    id: "website.analytics.pages",
    area: "website",
    route: "/website/analytics",
    title: "Top pages",
    body: "Views per page, how many visits started there, the share that left without seeing anything else, and the share of visits that saw the page and then took an action.",
  },
  {
    id: "website.analytics.events",
    area: "website",
    route: "/website/analytics",
    title: "Event pages",
    body: "Each event's page on the website: views and taps on its ticket or RSVP link. Good for telling which nights people are curious about before you staff them.",
  },
  {
    id: "website.analytics.devices",
    area: "website",
    route: "/website/analytics",
    title: "Devices",
    body: "Phones, computers or tablets, from the browser and the screen width. Most visitors are on phones, so check changes to the website on a phone first.",
  },
  {
    id: "website.analytics.places",
    area: "website",
    route: "/website/analytics",
    title: "Where visitors are",
    body: "A rough city from the internet connection, added by the website's host. It's approximate (phones often show a nearby city) and it's never stored with anything that identifies a person.",
  },
  {
    id: "website.analytics.salesLink",
    area: "website",
    route: "/website/analytics",
    title: "Website and sales",
    body: "Whether busier website days also brought more Square sales, compared within each weekday with events and closed days left out, over at least eight weeks. It shows the two moving together, never that one causes the other.",
    article: `How it's worked out:

- Each day's Square sales and the website's actions (direction clicks, or all actions) over the last 12 months of tracking.
- Event days, holidays, closures and closed days are left out: an event drives both at once.
- Every weekday gets its own level (Saturdays are busy for both), plus a straight-line trend for the season.
- The effect only counts when its 90% range is clear of zero, with at least 8 weeks of days.

Even then it's a link, not proof: a busy day brings both more clicks and more sales. Use it as a sign the website is part of how people decide, not as a dollar value.`,
    keywords: ["correlation", "sales", "directions", "square"],
  },
  {
    id: "website.analytics.inquiries",
    area: "website",
    route: "/website/analytics",
    title: "Private-event inquiries",
    body: "Inquiries from the website's form, by where the visit came from, followed through Private events: quoted, booked (deposit, confirmed or done) and the booked quote totals.",
    related: ["website.inquiries"],
  },
  {
    id: "website.analytics.google",
    area: "website",
    route: "/website/analytics",
    title: "Google",
    body: "Google's own numbers live under Online, so nothing is shown twice: the searches that show the website are on Online → Overview, and the listing's views, calls and direction requests are on Online → Google listing.",
    related: ["online.page", "online.google", "settings.google"],
  },
  {
    id: "website.analytics.googleSetup",
    area: "settings",
    route: "/settings/connections/google",
    title: "Your Google sign-in",
    body: "One sign-in covers Search Console, your Google listing and, soon, Google Analytics. Make a sign-in for the app (Client ID and secret), then the owner presses Connect Google. Search Console works straight away; the listing needs Google's OK first.",
    article: `On [Settings → Connections → Google](/settings/connections/google), open **How to set this up** under Your Google sign-in:

1. In Google Cloud, turn on the **Google Search Console API** (and, once approved, the three Business Profile APIs).
2. Set up the consent screen and **Publish** it. While it's in Testing, Google ends the sign-in after 7 days.
3. Create an **OAuth client** (Web application) with the redirect address the page shows.
4. Paste the Client ID and secret, then **Connect Google** with the account that owns the listing.
5. For the listing: send Google's **Application for Basic API Access** form (under Google listing → How to set this up). The listing must be verified for 60+ days and have a website. Approved projects show 300 requests a minute in Quotas; 0 means not yet.

While Google reviews the request, the Google listing row says **Waiting on Google**. That is not an error: the sign-in is fine and Search Console keeps working.

The app reads nightly; nothing is ever posted to the listing.`,
    keywords: ["search console", "business profile", "google my business", "gbp", "oauth", "maps"],
  },
  {
    id: "website.analytics.setup",
    area: "website",
    route: "/website/analytics",
    title: "Tracking setup",
    body: "The website sends a tiny message to Ops on each page and tap. Visits are only accepted from the website's own addresses; add a preview address here if needed. The snippet is in docs/website-analytics.md.",
  },
];
