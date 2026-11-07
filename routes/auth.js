const express = require("express");
const router = express.Router();

router.post("/register", function (req, res) {
  if (!req.body || typeof req.body.name !== "string" || typeof req.body.email !== "string" || typeof req.body.password !== "string") {
    return res.status(400).json({ error: "Name, email, and password are required and must be text." });
  }

  const name = req.body.name.trim();
  const email = req.body.email.trim().toLowerCase();
  const password = req.body.password;

  if (name === "") {
    return res.status(422).json({ error: "Enter your display name." });
  }

  const emailParts = email.split("@");
  if (emailParts.length !== 2 || emailParts[0] === "" || emailParts[1] !== "drexel.edu") {
    return res.status(422).json({ error: "Enter a valid Drexel University email address." });
  }

  // only letters and numbers are allowed before @drexel.edu (excluding the first.middle.last format and aliases)
  const emailCharacters = "abcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < emailParts[0].length; i++) {
    if (!emailCharacters.includes(emailParts[0][i])) {
      return res.status(422).json({ error: "Make sure to use a valid Drexel email address." });
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
    return res.status(422).json({ error: "Use at least 8 characters, one uppercase letter, one number, and one special character." });
  }

  // TODO: Hash the password, save an unverified account, and trigger verification.
  return res.status(501).json({ error: "Account creation is not implemented yet. Make sure to come back to this after hashing, saving the account, and triggering verification." });
});

// TODO: POST /verify    - check code, set verified = true
// TODO: POST /login     - bcrypt.compare, block unverified, set req.session.userId
// TODO: POST /logout    - req.session.destroy()

module.exports = router;
