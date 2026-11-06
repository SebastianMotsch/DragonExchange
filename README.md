# DragonExchange

A simple starter for a Drexel student auction marketplace, using Express and plain HTML, CSS, and JavaScript.

## Run locally

```bash
npm install
npm start
```

Open **http://localhost:3000**. Press Ctrl+C to stop. Use `npm run dev` to restart automatically when server files change.

## Pages

- Home: `public/index.html`
- Sell: `public/auctions/create.html`
- Dashboard: `public/account/dashboard.html`
- Profile: `public/account/profile.html`
- Login: `public/auth/login.html`

Shared styles and JavaScript live in `public/assets/`. Express serves `public/` as the website root and uses `public/404.html` for missing pages. Backend files stay outside `public/`.

The homepage and auction detail page read saved auctions from the backend. The sell form creates auctions for verified, logged-in users. Authentication routes are still placeholders on main, so creating an auction through the browser depends on the registration/login work being integrated. Profile/dashboard details are still sample data. Bidding, photos, and payments are separate stories.

The pages run without a database or `.env` file. To enable the existing database and session setup later, copy `.env.example` to `.env` and fill in `DATABASE_URL` and `SESSION_SECRET`. `PORT` defaults to `3000`.

`/health` checks the server. `/health/db` checks the database when configured.

## Auction setup (story #13)

1. Copy `.env.example` to `.env` (ignored by Git). In Supabase Dashboard > Connect, copy the Postgres connection string, preferably the session pooler if direct IPv6 connectivity is unavailable. Set `DATABASE_URL` with the database password and set `SESSION_SECRET` to a long random value. Never put either secret in browser code.
2. In the Supabase SQL Editor, apply `sql/schema.sql`, then `sql/migrations/001_auctions.sql`. These scripts create missing tables without clearing existing records. Check the deployed users table still uses integer `id` and boolean `verified` before applying.
3. Restart the app and check `/health/db`. Open the homepage to see saved auctions; an empty database shows an empty state.
4. Once the auth routes are integrated, log in as a verified user, open Sell, submit an auction, and follow the redirect to its details. The homepage shows the most recent 50 auctions.

The backend uses the existing Express session field `req.session.userId` and rechecks `users.verified` during insertion. No test login or authentication bypass is shipped. Sebastian's middleware can replace/consolidate the route guard when integrated. It should also guard the sell page before static serving if page-level protection is desired.

### API

- `GET /api/auctions` → `{ auctions: [...] }`, newest first, up to 50 non-cancelled auctions.
- `GET /api/auctions/:id` → `{ auction: {...} }`, or 404.
- `POST /api/auctions` → 201 and `{ auction: {...} }`. Requires a verified session, JSON content type, and `X-Requested-With: DragonExchange`. Do not enable permissive cross-origin access to this endpoint.

Create payload:

```json
{
  "title": "Calculus textbook",
  "description": "Used for one term.",
  "category": "Books",
  "startingPrice": "15.00",
  "endsAt": "2030-06-01T18:00:00.000Z"
}
```

Use a future deadline. Prices are decimal strings on input and integer cents in storage; the server derives the seller and initial status. The form converts the user's local time to UTC. Supported categories are Books, Electronics, Furniture, Clothing, and Other. The API returns field errors for invalid inputs, 401 for missing sessions, 403 for ineligible users, and 503 when the database is unavailable.

RLS is enabled on `auctions` with no browser API policies. All reads/writes currently go through Express using a trusted database owner/BYPASSRLS connection. Never expose that connection to the browser; a restricted database role will need a deliberately configured backend access policy. This migration does not configure Supabase Auth or Realtime.

Until bidding/lifecycle stories are implemented, auctions show "No bids yet" and an expired active auction reads as ended. This is a display calculation, not persisted closing or settlement. Photos, condition, editing/removal, bidding, scheduled processing, and wallet transfers remain in their own stories.

## Checks

To manually test auction creation before the auth routes are merged:

```bash
npm run demo:auctions
```

Open http://127.0.0.1:3001 and use Sell. This separate, loopback-only server supplies a verified test identity and an in-memory database; it never loads your Supabase credentials. Create an auction with a future end time, check the redirect/detail page, then return Home and refresh to see the saved listing. Try an invalid price or past deadline and confirm that nothing is saved.

Stop with Ctrl+C; all demo auctions disappear. Restart with `npm run demo:auctions -- --unverified` or `npm run demo:auctions -- --anonymous` to check rejection feedback. The fixture does not exercise real login/logout. Normal `npm start` continues to use real sessions and Supabase.

```bash
npm test
```

Tests use an isolated in-memory Postgres engine (PGlite, development dependency only), the real migration, and HTTP requests to the auction router. They cover validation, cents/UTC storage, session/verification checks, seller spoofing, create/list/detail, expiry display, and default-deny RLS. Session fixtures exist only inside the test process. They do not contact Supabase or prove the unfinished login routes work.

Manual integration check after credentials and auth are available: create a verified-account auction, confirm it in Supabase and on both pages, then try a past date, invalid price, logged-out submission, and unverified-account submission. Check missing auction IDs and database-unavailable feedback too.
