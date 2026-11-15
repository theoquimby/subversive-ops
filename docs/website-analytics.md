# Website analytics: what the website sends to Ops

For whoever looks after the public website (`subversive-website`, a separate
Next.js app). Ops never changes the website; this is the contract the website
implements. Ops side: `POST /api/public/collect`
(`src/app/api/public/collect/route.ts`), the dashboards at **Website →
Analytics** (`/website/analytics`), and Google at `/website/analytics/google`.

## Privacy in one paragraph

No cookies, no localStorage, no fingerprinting script, nothing third-party.
Each beacon carries the page URL, the referrer (first page only), the window
width and, for a tap, its name and a couple of short properties. Ops turns
IP + user agent into a visitor id with a **salt that is replaced every day**
(the old salt is deleted), so nobody can be followed from one day to the next
and the IP is never stored. Rough location (country, region, city) comes from
Vercel's geo headers on Ops' own request. Raw hits are deleted after 400 days;
daily totals are kept. The website's `/privacy` page can say: *"We count
visits without cookies. We don't store IP addresses and can't recognise you
from one day to the next."* No cookie banner is needed.

## The contract

```
POST https://<ops>/api/public/collect
Content-Type: text/plain;charset=UTF-8        (what sendBeacon sends: no CORS preflight)
Body (≤ 2 KB): {"n":"pageview","u":"https://drinksubversive.com/menu?utm_source=ig","r":"https://l.instagram.com/","w":390}
→ 204 No Content, always (bad or bot hits are dropped silently)
```

| Key | Meaning |
|---|---|
| `n` | `pageview` or one of the event names below |
| `u` | `location.href` (UTM tags in it are read; the path is stored without the query) |
| `r` | `document.referrer`, on the **first** pageview of a page load only (send `""` after client-side navigations) |
| `w` | `window.innerWidth` (device class) |
| `p` | optional flat object, ≤ 8 keys, short strings/numbers, e.g. `{"slug":"trivia-night"}` |

Events (anything else is ignored):

| `n` | When | Counts as an action? |
|---|---|---|
| `click_call` | a `tel:` link is tapped | yes |
| `click_directions` | Directions (Google or Apple Maps link) | yes |
| `click_order_online` | Order pickup / the Square Online link | yes |
| `menu_view` | `/menu` is shown, and on a Food/Drinks tab switch (`p.tab`) | the "interest" step |
| `event_view` | an `/events/[slug]` page is shown (`p.slug`) | the "interest" step |
| `ticket_click` | an event's `ticketUrl` link | yes |
| `rsvp_click` | an event's `rsvpUrl` link | yes |
| `inquiry_submit` | the private-event form was sent successfully | yes |
| `newsletter_signup` | newsletter success (once O6 is live) | no |
| `outbound_click` | any other link to another site (`p.href`) | no |

Ops only accepts beacons whose `Origin` and `u` are the website's own address
(`WEBSITE_URL`, set on the Website overview / Connections, plus any extra
addresses on Website → Analytics → Tracking setup; www and bare both work).
Bots, headless browsers, link previews and prefetches are dropped; each
visitor is limited to 60 hits a minute.

## The snippet (≈ 0.7 KB gzip, one client leaf in the site shell)

`src/components/layout/Beacon.tsx`:

```tsx
"use client";
// Cookieless first-party analytics → Ops (docs: subversive-ops/docs/website-analytics.md).
import { usePathname } from "next/navigation";
import { useEffect } from "react";

const URL = process.env.NEXT_PUBLIC_OPS_COLLECT_URL; // https://<ops>/api/public/collect
let first = true;

export function send(n: string, p?: Record<string, string | number>) {
  if (!URL || navigator.webdriver) return;
  const body = JSON.stringify({ n, u: location.href, r: first ? document.referrer : "", w: innerWidth, p });
  first = false;
  if (!navigator.sendBeacon?.(URL, body)) fetch(URL, { method: "POST", body, keepalive: true, mode: "no-cors" }).catch(() => {});
}

const DIRECTIONS = /(^|\.)maps\.apple\.com$|(^|\.)google\.[a-z.]+$|^maps\.app\.goo\.gl$|^g\.page$/;

export function Beacon({ orderHost }: { orderHost: string }) {
  const path = usePathname();
  useEffect(() => {
    send("pageview");
    if (path === "/menu") send("menu_view");
    const m = /^\/events\/([^/]+)$/.exec(path);
    if (m) send("event_view", { slug: m[1] });
  }, [path]);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
      const named = a.dataset.track; // e.g. data-track="ticket_click"
      if (named) return send(named, a.dataset.trackSlug ? { slug: a.dataset.trackSlug } : undefined);
      if (a.protocol === "tel:") return send("click_call");
      if (a.host === location.host) return;
      if (DIRECTIONS.test(a.hostname) && /maps|dir|place|g\.page|goo\.gl/.test(a.href)) return send("click_directions");
      if (a.hostname === orderHost) return send("click_order_online");
      send("outbound_click", { href: a.href.slice(0, 200) });
    };
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, [orderHost]);
  return null;
}
```

Wire-up:

- `src/app/(site)/layout.tsx`: render `<Beacon orderHost={new URL(site.links.order).hostname} />` next to `<Analytics />` (outside the `VERCEL === "1"` check so previews count too, or inside it to keep local dev out).
- Ticket / RSVP links on event pages: add `data-track="ticket_click"` (or `rsvp_click`) and `data-track-slug={event.slug}`.
- Menu tabs: on a Food/Drinks switch call `send("menu_view", { tab })`.
- Inquiry form: after a successful submit call `send("inquiry_submit")`.
- Newsletter (when O6 is answered): `send("newsletter_signup")` on success.
- `navigator.webdriver` keeps Playwright and Lighthouse runs out of the numbers.

### CSP and the JS budget

`next.config.ts` today: `connect-src 'self'`. `sendBeacon` and `fetch` are
governed by `connect-src`, so add the Ops origin:

```ts
const OPS = process.env.NEXT_PUBLIC_OPS_ORIGIN ?? ""; // https://<ops>
`connect-src 'self'${OPS ? ` ${OPS}` : ""}${isDev ? " ws:" : ""}`,
```

No `script-src` change (the snippet is part of the site's own bundle; no
third-party script). The Beacon is in the shared shell, so
`scripts/check-js-budget.ts` (which measures what `/menu` loads beyond the
`/about` shell) is unaffected; it adds well under 1 KB gzip to the shell.
`Referrer-Policy: strict-origin-when-cross-origin` is fine: Ops only uses the
referrer's host. Keep `@vercel/analytics` or drop it; they don't interfere.

### Vercel env vars (website project)

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_OPS_COLLECT_URL` | `https://<ops domain>/api/public/collect` |
| `NEXT_PUBLIC_OPS_ORIGIN` | `https://<ops domain>` (for the CSP) |

Ops side: `WEBSITE_URL` (Settings → Connections or the Website overview) is
the main allowed origin. Optional `WEB_ANALYTICS_ORIGINS` (comma-separated)
adds more. Nightly job: `/api/cron/web-analytics` at 08:41 UTC (rollups,
400-day retention, Website findings for Insights, Google sync), in `vercel.json`.

### Tag the links you control

So visits are credited correctly (UTM tags win over the referrer):

| Where | Link |
|---|---|
| Google Business Profile → Website | `https://drinksubversive.com/?utm_source=gbp&utm_medium=organic` |
| Google listing → Menu link | `https://drinksubversive.com/menu?utm_source=gbp&utm_medium=organic` |
| Instagram bio | `?utm_source=instagram&utm_medium=social` |
| Newsletter | `?utm_source=newsletter&utm_medium=email&utm_campaign=<issue>` |
| Posters / table QR codes | `?utm_source=poster&utm_medium=qr&utm_campaign=<what>` |

## Private-event inquiries (Ops side)

`POST /api/public/inquiry` (Ops) should call, after the PrivateEvent is created:

```ts
import { recordConversion } from "@/server/services/webAnalytics";
await recordConversion("inquiry_submit", { privateEventId, headers: req.headers, path: "/private-events" });
```

When the browser posts straight to Ops, its IP + user agent give the same
daily visitor id as its beacons, so the inquiry gets the visit's source. If
the website's server forwards the form instead, pass `url` (the page's URL with
its UTM tags) and `referrer` from hidden form fields. It never throws. The
dashboard then follows each inquiry to quoted → booked → revenue by source.

## Google Search Console and Business Profile

Set up on `/website/analytics/google` (step by step, with the redirect URL to
copy). Verified against Google's docs (developers.google.com, Nov 2026):

- **OAuth 2.0 for web server apps.** Authorize at
  `https://accounts.google.com/o/oauth2/v2/auth` with `access_type=offline`
  (refresh token), `prompt=consent`, `include_granted_scopes=true`; exchange
  and refresh at `https://oauth2.googleapis.com/token`; revoke at
  `https://oauth2.googleapis.com/revoke`. Docs: "The refresh_token is only
  returned on the first authorization" (hence `prompt=consent` on reconnect),
  and "A Google Cloud Platform project with an OAuth consent screen configured
  for an external user type and a publishing status of 'Testing' is issued a
  refresh token expiring in 7 days" — so the consent screen must be
  **published**. Redirect URIs "must use the HTTPS scheme… Localhost URIs… are
  exempt".
- **Search Console API.** Scope `https://www.googleapis.com/auth/webmasters.readonly`.
  `GET https://www.googleapis.com/webmasters/v3/sites` lists properties
  (`siteUrl` like `sc-domain:example.com` or `https://www.example.com/`).
  `POST https://www.googleapis.com/webmasters/v3/sites/{siteUrl}/searchAnalytics/query`
  with `startDate`, `endDate`, `dimensions` (`date`, `query`, `page`, `device`…),
  `type: "web"`, `rowLimit` ("Valid range is 1–25,000; Default is 1,000"),
  `startRow`, `dataState` ("If 'final'… or if this parameter is omitted, the
  returned data will include only finalized data"). Rows: `keys`, `clicks`,
  `impressions`, `ctr`, `position`. "The API is bounded by internal
  limitations of Search Console and does not guarantee to return all data
  rows but rather top ones." Dates are in Pacific time. Ops syncs totals, and
  by query, page and device, per day; re-reads the last 10 days nightly;
  first sync goes back ~16 months.
- **Business Profile Performance API.** Scope
  `https://www.googleapis.com/auth/business.manage` (the only scope listed).
  `GET https://businessprofileperformance.googleapis.com/v1/{location=locations/*}:fetchMultiDailyMetricsTimeSeries?dailyMetrics=…&dailyRange.start_date.year=…`
  with metrics `BUSINESS_IMPRESSIONS_{DESKTOP,MOBILE}_{MAPS,SEARCH}` ("Multiple
  impressions by a unique user within a single day are counted as a single
  impression"), `BUSINESS_DIRECTION_REQUESTS`, `CALL_CLICKS`,
  `WEBSITE_CLICKS`, `BUSINESS_FOOD_MENU_CLICKS`, `BUSINESS_BOOKINGS`
  (`BUSINESS_CONVERSATIONS` and `BUSINESS_FOOD_ORDERS` are marked deprecated
  and not requested). A datapoint's `value` "will not be present when the
  value is zero". Search terms:
  `GET …/v1/{parent=locations/*}/searchkeywords/impressions/monthly?monthlyRange.start_month.year=…`
  (`pageSize` max 100; each keyword has `insightsValue.value` or a
  `threshold` when Google hides small numbers). Ops asks one month at a time.
  Accounts: `GET https://mybusinessaccountmanagement.googleapis.com/v1/accounts`;
  locations: `GET https://mybusinessbusinessinformation.googleapis.com/v1/{accounts/*}/locations?readMask=name,title,storefrontAddress,websiteUri`
  (`readMask` is required; `pageSize` max 100).
- **Access request (required for Business Profile, not for Search Console).**
  Google's prerequisites page: applicants must "Manage a Google Business
  Profile that is verified and active for 60+ days" and "Have a website
  representing the business listed on the GBP"; submit the GBP API contact
  form choosing "Application for Basic API Access" with the Cloud project
  number, from "an email address that is listed as an owner/manager on your
  business's GBP". Check: "If your quota is 0 QPM… your project has not yet
  been approved. If your quota is set to 300 QPM, your project is approved."
  After approval enable the APIs (My Business Account Management, My Business
  Business Information, Business Profile Performance). Default quota: 300 QPM
  for the Performance API. There is no sandbox.

Until Business Profile is approved, the Google listing card on the dashboard
says so and Search Console works on its own. Google reviews keep coming from
the Places API key (Settings → Connections → Google reviews), unchanged.
