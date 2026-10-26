const express = require("express");
const router = express.Router();
const db = require("../db");

// TODO: POST /register  - drexel.edu only, hash password, send verify code
// TODO: POST /verify    - check code, set verified = true
// TODO: POST /login     - bcrypt.compare, block unverified, set req.session.userId
// TODO: POST /logout    - req.session.destroy()

module.exports = router;