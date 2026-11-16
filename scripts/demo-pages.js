// Browser fixtures for the standalone local demo; never mounted by server.js.
const express = require("express");
const fs = require("node:fs");
const path = require("node:path");
module.exports = function demoPages(app) {
  const fixtures = path.join(__dirname, "demo-public");
  app.use("/__demo", express.static(fixtures));
  app.get("/auth/login.html", (req, res) => res.sendFile(path.join(fixtures, "login.html")));
  for (const route of ["/", "/index.html", "/auctions/create.html", "/auctions/detail.html"]) {
    app.get(route, (req, res) => {
      const file = route === "/" ? "index.html" : route.slice(1);
      const html = fs.readFileSync(path.join(__dirname, "../public", file), "utf8");
      res.type("html").send(html.replace("</head>", '<script src="/__demo/account.js" defer></script></head>'));
    });
  }
};
