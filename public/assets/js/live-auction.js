// Same client pattern as the professor's game.html: io(), emit(), on().
function startLiveAuction(id, initial) {
  const status = document.querySelector("#live-status");
  const form = document.querySelector("#bid-form");
  const button = form.querySelector("button");
  const amount = form.querySelector("input");
  const feedback = document.querySelector("#bid-status");
  const walletText = document.querySelector("#wallet-status");
  let state = initial,
    ready = false,
    pending = null;
  function apply(next) {
    if (Number(next.id) !== Number(id) || next.version < state.version) return;
    state = next;
    const target = document.querySelector("#auction-detail");
    target.replaceChildren();
    renderAuction(target, state, true);
    amount.min = (
      (state.current_bid_cents === null
        ? state.starting_price_cents
        : state.current_bid_cents + state.min_increment_cents) / 100
    ).toFixed(2);
    button.disabled = !ready || state.status !== "active";
  }
  async function balance() {
    try {
      const response = await fetch("/api/wallet");
      if (!response.ok) return;
      const { wallet } = await response.json();
      walletText.textContent =
        "Available: " +
        money(wallet.available_cents) +
        " · Reserved: " +
        money(wallet.reserved_cents);
    } catch {}
  }
  const socket = io({
    transports: ["websocket"],
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30000,
    randomizationFactor: 0.5,
    autoConnect: false,
  });
  socket.on("BID_ACCEPTED", (next) => {
    apply(next);
    balance();
  });
  socket.on("AUCTION_STATE", (next) => {
    apply(next);
    balance();
  });
  socket.on("connect", () => {
    ready = false;
    button.disabled = true;
    status.textContent = "Synchronizing auction…";
    socket
      .timeout(10000)
      .emit("JOIN_AUCTION_ROOM", { auctionId: id }, (error, result) => {
        if (error || !result?.ok) {
          socket.disconnect();
          status.textContent =
            result?.error || "Unable to synchronize. Refresh to retry.";
          return;
        }
        ready = true;
        document.querySelector("#bid-login").hidden = true;
        apply(result.state);
        balance();
        status.textContent = "Live updates connected.";
      });
  });
  socket.on("disconnect", () => {
    ready = false;
    button.disabled = true;
    status.textContent = "Disconnected. Waiting to reconnect…";
  });
  socket.on("connect_error", () => {
    ready = false;
    button.disabled = true;
    status.textContent =
      "Live bidding requires a verified login. Log in, then refresh this page.";
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) location.reload();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!ready || state.status !== "active") return;
    if (pending && pending.amount !== amount.value) {
      feedback.textContent =
        "Retry the unchanged bid first so its result can be confirmed.";
      return;
    }
    pending = pending || {
      auctionId: id,
      amount: amount.value,
      requestId: crypto.randomUUID(),
    };
    button.disabled = true;
    feedback.textContent = "Submitting bid…";
    socket.timeout(10000).emit("PLACE_BID", pending, (error, result) => {
      button.disabled = !ready || state.status !== "active";
      if (error) {
        feedback.textContent =
          "Result not confirmed. Retry the same bid to check it safely.";
        return;
      }
      if (result?.ok) {
        apply(result.state);
        feedback.textContent = "Bid accepted.";
      } else feedback.textContent = result?.error || "Bid rejected.";
      pending = null;
      balance();
    });
  });
  socket.connect();
}
