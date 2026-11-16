# Google in one place

Approved by the owner on 2026-11-16. Shipped as release 1.19.

## Why

The owner felt overwhelmed by "all the different connections and ways we need
to connect" to Google, spread across the app: a Connect Google page under
Website → Analytics, a Google reviews tile and a second Google tile on
Settings → Connections, and links from Online. The day before, they thought
the Google setup had broken because the listing page said "waiting" without
saying why. In fact the sign-in and Search Console worked; Business Profile
access was waiting for Google's manual approval (Google answers an unapproved
project with a zero quota, as HTTP 429).

## What

One page, **Settings → Connections → Google** (`/settings/connections/google`,
managers only). At the top, a one-line count of states ("3 working · 1
waiting on Google · 1 coming next"), then the mental model in a sentence:
Google needs two things from you, **one Google sign-in** (Search Console, the
Google listing, Google Analytics) and **one key** (Google reviews). Nothing is
ever posted or changed on Google.

Each section shows its state (Working, Waiting on Google, Needs fixing, Not
set up, Waiting on sign-in, Coming next), the page it feeds, the last sync or
the error in plain words, and only the single next step. The full steps sit in
a "How to set this up" disclosure, open while that piece isn't set up.

The states, the next step's wording and the summary live in
`src/domain/googleHub.ts` (tested in `src/domain/__tests__/googleHub.test.ts`).
`src/server/services/googleHub.ts` gathers the facts.

## The five sections

1. **Your Google sign-in**: who connected it; Connect / Connect again / Sync
   now / Disconnect; the Google Cloud steps and Client ID and secret fields in
   the disclosure.
2. **Search Console** (grouped under the sign-in): the property picker and
   Find again; adding a property in the disclosure. Feeds Online › Overview.
3. **Google listing** (under the sign-in): the listing picker and Find again.
   While Google's approval is pending it reads calmly ("Waiting on Google's
   OK…"), never as an error. The approval form, the 60-day and website rules
   and the quota check are in the disclosure. Feeds Online › Google listing.
4. **Google Analytics** (under the sign-in): coming next. Says what to get
   ready: add the sign-in's Google account as a Viewer, note the property ID.
5. **Google reviews key**: the Places key and Find your business, moved from
   the Connections tile. Feeds Reviews.

If the sign-in needs connecting again, it alone shows the error; the rows
under it say they're waiting on the sign-in.

## What moved

- `/website/analytics/google` permanently redirects to the new page, carrying
  `error` and `connected`. The OAuth start and callback routes return straight
  to the new page. The redirect URI (`/api/google/oauth/callback`), scopes and
  sync are unchanged.
- `/settings/connections?open=google` redirects to the new page.
- Settings → Connections has one Google tile with the summary line, and its
  tiles are grouped: Sales and money, Online, Messages and helpers.
- `GOOGLE_SETUP_HREF`, the command bar, the setup checklist, Website →
  Analytics, Reviews, Settings → Insights & reviews and the help articles all
  point at the new page.

## What's next

Google Analytics (GA4) sync: add the read-only Analytics scope to the same
sign-in (one Connect again), a property ID field in section 4, and a nightly
sync into Online › Website.
