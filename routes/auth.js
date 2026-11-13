const express = require("express");
const bcrypt = require("bcrypt");
module.exports = function createAuthRouter(db) {
  const router = express.Router();
  const saltRounds = 12;

  router.post("/register", async function (req, res) {
    if (
      !req.body ||
      typeof req.body.name !== "string" ||
      typeof req.body.email !== "string" ||
      typeof req.body.password !== "string"
    ) {
      return res
        .status(400)
        .json({
          error: "Name, email, and password are required and must be text.",
        });
    }

    const name = req.body.name.trim();
    const email = req.body.email.trim().toLowerCase();
    const password = req.body.password;

    if (name === "") {
      return res.status(422).json({ error: "Enter your display name." });
    }

    const emailParts = email.split("@");
    if (
      emailParts.length !== 2 ||
      emailParts[0] === "" ||
      emailParts[1] !== "drexel.edu"
    ) {
      return res
        .status(422)
        .json({ error: "Enter a valid Drexel University email address." });
    }

    // only letters and numbers are allowed before @drexel.edu (excluding the first.middle.last format and aliases)
    const emailCharacters = "abcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < emailParts[0].length; i++) {
      if (!emailCharacters.includes(emailParts[0][i])) {
        return res
          .status(422)
          .json({ error: "Make sure to use a valid Drexel email address." });
      }
    }

    let hasUppercase = false;
    let hasNumber = false;
    let hasSpecial = false;
    const specialCharacters = "!@#$%^&*()-_=+[]{};:'\",.<>/?\\|`~";

    for (let i = 0; i < password.length; i++) {
      const character = password[i];

      if (character >= "A" && character <= "Z") {
        hasUppercase = true;
      }
      if (character >= "0" && character <= "9") {
        hasNumber = true;
      }
      if (specialCharacters.includes(character)) {
        hasSpecial = true;
      }
    }

    if (password.length < 8 || !hasUppercase || !hasNumber || !hasSpecial) {
      return res
        .status(422)
        .json({
          error:
            "Use at least 8 characters, one uppercase letter, one number, and one special character.",
        });
    }

    // bcrypt only uses the first 72 bytes
    if (Buffer.byteLength(password, "utf8") > 72) {
      return res
        .status(422)
        .json({ error: "Password must be 72 bytes or fewer." });
    }

    try {
      const passwordHash = await bcrypt.hash(password, saltRounds);

      const result = await db.query(
        `INSERT INTO users (name, email, password_hash, verified)
       VALUES ($1, $2, $3, false)
       ON CONFLICT (email) DO NOTHING
       RETURNING id`,
        [name, email, passwordHash],
      );

      if (result.rowCount === 0) {
        return res
          .status(409)
          .json({
            error:
              "We couldn't create an account with this email. If you are already registered, try logging in.",
          });
      }

      // TODO: Trigger the email verification flow from issue #17.
      return res
        .status(201)
        .json({
          message:
            "Your account was created and requires email verification before using marketplace features.",
        });
    } catch {
      return res
        .status(500)
        .json({
          error: "Registration is temporarily unavailable. Please try again.",
        });
    }
  });

  // Email verification delivery remains issue #17; registration never auto-verifies.
  const loginAttempts = new Map();
  router.post("/login", async (req, res) => {
    if (!req.session)
      return res
        .status(503)
        .json({ error: "Login is unavailable until sessions are configured." });
    if (req.get("X-Requested-With") !== "DragonExchange")
      return res.status(403).json({ error: "Use the login form." });
    const now = Date.now();
    for (const [key, value] of loginAttempts)
      if (now - value.start > 15 * 60 * 1000) loginAttempts.delete(key);
    const key = req.ip;
    const attempts = loginAttempts.get(key) || { count: 0, start: now };
    if (attempts.count >= 5)
      return res
        .status(429)
        .json({ error: "Too many attempts. Try again in 15 minutes." });
    attempts.count++;
    loginAttempts.set(key, attempts);
    const { email, password } = req.body || {};
    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      Buffer.byteLength(password, "utf8") > 72
    )
      return res.status(400).json({ error: "Enter your email and password." });
    try {
      const result = await db.query(
        "SELECT id,name,email,password_hash,verified FROM users WHERE email=$1",
        [email.trim().toLowerCase()],
      );
      const user = result.rows[0];
      if (!user || !(await bcrypt.compare(password, user.password_hash)))
        return res.status(401).json({ error: "Invalid email or password." });
      if (!user.verified)
        return res
          .status(403)
          .json({
            error:
              "Verify your Drexel email before logging in. Email verification is still being integrated.",
          });
      await new Promise((resolve, reject) =>
        req.session.regenerate((error) => (error ? reject(error) : resolve())),
      );
      req.session.userId = user.id;
      await new Promise((resolve, reject) =>
        req.session.save((error) => (error ? reject(error) : resolve())),
      );
      loginAttempts.delete(key);
      res.json({
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          verified: user.verified,
        },
      });
    } catch {
      res.status(503).json({ error: "Login is temporarily unavailable." });
    }
  });
  router.get("/me", async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!req.session?.userId)
      return res.status(401).json({ error: "Log in to continue." });
    try {
      const result = await db.query(
        "SELECT id,name,email,verified FROM users WHERE id=$1",
        [req.session.userId],
      );
      if (!result.rows.length)
        return res.status(401).json({ error: "Log in again." });
      res.json({ user: result.rows[0] });
    } catch {
      res.status(503).json({ error: "Account information is unavailable." });
    }
  });
  router.post("/logout", async (req, res) => {
    if (req.get("X-Requested-With") !== "DragonExchange")
      return res.status(403).json({ error: "Use the logout button." });
    const sessionId = req.sessionID;
    try {
      if (req.session)
        await new Promise((resolve, reject) =>
          req.session.destroy((error) => (error ? reject(error) : resolve())),
        );
    } catch {
      return res
        .status(503)
        .json({ error: "Unable to log out. Please retry." });
    }
    req.app.locals.io?.in("session:" + sessionId).disconnectSockets(true);
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });

  return router;
};
