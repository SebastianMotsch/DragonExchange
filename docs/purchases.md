# Regular purchases

Apply `sql/purchases.sql` using the database owner connection or Supabase SQL
Editor, or run `npm run setup:purchases` with `DATABASE_URL` configured.
It is separate from the currently conflicted `sql/schema.sql`. The setup
keeps existing ID column types and adds a unique listing index and history indexes.
If duplicate historical purchases exist, the unique index fails safely; investigate
those records instead of deleting them automatically.

Start `npm run dev:auth`. Create two verified test accounts, use one to create a
regular listing, then log into the other and open the listing from Home. Choose
Buy now and Confirm purchase. The purchase summary displays the current database
price. The server checks the displayed price again when confirming.

`POST /purchases` takes `listingId` and `expectedAmountCents`. The buyer comes
from `req.session.userId`. The seller and actual amount come from the locked
listing row. A single transaction inserts `purchases` with a NULL winning bid and
marks the listing sold. No wallet or Stripe transfer is performed: payment is
arranged directly with the seller, as explained on the purchase page.

Logged-out or unverified buyers, self-purchases, guest listings without a seller,
inactive listings, auctions and changed prices are rejected. Concurrent requests
lock the listing and the unique index permits only one purchase per listing.
A retry by the same buyer returns the original order instead of creating another.
Failed writes roll back the insert and status change together.

Sold items disappear from Home and Current listings on refresh. The buyer sees
the order under My purchases, and the seller sees it under My sales. Sold detail
pages remain accessible with a Sold status and no purchase button. Dashboard
history is served by `GET /purchases/mine` using the authenticated session.

Auction settlement is not implemented by this endpoint. It must validate the
winning bid's listing, bidder and seller before creating an auction purchase.

Run `node --test tests/purchases-api.test.js tests/purchase.test.js tests/purchase-history.test.js`
for transaction and interface tests. Run `PURCHASE_DB_TEST=1 node --test tests/purchases.integration.test.js`
for the opt-in PostgreSQL integration test. It creates and removes an isolated test
schema, leaving existing users, listings and purchases untouched.
