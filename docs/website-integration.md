# Website integration: the contract between Ops and the public website

Max runs everything guests see from Ops (**Website** in the nav, manager-only). The public
website (`theoquimby/subversive-website`, Next.js) reads a few public, read-only Ops feeds
and falls back to its own `content/*` files whenever a feed is down or invalid, so the
site never breaks while Ops catches up.

```
Ops (Website hub, Events, Kegs → Beers, Settings → Business)
  │  save ──► pingWebsite() ──POST /api/revalidate (x-revalidate-secret)──► website
  │                                                                          │
  └── GET /api/public/{site,menu,events,taps,images/:id,instagram} ◄──── reads every 5 min / on ping
      POST /api/public/inquiry ◄──── private-event form
      POST /api/public/collect ◄──── analytics beacon (see docs/website-analytics.md)
```

Every feed is checked against a zod schema in `src/domain/websiteSchema.ts` that mirrors
the website's own schemas (`src/lib/menu/schema.ts`, `src/lib/events/schema.ts`,
`src/lib/site/schema.ts`). Ops validates its own output before sending it. A row that
would fail is left out and named on the Website hub. **If the website changes a schema,
change the mirror too** (tests: `src/domain/__tests__/website.test.ts`).

## Common rules for the GET feeds

| | |
|---|---|
| Auth | None. `/api/public/*` is exempt from login (`src/middleware.ts`). |
| CORS | `Access-Control-Allow-Origin: *`, `GET, OPTIONS`. |
| Caching | `Cache-Control: public, s-maxage=300, stale-while-revalidate=3600`. |
| Errors | `503 {"error": "..."}` with `Cache-Control: no-store`. The website should treat any non-200, redirect or non-JSON answer as "use your own file". |
| Time | Dates `YYYY-MM-DD` and times `HH:mm` (24 h), New York wall time. `timezone` is always `"America/New_York"`. |
| Privacy | Guest-facing fields only. Never costs, recipes, suppliers, keg codes, sales, forecast impact, private bookings or internal notes. |

Production base URL: `https://subversive-ops.vercel.app`.

---

## 1. `GET /api/public/site`: hours, notice, contact

Source: Settings → Business (opening hours, seasonal hours, name, address, phone, email)
plus Website → Hours & notice (exact minutes, kitchen close, notice, links, phone note).

```json
{
  "timezone": "America/New_York",
  "hours": {
    "mon": { "open": "16:30", "close": "20:00", "kitchenClose": "20:00" },
    "tue": null,
    "wed": { "open": "16:30", "close": "20:00", "kitchenClose": "20:00" },
    "thu": { "open": "16:30", "close": "20:00", "kitchenClose": "19:45" },
    "fri": { "open": "16:30", "close": "20:30", "kitchenClose": "20:15" },
    "sat": { "open": "12:00", "close": "20:30", "kitchenClose": "20:15" },
    "sun": { "open": "12:00", "close": "18:30", "kitchenClose": "18:15" }
  },
  "notice": { "text": "Closed Thanksgiving Day. Open late for every Knicks game this month.", "until": "2026-11-25" },
  "season": null,
  "seasons": [],
  "name": "Subversive",
  "address": { "street": "96 West Bridge Street", "city": "Catskill", "state": "NY", "zip": "12414", "geo": null },
  "phone": { "display": "(518) 303-1270", "tel": "+15183031270", "note": "Only answered during taproom hours." },
  "email": "hello@drinksubversive.com",
  "links": {
    "order": "https://subversiveonline.square.site/",
    "map": "https://g.page/subversivebeer?share",
    "instagram": "https://www.instagram.com/subversivebeer/",
    "facebook": "https://www.facebook.com/subversivemaltnbrew/"
  },
  "updatedAt": "2026-11-15T22:35:29.657Z",
  "announcements": [
    { "id": "closed-thanksgiving-day-2026-11-16", "text": "Closed Thanksgiving Day.", "tone": "closure", "from": "2026-11-20", "until": "2026-11-26" },
    { "id": "oktoberfest-is-october-2-and-3-2026-11-16", "text": "Oktoberfest is October 2 and 3.", "tone": "event", "link": { "href": "/events/2027-10-02-oktoberfest", "label": "Details" } }
  ]
}
```

- `announcements` (Website → Announcements, model `WebAnnouncement`; never the internal
  `Announcement`): the band under the header, exactly the shape in the website's
  `docs/ops-feed-requests.md` and `src/lib/site/announcements.ts`. Active ones, in Max's order,
  whose `until` hasn't passed; future ones are sent too, with `from` (the website keeps those that
  stand on its New York day and shows the first three). `id` ≤ 64 and stable (Ops mints a new
  one only on "Show again to people who closed it"), `text` ≤ 140, `tone` `closure | event | info`,
  `link` only when set (`href` a `/path` on the website or `https://`, `label` ≤ 40), `from` /
  `until` only when set. Saving pings the website with `{"tags":["site"]}`.
- `hours`: the week **in force today**, seasonal hours applied. Same shape as `site.json → hours`
  (`null` = closed that weekday). Ops keeps whole hours. The exact minute and kitchen close
  are layered on top, and an exact time that no longer fits the Ops hours is ignored, so a
  change in Settings → Business never leaves the website wrong. Midnight is sent as `23:59`.
- `seasons`: every season with its own week and its `MM-DD` window (inclusive, may wrap the
  year), so the site can work out future dates. `season` is the label in force today.
- `notice`: `null`, or one line (≤ 280 chars) with `until` = the last day it shows
  (inclusive, `null` = until removed). Ops stops sending it after `until`. The website should
  still hide it after `until` in case its cache is old. This is never the internal
  `Announcement` model.
- `name`, `address`, `phone`, `email`: each is `null` when not filled in, or when it doesn't
  parse (address must read "street, town, ST 12345"; phone must be a US number). On `null`,
  keep the value from `site.json`.
- `links`: only the keys set in Ops. Any of `order`, `eGiftCard`, `map`, `instagram`,
  `facebook`, `bandBookingForm`. Merge over `site.json → links`.
- One-off closures and late nights are **events** (below), not hours.

## 2. `GET /api/public/menu`: the website menu

Exactly the website's menu shape (`src/lib/menu/schema.ts`, the same as `content/menu.json`),
strict objects throughout. Built from:

- **Draft beer**: what's on tap now (Kegs tap list, in board order). The style, ABV,
  description, color and pour prices come from Kegs → Beers. The family group, badge, hazy and
  on/off are set on Website → Menu. House beers go in section `house-beer` and guest beers in
  `guest-beer`. Groups are `Light | Hoppy | Malty | Farmhouse | Sour | Other` (the website's
  drink filters read the group title). `prices.full` is the biggest pour, and `prices.half` is the
  pour nearest 60 % of it (tasters don't count). A beer missing style, ABV or two sizes is sent
  as a plain item with one `price`, which is valid for the schema.
- **Food and other drinks**: menu recipes and add-ons (`Recipe.kind` MENU / MODIFIER) with
  **On website = Yes**, each with a web name, description, an extras line (`modifiers`), tags
  (`vegetarian`, `vegan`, `kid-friendly`, `dog-friendly`), a badge and an optional seasonal
  window. The price is the Menu costs price unless hidden. Food is grouped into sections by
  category (or a typed section). Sections have a heading, intro, extras and order. Drinks that
  aren't draft beer go under `other-beverages`, grouped the same way. Beer pour recipes
  (category "Beer") are never sent: draft comes from the tap list. Archived recipes and items
  past `availableUntil` are left out.
- `notices`: the lines under the menu (default: the allergy and raw-food notes).
- `_meta`: `{ "source": "Subversive Ops", "verify": [], "pourSizes": {"half","full"}, "updated": "YYYY-MM-DD" }`.
  `updated` is the date of the last web-menu change.

```json
{
  "_meta": { "source": "Subversive Ops", "verify": [], "pourSizes": { "half": "8 oz", "full": "16 oz" }, "updated": "2026-11-15" },
  "drinks": [
    {
      "id": "house-beer",
      "title": "House-brewed beer",
      "groups": [
        { "title": "Hoppy", "items": [
          { "name": "New York Nectar", "description": "Citra and Mosaic, soft and juicy with a little pine.", "style": "Hazy IPA", "abv": 6.8, "prices": { "half": 5, "full": 8 }, "color": "#f0a64a" }
        ] }
      ]
    },
    { "id": "other-beverages", "title": "Other beverages", "groups": [
      { "title": "Cocktails", "items": [ { "name": "Classic Gin & Tonic", "description": "Spirits Lab East End Gin, Fever Tree tonic, lime.", "price": 14 } ] }
    ] }
  ],
  "food": [
    {
      "id": "burgers",
      "title": "Subversive smash burgers",
      "intro": "Local beef, smashed thin, on a See & Be milk bun.",
      "items": [
        { "name": "Bacon Barbecue Burger", "description": "Lettuce, American cheese, house-made pickles, Subversive Sauce.", "price": 20, "badge": "Most loved" },
        { "name": "Classic Burger", "description": "Lettuce, American cheese, house-made pickles, Subversive Sauce.", "price": 18 }
      ]
    },
    { "id": "salads", "title": "Salads", "items": [
      { "name": "Greek Salad", "description": "Mixed greens, cucumber, red onion, tomato, croutons.", "price": 12, "tags": ["vegetarian"], "seasonal": true, "availableFrom": "2026-11-01", "availableUntil": "2027-03-31" }
    ] }
  ],
  "notices": ["If you have a food allergy or intolerance, please notify us.", "*Consuming raw or undercooked meats, poultry, seafood, shellfish or eggs may increase your risk of foodborne illness."]
}
```

While nothing is turned on, `food` and `drinks` (apart from what's on tap) are empty. The
website should keep `menu.json` until the feed has food (see the checklist).

## 3. `GET /api/public/events?days=120&pastDays=0`: events and closures

The existing feed, now with every optional field the website already parses.

| Param | Default | Max | Meaning |
|---|---|---|---|
| `days` | 120 | 365 | Days ahead from today (min 1) |
| `pastDays` | 0 | 365 | Days back from today, for past event pages |

```json
{
  "timezone": "America/New_York",
  "events": [
    {
      "id": "cmwiekl0o005e7d39taoufyxj",
      "date": "2026-11-17",
      "title": "Subversive Overtime: Knicks vs. Blazers",
      "kind": "GAME",
      "closed": false,
      "startTime": "19:30",
      "endTime": "22:00",
      "description": "We're staying open late for Knicks basketball. Tipoff at 7:30.",
      "slug": "2026-11-17-subversive-overtime-knicks-vs-blazers",
      "imageUrl": "https://subversive-ops.vercel.app/api/public/images/cmwiey5kr00067dxxfnzt4nse",
      "imageAlt": "The bar packed for a Knicks game",
      "kitchenCloseOverride": "20:15",
      "featured": true,
      "updatedAt": "2026-11-15T22:35:44.197Z"
    },
    {
      "id": "cmwiekl0s005f7d393uwiggxu",
      "date": "2026-11-20",
      "title": "Trivia with Smarty Pints",
      "kind": "TRIVIA",
      "closed": false,
      "startTime": "18:30",
      "endTime": "20:30",
      "description": "Biweekly trivia. The winning team takes home a 4-pack.",
      "slug": "2026-11-20-trivia-with-smarty-pints",
      "priceLabel": "Free",
      "updatedAt": "2026-11-15T22:25:11.022Z"
    },
    {
      "id": "cmwiekl0z005i7d39fj3uyzp0",
      "date": "2026-12-05",
      "title": "Closed for a staff day",
      "kind": "CLOSURE",
      "closed": true,
      "startTime": null,
      "endTime": null,
      "description": null,
      "slug": "2026-12-05-closed-for-a-staff-day",
      "updatedAt": "2026-11-15T22:25:26.763Z"
    }
  ]
}
```

- Always present: `id, date, title, kind, closed, startTime, endTime, description` (as before).
- `kind`: `GAME | MUSIC | FESTIVAL | OTHER | HOLIDAY | CLOSURE`, plus the finer `TRIVIA | MOVIE`
  set on Website → Events. The website's reader maps unknown kinds to `OTHER` and keeps
  `kindRaw`, so it already works. It can use `kindRaw` for the Trivia & movies chip instead of
  matching the title.
- `closed`: `true` for `CLOSURE`, and for `HOLIDAY` when Website → Events → Holidays is set to
  "Mean closed" (default: holidays stay open, as before). Max can also override one event
  (Closed / Open).
- `slug`: stable. It's set once from `date-kebab(title)` (the same `kebab` as the website's
  `src/lib/events/slug.ts`) the first time the event is published, and doesn't change when the
  title does. Max can edit it. Always `YYYY-MM-DD-words`, so `parseSlug` works for past pages.
- `imageUrl` (+ `imageAlt`): an absolute URL to `GET /api/public/images/:id`. The image is
  WebP/JPEG, ≤ 1600 px on the long side, and `Cache-Control: public, max-age=31536000, immutable`
  (a new upload gets a new id).
- Optional and only present when set: `ticketUrl`, `rsvpUrl` (http/https), `priceLabel`,
  `kitchenCloseOverride`, `barCloseOverride` (`HH:mm`), `featured: true`, `updatedAt` (ISO,
  latest of the event and its web fields).
- Never sent: `PRIVATE` events, events hidden on Website → Events, forecast impact.
- `page` (Website → Events → Add page; `WebEvent.page`, `heroImageId`, `heroAlt`): a featured
  event's own page, only when something is set, in the website's `eventPageSchema` shape:

  ```json
  "page": {
    "hero": "https://subversive-ops.vercel.app/api/public/images/cm3x0hero00001",
    "heroAlt": "The long tables in the yard",
    "intro": "Two days in the yard.",
    "sections": [{ "title": "Food", "body": "Brats and pretzels.\n\nAnd a vegan plate." }],
    "schedule": [{ "time": "12:00", "what": "First pour" }],
    "links": [{ "label": "Tickets", "href": "https://tickets.example.com/okt" }]
  }
  ```

  `hero` is `publicOrigin()` + `/api/public/images/<WebImage id>`, so it is always on the Ops
  origin (set `NEXT_PUBLIC_OPS_ORIGIN=https://subversive-ops.vercel.app` on the website, or it
  won't show it). Ops only accepts a landscape photo at least 1600 px wide (read from the file
  itself) and stores it at up to 2000 px wide. `hero` is left out when Ops is served over plain
  http (local development). Limits: intro 600, 8 sections (title 80, body 4000, paragraphs at
  blank lines), 24 schedule rows (`time` 20 in any wording, `what` 140), 6 links (`https://`
  only, label 60), `heroAlt` 200. Each part is left out when empty; a page that wouldn't pass is
  left off and the event still goes. Saving pings the website with `{"tags":["events"]}`.

## 4. `GET /api/public/taps` and `GET /api/public/images/:id`

- `/api/public/taps`: the live tap list for a "what's pouring" widget (unchanged, 60 s cache).
  The menu feed already includes draft beer, so the website doesn't need both.
- `/api/public/images/:id`: event pictures and event-page photos (see above). 404 when gone.

## 4b. `GET /api/public/instagram`: the latest Instagram posts

The five latest posts from what Ops already brings in each night from Instagram (Online →
Instagram, table `OnlinePost`). Ops never calls Instagram for this request, so the website needs
no Instagram token of its own.

```json
[
  {
    "id": "17912345678901234",
    "caption": "Festbier is on. First pour at noon.",
    "mediaType": "IMAGE",
    "mediaUrl": "https://scontent-lga3-1.cdninstagram.com/v/t51.29350-15/…&oe=6745A1B2",
    "thumbnailUrl": null,
    "permalink": "https://www.instagram.com/p/DCabc123/",
    "timestamp": "2026-11-15T18:02:11.000Z"
  },
  {
    "id": "17998765432109876",
    "caption": "Knicks night in the tent.",
    "mediaType": "VIDEO",
    "mediaUrl": null,
    "thumbnailUrl": "https://scontent-lga3-1.cdninstagram.com/v/t51.71878-15/…&oe=6746B3C4",
    "permalink": "https://www.instagram.com/reel/DCxyz789/",
    "timestamp": "2026-11-14T23:40:00.000Z"
  }
]
```

- A bare array, newest first, at most five. `[]` until Instagram is connected in Ops.
- `mediaType`: `IMAGE | VIDEO | CAROUSEL_ALBUM` (Instagram's own names; reels are `VIDEO`).
  The picture is `mediaUrl` for `IMAGE` and `CAROUSEL_ALBUM` (a carousel's first picture) and
  `thumbnailUrl` (the cover) for `VIDEO`. Ops keeps only pictures, never a video's own address, so
  a `VIDEO`'s `mediaUrl` is `null`.
- `caption`: the first couple of hundred characters on one line (what Ops stores), or `null`.
- Picture addresses are Instagram's (`*.cdninstagram.com` / `*.fbcdn.net`). **They expire**: they
  are signed, and `oe=` is the expiry (hex Unix seconds), typically days to a few weeks out. The
  nightly Meta sync (`/api/cron/web-analytics`, 08:41 UTC) reads the latest 50 posts again and
  saves fresh addresses, so the five here stay fresh while Instagram is connected. A post whose
  address runs out within two hours (e.g. the sync stopped because the sign-in needs connecting
  again) is left out rather than sent broken.
- Caching: `public, s-maxage=1800, stale-while-revalidate=3600`. Errors: `503` as the other feeds.

### What the website changes to read it (instead of `INSTAGRAM_ACCESS_TOKEN`)

In `src/lib/social/instagram.ts`:

1. Replace `fetchMedia(token)` with a fetch of `opsBase() + "/api/public/instagram"` through the
   existing `fetchOps` helper (`src/lib/ops/fetch.ts`), and parse `z.array(z.unknown())` instead
   of the `{ data }` envelope. Map each item to the existing `mediaSchema` field names:
   `media_type ← mediaType`, `media_url ← mediaUrl`, `thumbnail_url ← thumbnailUrl`, the rest
   as is. `parseMedia` and `isInstagramCdn` stay unchanged.
2. `getInstagramPosts`: gate on `opsBase()` instead of `process.env.INSTAGRAM_ACCESS_TOKEN`.
   Keep `unstable_cache(..., ["instagram-media"], { revalidate: 3600, tags: ["instagram"] })`
   and the `[]` on any failure. **Fallback**: no Ops base, a non-200, or an empty list renders
   nothing, exactly as without a token today.
3. `next.config.ts`: change `const INSTAGRAM = Boolean(process.env.INSTAGRAM_ACCESS_TOKEN)` to
   `Boolean(process.env.OPS_BASE_URL)`, so `*.cdninstagram.com` and `*.fbcdn.net` stay allowed
   in `images.remotePatterns` and the CSP `img-src`.
4. Then remove `INSTAGRAM_ACCESS_TOKEN` from Vercel and the 60-day refresh reminder from
   `docs/announcements-and-instagram.md`.

## 5. `POST /api/public/inquiry`: private-event inquiries

The website's "Book a private event" form posts here. Each inquiry becomes a **PrivateEvent
at INQUIRY** (Events → Private, via `createInquiry` in `src/server/services/privateEvents.ts`),
shows in Website → Inquiries, and notifies managers (event `inquiries`, email + push by
default, per Settings → Notifications).

Body: JSON (`application/json`), or form fields (`application/x-www-form-urlencoded` /
`multipart/form-data`). Bodies over 20 KB are refused.

| Field | Rules |
|---|---|
| `name` | required, ≤ 120 |
| `email` | email, ≤ 200 |
| `phone` | 7–15 digits |
| | **email or phone required** |
| `date` | `YYYY-MM-DD`, today or later (optional) |
| `guests` | whole number 1–2000 (optional) |
| `type` | free text ≤ 60, e.g. "Birthday", "Rehearsal dinner", "Corporate", "Buyout" (mapped to the pipeline's types; the text is kept) |
| `message` | ≤ 2000 |
| `website` | **honeypot**: render it hidden from people (off-screen, `tabindex=-1`, `autocomplete=off`). It must be empty. |

Responses:

| Status | Body | When |
|---|---|---|
| 200 | `{"ok":true}` | Saved. Also returned to bots (honeypot filled, or more than two links in the message), which are dropped silently. |
| 400 | `{"ok":false,"error":"Check the email address.","field":"email"}` | Validation. `field` names the input to mark. |
| 403 | `{"ok":false,"error":"Not allowed from this site."}` | Browser `Origin` isn't the website |
| 413 | `{"ok":false,"error":"That's too long."}` | Body over 20 KB |
| 429 | `{"ok":false,"error":"We've got your earlier message. We'll be in touch soon."}` + `Retry-After: 3600` | More than 3 per hour or 8 per day from the same sender |
| 500 | `{"ok":false,"error":"Something went wrong. Please email or call us instead."}` | Unexpected |

CORS: browsers may post only from the origin in `WEBSITE_URL` (and its `www.`/apex twin).
There is no wildcard. Two ways to post:

1. **From the browser** (simplest): `fetch(OPS + "/api/public/inquiry", { method: "POST", headers: {"content-type": "application/json"}, body })`.
   The preflight answers for the website's origin.
2. **From the website's server** (a route handler or server action): send
   `x-revalidate-secret: <REVALIDATE_SECRET>` and the guest's IP as `x-client-ip`. The
   rate limit then counts per guest, not per Vercel function.

IPs are never stored, only an HMAC of them (for the rate limit).

## 6. The revalidate ping (Ops → website)

When Max saves anything website-facing, Ops calls:

```
POST {WEBSITE_URL}/api/revalidate
x-revalidate-secret: {REVALIDATE_SECRET}
content-type: application/json

{"tags":["events","site"],"source":"subversive-ops"}
```

- Triggers: Website hub edits (notice, exact hours, links, menu web fields, sections, beer web
  fields, event web fields, pictures, the holiday setting), Events (add/edit/delete/holidays),
  Settings → Business (contact, hours, seasons), Kegs (keg actions such as tap/kick/undo,
  beer details, labels, board order) and Menu costs (recipe save/archive/restore).
- `tags` is a hint: `events`, `menu`, `site`. The website's route today ignores the body and
  revalidates `events`. It should revalidate the tags sent (see the checklist).
- Ops debounces (2.5 s per server instance, so a burst of edits sends one ping), sends it after
  the response with `after()` (it never blocks or fails a save), times out after 8 s, and keeps
  the last result (`Setting website.ping.last`), which shows on Website → Overview. Failures are
  logged (`website revalidate ping failed: …`). When it isn't configured, nothing is sent and
  the website catches up within 5 minutes.
- Expected answers: `200` = refreshed; `401` = the secrets differ.

### Setting up the secret (both Vercel projects)

1. Pick a secret: on Ops, Settings → Connections → **Website** → step 2 → **Make one** (shown
   once), or use one the website already has. It must be at least 16 characters, with no spaces.
2. **Website project** (Vercel → subversive-website → Settings → Environment Variables):
   `REVALIDATE_SECRET=<secret>` for Production (and Preview if wanted). Redeploy.
3. **Ops**: paste it in Settings → Connections → Website (stored encrypted in the database),
   with the website address, e.g. `https://drinksubversive.com`. Environment variables
   `WEBSITE_URL` and `REVALIDATE_SECRET` on the Ops Vercel project also work as a fallback, and a
   value saved in the app wins.
4. Press **Send a test refresh**. It should say "Working — the website accepted the secret and refreshed."

`WEBSITE_URL` also sets which origin may post the inquiry form.

## 7. Analytics collector (built separately)

`POST /api/public/collect` takes the website's privacy-friendly analytics beacon and feeds
Website → Analytics. The contract (payload, CORS, the `NEXT_PUBLIC_OPS_COLLECT_URL` env var
on the website) is in **docs/website-analytics.md**.

## 8. What's editable in Ops, and what the website still holds

| Block | Status |
|---|---|
| Events, closures, late nights | **Live**: the website reads `/api/public/events` today |
| Weekly hours + kitchen close, notice | Ready in Ops; the website needs a reader (checklist) |
| Address, phone, email, links | Ready in Ops; the website needs a reader |
| Menu and draft list | Ready in Ops; the website has the `MenuSource` seam (`opsMenuSource`) |
| Private event form | Ready in Ops; the website has no form yet |
| Visit notes (seating, tent, parking, dogs, gift cards), about/founders, brewery paragraphs, sourcing line + list, band booking line, privacy | **Request**: still in `content/site.json`, with no seam to override. If the website adds an optional `content` block to its site reader, Ops can serve these as free text in `/api/public/site` (same keys as `site.json`). Ops doesn't invent them now. |
| Photos and captions (`content/photos.ts`) | **Request**: static imports, no seam. Event pictures already come from Ops. |
| Buttons and labels (`content/microcopy.ts`) | Code by design (spec §7). Not editable. |

---

## What the website session should do (checklist)

1. **Events**: set `EMPTY_FEED_USES_SEED = false` in `src/lib/events/source.ts` once Max has
   entered events (Ops now holds the calendar). Consider reading `?days=120&pastDays=90` so past
   event pages resolve from the feed, and use `kindRaw` (`TRIVIA`/`MOVIE`) in `classify()`.
2. **Revalidate route**: in `src/app/api/revalidate/route.ts`, read the JSON body
   `{ tags?: string[] }` and `revalidateTag()` each of `events`, `menu` and `site` that's sent
   (default: all three). Keep the 401 on a wrong secret.
3. **Site reader**: add `src/lib/site/ops.ts`. Fetch `${OPS}/api/public/site` with
   `unstable_cache(..., { revalidate: 300, tags: ["site"] })`, `redirect: "manual"`, and
   status 200 + JSON required. Validate with zod (the shape in §1). Merge it over `site.json`:
   `hours` and `timezone` replace; `address`, `phone`, `email` and `name` replace only when
   non-null; `links` merge key by key. `getSite()` becomes async (or a cached merged getter),
   and on any failure it's `site.json` as today. Show `notice` (hide it after `until`).
4. **Menu reader**: add `opsMenuSource` in `src/lib/menu/` that fetches `/api/public/menu`
   (tags `["menu"]`, 300 s), parses it with the existing `menuSchema`, and falls back to
   `fileMenuSource` on failure **or when `food` is empty** (until Max turns items on). Select it
   with `MENU_SOURCE=ops`.
5. **Inquiry form**: build the private-event form (name, email, phone, date, guests, type,
   message, hidden `website` honeypot). Post per §5 and show `error` beside `field` on 400.
   Set `NEXT_PUBLIC_OPS_URL` (or post through a server action with `x-client-ip`).
6. **Env vars** on the website project: `REVALIDATE_SECRET` (same as Ops), `OPS_EVENTS_URL`
   (exists), plus the base URL for the new readers (e.g. `OPS_BASE_URL=https://subversive-ops.vercel.app`),
   and `NEXT_PUBLIC_OPS_COLLECT_URL` for analytics.
7. **Images**: allow the Ops host in `next.config` `images.remotePatterns` (or use a plain
   `<img>`) for `imageUrl`.
8. **Content seams (optional, later)**: if visit notes, about, brewery or sourcing should be
   editable by Max, add an optional `content` block to the site reader and ask Ops to serve it.

Verified locally on 2026-11-15: the website (`next dev`) with
`OPS_EVENTS_URL=http://localhost:3224/api/public/events` rendered the Ops events on `/events`
(not the seed) and the event page at the Ops slug, with no "dropped a malformed event"
warnings. The website's real `content/menu.json` passes Ops's mirrored `menuSchema`, and Ops's
pings to `/api/revalidate` returned 200.
