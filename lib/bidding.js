const { snapshot, validId } = require("./auction-state");
class BidError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
const fail = (code, message) => {
  throw new BidError(code, message);
};
function parseCents(value) {
  if (typeof value !== "string" || !/^\d{1,8}(\.\d{1,2})?$/.test(value))
    return null;
  const [whole, fraction = ""] = value.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents > 0 && cents <= 2147483647
    ? cents
    : null;
}
async function placeBid(pool, userId, data = {}) {
  if (
    !data ||
    !validId(data.auctionId) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      data.requestId || "",
    )
  )
    fail("INVALID_INPUT", "Invalid auction or request ID.");
  const amount = parseCents(data.amount);
  if (amount === null)
    fail(
      "INVALID_INPUT",
      "Enter a positive bid with at most two decimal places.",
    );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // All transactions lock the auction first, then wallets in user-ID order.
    const locked = await client.query(
      "SELECT * FROM auctions WHERE id=$1 FOR UPDATE",
      [data.auctionId],
    );
    const auction = locked.rows[0];
    if (!auction) fail("NOT_FOUND", "Auction not found.");
    const user = await client.query("SELECT verified FROM users WHERE id=$1", [
      userId,
    ]);
    if (!user.rows[0]?.verified)
      fail("NOT_VERIFIED", "A verified account is required.");
    const prior = await client.query(
      "SELECT auction_id, amount_cents FROM bids WHERE bidder_id=$1 AND request_id=$2",
      [userId, data.requestId],
    );
    if (prior.rows.length) {
      if (
        prior.rows[0].auction_id !== Number(data.auctionId) ||
        prior.rows[0].amount_cents !== amount
      )
        fail(
          "REQUEST_REUSED",
          "This request ID was already used for a different bid.",
        );
      const state = await snapshot(client, auction.id);
      await client.query("COMMIT");
      return { ok: true, duplicate: true, requestId: data.requestId, state };
    }
    const open = await client.query(
      "SELECT status='active' AND ends_at > clock_timestamp() AS open FROM auctions WHERE id=$1",
      [auction.id],
    );
    if (!open.rows[0].open) fail("AUCTION_ENDED", "This auction has ended.");
    if (auction.seller_id === userId)
      fail("OWN_AUCTION", "You cannot bid on your own auction.");
    const minimum =
      auction.current_bid_cents === null
        ? auction.starting_price_cents
        : auction.current_bid_cents + auction.min_increment_cents;
    if (amount < minimum)
      fail("BID_TOO_LOW", "Your bid is below the minimum shown.");
    const walletIds = [
      ...new Set([userId, auction.highest_bidder_id].filter(Boolean)),
    ].sort((a, b) => a - b);
    await client.query(
      "INSERT INTO wallets(user_id) VALUES ($1) ON CONFLICT DO NOTHING",
      [userId],
    );
    const lockedWallets = await client.query(
      "SELECT * FROM wallets WHERE user_id=ANY($1::int[]) ORDER BY user_id FOR UPDATE",
      [walletIds],
    );
    const wallet = lockedWallets.rows.find((row) => row.user_id === userId);
    const ownHold =
      auction.highest_bidder_id === userId ? auction.current_bid_cents : 0;
    if (amount > wallet.balance_cents - wallet.reserved_cents + ownHold)
      fail("INSUFFICIENT_FUNDS", "Your available balance is too low.");
    // Recheck after waiting for wallet locks.
    const stillOpen = await client.query(
      "SELECT ends_at > clock_timestamp() AS open FROM auctions WHERE id=$1",
      [auction.id],
    );
    if (!stillOpen.rows[0].open)
      fail("AUCTION_ENDED", "This auction has ended.");
    if (auction.highest_bidder_id) {
      await client.query(
        "UPDATE wallets SET reserved_cents=reserved_cents-$2 WHERE user_id=$1",
        [auction.highest_bidder_id, auction.current_bid_cents],
      );
    }
    await client.query(
      "UPDATE wallets SET reserved_cents=reserved_cents+$2 WHERE user_id=$1",
      [userId, amount],
    );
    await client.query(
      "INSERT INTO bids(auction_id,bidder_id,amount_cents,request_id) VALUES ($1,$2,$3,$4)",
      [auction.id, userId, amount, data.requestId],
    );
    await client.query(
      "UPDATE auctions SET current_bid_cents=$2,highest_bidder_id=$3,bid_count=bid_count+1,version=version+1 WHERE id=$1",
      [auction.id, amount, userId],
    );
    const state = await snapshot(client, auction.id);
    await client.query("COMMIT");
    return { ok: true, requestId: data.requestId, state };
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505")
      fail(
        "REQUEST_REUSED",
        "This request was already processed. Refresh the auction before retrying.",
      );
    throw error;
  } finally {
    client.release();
  }
}
module.exports = { placeBid, BidError, parseCents };
