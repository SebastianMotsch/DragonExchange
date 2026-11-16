const express = require("express");
const bcrypt = require("bcrypt");
const db = require("../db");
const registrationLimiter = require("../middleware/registration-limiter");
const router = express.Router();
const saltRounds = 12;
const maxPasswordBytes = 72;
const maxActiveRegistrations = 4;
let activeRegistrations = 0;

router.post("/register", registrationLimiter, async function (req, res) {
  if (!req.body) {
    return res.status(400).json({
      error: "Name, email, and password are required and must be text."
    });
  }

  const nameIsText = typeof req.body.name === "string";
  const emailIsText = typeof req.body.email === "string";
  const passwordIsText = typeof req.body.password === "string";

  if (!nameIsText || !emailIsText || !passwordIsText) {
    return res.status(400).json({
      error: "Name, email, and password are required and must be text."
    });
  }

  const name = req.body.name.trim();
  const email = req.body.email.trim().toLowerCase();
  const password = req.body.password;

  if (name === "") {
    return res.status(422).json({
      error: "Enter your display name."
    });
  }

  const emailParts = email.split("@");
  if (emailParts.length !== 2 || emailParts[0] === "" || emailParts[1] !== "drexel.edu") {
    return res.status(422).json({
      error: "Enter a valid Drexel University email address."
    });
  }

  // only letters and numbers are allowed before @drexel.edu (excluding the first.middle.last format and aliases)
  const emailCharacters = "abcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < emailParts[0].length; i++) {
    if (!emailCharacters.includes(emailParts[0][i])) {
      return res.status(422).json({
        error: "Make sure to use a valid Drexel email address."
      });
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
    return res.status(422).json({
      error: "Use at least 8 characters, one uppercase letter, one number, and one special character."
    });
  }

  const passwordBytes = Buffer.byteLength(password, "utf8");
  if (passwordBytes > maxPasswordBytes) {
    return res.status(422).json({
      code: "PASSWORD_TOO_LONG",
      error: "Your password is too long. Shorten it and try again."
    });
  }

  // Check capacity before starting expensive password hashing.
  if (activeRegistrations >= maxActiveRegistrations) {
    res.set("Retry-After", "1");
    return res.status(503).json({
      code: "REGISTRATION_BUSY",
      error: "Registration is busy right now. Please wait a moment and try again."
    });
  }

  // Reserve one slot until this registration finishes.
  activeRegistrations++;
  try {
    const passwordHash = await bcrypt.hash(password, saltRounds);

    const result = await db.query(
      `INSERT INTO users (name, email, password_hash, verified)
       VALUES ($1, $2, $3, false)
       ON CONFLICT (email) DO NOTHING
       RETURNING id`,
      [name, email, passwordHash]
    );

    if (result.rowCount === 0) {
      return res.status(409).json({
        error: "We couldn't create an account with this email. If you are already registered, try logging in."
      });
    }

    // TODO: Trigger the email verification flow from issue #17.
    return res.status(201).json({
      message: "Your account was created and requires email verification before using marketplace features."
    });
  } catch {
    return res.status(500).json({
      error: "Registration is temporarily unavailable. Please try again."
    });
  } finally {
    activeRegistrations--;
  }
});

// TODO: POST /verify    - check code, set verified = true
// TODO: POST /login     - bcrypt.compare, block unverified, set req.session.userId
// TODO: POST /logout    - req.session.destroy()

module.exports = router;
