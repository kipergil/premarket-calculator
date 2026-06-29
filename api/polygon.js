export default async function handler(req, res) {
  const apiKey = process.env.VITE_POLYGON_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "VITE_POLYGON_API_KEY not configured" });

  // The frontend sends the full Polygon path (e.g. /api/polygon/v2/snapshot/.../tickers/AAPL).
  // Strip the /api/polygon prefix and forward the rest to Polygon, injecting the server-side key.
  const path = (req.url || "").replace(/^\/api\/polygon/, "");
  const url = new URL("https://api.polygon.io" + path);
  url.searchParams.set("apiKey", apiKey);

  try {
    const response = await fetch(url.toString());
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
