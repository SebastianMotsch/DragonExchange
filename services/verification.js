const { randomBytes, createHash } = require("node:crypto");
const db = require("../db");

function hashVerificationToken(token) {
  const hash = createHash("sha256");
  hash.update(token);
  return hash.digest("hex");
}

async function createVerificationToken(userId) {
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashVerificationToken(token);

  const result = await db.query(
    `INSERT INTO email_verifications (user_id, token_hash, expires_at)
     SELECT id, $1, now() + interval '30 minutes'
     FROM users
     WHERE id = $2 AND verified = false
     ON CONFLICT (user_id) DO UPDATE
     SET token_hash = EXCLUDED.token_hash,
         expires_at = EXCLUDED.expires_at`,
    [tokenHash, userId]
  );

  if (result.rowCount === 0) {
    return null;
  }

  return token;
}

async function verifyEmailToken(token) {
  const tokenHash = hashVerificationToken(token);

  const result = await db.query(
    `WITH consumed_token AS (
       DELETE FROM email_verifications
       WHERE token_hash = $1 AND expires_at > now()
       RETURNING user_id
     )
     UPDATE users
     SET verified = true
     FROM consumed_token
     WHERE users.id = consumed_token.user_id
       AND users.verified = false`,
    [tokenHash]
  );


  return result.rowCount === 1;
}

module.exports = { createVerificationToken, verifyEmailToken };
