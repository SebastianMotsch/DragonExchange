const { snapshot } = require("./auction-state");
function startAuctionEventRelay(
  db,
  io,
  { intervalMs = 2000, onError = () => {} } = {},
) {
  const seen = new Map();
  let active = null,
    stopped = false;
  async function poll() {
    if (stopped) return;
    if (active) return active;
    active = (async () => {
      const ids = [...io.sockets.adapter.rooms.keys()]
        .filter((room) => /^auction:[1-9]\d*$/.test(room))
        .map((room) => Number(room.slice(8)));
      for (const id of seen.keys()) if (!ids.includes(id)) seen.delete(id);
      if (!ids.length) return;
      // Query per-auction versions rather than a global sequence cursor: transactions
      // on different auctions can commit out of sequence.
      const result = await db.query(
        "SELECT DISTINCT ON (auction_id) auction_id,kind,version FROM auction_events WHERE auction_id=ANY($1::int[]) ORDER BY auction_id,version DESC",
        [ids],
      );
      for (const event of result.rows) {
        const room = "auction:" + event.auction_id;
        if (
          io.sockets.adapter.rooms.has(room) &&
          event.version > (seen.get(event.auction_id) ?? -1)
        ) {
          const state = await snapshot(db, event.auction_id, true);
          if(state && event.kind==="AUCTION_SETTLED"){
            state.settlement=(await db.query("SELECT outcome,amount_cents,created_at FROM auction_settlements WHERE auction_id=$1",[event.auction_id])).rows[0];
          }
          if (state) io.to(room).emit(event.kind, state);
        }
        seen.set(event.auction_id, event.version);
      }
    })()
      .catch(onError)
      .finally(() => {
        active = null;
      });
    return active;
  }
  const timer = setInterval(poll, intervalMs);
  timer.unref();
  return {
    poll,
    stop() {
      stopped = true;
      clearInterval(timer);
      return active || Promise.resolve();
    },
  };
}
module.exports = { startAuctionEventRelay };
