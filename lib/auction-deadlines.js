async function endDueAuctions(db, limit = 100) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const due = await client.query(
      "SELECT id FROM auctions WHERE status='active' AND ends_at<=clock_timestamp() ORDER BY ends_at,id LIMIT $1 FOR UPDATE SKIP LOCKED",
      [limit],
    );
    const ids = due.rows.map((row) => row.id);
    if (ids.length) {
      await client.query(
        "UPDATE auctions SET status='ended',ended_at=clock_timestamp(),version=version+1 WHERE id=ANY($1::int[])",
        [ids],
      );
      await client.query(
        "INSERT INTO auction_events(auction_id,kind,version) SELECT id,'AUCTION_ENDED',version FROM auctions WHERE id=ANY($1::int[]) ON CONFLICT DO NOTHING",
        [ids],
      );
      await client.query(
        "INSERT INTO auction_settlement_jobs(auction_id) SELECT unnest($1::int[]) ON CONFLICT DO NOTHING",
        [ids],
      );
    }
    await client.query("COMMIT");
    return ids;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
function startDeadlineWorker({
  db,
  intervalMs = 60000,
  onError = console.error,
  onRun = () => {},
  afterClose = async () => {},
}) {
  let active = null;
  function run() {
    if (active) return active;
    active = (async () => {
      let total = 0;
      for (let batch = 0; batch < 10; batch++) {
        const ids = await endDueAuctions(db);
        total += ids.length;
        if (ids.length < 100) break;
      }
      await afterClose();
      onRun(total);
      return total;
    })()
      .catch((error) => {
        onError(error);
        return null;
      })
      .finally(() => {
        active = null;
      });
    return active;
  }
  const timer = setInterval(run, intervalMs);
  run();
  return {
    run,
    async stop() {
      clearInterval(timer);
      if (active) await active;
    },
  };
}
async function cancelAuction(db, userId, id) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      "SELECT a.*,u.verified,a.ends_at>clock_timestamp() AS open FROM auctions a JOIN users u ON u.id=$2 WHERE a.id=$1 FOR UPDATE OF a",
      [id, userId],
    );
    const auction = result.rows[0];
    if (!auction || auction.seller_id !== userId || !auction.verified)
      throw Object.assign(
        new Error("Only the verified seller can cancel this auction."),
        { status: 403 },
      );
    if (auction.status === "cancelled") {
      await client.query("COMMIT");
      return;
    }
    if (auction.status !== "active" || !auction.open || auction.bid_count > 0)
      throw Object.assign(
        new Error("Only active auctions with no bids can be cancelled."),
        { status: 409 },
      );
    await client.query(
      "UPDATE auctions SET status='cancelled',version=version+1 WHERE id=$1",
      [id],
    );
    await client.query(
      "INSERT INTO auction_events(auction_id,kind,version) SELECT id,'AUCTION_CANCELLED',version FROM auctions WHERE id=$1",
      [id],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
module.exports = { endDueAuctions, startDeadlineWorker, cancelAuction };
