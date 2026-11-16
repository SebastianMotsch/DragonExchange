require("dotenv").config();
const db = require("./db");
const { createApp } = require("./app");
const { createAuctionServer } = require("./lib/live-auctions");
const app = createApp({ db });
if (require.main === module) {
  const { server } = createAuctionServer(app, db);
  const port = process.env.PORT || 3000;
  server.listen(port, () => console.log("Running on http://localhost:" + port));
}
module.exports = app;
