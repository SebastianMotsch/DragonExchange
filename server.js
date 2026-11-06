require("dotenv").config();
const express = require("express");
const path = require("node:path");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const db = require("./db");

const app = express();
app.use(express.json());
const publicDirectory = path.join(__dirname, "public");
app.use(express.static(publicDirectory));

// The static starter runs without database credentials. Enable persistent
// sessions when the database and session secret have been configured.
if (process.env.DATABASE_URL && process.env.SESSION_SECRET) {
  app.use(
    session({
      store: new PgSession({ pool: db, createTableIfMissing: true }),
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }, // 7 days
    })
  );
}

app.use("/auth", require("./routes/auth"));

app.get("/health", (req, res) => res.send("ok"));

app.get("/health/db", async (req, res) => {
  if (!process.env.DATABASE_URL) {
    return res.status(503).json({ connected: false, error: "DATABASE_URL is not configured" });
  }
  try {
    const result = await db.query("SELECT now()");
    res.json({ connected: true, time: result.rows[0].now });
  } catch (err) {
    res.status(500).json({ connected: false, error: err.message });
  }
});

app.use((req, res) => {
  res.status(404).sendFile(path.join(publicDirectory, "404.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on http://localhost:${PORT}`));