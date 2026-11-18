# Online channels

How Instagram and the Facebook Page are brought into **Online**, how to add
another channel to the same tables and pages, and what Yelp, TripAdvisor and
Untappd let an outside app read. Checked against each service's own
documentation on 2026-11-15; the links are at the end of each section.

Nothing here costs money today. **Ask the owner before building anything in
"Other sources" that does.**

## What is stored

Two tables, made for any channel:

| Table | One row is | Key |
| --- | --- | --- |
| `OnlineChannelDaily` | one number, for one channel, on one day | `(channel, day, metric)` |
| `OnlinePost` | one of the business's own posts, with its latest numbers | `(channel, externalId)` |

`channel` is a short lower-case name (`instagram`, `facebook`). `metric` is a
short name shared across channels, so a page can treat them alike:

| `metric` | Counts | Instagram | Facebook Page |
| --- | --- | --- | --- |
| `views` | times content was shown (adds up over days) | `views` | `page_media_view` |
| `reach` | accounts or people who saw something that day (never add across days) | `reach` | `page_total_media_view_unique` |
| `followers` | the follower count on that day | `followers_count`, read once a day | `page_follows` |
| `follows`, `unfollows` | gained and lost that day | `follows_and_unfollows` | `page_daily_follows_unique`, `page_daily_unfollows_unique` |
| `interactions` | likes, comments, saves, shares (and clicks, on Facebook) | `total_interactions` | `page_post_engagements` |
| `profile_taps` | taps on the profile's or Page's buttons | `profile_links_taps` | `page_total_actions` |
| `tap_call`, `tap_directions`, `tap_email`, `tap_text`, `tap_book`, `tap_other` | the same, by button | its `contact_button_type` breakdown | not given |
| `profile_visits` | visits to the Page itself | not given for the account | `page_views_total` |
| `engaged`, `likes`, `comments`, `saves`, `shares` | as named | same names | not stored |

The connection (which Page, which Instagram account, the tokens) is one
encrypted `Setting` row, `meta.connection`, sealed the same way as Google's,
Square's and QuickBooks'. The sync's progress is `meta.syncState`.

**Privacy.** Only aggregate numbers and the business's own posts are stored.
No follower lists, no names of people who liked or commented, no messages.
Reaction and comment counts are requested with `limit(0)` so the names never
leave Meta.

## Where the code is

| Layer | File |
| --- | --- |
| Meta's shapes, errors, token and sync decisions (pure) | `src/domain/metaData.ts` |
| Channel-agnostic page logic: followers, best and worst post, states, Worth a look (pure) | `src/domain/onlineChannels.ts` |
| The signed sign-in `state` | `src/domain/oauthState.ts` |
| Every HTTP call to Meta | `src/server/integrations/meta.ts` |
| Connection, sync, reading | `src/server/services/metaChannels.ts` |
| The pages' numbers | `src/server/services/online.ts` (`socialReport`, `onlineOverview`) |
| Pages | `src/app/(app)/online/{instagram,facebook,meta}/`, shared `social.tsx` and `posts.tsx` |
| Sign-in routes | `src/app/api/meta/oauth/{start,callback}/route.ts` |
| Nightly | `src/app/api/cron/web-analytics/route.ts` calls `syncMeta()` last |
| Demo data | `src/server/demo/onlineChannels.ts` (`seedOnlineChannels`) |

## Adding another channel

1. **Check the rules first.** Read the service's current terms for what may be
   stored and for how long. Two of the three review sites below forbid keeping
   their numbers at all.
2. **Pick a channel name** and map the service's numbers onto the shared
   `metric` names above. Add a new name only for something no existing one
   means, and say what it counts in `SOCIAL[...].copy` in
   `src/domain/onlineChannels.ts`. A rating fits: `value` is `Decimal(14,2)`.
3. **One integration module** in `src/server/integrations/`: plain `fetch`, a
   timeout, a pinned API version, the key in a header, nothing at import time.
   Its tests stub `fetch`.
4. **Pure parsing and error wording** in `src/domain/`, tests first: a metric
   that has gone, an empty account, a post with no numbers yet, a sign-in that
   dies mid-run.
5. **A sync** that replaces exactly the names it asked for, day by day (see
   `replaceRows` in `metaChannels.ts`), so it can be run twice safely, and
   that goes through `runSteps` so one failing part never stops the next.
   Call it from an existing nightly route. The Vercel plan has a limit on cron
   entries; do not add one.
6. **Keys** in `SECRET_NAMES` and `validateSecret` in
   `src/domain/secretFormats.ts`, with the "that's a …, not a …" wording.
7. **Pages.** Add the channel to `SOCIAL_CHANNELS` and `SOCIAL`. If it has
   posts and followers, `SocialPage` already draws it; add a `page.tsx` that
   calls `socialReport`. A channel that is only a rating and a count (a review
   site) belongs on **Reviews** and as a row in the overview, not on a page
   shaped for posts.
8. **Overview.** Add a row under the right group in "How people found you",
   its keys to `STEPS` in `src/domain/online.ts` if it shares a step, and its
   metrics to the list `onlineOverview` gives `worthALook`.
9. **Menu, help, release notes, demo data**: `src/lib/areas.ts`,
   `src/help/areas/online.ts`, `src/help/releases.ts` and `whatsNew.ts`, and a
   sibling of `src/server/demo/onlineChannels.ts`.

## Instagram and the Facebook Page

### What was confirmed (Meta's developer docs, 2026-11-15)

- **Which API.** Meta now documents three setups: Instagram API with Unified
  Login (recommended for new integrations, needs a business portfolio and
  gives a system-user token), with Instagram Login (no Facebook Page), and with
  Facebook Login (Page-linked). This app uses **Facebook Login**, because one
  sign-in then reads both the Instagram account and the Page it is linked to,
  and a Page's own token has no end date. Unified Login would be the one to
  move to if Meta retires the others; the docs call them "existing"
  integrations but give no end date.
- **Permissions.** `pages_show_list`, `business_management`,
  `pages_read_engagement`, `read_insights`, `instagram_basic`,
  `instagram_manage_insights`. The app only reads with them.
  `business_management` is asked for so a Page held in a business portfolio
  is listed; it isn't counted as missing if left out.
- **Use cases (checked 2026-11-18).** "Manage everything on your Page" only
  brings `business_management`, `pages_show_list`, `public_profile`. The
  Instagram permissions come from "Manage messaging and content on Instagram"
  with "API setup with Facebook Login". The guide has the owner tick both at
  app creation (use cases can't be removed; only compatible ones can be added
  later), then add `instagram_basic` and `instagram_manage_insights` (Instagram
  use case) and `pages_read_engagement` and `read_insights` (Page use case)
  under **Permissions and features**. It warns not to press "Add all required
  permissions" on the Instagram use case, because that adds
  `instagram_content_publishing`.
- **Redirect address.** The Instagram use case signs in with Facebook Login
  for Business: **Facebook Login for Business → Settings → Client OAuth
  settings → Valid OAuth Redirect URIs**. Facebook Login for Business
  recommends a `config_id` over `scope` for user tokens but says `scope` "can
  still be included"; the Instagram Facebook Login guide's own example uses
  `scope`, so the app keeps `scope`.
- **Business portfolio Pages.** The Instagram insights and media references
  say that when the person's Page role was granted "via the Business Manager"
  the app also needs `ads_management` or `ads_read`. The app does not ask for
  either: the guide asks the owner to have full control of the Page on their
  own profile (Page settings → Page access), and has a troubleshooting entry
  for it.
- **Thresholds.** Page insights: "only available on Pages with 100 or more
  likes". Instagram `follows_and_unfollows`: "Not returned if the IG User has
  less than 100 followers."
- **No App Review.** "Standard Access is all your app needs" when it serves
  only accounts you own or manage. An app in Development mode "can only
  request permissions from role users", so whoever connects must have a role
  on the Meta app.
- **Version.** `v27.0` (introduced 2026-11-04), pinned in
  `META_API_VERSION`. v25.0 is available until 2028-07-29.
- **Instagram account metrics today:** `reach` (the only one with a time
  series), `views`, `accounts_engaged`, `total_interactions`, `likes`,
  `comments`, `saves`, `shares`, `profile_links_taps` (breakdown
  `contact_button_type`), `follows_and_unfollows` (breakdown `follow_type`).
  All are `period=day`, `metric_type=total_value`, so the sync asks for one
  business day at a time. Data can be up to 48 hours late.
- **Removed.** `impressions` (all versions, 2025-04-21). `profile_views`,
  `website_clicks`, `email_contacts`, `get_direction_clicks`,
  `phone_call_clicks`, `text_message_clicks` (all versions, 2025-01-08).
  `video_views` on media (2025-01-08). So there is **no account-level count of
  profile visits or website-link taps any more**. The Instagram page shows
  profile visits added up from posts (`profile_visits`, feed posts only) and
  the website's own count of visits from Instagram.
- **Media metrics today:** `views`, `reach`, `likes`, `comments`, `saved`,
  `shares`, `total_interactions`; `profile_visits` and `follows` on feed posts;
  `ig_reels_avg_watch_time` on reels. Not available for images inside an
  album. Story numbers last 24 hours, so stories are not brought in. Stored
  for up to two years.
- **Page metrics today:** `page_media_view`, `page_total_media_view_unique`,
  `page_views_total`, `page_follows`, `page_daily_follows_unique`,
  `page_daily_unfollows_unique`, `page_post_engagements`, `page_total_actions`;
  per post `post_media_view`, `post_total_media_view_unique`, `post_clicks`,
  `post_reactions_by_type_total`. `page_impressions`, `page_fans`,
  `page_fan_adds`, `page_fan_removes` and `post_impressions` were removed for
  all versions on 2025-11-15. The `_unique` impression metrics are gone too;
  Meta's two pages give different years for that (15 June 2025 and 15 June
  2026), and either way it has passed. Only for Pages with 100 or more likes;
  two years of history; at most 90 days a request.
- **Tokens.** A long-lived user token lasts about 60 days. A Page token made
  from one does "not have an expiration date". The sync uses the Page token and
  renews the user token when it is within 15 days of running out.
- **Rate limits.** Instagram: "Calls within 24 hours = 4800 * Number of
  Impressions". Pages with a Page token: 4800 × engaged users. A nightly sync
  is a few dozen calls; the first one is a few hundred.

### What could not be confirmed

- How far back Instagram account insights go. The reference gives no limit,
  so the backfill works backwards 60 days a night until two years or fourteen
  empty days in a row.
- Whether re-exchanging a long-lived user token extends it server-side (the
  docs describe it for SDKs). It is tried and its failure is harmless.
- What `follows_and_unfollows` `FOLLOWER` / `NON_FOLLOWER` mean exactly. They
  are stored as `follows` / `unfollows` but the pages take the follower change
  from the daily count instead.
- Which day a Page value belongs to. The reference doesn't say; the app
  takes the day that ended at `end_time`, in Pacific time.
- Whether `profile_links_taps` includes the website link (the reference lists
  address, call, email and text only).
- Whether a Page token works for every Instagram call. Meta's overview says
  "Facebook User or Page access token"; the account-insights reference lists
  only a Facebook User access token for this setup. The sync tries the Page
  token first, and falls back to the user token on an auth, role or permission
  error, or Meta's "cannot be loaded due to missing permissions" answer
  (classed `gone`; see `tryOtherIgToken`). Which token worked is stored as
  `igWorkedWith` in the connection. When it is the user token, the status says
  Instagram needs Connect again by the sign-in's end date, and from ten days
  before (`RECONNECT_WARN_DAYS`) Online's Worth a look, the Instagram page and
  the Settings → Connections tile say so.
- **The 90-day data access expiry** (`data_access_expiration_time`). Meta's
  "Authentication versus data access" page says data access lapses 90 days
  after the user was last active and can be read from `debug_token`. It says
  nothing about Development mode, app-role users or Page tokens, and Meta's
  2018 note said business APIs (Pages) keep working without it. The app
  doesn't call `debug_token`, so it can't know this date; nothing is built for
  it. If Instagram stops after about 90 days while depending on the user token,
  this is the first suspect.
- Whether `business_management` is what makes `/me/accounts` list Pages held
  through a business portfolio. Developer-forum answers quoting Meta say so;
  the official `user/accounts` reference doesn't mention it.
- The exact wording of the App Dashboard's screens, and the Facebook Page's
  **Settings → Page access** and **Linked accounts** paths. The guide names
  the use cases and settings Meta's docs name; a label may differ. The guide
  says so at the top and points to Feedback until the first sync succeeds.
- Nothing here has been run against Meta yet: no call to Meta has been made
  from this app.

### Links

- https://developers.facebook.com/docs/instagram-platform/overview
- https://developers.facebook.com/docs/instagram-platform/api-reference/instagram-user/insights
- https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights/
- https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user
- https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/get-started
- https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/authentication
- https://developers.facebook.com/docs/graph-api/reference/page/insights/
- https://developers.facebook.com/docs/platforminsights/page/deprecated-metrics
- https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow
- https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived
- https://developers.facebook.com/docs/development/build-and-test/app-modes
- https://developers.facebook.com/docs/development/create-an-app/
- https://developers.facebook.com/documentation/development/create-an-app/pages-use-case.md
- https://developers.facebook.com/documentation/development/create-an-app/instagram-use-case.md
- https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/business-login-for-instagram
- https://developers.facebook.com/docs/facebook-login/facebook-login-for-business/
- https://developers.facebook.com/docs/instagram-platform/reference/instagram-media
- https://developers.facebook.com/docs/facebook-login/auth-vs-data/
- https://developers.facebook.com/docs/permissions/
- https://developers.facebook.com/docs/graph-api/overview/rate-limiting
- https://developers.facebook.com/docs/graph-api/guides/error-handling
- https://developers.facebook.com/docs/graph-api/changelog
- https://developers.facebook.com/documentation/development/graph-api/changelog/version21.0
- https://developers.facebook.com/documentation/development/graph-api/changelog/version27.0

## Other sources: Yelp, TripAdvisor, Untappd

Not built. In short: **none of the three offers a cheap, self-serve way to
read your own listing whose terms allow keeping a daily history of the rating
and review count**, which is what these pages would need.

### Yelp (Places API, formerly Fusion)

- **Readable:** business details with `rating` and `review_count`; up to 3
  review excerpts (about 160 characters) on the Enhanced plan, up to 7 on
  Premium, none on Base. The owner's own numbers (page views, leads, calls,
  directions) are in the Reporting API, which is "only available to Yelp
  advertising, listing management, & knowledge partners".
- **Cost:** Base $229 a month, Enhanced $299, Premium $643, plus overage. A
  30-day, 5,000-call trial for evaluation only. No free tier.
- **Access:** self-serve API key. The terms license a "consumer-facing content
  distribution platform" and bar commercial use without written consent.
- **Storage:** Yelp content may not be stored for more than 24 hours (only
  business IDs may be kept); Yelp stars may not be blended into a combined
  rating; logo and link-back required. **A stored daily rating history would
  breach the terms without Yelp's written consent.**
- **Not confirmed:** the daily call limits (two Yelp pages disagree), whether
  the trial needs a card, whether a single owner can get the Reporting API.
- https://docs.developer.yelp.com/docs/places-intro ·
  https://business.yelp.com/data/resources/pricing/ ·
  https://docs.developer.yelp.com/docs/reporting-api.md ·
  https://terms.yelp.com/developers/api_terms/ ·
  https://terms.yelp.com/developers/display_requirements/

### TripAdvisor (Terra, which replaced the Content API)

- **Readable:** the old Content API "will be sunset and API keys deprecated on
  August 31, 2026". Terra's Location Details gives the overall rating and
  count, sub-ratings, the per-star breakdown and rankings; reviews and photos
  are paged. There is no owner-analytics (Management Center) API.
- **Cost:** pay as you go. The first 1,000 billable lookups are free once,
  then $0.015 a location. One lookup a day is about $0.45 a month.
- **Access:** sign up, create a key, send it in `X-API-Key`. 10 a second,
  10,000 a day.
- **Storage:** "caching, copying, downloading, storing or indexing content is
  not permitted for any content", except the location ID. Combining its
  content into an aggregated rating is barred. **Storing daily numbers is not
  permitted without a contract that says otherwise.**
- **Not confirmed:** whether sign-up needs a card or an approval step (the
  developer page refused automated reading), and how many reviews the
  pay-as-you-go plan returns.
- https://docs.terra.tripadvisor.com/docs/faq.md ·
  https://docs.terra.tripadvisor.com/docs/usage-based-pricing.md ·
  https://docs.terra.tripadvisor.com/docs/caching-policy.md ·
  https://docs.terra.tripadvisor.com/docs/api-master-terms.md ·
  https://docs.terra.tripadvisor.com/reference/locationget.md

### Untappd

- **Readable:** the public API (v4) documents venue and brewery info and
  check-in feeds, 100 calls an hour. Untappd for Business has its own API
  (email plus a token from the account's API Access page): a venue's check-ins
  with each drinker's rating of the beer, and insights for total check-ins,
  unique users, check-ins over time, menu views and top beers. No venue-rating
  field was found.
- **Cost:** not confirmed from Untappd itself. Third-party listings put
  Untappd for Business at about $899 to $1,199 a year and say the API needs
  the higher plan.
- **Access:** the Business API needs a paid Untappd for Business account. For
  the public API the docs still show "Add App", but reports from 2022 to 2024
  say new keys are not being issued.
- **Storage:** the public API terms say "you must delete your caches every 24
  hours" and bar mining or analysing the data; the site terms bar scraping. No
  storage terms were found for the Business API.
- **Note:** check-ins name the drinker. If this were ever built, only the
  totals may be kept, as with Instagram.
- https://untappd.com/api/docs · https://untappd.com/terms/api ·
  https://untappd.com/terms · https://docs.business.untappd.com

### What that leaves

- **Google reviews** are already brought in (Reviews, and the rating on the
  overview), and reviews from any site can be pasted in on the Reviews page.
- The **website's own visit counts** already say how many visits arrived from
  Yelp, TripAdvisor and Untappd ("Review and listing sites" on the overview),
  with no API and no cost.
- If the owner wants more from one of these, the honest next step is to ask
  that service in writing for permission to keep a daily rating and count for
  the business's own listing, and to decide whether its price is worth it.
