import type { HelpEntry } from "../types";

/** Online: how guests find the business (Google Search, the Google listing, the website) and the reviews they leave. */
export const online: HelpEntry[] = [
  {
    id: "online.page",
    area: "online",
    route: "/online",
    title: "Online",
    body: "How guests find Subversive online and what they do next, on one page: Google Search, the Google listing, the website and reviews, each against the period before. Pick 7 days, 28 days, 3 months or 12 months at the top.",
    article: `Open it from **Online → Overview**. It answers two questions: how do people find us, and what do they do next?

- **How people found you**: how often the website showed up in Google's search results, how often the Google listing was shown on Maps and Search, and visits to the website, each with its trend. Under them, where website visits came from.
- **What they did next**: directions, calls, the menu and the rest, with the Google listing and the website side by side.
- **Worth a look**: only shows when the numbers have something to say.
- **Reviews** and **Top Google searches**.

### How the periods work

Every period is whole weeks (7, 28, 91 or 364 days) and ends yesterday, so it holds the same weekdays as the period before it and never includes half a day. A change is only coloured green or red when it is bigger than normal ups and downs; otherwise it says "about the same".

Google's numbers arrive two or three days late. Rather than show those missing days as a drop, the Google rows end on the last day Google has reported and are compared with the same number of days before that.

### Where each number lives

- Google Search numbers and the list of searches live here.
- The listing's detail lives on [Google listing](/online/google).
- Everything about website visits lives on [Website → Analytics](/website/analytics).
- Reviews, replies and what to fix live on [Reviews](/reviews).`,
    related: ["online.found", "online.next", "online.look", "online.google", "website.analytics", "reviews.page"],
    keywords: ["online", "google", "search", "maps", "listing", "found", "discovery", "seo", "traffic", "overview"],
  },
  {
    id: "online.found",
    area: "online",
    route: "/online",
    title: "How people found you",
    body: "Three counts over the same period: times the website showed up in Google's search results, times the Google listing was shown on Maps and Search, and visits to the website. The dashed line is the period before. They count different things, so they are never added together.",
    article: `- **Google Search**: each time a page of the website appeared in someone's Google results, and how many of those were clicked. From Google Search Console.
- **Google listing**: each time the listing (the panel with your hours, photos and reviews) was shown on Google Maps or in Google Search. From Google Business Profile, once Google has approved access.
- **Website**: visits counted by the website itself, with no cookies.

**Where website visits came from** splits those visits by where each one started: Google Search, Google Maps and the listing, other search and maps, social, typed in or bookmarked, and so on. [Website → Analytics](/website/analytics) has every source and how often its visits act.`,
    related: ["online.page", "website.analytics.sources", "online.google.views"],
    keywords: ["impressions", "views", "visits", "sources", "search console"],
  },
  {
    id: "online.next",
    area: "online",
    route: "/online",
    title: "What they did next",
    body: "The same step counted in both places: asked for directions, called, looked at the menu. One bar is the Google listing, the other the website, on one scale so the rows compare. Steps only one of them has (ordering online, private-event inquiries) show a single bar.",
    related: ["online.google.actions", "website.analytics.actions"],
    keywords: ["calls", "directions", "website clicks", "actions", "conversions"],
  },
  {
    id: "online.look",
    area: "online",
    route: "/online",
    title: "Worth a look",
    body: "A short list that only appears when the numbers show something: a count down by a quarter or more against the period before (and by more than chance), a source that still needs setting up or has stopped updating, a slipping rating, or reviews waiting for a reply.",
    article: `Each row links to the page that explains it.

- **Down sharply**: at least 25% below the period before, on enough numbers to rule out a normal wobble. A halving is marked red.
- **Up sharply**: 40% or more above the period before. Good news goes last.
- **Not set up**: Google isn't connected, the website isn't sending visits, or no reviews are coming in.
- **Stopped**: a Google source hasn't sent anything for more than five days.
- **Rating**: the period's reviews average 0.3 stars or more below the period before, with at least three reviews in each.

A source that is only waiting on Google's approval isn't listed, because there is nothing to do about it.`,
    related: ["online.page"],
  },
  {
    id: "online.reviews",
    area: "online",
    route: "/online",
    title: "Reviews",
    body: "The average rating over the last 90 days (the same number the Reviews page leads with), how many reviews came in during the period and what they averaged, and the average of the last 5 reviews over time.",
    related: ["reviews.page"],
  },
  {
    id: "online.searches",
    area: "online",
    route: "/online",
    title: "Top Google searches",
    body: "What people typed when the website showed up in Google's results: times shown, clicks and the average spot (1 is the top). 'By name' marks searches for Subversive itself; the rest found you while looking for something else.",
    article: `These come from Google Search Console and cover the website. Google leaves out searches only a handful of people made, so the list adds up to a little less than the totals above it.

**Searches that showed the listing** are a different list: what people typed before the Google listing came up on Maps or Search. Google gives those a month at a time, as the number of people. The full list is on [Google listing](/online/google).`,
    related: ["online.google.keywords", "website.analytics.googleSetup"],
    keywords: ["queries", "keywords", "search terms", "position", "rank", "click rate", "ctr"],
  },
  {
    id: "online.google",
    area: "online",
    route: "/online/google",
    title: "Google listing",
    body: "The listing guests see on Google Maps and Google Search: how often it was shown, what people did from it (directions, calls, website, menu) and what they searched for. Read from Google every night; nothing is ever changed on the listing.",
    article: `Open it from **Online → Google listing**.

Google has to approve access to a listing's numbers before they can be read. Until then the page says **Waiting on Google's approval** and lists what will appear. The request and its status are on [Connect Google](/website/analytics/google).

What is counted:

- **Times shown**, split by Google Maps and Google Search, and by phone and computer.
- **Direction requests, calls, website clicks and menu views** from the listing, and bookings if the listing takes them.
- **Searches that showed the listing**, a month at a time.

Messages and food orders sent from the listing aren't brought in.`,
    related: ["online.google.views", "online.google.actions", "online.google.keywords", "online.google.connection", "website.analytics.googleSetup"],
    keywords: ["google business profile", "google my business", "gbp", "maps", "listing", "directions", "calls"],
  },
  {
    id: "online.google.views",
    area: "online",
    route: "/online/google",
    title: "Times the listing was shown",
    body: "Each time the listing appeared in front of someone, split four ways: Google Maps or Google Search, on a phone or a computer. The bars underneath show Maps and Search over time. Google counts a person once a day for each of the four.",
    related: ["online.google"],
    keywords: ["impressions", "views", "maps", "search", "mobile", "desktop"],
  },
  {
    id: "online.google.actions",
    area: "online",
    route: "/online/google",
    title: "What people did from the listing",
    body: "Taps on the listing's Directions, Call, Website and Menu buttons, each with its own trend and its change against the period before. Each chart has its own scale, so compare the shapes, not the heights.",
    related: ["online.next"],
    keywords: ["calls", "directions", "website clicks", "menu", "bookings"],
  },
  {
    id: "online.google.keywords",
    area: "online",
    route: "/online/google",
    title: "Searches that showed the listing",
    body: "What people typed before the listing came up, for the last finished month. The number is people, not searches. For terms only a few people used, Google gives 'under 15' instead of a number.",
    related: ["online.searches"],
    keywords: ["keywords", "search terms", "near me"],
  },
  {
    id: "online.google.connection",
    area: "online",
    route: "/online/google",
    title: "Connection",
    body: "Which listing the app reads, when it last checked and the last day Google has reported. Manage the connection opens the Google sign-in page, where you can sync now, pick a different listing or disconnect.",
    related: ["website.analytics.googleSetup"],
  },
];
