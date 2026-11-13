# Subversive Ops

The back-office app for Subversive, a single-site brewery restaurant. It runs on
Square data and covers food costing, ordering and invoices, the schedule,
timecards and payroll export, the live P&L, reviews, and a weekly brief that
says what needs a manager's attention. Staff use the same app on their phones
for shifts, time off, counts and waste.

## What's in it

| Area | What it does |
|---|---|
| **Overview** | Today so far (sales, labor %, projected close against forecast). Last 7 days of food, beverage, labor and prime cost, profit, sales per labor hour, rating and waste $. Recent price moves, items over target and the next deliveries. |
| **Weekly brief** | Last week against budget, what needs a decision (requests, auto-drafts, invoice issues, low reviews), next week's forecast, then one-tap cards: orders to place, the schedule, price increases, items over target, Square items with no recipe, the margin gap, counts and waste. Emailed and pushed to managers on Sunday. |
| **Live P&L** | Sales − theoretical cost of goods − labor by day and by hour, split food and beverage, with budget and forecast comparisons. Actual cost of goods from counts. |
| **Budgets** | Weekly sales, food cost % and labor % targets with red/amber/green. The P&L, Overview, schedule and brief all measure against them. |
| **Sales & forecast** | Square sync (OAuth connect, webhooks, near-live refresh, resumable history import), item → recipe matching, and a 5-week forecast by day and hour. It accounts for weekdays, seasonality, weather, holidays and events, and you can adjust any day. |
| **Menu costs** | Recipes with sub-recipes, add-ons (Square modifiers), yield loss and any units. Plate cost, food cost %, margin and "price to hit target", recalculated live, with cost history. Draft beer costing. |
| **Ingredients & prices** | A spreadsheet-style ingredient grid with archive and restore. Distributor price sheets (.xlsx/.csv) are imported with column detection, and every price is kept with its date. Managers get alerts when a price rises past the threshold. |
| **Ordering** | Per supplier: forecast usage + buffer − expected stock, rounded to packs. Delivery days, cutoffs and minimums apply. Drafts can be saved automatically before a cutoff. Orders go out by email with a CSV attached. |
| **Invoices** | Snap or upload an invoice and Claude reads it. It's three-way matched against the order and delivery, and duplicates are caught. Clean matches can be auto-approved. Approval keeps an audit trail. Credit requests can be emailed or copied. Exports bills and a sales journal for QuickBooks or Xero. Managers get an alert when an invoice doesn't match. |
| **Counts, waste & margin gap** | Phone-first stock counts and a waste log for staff. The margin gap shows theoretical vs actual usage between two counts, item by item, with likely causes. |
| **Team & schedule** | Positions, rates, availability and logins. Square team sync only fills blanks and flags differences. Schedules are built from the forecast and fitted to the labor budget, with NY compliance checks (overtime, breaks, minors, minimum wage, call-in, spread of hours). Publishing emails and pushes each person their shifts. |
| **My shifts (staff)** | Shifts, open-shift pickup, swaps, time off and sick leave, availability and announcements. Managers are notified when a request comes in. |
| **Labor, tips & payroll** | Timecards from Square, protected once edited or approved. Pay-period approval, NY sick leave accrual, tip pools by hours or points, adjustments, and a payroll CSV with an exceptions list. |
| **Reviews** | Google import plus paste from Yelp, TripAdvisor and OpenTable. Themes, sentiment, reply drafts, "what to fix this month" and rating-drop alerts. New 1–2★ reviews notify managers. |
| **Events** | An events calendar and holidays that feed the forecast. |
| **Notifications** | Email (Resend) and web push (VAPID) with per-person preferences. Covers the schedule, shift changes, request decisions, the weekly brief, price spikes, invoice issues, staff requests and low reviews. |

Power-user bits: **⌘K / `/`** command bar everywhere · inline grid editing
(Enter/↓ moves down, Tab across, paste a column from Excel) · type
`6 oz ground beef` (or paste a whole list) to add recipe lines · in-app help
center and guided tours.

## Architecture

```
src/
  domain/        Pure business logic, no I/O, fully unit-tested
                 costing · forecast · ordering · invoiceMatch · schedule · labor · payroll ·
                 pnl · budgets · reviews · alerts · teamSync · weekRecap · units · dates …
  server/        Server-only code
    services/    Use-cases composing domain + database (costing, planning, sales, priceImport…)
    integrations/            Square REST client (OAuth, catalog, orders, labor), Claude, Google Places,
                             Resend email, weather
    email/                   Email templates, notification preferences, supplier emails
    actions/     Shared server actions (inline grid edits)
    auth.ts, session.ts      PIN login, signed cookie sessions, lockout
  app/           Next.js App Router — pages are server components; each feature
                 folder keeps its own actions.ts and client components
  components/    Design system (ui.tsx), grid cells, command bar, chart
prisma/          Schema, migrations, demo seed
```

Rules that keep it trustworthy as it grows:

- **Prices are append-only.** "Cost today" and "cost on March 1st" are the same
  query with a different date — no snapshot tabs.
- **Quantities are stored in one base unit per ingredient** (g, ml or each) and
  converted at the edges.
- **Business dates are `YYYY-MM-DD` in the business timezone** (`BUSINESS_TIMEZONE`).
- **Domain code never imports the database.** Swap the forecaster for a smarter
  model later without touching ordering or the UI.

## Develop

```bash
cp .env.example .env        # fill DATABASE_URL + SESSION_SECRET
npm install
npm run db:migrate
npm run db:seed             # demo data; logins Max/1234, Line/0000
npm run dev
npm test                    # domain unit tests
npm run typecheck && npm run lint
```

## Deploy

Vercel + Postgres (Neon). `npm run build` runs migrations. Every environment
variable is listed with comments in `.env.example`.

### Scheduled jobs (`vercel.json`)

All cron routes require `CRON_SECRET`: Vercel Cron sends it as a Bearer
token, and without it every route answers 401 and **nothing runs on
schedule**. Times are UTC.

| Route | When | What it does |
|---|---|---|
| `/api/cron/square-sync` | Daily 09:17 | Catalog, the last 3 days of sales, team and timecards from Square. |
| `/api/cron/weather` | Daily 10:07 | Weather forecast for the sales forecast (Open-Meteo, no key). |
| `/api/cron/daily-ops` | Daily 10:23 | Auto-drafts supplier orders before their cutoff, imports new Google reviews (alerting on 1–2★), sends price-spike alerts, and on Fri/Sat drafts next week's schedule if auto-draft is on. |
| `/api/cron/weekly-brief` | Sun 21:13 | Emails and pushes the weekly brief to managers. |

### External accounts

Everything works without these; each one turns a feature on.

| Account | Variables | Turns on | Without it |
|---|---|---|---|
| Square Developer app (Production) | `SQUARE_APPLICATION_ID`, `SQUARE_APPLICATION_SECRET`, `SQUARE_WEBHOOK_SIGNATURE_KEY`, `SQUARE_WEBHOOK_URL` | "Connect with Square" and webhooks (near-live sales and labor) | Paste an access token in Settings → Square. Data refreshes on page views and nightly. |
| Vercel | `CRON_SECRET` | The scheduled jobs above | Nothing runs on schedule. |
| Anthropic | `ANTHROPIC_API_KEY` | Invoice reading, review analysis and reply drafts, "what to fix" | Invoices typed by hand. Reviews use keyword themes and template replies. |
| Google Cloud (Places API (New)) | `GOOGLE_PLACES_API_KEY` + a Place ID saved on /reviews | Google review import, daily | Paste reviews in. |
| Resend (verified domain) | `RESEND_API_KEY`, `EMAIL_FROM` | Emailing POs and credit requests, notification emails | Copy, `mailto:` or download instead. Notification emails are skipped. |
| Web push (self-generated) | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Push notifications (staff on iPhone add the app to the Home Screen) | Push toggles show "not set up". |
| — | `APP_URL` (optional on Vercel) | Correct links in emails and pushes | Falls back to the Vercel URL. |

Also check before going live: the payroll CSV columns against your payroll
provider's import, and the account names on Invoices → Exports against your
chart of accounts.

### Connecting Square

Square is connected **from inside the app** (Settings → Square). The
connection — tokens, merchant, chosen locations — is stored in the database
encrypted with AES-256-GCM (key derived from `SESSION_SECRET`; tokens never
reach the browser). Rotating `SESSION_SECRET` therefore disconnects Square.

**1. Create the Square app (once, by whoever manages hosting)**

1. Go to **developer.squareup.com/apps**, sign in with the restaurant's Square
   account and press **+ / Create an application**. Name it "Subversive Ops".
2. Switch the toggle at the top to **Production**.
3. **OAuth** page → **Redirect URL**:
   `https://subversive-ops.vercel.app/api/square/oauth/callback` → Save.
   Copy the **Application ID** and the **Application secret** (press Show).
4. **Webhooks → Subscriptions → Add subscription** (Production):
   - URL: `https://subversive-ops.vercel.app/api/webhooks/square`
   - API version: `2025-10-16`
   - Events: `order.created`, `order.updated`, `payment.created`,
     `payment.updated`, `refund.created`, `refund.updated`,
     `labor.timecard.created`, `labor.timecard.updated`,
     `labor.timecard.deleted`, `catalog.version.updated`
   - Save, then copy the subscription's **Signature key**.
5. In Vercel → Project → Settings → Environment Variables (Production), set:

   | Variable | Value |
   |---|---|
   | `SQUARE_ENVIRONMENT` | `production` |
   | `SQUARE_APPLICATION_ID` | Application ID from step 3 |
   | `SQUARE_APPLICATION_SECRET` | Application secret from step 3 |
   | `SQUARE_WEBHOOK_SIGNATURE_KEY` | Signature key from step 4 |
   | `SQUARE_WEBHOOK_URL` | `https://subversive-ops.vercel.app/api/webhooks/square` (exactly as registered) |
   | `CRON_SECRET` | any long random string (protects the scheduled jobs) |

   Redeploy.

Scopes requested on connect (read-only): `MERCHANT_PROFILE_READ ITEMS_READ
ORDERS_READ PAYMENTS_READ EMPLOYEES_READ TIMECARDS_READ
TIMECARDS_SETTINGS_READ INVENTORY_READ`.

**2. Connect (the owner, in the app)**

Settings → **Square** → **Connect with Square** → sign in to Square → **Allow**.
Every active location is selected; deselect any you don't want (keep the
Square Online location if you sell online). OAuth access tokens last 30 days
and are renewed automatically when fewer than 7 days remain; **Disconnect**
revokes the app's access.

**Alternative: paste a token.** Without the OAuth variables, use **Paste an
access token instead** with the **Production → Access token** from the
app's **Credentials** page. It is checked against `/v2/merchants/me` before
it's saved. (Personal access tokens don't expire.) Legacy
`SQUARE_ACCESS_TOKEN` + `SQUARE_LOCATION_ID` env vars still work as a
fallback when nothing is connected in the app.

**3. First import**

Settings → Square → **First import**: pick 3, 6 or 12 months → **Start
import**. It runs a week at a time (menu and team first, then sales and
timecards, newest weeks first) and can be paused and resumed. Then open
**Sales → Menu from Square** to accept suggested recipe matches, create
recipes for the rest and line up menu prices with Square.

**Staying fresh.** Webhooks resync the affected day within seconds; pages
(Overview, Sales, P&L, Timecards, Brief) top up today + yesterday in the
background when the last refresh is over 15 minutes old; the nightly cron
re-syncs the catalog, the last 3 days of sales and labor. Timecards a manager
edited or approved in the app are never overwritten.

**Sandbox.** Set `SQUARE_ENVIRONMENT=sandbox`, use the app's **Sandbox**
Application ID/secret, add the same redirect URL on the Sandbox OAuth page, and
open the sandbox test account's dashboard (Developer Dashboard → Sandbox test
accounts → Open) before pressing Connect. All Square hosts switch to
`connect.squareupsandbox.com`.

## Roadmap

- Google Business Profile API: full review history and posting replies from the app.
- Accounting API push (QuickBooks / Xero) instead of CSV files.
- Vacation/PTO accrual alongside NY sick leave; salaried staff in payroll.
- Brewery: batch logs, kegs, TTB reporting.
