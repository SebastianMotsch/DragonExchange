const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
async function readResponse(response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.errors ? Object.values(data.errors).join(' ') : data.error);
  return data;
}
function addText(parent, tag, text) {
  const node = document.createElement(tag);
  node.textContent = text;
  parent.append(node);
  return node;
}
function renderAuction(parent, auction, detail = false) {
  const article = document.createElement('article');
  const heading = addText(article, detail ? 'h1' : 'h3', '');
  const link = document.createElement('a');
  link.href = '/auctions/detail.html?id=' + encodeURIComponent(auction.id);
  link.textContent = auction.title;
  heading.append(link);
  addText(article, 'p', auction.category);
  if (detail) addText(article, 'p', auction.description).style.whiteSpace = 'pre-wrap';
  addText(article, 'p', 'Starting bid: ' + money(auction.starting_price_cents));
  addText(article, 'p', 'Status: ' + auction.status);
  addText(article, 'p', 'Bidding ends: ' + new Date(auction.ends_at).toLocaleString());
  addText(article, 'p', 'No bids yet.');
  if (detail) addText(article, 'p', 'Bidding is not available yet.');
  parent.append(article);
}
const auctionForm = document.querySelector('#auction-form');
if (auctionForm) {
  auctionForm.addEventListener('submit', async event => {
    event.preventDefault();
    const button = auctionForm.querySelector('button');
    const status = auctionForm.querySelector('.status');
    button.disabled = true;
    status.textContent = 'Saving auction…';
    try {
      const fields = new FormData(auctionForm);
      const localEnd = new Date(fields.get('ends'));
      if (!Number.isFinite(localEnd.getTime()) || localEnd.getTime() <= Date.now()) throw new Error('Choose a future end time.');
      const { auction } = await readResponse(await fetch('/api/auctions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'DragonExchange' },
        body: JSON.stringify({ title: fields.get('title'), description: fields.get('description'), category: fields.get('category'), startingPrice: fields.get('price'), endsAt: localEnd.toISOString() })
      }));
      window.location.assign('/auctions/detail.html?id=' + encodeURIComponent(auction.id));
    } catch (error) { status.textContent = error.message || 'Unable to save the auction.'; }
    finally { button.disabled = false; }
  });
}
const auctionList = document.querySelector('#auction-list');
const auctionDetail = document.querySelector('#auction-detail');
if (auctionList || auctionDetail) {
  const target = auctionList || auctionDetail;
  const status = document.querySelector('#auction-status');
  (async () => {
    try {
      if (auctionList) {
        const { auctions } = await readResponse(await fetch('/api/auctions'));
        status.textContent = auctions.length === 50 ? 'Showing the 50 most recent auctions.' : auctions.length ? '' : 'No auctions yet. Create the first one from the Sell page.';
        auctions.forEach(auction => renderAuction(target, auction));
      } else {
        const id = new URLSearchParams(window.location.search).get('id');
        if (!id || !/^[1-9]\d*$/.test(id)) throw new Error('Auction not found.');
        const { auction } = await readResponse(await fetch('/api/auctions/' + encodeURIComponent(id)));
        status.textContent = '';
        document.title = auction.title + ' | DragonExchange';
        renderAuction(target, auction, true);
      }
    } catch (error) { status.textContent = error.message || 'Unable to load auctions.'; }
  })();
}
