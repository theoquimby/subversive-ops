# Subversive Ops

Internal back-of-house tools for Subversive — food costing that stays live as
distributor prices move, forecast-driven ordering from Square sales, and
phone-first stock counts for staff.

## What's in it (Phase 1)

| Area | What it does |
|---|---|
| **Prices** | Import a distributor price sheet (.xlsx/.csv) as downloaded — columns are detected and remembered per supplier, every change is previewed before saving. Local suppliers are updated inline. Every price is kept with its effective date. |
| **Menu costs** | Recipes with sub-recipes (sauces, doughs), add-ons (Square modifiers), yield loss and any units. Plate cost, food cost %, margin and "price to hit target", recalculated live; six-month cost history. |
| **Ingredients** | Spreadsheet-style grid; custom units ("1 slice = 21 g"), pack sizes, preferred supplier product. |
| **Ordering** | Per supplier: forecast sales × recipes + buffer − stock you'll have on delivery day, rounded to whole packs. Save → copy/email/CSV → check in the delivery. |
| **Sales** | Square sync (OAuth connect, webhooks, near-live refresh, resumable history import), item → recipe matching, 7-day forecast with per-day event adjustments. |
| **Counts / Waste** | Staff-only, phone-first. Counts save as you type; Enter jumps to the next item. |

Power-user bits: **⌘K / `/`** command bar everywhere · inline grid editing
(Enter/↓ moves down, Tab across, paste a column from Excel) · type
`6 oz ground beef` (or paste a whole list) to add recipe lines.

## Architecture

```
src/
  domain/        Pure business logic, no I/O, fully unit-tested
                 units · costing · forecast · ordering · priceSheet · quickAdd · dates
  server/        Server-only code
    services/    Use-cases composing domain + database (costing, planning, sales, priceImport…)
    integrations/square*.ts  Minimal Square REST client (OAuth, catalog, orders, labor; shared retrying fetch)
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

Vercel + Postgres (Neon). `npm run build` runs migrations. Environment
variables are listed in `.env.example`. A Vercel Cron job hits
`/api/cron/square-sync` nightly (authorized with `CRON_SECRET`).

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
   | `CRON_SECRET` | any long random string (protects the nightly sync) |

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

- Phase 2 — bar program (many suppliers, few products), supplier website price checks, invoice photo → prices.
- Phase 3 — smarter forecasting (weather, events), labor/scheduling, live P&L.
- Brewery — batch logs, kegs, TTB reporting.
