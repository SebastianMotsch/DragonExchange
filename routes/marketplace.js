const { categories } = require("../lib/auction-input");

const orders = new Map([
  ["newest", "created_at DESC, sale_type, id DESC"],
  ["price-asc", "price_cents ASC, created_at DESC, sale_type, id DESC"],
  ["price-desc", "price_cents DESC, created_at DESC, sale_type, id DESC"],
]);
const pageSize = 24;

function parsePrice(value) {
  if (value === "") return null;
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(value)) return NaN;
  const [dollars, cents = ""] = value.split(".");
  const amount = Number(dollars) * 100 + Number(cents.padEnd(2, "0"));
  return amount <= 2147483647 ? amount : NaN;
}

module.exports = (db, configured) => async (req, res) => {
  res.set("Cache-Control", "no-store");
  const { q = "", category = "", type = "", min = "", max = "", sort = "newest", page = "1" } = req.query;
  if ([q, category, type, min, max, sort, page].some(value => typeof value !== "string")) {
    return res.status(400).json({ error: "Use one value for each filter." });
  }
  const minimum = parsePrice(min);
  const maximum = parsePrice(max);
  if (q.length > 150 || (category && !categories.includes(category)) ||
      !["", "auction", "fixed"].includes(type) || !orders.has(sort) ||
      !/^[1-9]\d{0,5}$/.test(page)) {
    return res.status(400).json({ error: "Check your search filters and try again." });
  }
  if (Number.isNaN(minimum) || Number.isNaN(maximum) ||
      (minimum !== null && maximum !== null && minimum > maximum)) {
    return res.status(400).json({ error: "Enter a valid price range in dollars and cents." });
  }
  if (!configured()) {
    return res.status(503).json({ error: "Listings are temporarily unavailable." });
  }

  try {
    const { rows } = await db.query(
      `WITH available AS (
         SELECT id, title, description, category, price_cents, created_at,
                NULL::timestamptz AS ends_at, 'fixed' AS sale_type
         FROM public.listings
         WHERE type = 'regular' AND status = 'active' AND $3::text IN ('', 'fixed')
         UNION ALL
         SELECT id, title, description, category,
                COALESCE(current_bid_cents, starting_price_cents) AS price_cents,
                created_at, ends_at, 'auction' AS sale_type
         FROM public.auctions
         WHERE status = 'active' AND ends_at > now() AND $3::text IN ('', 'auction')
       )
       SELECT id, title, category, price_cents, created_at, ends_at, sale_type
       FROM available
       WHERE ($1::text = '' OR strpos(lower(title), lower($1)) > 0
                            OR strpos(lower(description), lower($1)) > 0)
         AND ($2::text = '' OR category = $2)
         AND ($4::integer IS NULL OR price_cents >= $4)
         AND ($5::integer IS NULL OR price_cents <= $5)
       ORDER BY ${orders.get(sort)}
       LIMIT $6 OFFSET $7`,
      [q.trim(), category, type, minimum, maximum, pageSize + 1, (Number(page) - 1) * pageSize],
    );
    return res.json({ listings: rows.slice(0, pageSize), hasMore: rows.length > pageSize });
  } catch (error) {
    console.error("Marketplace search failed:", error.code || "database error");
    return res.status(503).json({ error: "Could not load listings. Try again shortly." });
  }
};
