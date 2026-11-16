// Local test/demo adapter only. Production uses Edric's routes/auth.js unchanged.
const express=require('express');
const bcrypt=require('bcrypt');
module.exports=function demoAuth(db){
 const router=express.Router();
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
