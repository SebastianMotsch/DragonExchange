const express = require("express");
const path = require("node:path");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const { UPLOAD_DIR } = require("./lib/photo-upload");
function createApp({
  db,
  sessionStore,
  sessionSecret = process.env.SESSION_SECRET,
  configured = () => Boolean(process.env.DATABASE_URL),
  authRouter,
  beforeStatic,
}) {
  const app = express();
  if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);
  app.use(express.json({ limit: "32kb" }));
  app.use((error, req, res, next) => {
    if (error.type === "entity.parse.failed")
      return res.status(400).json({ error: "Send a valid JSON request." });
    if (error.type === "entity.too.large")
      return res.status(413).json({ error: "Request is too large." });
    next(error);
  });
  app.use((req, res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && req.get("Origin")) {
      const expected =
        process.env.APP_ORIGIN || req.protocol + "://" + req.get("host");
      if (req.get("Origin") !== expected)
        return res
          .status(403)
          .json({ error: "Cross-origin requests are not allowed." });
    }
    next();
  });
  if (sessionSecret && configured()) {
    const middleware = session({
      store:
        sessionStore || new PgSession({ pool: db, createTableIfMissing: true }),
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        maxAge: 7 * 24 * 60 * 60 * 1000,
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.NODE_ENV === "production",
      },
    });
    app.locals.sessionMiddleware = middleware;
    app.use(middleware);
  }
  app.use("/auth", authRouter || require("./routes/auth"));
  app.use("/api/auctions", require("./routes/auctions")(db, configured));
  app.use("/api/account", require("./routes/account")(db));
  app.get("/api/wallet", async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!req.session?.userId)
      return res.status(401).json({ error: "Log in to view your balance." });
    try {
      const r = await db.query(
        "SELECT balance_cents,reserved_cents,balance_cents-reserved_cents AS available_cents FROM wallets WHERE user_id=$1",
        [req.session.userId],
      );
      res.json({
        wallet: r.rows[0] || {
          balance_cents: 0,
          reserved_cents: 0,
          available_cents: 0,
        },
      });
    } catch {
      res.status(503).json({ error: "Balance is unavailable." });
    }
  });
  app.get("/health", (req, res) => res.send("ok"));
  app.get("/health/db", async (req, res) => {
    if (!configured())
      return res
        .status(503)
        .json({ connected: false, error: "DATABASE_URL is not configured" });
    try {
      const r = await db.query("SELECT now()");
      res.json({ connected: true, time: r.rows[0].now });
    } catch {
      res
        .status(503)
        .json({ connected: false, error: "Database connection failed." });
    }
  });
  const publicDirectory = path.join(__dirname, "public");
  app.get(
    [
      "/auctions/create.html",
    ],
    async (req, res, next) => {
      if (!req.session?.userId)
        return res.redirect(
          "/auth/login.html?next=" + encodeURIComponent(req.path),
        );
      try {
        const r = await db.query("SELECT verified FROM users WHERE id=$1", [
          req.session.userId,
        ]);
        if (!r.rows[0]?.verified)
          return res.status(403).send("A verified account is required.");
        next();
      } catch {
        res.status(503).send("Unable to check your account.");
      }
    },
  );
  if (beforeStatic) beforeStatic(app);
  app.use(express.static(publicDirectory));
    // Static folder for listing photos saved by lib/photo-upload.js.
  app.use(
    "/uploads",
    express.static(UPLOAD_DIR, {
      index: false,
      setHeaders: (res) => res.set("X-Content-Type-Options", "nosniff"),
    }),
  );
  // Mounted after static so /listings/*.html pages aren't caught by /listings/:id
  app.use("/listings", require("./routes/listings"));
  app.use("/purchases", require("./routes/purchases")({ db }));
  app.use((req, res) =>
    res.status(404).sendFile(path.join(publicDirectory, "404.html")),
  );
  return app;
}
module.exports = { createApp };
