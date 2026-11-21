const fields =
  "id, title, description, category, starting_price_cents, current_bid_cents, bid_count, version, min_increment_cents, ends_at, created_at, CASE WHEN status = 'active' AND ends_at <= clock_timestamp() THEN 'ended' ELSE status END AS status";
function validId(id) {
  return /^[1-9]\d{0,9}$/.test(String(id)) && Number(id) <= 2147483647;
}
async function snapshot(db, id, includeCancelled = false) {
  const result = await db.query(
    `SELECT ${fields} FROM public.auctions WHERE id=$1 ${includeCancelled ? "" : "AND status <> 'cancelled'"}`,
    [id],
  );
  return result.rows[0] || null;
}
module.exports = { fields, snapshot, validId };
