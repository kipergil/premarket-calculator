export default async function handler(req, res) {
  // The frontend sends the full Yahoo path (e.g. /api/yahoo/v8/finance/chart/AAPL?...).
  // Strip the /api/yahoo prefix and forward the rest to Yahoo Finance.
  const path = (req.url || "").replace(/^\/api\/yahoo/, "");
  const url = "https://query1.finance.yahoo.com" + path;

  try {
    const response = await fetch(url, {
      headers: {
        // Yahoo blocks requests without a browser-like User-Agent.
        "User-Agent": "Mozilla/5.0 (compatible; PremarketCalc/1.0)",
        "Accept": "application/json",
      },
    });
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
