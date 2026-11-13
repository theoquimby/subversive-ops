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
| **Sales** | Nightly Square sync (orders, refunds, modifiers), item → recipe mapping, 7-day forecast with per-day event adjustments. |
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
    integrations/square.ts   Minimal Square REST client (catalog + orders)
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

1. developer.squareup.com → create an app → **Production** credentials.
2. Copy the access token and the location ID (Locations tab).
3. Set `SQUARE_ACCESS_TOKEN` and `SQUARE_LOCATION_ID` in Vercel, redeploy.
4. In the app: **Sales → Import last 6 months**, then link Square items to recipes.

## Roadmap

- Phase 2 — bar program (many suppliers, few products), supplier website price checks, invoice photo → prices.
- Phase 3 — smarter forecasting (weather, events), labor/scheduling, live P&L.
- Brewery — batch logs, kegs, TTB reporting.
