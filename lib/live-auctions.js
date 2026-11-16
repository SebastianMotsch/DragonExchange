// Adapted from the professor's ws/ws/src/server.js:
// createServer(app), new Server(server), socket.join(room), io.to(room).emit(...).
const { createServer } = require("node:http");
const { Server } = require("socket.io");
const { snapshot, validId } = require("./auction-state");
const { placeBid, BidError } = require("./bidding");
function createAuctionServer(app, db) {
  const server = createServer(app);
  const io = new Server(server, {
    transports: ["websocket"],
    maxHttpBufferSize: 16384,
  });
  app.locals.io = io;
  const sessions = app.locals.sessionMiddleware;
  const attempts = new Map();
  io.engine.use((req, res, next) => {
    const origin = req.headers.origin;
    const allowed =
      process.env.APP_ORIGIN ||
      (req.socket.encrypted ? "https://" : "http://") + req.headers.host;
    if (origin && origin !== allowed) return next(new Error("Origin rejected"));
    if (!sessions) return next(new Error("Authentication unavailable"));
    sessions(req, res, next);
  });
  io.engine.use(async (req, res, next) => {
    try {
      if (!req.session?.userId) return next(new Error("Login required"));
      const user = await db.query("SELECT verified FROM users WHERE id=$1", [
        req.session.userId,
      ]);
      if (!user.rows[0]?.verified)
        return next(new Error("Verified account required"));
      next();
    } catch {
      next(new Error("Authentication unavailable"));
    }
  });
  async function authorize(socket) {
    await new Promise((resolve, reject) =>
      socket.request.session.reload((error) =>
        error ? reject(error) : resolve(),
      ),
    );
    if (!socket.request.session.userId) throw new Error("Login required");
    const result = await db.query("SELECT verified FROM users WHERE id=$1", [
      socket.request.session.userId,
    ]);
    if (!result.rows[0]?.verified) throw new Error("Verified account required");
    return socket.request.session.userId;
  }
  io.on("connection", (socket) => {
    socket.join("session:" + socket.request.sessionID);
    let joined = null;
    let changingRoom = false;
    let placing = false;
    socket.on("JOIN_AUCTION_ROOM", async (data, ack) => {
      if (typeof ack !== "function") return;
      if (changingRoom)
        return ack({
          ok: false,
          error: "Please wait for the current subscription.",
        });
      changingRoom = true;
      try {
        await authorize(socket);
        if (!data || !validId(data.auctionId))
          return ack({ ok: false, error: "Auction not found." });
        if (joined) await socket.leave("auction:" + joined);
        joined = String(data.auctionId);
        await socket.join("auction:" + joined);
        const state = await snapshot(db, joined);
        if (!state) {
          await socket.leave("auction:" + joined);
          joined = null;
          return ack({ ok: false, error: "Auction not found." });
        }
        ack({ ok: true, state });
      } catch {
        ack({ ok: false, error: "Please log in again." });
        socket.disconnect(true);
      } finally {
        changingRoom = false;
      }
    });
    socket.on("LEAVE_AUCTION_ROOM", () => {
      if (joined) socket.leave("auction:" + joined);
      joined = null;
    });
    socket.on("PLACE_BID", async (data, ack) => {
      if (typeof ack !== "function") return;
      if (placing)
        return ack({
          ok: false,
          code: "BUSY",
          error: "Wait for your previous bid.",
        });
      placing = true;
      try {
        const userId = await authorize(socket);
        const now = Date.now();
        if (now - (attempts.get(userId) || 0) < 500)
          return ack({
            ok: false,
            code: "RATE_LIMITED",
            error: "Please wait before bidding again.",
          });
        attempts.set(userId, now);
        if (!joined || String(data?.auctionId) !== joined)
          return ack({ ok: false, error: "Open this auction before bidding." });
        const result = await placeBid(db, userId, data);
        // Database commit happens before any broadcast.
        if (!result.duplicate)
          io.to("auction:" + result.state.id).emit(
            "BID_ACCEPTED",
            result.state,
          );
        ack(result);
      } catch (error) {
        if (error instanceof BidError)
          ack({ ok: false, code: error.code, error: error.message });
        else {
          ack({
            ok: false,
            error:
              "Unable to confirm this bid. Reconnect and check the current state.",
          });
          socket.disconnect(true);
        }
      } finally {
        placing = false;
      }
    });
  });
  // Recheck expired sessions and provide snapshots even if the last broadcast was missed.
  const timer = setInterval(async () => {
    for (const [userId, time] of attempts)
      if (Date.now() - time > 60000) attempts.delete(userId);
    for (const socket of io.sockets.sockets.values()) {
      try {
        await authorize(socket);
        for (const room of socket.rooms)
          if (room.startsWith("auction:")) {
            const state = await snapshot(db, room.slice(8));
            if (state) socket.emit("AUCTION_STATE", state);
          }
      } catch {
        socket.disconnect(true);
      }
    }
  }, 15000);
  timer.unref();
  io.on("close", () => clearInterval(timer));
  server.on("close", () => clearInterval(timer));
  return { server, io };
}
module.exports = { createAuctionServer };
