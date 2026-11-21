const { parseCents } = require("./bidding");
const validRequest = (id) =>
  typeof id === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
function fundingError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}
async function createDeposit(
  db,
  stripe,
  userId,
  { amount, requestId } = {},
  origin,
) {
  const cents = parseCents(amount);
  if (
    !validRequest(requestId) ||
    cents === null ||
    cents < 100 ||
    cents > 50000
  )
    throw fundingError("Enter $1–$500 and a valid request ID.");
  const user = await db.query("SELECT verified FROM users WHERE id=$1", [
    userId,
  ]);
  if (!user.rows[0]?.verified)
    throw fundingError("A verified account is required.", 403);
  await db.query(
    "INSERT INTO wallet_deposits(id,user_id,amount_cents) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
    [requestId, userId, cents],
  );
  const deposit = (
    await db.query("SELECT * FROM wallet_deposits WHERE id=$1", [requestId])
  ).rows[0];
  if (deposit.user_id !== userId || deposit.amount_cents !== cents)
    throw fundingError("This request ID belongs to a different deposit.", 409);
  if (deposit.status === "credited") return { credited: true };
  // The idempotency key survives retries even if the process dies after Stripe creates the session.
  const checkout = deposit.stripe_session_id
    ? await stripe.checkout.sessions.retrieve(deposit.stripe_session_id)
    : await stripe.checkout.sessions.create(
        {
          mode: "payment",
          client_reference_id: String(userId),
          metadata: { depositId: deposit.id },
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: "usd",
                unit_amount: cents,
                product_data: {
                  name: "DragonExchange demo wallet funds (test only)",
                },
              },
            },
          ],
          success_url: origin + "/account/wallet.html?checkout=returned",
          cancel_url: origin + "/account/wallet.html?checkout=cancelled",
        },
        { idempotencyKey: "wallet-deposit-" + deposit.id },
      );
  if (checkout.livemode !== false)
    throw fundingError("Only Stripe test mode is supported.", 503);
  if (!checkout.url && checkout.payment_status !== "paid")
    throw fundingError("Checkout expired. Start a new deposit.", 409);
  await db.query(
    "UPDATE wallet_deposits SET stripe_session_id=$2 WHERE id=$1 AND (stripe_session_id IS NULL OR stripe_session_id=$2)",
    [deposit.id, checkout.id],
  );
  return { url: checkout.url, depositId: deposit.id };
}
async function creditDeposit(db, checkout) {
  if (
    checkout.livemode !== false ||
    checkout.mode !== "payment" ||
    checkout.payment_status !== "paid"
  )
    return false;
  if (!validRequest(checkout.metadata?.depositId)) return false;
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(
      "SELECT * FROM wallet_deposits WHERE id=$1 FOR UPDATE",
      [checkout.metadata.depositId],
    );
    const deposit = r.rows[0];
    if (
      !deposit ||
      checkout.currency !== "usd" ||
      checkout.amount_total !== deposit.amount_cents ||
      checkout.client_reference_id !== String(deposit.user_id) ||
      (deposit.stripe_session_id && deposit.stripe_session_id !== checkout.id)
    )
      throw fundingError("Checkout does not match the deposit.");
    if (deposit.status === "credited") {
      await client.query("COMMIT");
      return false;
    }
    await client.query(
      "INSERT INTO wallets(user_id) VALUES($1) ON CONFLICT DO NOTHING",
      [deposit.user_id],
    );
    await client.query(
      "SELECT user_id FROM wallets WHERE user_id=$1 FOR UPDATE",
      [deposit.user_id],
    );
    await client.query(
      "UPDATE wallets SET balance_cents=balance_cents+$2 WHERE user_id=$1",
      [deposit.user_id, deposit.amount_cents],
    );
    await client.query(
      "INSERT INTO wallet_ledger(user_id,amount_cents,kind,deposit_id) VALUES($1,$2,'test_deposit',$3)",
      [deposit.user_id, deposit.amount_cents, deposit.id],
    );
    await client.query(
      "UPDATE wallet_deposits SET status='credited',credited_at=clock_timestamp(),stripe_session_id=$2 WHERE id=$1",
      [deposit.id, checkout.id],
    );
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
module.exports = { createDeposit, creditDeposit };
