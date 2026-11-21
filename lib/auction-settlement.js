class SettlementError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
const fail = (code) => {
  throw new SettlementError(code);
};
async function settleAuction(db, id) {
  const client = await db.connect();
  let auctionFound = false;
  try {
    await client.query("BEGIN");
    // Match bidding's lock order: auction first, then wallets by user ID.
    const found = await client.query(
      "SELECT *,ends_at<=clock_timestamp() AS expired FROM auctions WHERE id=$1 FOR UPDATE SKIP LOCKED",
      [id],
    );
    const auction = found.rows[0];
    if (!auction) {
      await client.query("ROLLBACK");
      return { status: "skipped" };
    }
    auctionFound = true;
    const jobs = await client.query(
      "SELECT * FROM auction_settlement_jobs WHERE auction_id=$1 FOR UPDATE",
      [id],
    );
    const job = jobs.rows[0];
    if (!job) {
      await client.query("ROLLBACK");
      return { status: "not_ready" };
    }
    if (job.status === "completed") {
      await client.query("COMMIT");
      return { status: "completed", duplicate: true };
    }
    if (auction.status !== "ended" || !auction.expired)
      fail("AUCTION_NOT_ENDED");
    const bids = await client.query(
      "SELECT b.*,b.created_at<=a.ends_at AS on_time FROM bids b JOIN auctions a ON a.id=b.auction_id WHERE b.auction_id=$1 ORDER BY b.amount_cents DESC,b.id ASC LIMIT 1",
      [id],
    );
    const winner = bids.rows[0];
    if (!winner) {
      if (
        auction.bid_count !== 0 ||
        auction.current_bid_cents !== null ||
        auction.highest_bidder_id !== null
      )
        fail("BID_STATE_MISMATCH");
      await client.query(
        "INSERT INTO auction_settlements(auction_id,seller_id,amount_cents,outcome) VALUES($1,$2,0,'no_bids')",
        [id, auction.seller_id],
      );
    } else {
      if (!winner.on_time) fail("BID_AFTER_DEADLINE");
      if (
        winner.bidder_id === auction.seller_id ||
        winner.bidder_id !== auction.highest_bidder_id ||
        winner.amount_cents !== auction.current_bid_cents
      )
        fail("BID_STATE_MISMATCH");
      const eligible = await client.query(
        "SELECT verified FROM users WHERE id=$1",
        [winner.bidder_id],
      );
      if (!eligible.rows[0]?.verified) fail("WINNER_NOT_ELIGIBLE");
      await client.query(
        "INSERT INTO wallets(user_id) VALUES($1),($2) ON CONFLICT DO NOTHING",
        [winner.bidder_id, auction.seller_id],
      );
      const ids = [winner.bidder_id, auction.seller_id].sort((a, b) => a - b);
      const balances = await client.query(
        "SELECT * FROM wallets WHERE user_id=ANY($1::int[]) ORDER BY user_id FOR UPDATE",
        [ids],
      );
      const buyer = balances.rows.find(
        (row) => row.user_id === winner.bidder_id,
      );
      const seller = balances.rows.find(
        (row) => row.user_id === auction.seller_id,
      );
      if (
        !buyer ||
        buyer.reserved_cents < winner.amount_cents ||
        buyer.balance_cents < winner.amount_cents
      )
        fail("RESERVED_FUNDS_MISSING");
      // Never consume funds reserved for another leading auction.
      const holds = await client.query(
        "SELECT COALESCE(SUM(current_bid_cents),0)::bigint AS total FROM auctions WHERE highest_bidder_id=$1 AND current_bid_cents IS NOT NULL AND (status='active' OR (status='ended' AND NOT EXISTS(SELECT 1 FROM auction_settlements s WHERE s.auction_id=auctions.id)))",
        [winner.bidder_id],
      );
      if (Number(holds.rows[0].total) > buyer.reserved_cents)
        fail("RESERVATION_STATE_MISMATCH");
      if (seller.balance_cents + winner.amount_cents > 2147483647)
        fail("SELLER_BALANCE_LIMIT");
      await client.query(
        "INSERT INTO auction_settlements(auction_id,seller_id,buyer_id,winning_bid_id,amount_cents,outcome) VALUES($1,$2,$3,$4,$5,'sold')",
        [
          id,
          auction.seller_id,
          winner.bidder_id,
          winner.id,
          winner.amount_cents,
        ],
      );
      await client.query(
        "UPDATE wallets SET balance_cents=balance_cents-$2,reserved_cents=reserved_cents-$2 WHERE user_id=$1",
        [winner.bidder_id, winner.amount_cents],
      );
      await client.query(
        "UPDATE wallets SET balance_cents=balance_cents+$2 WHERE user_id=$1",
        [auction.seller_id, winner.amount_cents],
      );
      await client.query(
        "INSERT INTO wallet_ledger(user_id,amount_cents,kind,auction_id) VALUES($1,$3,'auction_debit',$4),($2,$3,'auction_credit',$4)",
        [winner.bidder_id, auction.seller_id, winner.amount_cents, id],
      );
    }
    await client.query(
      "UPDATE auctions SET status=$2,version=version+1 WHERE id=$1",
      [id, winner ? "settled" : "ended"],
    );
    await client.query(
      "UPDATE auction_settlement_jobs SET status='completed',attempts=attempts+1,last_error=NULL WHERE auction_id=$1",
      [id],
    );
    await client.query(
      "INSERT INTO auction_events(auction_id,kind,version) SELECT id,'AUCTION_SETTLED',version FROM auctions WHERE id=$1",
      [id],
    );
    await client.query("COMMIT");
    return { status: "completed", outcome: winner ? "sold" : "no_bids" };
  } catch (error) {
    await client.query("ROLLBACK");
    if (auctionFound) {
      const code =
        error instanceof SettlementError ? error.code : "SETTLEMENT_FAILED";
      await client.query(
        "UPDATE auction_settlement_jobs SET attempts=attempts+1,last_error=$2,next_attempt_at=clock_timestamp()+interval '30 seconds'*LEAST(10,attempts+1) WHERE auction_id=$1 AND status='pending'",
        [id, code],
      );
      return { status: "pending", error: code };
    }
    throw error;
  } finally {
    client.release();
  }
}
async function settleDueAuctions(db, limit = 100) {
  const jobs = await db.query(
    "SELECT auction_id FROM auction_settlement_jobs WHERE status='pending' AND next_attempt_at<=clock_timestamp() ORDER BY created_at,auction_id LIMIT $1",
    [limit],
  );
  const results = [];
  for (const job of jobs.rows)
    results.push({
      auctionId: job.auction_id,
      ...(await settleAuction(db, job.auction_id)),
    });
  return results;
}
module.exports = { settleAuction, settleDueAuctions };
