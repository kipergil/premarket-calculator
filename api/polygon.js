export default async function handler(req, res) {
  const apiKey = process.env.VITE_POLYGON_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "VITE_POLYGON_API_KEY not configured" });

  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: "ticker query param required" });

  const url = `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${encodeURIComponent(ticker.toUpperCase())}?apiKey=${apiKey}`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}