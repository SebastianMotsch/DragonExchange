require("dotenv").config();
const express = require("express");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const db = require("./db");

const app = express();
app.use(express.json());
app.use(express.static("public"));
app.use(
  session({
    // Store sessions in Postgres so logins survive server restarts
    store: new PgSession({ pool: db, createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }, // 7 days
  })
);

app.use("/auth", require("./routes/auth"));

app.get("/health", (req, res) => res.send("ok"));

// Visit this to confirm the Supabase connection works
app.get("/health/db", async (req, res) => {
  try {
    const result = await db.query("SELECT now()");
    res.json({ connected: true, time: result.rows[0].now });
  } catch (err) {
    res.status(500).json({ connected: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on http://localhost:${PORT}`));