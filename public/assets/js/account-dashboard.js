// Dashboard sections for issue #12: wallet, bids, auctions, and past listings.
// Current listings, purchases, and sales are loaded by dashboard.js and purchase-history.js.
// Each section shows its own loading, empty, logged-out, and error message.
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function formatCents(cents) {
  return money.format(Number(cents) / 100);
}

function formatDate(value) {
  return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

// Fetches one section's data. Returns null and sets the status text if it fails.
async function fetchSection(url, status, loginText, errorText) {
  try {
    const response = await fetch(url, { credentials: "same-origin", cache: "no-store" });
    if (response.status === 401) {
      status.textContent = loginText;
      return null;
    }
    if (!response.ok) throw new Error("Request failed");
    return await response.json();
  } catch {
    status.textContent = errorText;
    return null;
  }
}

function addEntry(container, title, href, lines) {
  const entry = document.createElement("div");
  entry.className = "history-entry";
  const heading = document.createElement("h3");
  const link = document.createElement("a");
  link.href = href;
  link.textContent = title;
  heading.append(link);
  entry.append(heading);
  for (const text of lines) {
    const line = document.createElement("p");
    line.textContent = text;
    entry.append(line);
  }
  container.append(entry);
}

function showCount(status, count, limit, emptyText) {
  if (count === 0) status.textContent = emptyText;
  else if (count >= limit) status.textContent = "Showing your " + limit + " most recent.";
  else status.textContent = "";
}

async function loadWallet() {
  const status = document.querySelector("#wallet-status");
  const data = await fetchSection("/api/wallet", status,
    "Log in to see your balance.",
    "Could not load your balance. Refresh the page to try again.");
  if (!data) return;
  document.querySelector("#wallet-total").textContent = formatCents(data.wallet.balance_cents);
  document.querySelector("#wallet-reserved").textContent = formatCents(data.wallet.reserved_cents);
  document.querySelector("#wallet-available").textContent = formatCents(data.wallet.available_cents);
  document.querySelector("#wallet-summary").hidden = false;
  status.textContent = "";
}

const outcomeText = {
  leading: "You're the highest bidder",
  outbid: "You've been outbid",
  won: "You won this auction",
  lost: "Auction ended. Another bidder won",
  cancelled: "This auction was cancelled",
};

async function loadBids() {
  const status = document.querySelector("#bids-status");
  const container = document.querySelector("#my-bids");
  const data = await fetchSection("/api/account/bids", status,
    "Log in to see your bids.",
    "Could not load your bids. Refresh the page to try again.");
  if (!data) return;
  for (const bid of data.bids) {
    const bidWord = bid.my_bid_count === 1 ? "bid" : "bids";
    addEntry(container, bid.title, "../auctions/detail.html?id=" + bid.auction_id, [
      outcomeText[bid.outcome],
      "Your top bid: " + formatCents(bid.my_top_bid_cents) + " (" + bid.my_bid_count + " " + bidWord + ")",
      "Current bid: " + formatCents(bid.current_bid_cents),
      (bid.ended ? "Ended " : "Ends ") + formatDate(bid.ends_at),
    ]);
  }
  showCount(status, data.bids.length, data.limit, "You haven't bid on any auctions yet.");
}

function sellerAuctionState(auction) {
  if (auction.status === "cancelled") return "Cancelled";
  if (auction.ended && auction.current_bid_cents === null) return "Ended with no bids";
  if (auction.ended) {
    return "Sold to " + (auction.leading_bidder_name || "the highest bidder") +
      " for " + formatCents(auction.current_bid_cents);
  }
  if (auction.current_bid_cents === null) {
    return "No bids yet. Starting price " + formatCents(auction.starting_price_cents);
  }
  const bidWord = auction.bid_count === 1 ? "bid" : "bids";
  return "Current bid " + formatCents(auction.current_bid_cents) + " (" + auction.bid_count + " " + bidWord + ")";
}

async function loadAuctions() {
  const status = document.querySelector("#auctions-status");
  const container = document.querySelector("#my-auctions");
  const data = await fetchSection("/api/account/auctions", status,
    "Log in to see your auctions.",
    "Could not load your auctions. Refresh the page to try again.");
  if (!data) return;
  for (const auction of data.auctions) {
    addEntry(container, auction.title, "../auctions/detail.html?id=" + auction.id, [
      sellerAuctionState(auction),
      (auction.ended ? "Ended " : "Ends ") + formatDate(auction.ends_at),
    ]);
  }
  showCount(status, data.auctions.length, data.limit, "You haven't created any auctions yet.");
}

async function loadPastListings() {
  const status = document.querySelector("#past-listings-status");
  const container = document.querySelector("#past-listings");
  const data = await fetchSection("/api/account/past-listings", status,
    "Log in to see your past listings.",
    "Could not load your past listings. Refresh the page to try again.");
  if (!data) return;
  for (const listing of data.listings) {
    const state = listing.status === "sold" ? "Sold" : "No longer active";
    addEntry(container, listing.title, "../listings/detail.html?id=" + listing.id, [
      state + " · " + formatCents(listing.price_cents),
      "Listed " + formatDate(listing.created_at),
    ]);
  }
  showCount(status, data.listings.length, data.limit, "No past listings yet. Sold listings will show here.");
}

loadWallet();
loadBids();
loadAuctions();
loadPastListings();
