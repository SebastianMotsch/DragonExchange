const { rateLimit } = require("express-rate-limit");

function skipInvalidEmail(req) {
  if (!req.body) {
    return true;
  }

  if (typeof req.body.email !== "string") {
    return true;
  }

  const email = req.body.email.trim().toLowerCase();
  const emailParts = email.split("@");

  if (emailParts.length !== 2) {
    return true;
  }

  const username = emailParts[0];
  const domain = emailParts[1];

  if (username === "" || domain !== "drexel.edu") {
    return true;
  }

  const allowedCharacters = "abcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < username.length; i++) {
    if (!allowedCharacters.includes(username[i])) {
      return true;
    }
  }

  return false;
}

function getEmailKey(req) {
  const email = req.body.email.trim().toLowerCase();
  return email;
}

// Students on campus can share a public IP so attempts are counted by email
const registrationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInvalidEmail,
  keyGenerator: getEmailKey,
  message: {
    error: "Too many attempts with this email. Please wait 15 minutes before trying again."
  }
});

module.exports = registrationLimiter;
