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

A verified seller opens Sell > Auction, supplies title, description, category, starting price, and a future deadline, and submits. The backend derives the seller from `req.session.userId` and rechecks verification. The saved auction opens on its detail page and is returned by the auction listing API. The current homepage's regular-listing feed is managed separately.

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

A leading bid reserves funds. Being outbid releases the prior hold, while raising your own leading bid holds only the extra amount. Different auctions cannot spend the same available funds. Wallets default to zero; there is no public balance-edit or free-funding endpoint. A separate test-funding page now credits signed Stripe sandbox payments; withdrawals and the full transfer ledger remain #14/#24.

Bid throttling is in-process (one attempt per user per 500ms). Bid broadcasts use the existing single-backend setup. Deadline and cancellation events are saved in Postgres and relayed to connected viewers. An expired auction rejects bids even if the deadline worker is down. Leading funds remain reserved pending #11 settlement; ending an auction never automatically transfers or releases them.

## Deadline worker (#25)

Run the web app and the independent worker in separate terminals:

```bash
npm run db:migrate
npm start
```

```bash
npm run worker:auctions
```

The worker checks immediately on startup, then every minute. It locks overdue active auctions with `FOR UPDATE SKIP LOCKED`, persists `ended`/an end timestamp, increments the version, and writes an event plus a unique pending settlement job in one transaction. Overlapping ticks are coalesced, multiple workers do not close the same auction twice, and restarts catch missed deadlines.

The web server checks saved events for viewed rooms every two seconds and sends `AUCTION_ENDED` or `AUCTION_CANCELLED`. Reconnecting viewers also receive the current snapshot. Events use per-auction versions so out-of-order commits from different workers cannot be skipped. These are in-page notifications, not email or OS push messages.

Supported flow: immediate start `active → ended` (awaiting settlement), then `settled` when #11 is implemented. No future-start scheduling or automatic deadline extension is offered. The verified owner may cancel an active auction with zero bids through the detail page; the row is retained. Cancellation after bids requires #10's policy and remains blocked. A database trigger prevents changing starting price/deadline after any bid.

`auction_settlement_jobs` is the durable handoff to #11, not a completed settlement implementation. This story does not debit a winner or credit a seller.

## Stripe test funding

Open `/account/wallet.html` to view total/reserved/available balance and the latest 20 deposits. The funding button stays disabled until both server secrets are configured:

```dotenv
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
APP_ORIGIN=http://localhost:3000
```

Install the Stripe CLI, then use this project's helper to forward sandbox events:

```bash
npm run stripe:listen
```

The helper reads this project's test API key, starts the listener, and saves its signing secret to the Git-ignored `.env` without printing either secret. No separate CLI login is required. Keep the listener running and restart `npm start` after it reports ready. On Windows it also finds a WinGet-installed CLI if the current terminal has an old PATH. Use the sandbox key from Stripe's API keys page. Live keys are refused. This flow uses hosted Checkout; no card data passes through our application. Sandbox test payments do not move real money.

The verified owner chooses $1–$500. `POST /api/wallet/checkout` creates a pending deposit and an idempotent Stripe Checkout Session. The return URL never credits funds. The raw-body webhook verifies Stripe's signature, retrieves the session, checks test mode/payment/amount/currency/account, then atomically credits the wallet and a unique deposit ledger entry. Duplicate events cannot credit twice. Checkout requests are rate-limited and a lost response can be retried with the same UUID.

Use Stripe's documented test card `4242 4242 4242 4242`, a future expiry, and any three-digit CVC in hosted test Checkout. Confirm credited status on the wallet page and in Stripe's sandbox. Failures/unpaid or cancelled sessions remain pending and give no balance credit. Expired Checkout sessions require a new request.

Stripe account credentials are not in this repository. Automated tests use provider stubs and the Stripe SDK's real signature verifier. A real Stripe sandbox checkout and signed webhook delivery were verified in the opt-in isolated demo: a $10 payment credited the buyer once, and replaying its completion event did not credit twice. Production login is still awaiting Edric. Funding is disabled in the default isolated demo.

### Optional isolated Stripe checkout test

To test real Stripe sandbox events before production login is available, run these in separate terminals:

```bash
npm run stripe:listen:demo
```

```bash
npm run demo:funding
```

Wait for the listener to save its secret before starting the funding demo. Open http://127.0.0.1:3001, use a seeded demo account, then open /account/wallet.html. This opt-in mode reads only the Stripe secrets from .env and uses a temporary local database; it explicitly disables the shared database connection. Normal demo mode still disables Stripe funding.

Complete the hosted checkout manually with Stripe's test card. A $10 deposit increases the buyer's initial $1,000 demo balance to $1,010 after the webhook arrives. Keep both commands running until verification finishes; restarting the demo discards pending deposits and balances. Stripe controls the available payment methods through its Dashboard; the deprecated `payment_method_types` creation parameter is not sent.

References: [Stripe fulfillment](https://docs.stripe.com/checkout/fulfillment), [webhook signatures](https://docs.stripe.com/webhooks/signature), [sandbox testing](https://docs.stripe.com/testing).

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

Ctrl+C stops the server and discards demo data. Use the three seeded accounts; registration is not part of this demo. They are explicitly verified test fixtures. The demo includes an in-memory minute-based deadline worker; create an auction ending shortly and watch the detail page close without refreshing. Its regular-listing API is disabled to keep the demo away from the shared database.

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

Remaining integration work: Edric's actual login/verification/logout, a real Stripe sandbox checkout, withdrawals and the full wallet ledger, bid retraction (#10), money settlement (#11), and shared listing/photo integration. This branch is based on main as of Nov 21, including the merged listing/dashboard work. Teammate auth, profile, dashboard, and regular-listing implementation files are unchanged.
