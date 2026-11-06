const categories = ['Books', 'Electronics', 'Furniture', 'Clothing', 'Other'];
function validateAuction(body = {}, now = Date.now()) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) body = {};
  const errors = {};
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  if (!title || title.length > 120) errors.title = 'Enter a title of 1–120 characters.';
  if (!description || description.length > 5000) errors.description = 'Enter a description of 1–5000 characters.';
  if (!categories.includes(body.category)) errors.category = 'Choose a valid category.';
  // Accept a decimal string, never a floating-point money calculation.
  const price = typeof body.startingPrice === 'string' ? body.startingPrice : '';
  let cents;
  if (/^\d{1,8}(\.\d{1,2})?$/.test(price)) {
    const [whole, fraction = ''] = price.split('.');
    cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  }
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > 2147483647) {
    errors.startingPrice = 'Enter a positive price up to $21,474,836.47 with at most two decimal places.';
  }
  const end = typeof body.endsAt === 'string' && /Z$|[+-]\d{2}:\d{2}$/.test(body.endsAt)
    ? Date.parse(body.endsAt) : NaN;
  if (!Number.isFinite(end) || end <= now) errors.endsAt = 'Choose a future end time.';
  return { errors, value: { title, description, category: body.category, cents, endsAt: Number.isFinite(end) ? new Date(end).toISOString() : null } };
}
module.exports = { validateAuction };
