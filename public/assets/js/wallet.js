const walletMoney = (cents) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
const form = document.querySelector("#funding-form"),
  message = document.querySelector("#wallet-message"),
  fundingMessage = document.querySelector("#funding-message");
let pending = null;
async function loadWallet() {
  try {
    const [balance, history] = await Promise.all([
      fetch("/api/wallet"),
      fetch("/api/wallet/deposits"),
    ]);
    const data = await balance.json();
    if (!balance.ok) throw new Error(data.error);
    document.querySelector("#balance-total").textContent = walletMoney(
      data.wallet.balance_cents,
    );
    document.querySelector("#balance-reserved").textContent = walletMoney(
      data.wallet.reserved_cents,
    );
    document.querySelector("#balance-available").textContent = walletMoney(
      data.wallet.available_cents,
    );
    message.textContent = "";
    if (history.ok) {
      const deposits = await history.json();
      form.querySelector("button").disabled = !deposits.fundingAvailable;
      if (!deposits.fundingAvailable)
        fundingMessage.textContent =
          "Stripe test funding has not been configured yet.";
      const target = document.querySelector("#deposits");
      target.replaceChildren();
      if (!deposits.deposits.length) target.textContent = "No deposits yet.";
      for (const deposit of deposits.deposits) {
        const row = document.createElement("p");
        row.textContent =
          walletMoney(deposit.amount_cents) +
          " — " +
          deposit.status +
          " — " +
          new Date(deposit.created_at).toLocaleString();
        target.append(row);
      }
    } else fundingMessage.textContent = "Deposit history is unavailable.";
    const transfers = document.querySelector("#auction-transfers");
    if (transfers) {
      const response = await fetch("/api/auction-history", {
        cache: "no-store",
      });
      if (!response.ok) {
        transfers.textContent = "Auction history is unavailable.";
        return;
      }
      const data = await response.json();
      transfers.replaceChildren();
      if (!data.purchases.length && !data.sales.length)
        transfers.textContent = "No completed auction purchases or sales yet.";
      for (const [kind, rows] of [
        ["Purchased", data.purchases],
        ["Sold", data.sales],
      ]) {
        for (const row of rows) {
          const entry = document.createElement("p");
          const link = document.createElement("a");
          link.href =
            "/auctions/detail.html?id=" + encodeURIComponent(row.auction_id);
          link.textContent = row.title;
          entry.append(
            kind + " ",
            link,
            " — " +
              walletMoney(row.amount_cents) +
              " — " +
              new Date(row.created_at).toLocaleString(),
          );
          transfers.append(entry);
        }
      }
    }
  } catch (error) {
    message.textContent = error.message || "Unable to load your wallet.";
  }
}
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const amount = form.elements.amount.value;
  if (pending && pending.amount !== amount) {
    fundingMessage.textContent =
      "Retry the same amount first to confirm the previous request.";
    return;
  }
  pending = pending || { amount, requestId: crypto.randomUUID() };
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    const r = await fetch("/api/wallet/checkout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "DragonExchange",
      },
      body: JSON.stringify(pending),
    });
    const result = await r.json();
    if (!r.ok) {
      if (r.status < 500) pending = null;
      throw new Error(result.error);
    }
    if (result.credited) {
      pending = null;
      await loadWallet();
      return;
    }
    const url = new URL(result.url);
    if (url.protocol !== "https:" || url.hostname !== "checkout.stripe.com")
      throw new Error("Unexpected checkout destination.");
    location.assign(url.href);
  } catch (error) {
    fundingMessage.textContent = error.message || "Unable to start checkout.";
    button.disabled = false;
  }
});
document.querySelector("#refresh-wallet").addEventListener("click", loadWallet);
if (new URLSearchParams(location.search).get("checkout") === "returned")
  fundingMessage.textContent =
    "Returned from checkout. Funds are credited only after payment confirmation. Refresh to check.";
loadWallet();
