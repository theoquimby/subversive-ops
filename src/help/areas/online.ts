import type { HelpEntry } from "../types";

/** Online: how guests find the business (Google Search, the Google listing, the website, Instagram, the Facebook Page) and the reviews they leave. */
export const online: HelpEntry[] = [
  {
    id: "online.page",
    area: "online",
    route: "/online",
    title: "Online",
    body: "How guests find Subversive online and what they do next, on one page: Google Search, the Google listing, the website, Instagram, the Facebook Page and reviews, each against the period before. Pick 7 days, 28 days, 3 months or 12 months at the top.",
    article: `Open it from **Online → Overview**. It answers two questions: how do people find us, and what do they do next?

- **How people found you**, in four groups: Search (how often the website showed up in Google's results), Maps and the listing (how often the Google listing was shown), Website (visits, and where they came from) and Social (how often your Instagram posts and your Facebook Page were shown).
- **What they did next**: directions, calls, going on to the website, the menu and the rest, with the Google listing and the website side by side, and Instagram and Facebook on the rows they share.
- **Worth a look**: only shows when the numbers have something to say.
- **Reviews** and **Top Google searches**.

### How the periods work

Every period is whole weeks (7, 28, 91 or 364 days) and ends yesterday, so it holds the same weekdays as the period before it and never includes half a day. A change is only coloured green or red when it is bigger than normal ups and downs; otherwise it says "about the same".

Google's numbers arrive two or three days late, and Instagram's and Facebook's a day or two. Rather than show those missing days as a drop, each of those rows ends on the last day its source has reported and is compared with the same number of days before that.

### Where each number lives

- Google Search numbers and the list of searches live here.
- The listing's detail lives on [Google listing](/online/google).
- Followers, posts and reels live on [Instagram](/online/instagram) and [Facebook](/online/facebook).
- Everything about website visits lives on [Website → Analytics](/website/analytics).
- Reviews, replies and what to fix live on [Reviews](/reviews).`,
    related: ["online.found", "online.next", "online.look", "online.google", "online.instagram", "online.facebook", "website.analytics", "reviews.page"],
    keywords: ["online", "google", "search", "maps", "listing", "found", "discovery", "seo", "traffic", "overview", "instagram", "facebook", "social"],
  },
  {
    id: "online.found",
    area: "online",
    route: "/online",
    title: "How people found you",
    body: "Counts over the same period, in four groups: Search, Maps and the listing, Website and Social (Instagram and the Facebook Page). The dashed line is the period before. Each row counts a different thing, so they are never added together.",
    article: `- **Google Search**: each time a page of the website appeared in someone's Google results, and how many of those were clicked. From Google Search Console.
- **Google listing**: each time the listing (the panel with your hours, photos and reviews) was shown on Google Maps or in Google Search. From Google Business Profile, once Google has approved access.
- **Website**: visits counted by the website itself, with no cookies.
- **Instagram** and **Facebook Page**: times your posts, reels and stories (or the Page and its posts) were shown, with the follower count beside it. From Meta, once [connected](/online/meta).

**Where website visits came from** splits those visits by where each one started: Google Search, Google Maps and the listing, other search and maps, social, typed in or bookmarked, and so on. [Website → Analytics](/website/analytics) has every source and how often its visits act.`,
    related: ["online.page", "website.analytics.sources", "online.google.views", "online.instagram.seen", "online.facebook.seen"],
    keywords: ["impressions", "views", "visits", "sources", "search console", "instagram", "facebook"],
  },
  {
    id: "online.next",
    area: "online",
    route: "/online",
    title: "What they did next",
    body: "The same step counted in each place: asked for directions, called, went on to the website, looked at the menu. One bar each for the Google listing, the website, Instagram and the Facebook Page, on one scale so the rows compare. A step only one place has shows a single bar.",
    article: `Instagram joins the rows it shares: taps on the profile's **Directions** and **Call** buttons. Under **Went on to the website**, the Instagram and Facebook bars are the website's own count of visits that started there, because Instagram no longer tells apps how many people tapped the website link.

Rows only one place has (ordering online, private-event inquiries, opening the Facebook Page) show a single bar, and are left out while they are zero.`,
    related: ["online.google.actions", "website.analytics.actions", "online.instagram.next", "online.facebook.next"],
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
- **Not set up**: Google, or Instagram and Facebook, aren't connected; the website isn't sending visits; or no reviews are coming in.
- **Stopped**: Google, Instagram or Facebook hasn't sent anything for more than five days.
- **Rating**: the period's reviews average 0.3 stars or more below the period before, with at least three reviews in each.
- **Followers**: Instagram or the Page lost followers over the period: at least 10, and 2% of where it started.
- **Gone quiet**: nothing posted on Instagram or the Page for three weeks.
- **A post that travelled**: one post reached at least three times what a typical post does. Good news goes last.

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
    related: ["online.google.keywords", "settings.google"],
    keywords: ["queries", "keywords", "search terms", "position", "rank", "click rate", "ctr"],
  },
  {
    id: "online.google",
    area: "online",
    route: "/online/google",
    title: "Google listing",
    body: "The listing guests see on Google Maps and Google Search: how often it was shown, what people did from it (directions, calls, website, menu) and what they searched for. Read from Google every night; nothing is ever changed on the listing.",
    article: `Open it from **Online → Google listing**.

Google has to approve access to a listing's numbers before they can be read. Until then the page says **Waiting on Google's approval** and lists what will appear. The request and its status are on [Settings → Connections → Google](/settings/connections/google), under Google listing. Nothing is broken while it waits: the sign-in is fine and Search Console works.

What is counted:

- **Times shown**, split by Google Maps and Google Search, and by phone and computer.
- **Direction requests, calls, website clicks and menu views** from the listing, and bookings if the listing takes them.
- **Searches that showed the listing**, a month at a time.

Messages and food orders sent from the listing aren't brought in.`,
    related: ["online.google.views", "online.google.actions", "online.google.keywords", "online.google.connection", "settings.google"],
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
    body: "Which listing the app reads, when it last checked and the last day Google has reported. Manage the connection opens Settings → Connections → Google, where you can sync now, pick a different listing or disconnect.",
    related: ["settings.google", "website.analytics.googleSetup"],
  },
  {
    id: "online.instagram",
    area: "online",
    route: "/online/instagram",
    title: "Instagram",
    body: "Your Instagram account's numbers: followers and how they changed, how often your posts, reels and stories were shown, what people tapped on the profile, and each recent post with its reach. Read every night; nothing is ever posted.",
    article: `Open it from **Online → Instagram**. Until Instagram is connected the page says so and lists what will appear; [Connect Instagram and Facebook](/online/meta) has the steps.

What is counted:

- **Followers**: the count today, and how many were gained or lost over the period.
- **Views**: times your posts, reels and stories were shown.
- **Accounts reached**: accounts that saw at least one of them on a day.
- **Taps on your profile's buttons**: Call, Directions, Email and Text.
- **Went on to the website**: counted by the website itself.
- **Posts and reels**: each with its reach, views, and likes, comments, saves and shares.

### What Instagram doesn't give

Instagram stopped giving apps the count of profile visits and of taps on the website link for the whole account in 2025. So profile visits are added up from the posts that report them, and website visits are the website's own count.

Stories aren't listed (Instagram keeps their numbers for a day), and nothing that names a person is ever brought in: no follower lists, no commenters, no messages.`,
    related: ["online.instagram.followers", "online.instagram.seen", "online.instagram.next", "online.instagram.posts", "online.instagram.connection", "online.meta"],
    keywords: ["instagram", "ig", "social", "followers", "reels", "posts", "reach", "insights"],
  },
  {
    id: "online.instagram.followers",
    area: "online",
    route: "/online/instagram",
    title: "Followers",
    body: "The number following the account today, and the change since the start of the period. The count is read once a day from the day you connect, so the line and the change start there; Instagram doesn't hand over the history from before.",
    related: ["online.instagram"],
    keywords: ["followers", "growth", "unfollows"],
  },
  {
    id: "online.instagram.seen",
    area: "online",
    route: "/online/instagram",
    title: "How far your posts travelled",
    body: "Views is every time a post, reel or story was shown, so it adds up over the period. Accounts reached counts each account once a day; the same account on two days counts twice, so the page gives a typical day instead of a total.",
    related: ["online.found"],
    keywords: ["views", "reach", "accounts reached"],
  },
  {
    id: "online.instagram.next",
    area: "online",
    route: "/online/instagram",
    title: "What people did next",
    body: "Taps on the profile's Call, Directions, Email and Text buttons, split by button. Went on to the website is the website's own count of visits that arrived from Instagram. Profile visits are added up from the period's posts.",
    related: ["online.next", "website.analytics.sources"],
    keywords: ["profile visits", "website taps", "link in bio", "calls", "directions"],
  },
  {
    id: "online.instagram.posts",
    area: "online",
    route: "/online/instagram",
    title: "Posts and reels",
    body: "What went up in the period, with each post's numbers. Tap a column to sort by it; it opens sorted by reach. The sentence above the table names the post that reached the most accounts and the quietest one, once three posts have numbers.",
    article: `**Reach** is the number of accounts that saw the post at least once. **Views** is how many times it was shown. The last column adds up likes, comments, saves and shares.

A post's numbers keep growing for a few days, so a post from the last two days is never called the quietest. A post that says **No numbers yet** hasn't been reported on by Instagram; it fills in after a later sync.

When fewer than three posts went up in the period, the table shows the latest twelve instead and says so.

The small pictures come from Instagram's own addresses, which stop working after a while; a grey square takes their place.`,
    related: ["online.instagram"],
    keywords: ["best post", "worst post", "reels", "sort", "reach"],
  },
  {
    id: "online.instagram.connection",
    area: "online",
    route: "/online/instagram",
    title: "Connection",
    body: "Which Instagram account the app reads, when it last checked and the last day reported. If Instagram has stopped giving a number, it is named here and left out; everything else still comes in. Manage the connection opens the sign-in page.",
    related: ["online.meta"],
  },
  {
    id: "online.facebook",
    area: "online",
    route: "/online/facebook",
    title: "Facebook Page",
    body: "Your Facebook Page's numbers: followers and how they changed, how often the Page and its posts were shown, visits to the Page, taps on its buttons, and each recent post with its reach. Read every night; nothing is ever posted.",
    article: `Open it from **Online → Facebook**. It uses the same sign-in as Instagram: [Connect Instagram and Facebook](/online/meta).

What is counted:

- **Followers**: the count day by day, and the change over the period. Facebook does hand over the history, up to two years.
- **Views**: times anything from the Page was shown.
- **People reached**: people who saw anything from the Page on a day.
- **Visits to the Page** and **taps on its buttons**.
- **Went on to the website**: counted by the website itself.
- **Posts**: each with its reach, views, and reactions, comments and shares.

Facebook only gives numbers for Pages with 100 or more likes. Below that the page says it is connected but has nothing yet.

It has a page of its own, rather than a section under Instagram, because it is a different audience with different numbers, and each page stays short enough to read on a phone.`,
    related: ["online.facebook.followers", "online.facebook.seen", "online.facebook.next", "online.facebook.posts", "online.facebook.connection", "online.meta"],
    keywords: ["facebook", "page", "meta", "social", "followers", "posts", "reach"],
  },
  {
    id: "online.facebook.followers",
    area: "online",
    route: "/online/facebook",
    title: "Followers",
    body: "The number following the Page, day by day, and the change since the start of the period. A count on a day, so it is compared, never added up.",
    related: ["online.facebook"],
    keywords: ["followers", "likes", "growth"],
  },
  {
    id: "online.facebook.seen",
    area: "online",
    route: "/online/facebook",
    title: "How often the Page was seen",
    body: "Views is every time anything from the Page was shown: posts, videos and the Page itself. People reached counts each person once a day, so the page gives a typical day instead of a total.",
    related: ["online.found"],
    keywords: ["views", "reach", "people reached"],
  },
  {
    id: "online.facebook.next",
    area: "online",
    route: "/online/facebook",
    title: "What people did next",
    body: "Visits to the Page itself, taps on its contact details and main button, and visits to the website that started on Facebook (the website's own count).",
    related: ["online.next", "website.analytics.sources"],
    keywords: ["page visits", "button", "website"],
  },
  {
    id: "online.facebook.posts",
    area: "online",
    route: "/online/facebook",
    title: "Posts",
    body: "The Page's posts from the period with their numbers. Tap a column to sort; it opens sorted by reach, the number of people who saw the post at least once. The sentence above names the best and the quietest once three posts have numbers.",
    related: ["online.instagram.posts"],
    keywords: ["best post", "worst post", "sort", "reach"],
  },
  {
    id: "online.facebook.connection",
    area: "online",
    route: "/online/facebook",
    title: "Connection",
    body: "Which Page the app reads, when it last checked and the last day reported. If Facebook has stopped giving a number, it is named here and left out. Manage the connection opens the sign-in page.",
    related: ["online.meta"],
  },
  {
    id: "online.meta",
    area: "online",
    route: "/online/meta",
    title: "Connect Instagram and Facebook",
    body: "One sign-in with Facebook connects both, because Instagram shares its numbers through the Facebook Page it is linked to. Make a small Meta app, paste its App ID and App secret, press Connect and pick the Page. Read-only.",
    article: `1. At developers.facebook.com, create an app (**Manage everything on your Page**) and add five read-only permissions: \`pages_show_list\`, \`pages_read_engagement\`, \`read_insights\`, \`instagram_basic\` and \`instagram_manage_insights\`.
2. Under **Facebook Login → Settings**, paste the redirect address the page shows into **Valid OAuth Redirect URIs**.
3. Paste the **App ID** and **App secret** from **App settings → Basic**.
4. Press **Connect**, signed in to Facebook as someone with full control of the Page. Tick the Page and its Instagram account, and leave every permission on.
5. If there is more than one Page, pick the business's.

### No review needed

Leave the Meta app in **Development mode**. Meta's review is for apps other businesses sign in to. The one catch: whoever presses Connect must have a role on the Meta app (**App roles → Roles**).

### If Instagram doesn't show up

Instagram only shares numbers for a **professional account** (business or creator, free to switch) that is **linked to the Facebook Page**. Part 3 of the page has both steps.

### What it says when something is wrong

- **Needs connecting again**: the Facebook sign-in expired or was removed. A password change does this. Press Connect again.
- **Not allowed at sign-in**: a permission was unticked. Press Connect again and leave every box on.
- **The app isn't available**: the person signing in isn't on the Meta app. Add them under App roles.
- **Instagram no longer gives…**: Meta removed a number. It is left out and the rest carries on.

The app reads nightly. It never posts, replies or messages, and it stores totals and your own posts only: no follower lists, no commenters' names.`,
    related: ["online.instagram", "online.facebook", "settings.connections"],
    keywords: ["instagram", "facebook", "meta", "connect", "oauth", "app id", "app secret", "permissions", "professional account", "development mode"],
  },
];
