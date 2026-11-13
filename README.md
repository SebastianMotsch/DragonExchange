# DragonExchange

A Drexel student marketplace using Express, plain HTML/CSS/JavaScript, and Supabase-hosted Postgres.

## Run with Supabase

```bash
npm ci
npm run db:migrate
npm start
```

Before migrating, copy `.env.example` to the Git-ignored `.env` and set:

- `DATABASE_URL`: Supabase Dashboard > Connect. Direct works with IPv6; session pooler also works from IPv4 networks. Replace the password placeholder and percent-encode reserved characters.
- `SESSION_SECRET`: a long random value. Generate one with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
- `PORT`: defaults to 3000.
- `APP_ORIGIN` (optional): the exact public origin, such as `https://example.com`, when deploying behind a proxy.
- `NODE_ENV=production` on an HTTPS deployment enables Secure session cookies. The app trusts one proxy hop in production; match this to the hosting topology.

Apply `sql/schema.sql` once for a new project before `npm run db:migrate`. Migrations create the auction, bid, and wallet structures without clearing existing data. They expect the existing integer `users.id` and boolean `users.verified`.

Open http://localhost:3000. `/health` checks the app; `/health/db` queries the configured database. Credentials remain on the server; no Supabase service key is needed in the browser.

## Accounts and auction creation

Edric's registration routes, form, and login page are included unchanged from his branch. Production login/logout and verification remain his integration work. This branch consumes the agreed `req.session.userId` interface, shares the session with auction sockets, and guards the auction-create page. It does not replace the account-page middleware or dashboard work.

**Production login and email verification are not complete in the published auth branch.** Normal `npm start` uses Edric's routes, including his existing TODOs. The authenticated auction flow is ready to consume his session once that work is merged. Use the isolated demo below to test auction behavior now; its auth adapter is confined to `scripts/` and is never mounted by the normal server.

A verified seller opens Sell > Auction, supplies title, description, category, starting price, and a future deadline, and submits. The backend derives the seller from `req.session.userId` and rechecks verification. The saved auction opens on its detail page and appears in the homepage's most recent 50 non-cancelled auctions.

Prices are stored as integer cents. The form converts local deadlines to UTC; database timestamps include time zones. Invalid fields return readable errors. Photo uploads, condition fields, fixed-price listings, and listing editing remain in their respective team branches/stories.

## Live bidding

The implementation adapts the professor's `../ws/ws/src/server.js` and `game.html` pattern: `createServer(app)`, `new Server(server)`, `socket.join(room)`, and `io.to(room).emit(...)`.

It uses Socket.IO's WebSocket transport and shares Express's Postgres-backed login session. Session and verification checks reject unauthorized handshakes. Browser origins must match the app origin. Active sockets recheck session validity and verification. Edric's logout route can immediately disconnect a session with `req.app.locals.io?.in("session:" + req.sessionID).disconnectSockets(true)`; otherwise the periodic check detects a destroyed session.

- `JOIN_AUCTION_ROOM { auctionId }` joins `auction:<id>` and acknowledges with current database state.
- `LEAVE_AUCTION_ROOM` unsubscribes.
- `PLACE_BID { auctionId, amount, requestId }` uses a decimal amount string and a UUID request ID. Its private acknowledgement reports acceptance or rejection.
- `BID_ACCEPTED` broadcasts committed public auction state only to that room. `AUCTION_STATE` periodically reconciles missed updates and deadline status.

The client subscribes then reconciles state by version, reconnects with capped backoff/jitter, and disables bidding while disconnected. Retrying an unconfirmed bid reuses its request ID to avoid creating a second bid.

Each bid uses one database transaction/client: lock the auction, then affected wallets in user-ID order; validate the deadline, account, price, ownership, and available balance; reserve/release funds; record the bid; update the public state; commit; broadcast. The seller cannot bid on their own auction. The first bid must meet the starting price. Following bids currently require the auction's `min_increment_cents` (default 100 cents); coordinate that default with #9.

A leading bid reserves funds. Being outbid releases the prior hold, while raising your own leading bid holds only the extra amount. Different auctions cannot spend the same available funds. Wallets default to zero; there is no public balance-edit or free-funding endpoint. Stripe/test funding remains #14, and the full wallet ledger remains #24.

This is a single-backend implementation. Broadcasts are not durably replayed; subscription snapshots and periodic refresh recover current state. Bid throttling is in-process (one attempt per user per 500ms). Scheduled settlement (#11/#25) and cancellation (#10) remain unfinished. An expired auction displays ended and rejects bids, but its leading hold stays reserved pending settlement; there is no automatic transfer/release yet.

## Manual demo without shared data

```bash
npm run demo:auctions
```

Open http://127.0.0.1:3001. This separate loopback-only server uses an in-memory Postgres database and a demo-only cookie-login adapter, not your Supabase credentials. The demo login page, session endpoints, and account controls live under `scripts/`; they do not change Edric's production auth files.

| Account | Password | Initial demo balance |
| --- | --- | --- |
| seller@drexel.edu | DemoPass123! | $0 |
| buyer@drexel.edu | DemoPass123! | $1,000 |
| other@drexel.edu | DemoPass123! | $1,000 |

These known credentials exist only in the temporary local demo. Use separate browser profiles (or normal/private windows) for separate users:

1. Log in as seller, open Sell > Auction, and create an auction with a future deadline.
2. Open its detail URL as buyer and other. Place competing bids and confirm both windows update without refreshing.
3. Check the available/reserved amounts after an outbid, refresh to verify persistence, and try a bid above the available balance.
4. Log out and confirm the protected Sell page redirects to Login.

Ctrl+C stops the server and discards demo data. Use the three seeded accounts; registration is not part of this demo. They are explicitly verified test fixtures.

## API and access boundaries

- `GET /api/auctions`: most recent 50 non-cancelled auctions.
- `GET /api/auctions/:id`: public auction details or 404.
- `POST /api/auctions`: verified-session creation; JSON and `X-Requested-With: DragonExchange` required.
- `GET /api/wallet`: current session's total, reserved, and available balance.
- `POST /auth/register`: Edric's existing registration endpoint. His login/logout/verification TODOs remain unchanged. The demo provides its own login/logout/current-user endpoints for isolated auction testing only.

RLS is enabled on auctions, bids, and wallets with no browser API policies. All feature access goes through Express/Socket.IO and a trusted owner/BYPASSRLS database connection. Do not expose that connection or enable permissive CORS. Express sessions are not Supabase Auth JWTs; this implementation does not use Supabase Realtime.

## Verification

```bash
npm test
```

Tests run without Supabase using isolated PGlite databases, real migrations, HTTP requests, bcrypt, cookie sessions, and multiple Socket.IO clients. Edric's registration tests run unchanged. Auction tests use the demo auth adapter to cover authenticated creation, invalid input, ownership/verification, handshake rejection, room isolation, concurrent spending, duplicate requests, holds, reconnect state, logout, and RLS. They do not prove his eventual login/verification implementation works. PGlite serializes its single connection; true multi-connection locking must also be checked against Postgres.

The auction/database work was additionally checked against shared Supabase using temporary verified test accounts, an auth adapter, real HTTP sessions, socket broadcasts, and competing Postgres transactions. The test fixtures were removed afterward. Browser checks used demo auth and covered creation, two competing bidders, refresh, logout, and mobile layout.

Remaining integration work: Edric's actual login/verification/logout, funding/deposits/withdrawals, auction cancellation/settlement, and team listing/photo/dashboard integration. This branch includes main plus Edric's existing registration commits; Steven's fixed-price backend and Sebastian's photo helpers are not merged here. Shared integration files (`server.js`, `app.js`, homepage, and package manifests) will still need coordination when those branches merge.
